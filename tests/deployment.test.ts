import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deploymentConfig, secretReference } from '../apps/deploy/src/config.ts';
import { commandRunner, redact, resolveWindowsCommand, windowsInvocation } from '../apps/deploy/src/commands.ts';
import type { CommandResult, DeployContext, RunCommand } from '../apps/deploy/src/commands.ts';
import { ensureSecret } from '../apps/deploy/src/secrets.ts';
import { deploy, preflight, stackOutputs, samArguments } from '../apps/deploy/src/workflow.ts';
import { smokeDeployment } from '../apps/deploy/src/smoke.ts';

const SOURCE = 'AWS_ACCOUNT_ID=123456789012\nAWS_REGION=us-east-1\nAWS_PROFILE=demo\nDEPLOY_ALERT_EMAIL=alerts@example.com\nORS_API_KEY=test-routing-key-not-real\nDEPLOY_APPROVED=true\n';
const ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:paanipath/paanipath-ncr/runtime-ABC123';
const VERSION = '11111111-1111-4111-8111-111111111111';
const config = deploymentConfig(SOURCE);
const success = (value: unknown): CommandResult => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const output = { Stacks: [{ Outputs: [
  { OutputKey: 'WebsiteUrl', OutputValue: 'https://d123abc.cloudfront.net' },
  { OutputKey: 'WebBucketName', OutputValue: 'paanipath-ncr-webbucket-demo' },
  { OutputKey: 'DistributionId', OutputValue: 'E123ABC' },
  { OutputKey: 'ApiUrl', OutputValue: 'https://abc.execute-api.us-east-1.amazonaws.com' },
] }] };
const context = (run: RunCommand, root = tmpdir()): DeployContext => ({ run, root, config, log: () => {} });

test('deployment config validates account, Virginia, credentials, secrets and inert boolean settings', () => {
  assert.equal(config.region, 'us-east-1'); assert.equal(config.concurrency, 0); assert.equal(config.sessionSecret, '');
  assert.throws(() => deploymentConfig(SOURCE.replace('us-east-1', 'ap-south-1')), /Northern Virginia/);
  assert.throws(() => deploymentConfig(SOURCE.replace('123456789012', '123')), /12-digit/);
  assert.throws(() => deploymentConfig(SOURCE + 'SECRET_TYPO=x'), /Unknown deployment/);
  assert.throws(() => deploymentConfig(SOURCE + 'SESSION_SECRET=short'), /32 characters/);
  assert.throws(() => deploymentConfig(SOURCE + 'ORS_URL=https://user:password@example.com'), /without credentials/);
  assert.throws(() => deploymentConfig(SOURCE + 'SEED_MODE=maybe'), /true or false/);
  assert.throws(() => deploymentConfig(SOURCE + 'AWS_ACCESS_KEY_ID=fake\nAWS_SECRET_ACCESS_KEY=fake'), /not both/);
});

test('Windows command literals cannot expand shell payloads and log redaction hides all supplied secrets', () => {
  const payload = "C:\\Aditya Raj\\$x';& echo token";
  const invocation = windowsInvocation('sam', ['--config-file', payload]);
  const source = Buffer.from(invocation[3] ?? '', 'base64').toString('utf16le');
  assert(source.includes("'C:\\Aditya Raj\\$x'';& echo token'")); assert(source.includes('exit $LASTEXITCODE'));
  assert(source.includes("$ErrorActionPreference = 'Stop'")); assert(source.includes('exit 1'));
  assert(source.includes('$null -eq $LASTEXITCODE'));
  assert.equal(redact('key=secret secret', ['secret']), 'key=[REDACTED] [REDACTED]');
});

test('Windows tool resolution uses absolute PATH entries and supports explicit SAM paths with spaces', () => {
  const sam = 'C:\\Program Files\\Amazon\\AWSSAMCLI\\bin\\sam.cmd';
  const exists = (path: string): boolean => path === sam || path === 'C:\\Node\\npm.cmd';
  assert.equal(resolveWindowsCommand('sam', { Path: 'relative;. ;"C:\\Program Files\\Amazon\\AWSSAMCLI\\bin"' }, exists), sam);
  assert.equal(resolveWindowsCommand(sam, {}, exists), sam);
  assert.equal(resolveWindowsCommand('npm', { PATH: 'C:\\Node' }, exists), 'C:\\Node\\npm.cmd');
  assert.throws(() => resolveWindowsCommand('sam', { PATH: 'C:\\Missing' }, exists), /SAM_CLI_PATH/);
  assert.throws(() => resolveWindowsCommand('C:\\Unsafe\\sam.ps1', {}, exists), /existing .exe/);
  assert.equal(deploymentConfig(SOURCE + `SAM_CLI_PATH="${sam}"`).samPath, sam);
  assert.throws(() => deploymentConfig(SOURCE + 'SAM_CLI_PATH=relative/sam'), /absolute/);
});

test('preflight rejects an unrelated sam executable before making any AWS identity or resource calls', async () => {
  const calls: string[] = [];
  const run: RunCommand = async (command, args) => {
    calls.push(`${command}:${args[0]}`);
    return { code: 0, stdout: command === 'aws' ? 'aws-cli/2.0' : 'unrelated-tool 1.0', stderr: '' };
  };
  await assert.rejects(preflight(context(run)), /not AWS SAM CLI/);
  assert.deepEqual(calls, ['aws:--version', 'sam:--version']);
});

test('approval/account mismatch aborts before quality gates or AWS writes', async () => {
  const calls: string[] = [];
  const run: RunCommand = async (command, args) => {
    calls.push(`${command} ${args[0]}`);
    if (command === 'sam') return success('SAM CLI, version 1.150.0');
    if (args[0] === '--version') return { code: 0, stdout: 'aws-cli/2.0', stderr: '' };
    return success({ Account: '999999999999', Arn: 'arn:aws:iam::999999999999:user/demo' });
  };
  await assert.rejects(preflight({ ...context(run), config: { ...config, approved: false } }), /DEPLOY_APPROVED/);
  assert.equal(calls.length, 0);
  await assert.rejects(preflight(context(run)), /account mismatch/); assert(!calls.some(call => call.startsWith('npm')));
});

test('SAM arguments use version-pinned secret references, correct region and no interactive change-set prompt', () => {
  const args = samArguments(context(async () => success({})), { arn: ARN, version: VERSION });
  assert(args.includes('--no-confirm-changeset')); assert(args.includes('--no-fail-on-empty-changeset'));
  assert(args.includes('us-east-1')); assert(!args.join(' ').includes(config.orsKey));
  assert(args.includes(`OrsApiKey=${secretReference(ARN, 'ORS_API_KEY', VERSION)}`));
  assert(args.includes('ReservedConcurrency=0'));
});

test('secret creation keeps plaintext out of command arguments and removes the private payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paanipath-deploy-'));
  try {
    const run: RunCommand = async (_command, args) => {
      if (args[1] === 'describe-secret') return { code: 1, stdout: '', stderr: 'ResourceNotFoundException' };
      assert(!args.includes(config.orsKey));
      const reference = args[args.indexOf('--secret-string') + 1]; assert(reference); assert(reference.startsWith('file://'));
      const body = JSON.parse(await readFile(reference.slice(7), 'utf8')) as Record<string, string>;
      assert.equal(body.ORS_API_KEY, config.orsKey); assert.equal(body.SESSION_SECRET?.length, 64);
      return success({ ARN, VersionId: VERSION });
    };
    assert.deepEqual(await ensureSecret(context(run, root)), { arn: ARN, version: VERSION });
    assert.deepEqual(await readdir(join(root, '.deploy', 'private')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unchanged deployments reuse the stored session/key version rather than rotating sessions', async () => {
  let calls = 0;
  const run: RunCommand = async (_command, args) => {
    calls++;
    if (args[1] === 'describe-secret') return success({ Tags: [{ Key: 'ManagedBy', Value: 'PaaniPathDeploy' }, { Key: 'StackName', Value: config.stack }] });
    return success({ ARN, VersionId: VERSION, SecretString: JSON.stringify({ ORS_API_KEY: config.orsKey, SESSION_SECRET: 's'.repeat(64) }) });
  };
  assert.deepEqual(await ensureSecret(context(run)), { arn: ARN, version: VERSION }); assert.equal(calls, 2);
});

test('stack output validation refuses foreign buckets and non-CloudFront web URLs', () => {
  assert.equal(stackOutputs(output, config).bucket, 'paanipath-ncr-webbucket-demo');
  assert.throws(() => stackOutputs(JSON.parse(JSON.stringify(output).replace('paanipath-ncr-webbucket-demo', 'foreign-bucket')) as Record<string, unknown>, config), /Refusing/);
  assert.throws(() => stackOutputs(JSON.parse(JSON.stringify(output).replace('d123abc.cloudfront.net', 'evil.example.com')) as Record<string, unknown>, config), /Refusing/);
});

test('mock deployment orders gates, secret provisioning, SAM, private upload, invalidation and smoke checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paanipath-deploy-flow-'));
  const calls: { command: string; args: readonly string[] }[] = [];
  let described = 0; let smoke = false;
  try {
    const run: RunCommand = async (command, args) => {
      calls.push({ command, args });
      if (command === 'sam' && args[0] === '--version') return success('SAM CLI, version 1.150.0');
      if (command === 'aws' && args[0] === '--version') return { code: 0, stdout: 'aws-cli/2.0', stderr: '' };
      if (args[0] === 'sts') return success({ Account: config.account, Arn: `arn:aws:iam::${config.account}:user/deployer` });
      if (args[1] === 'describe-stacks') return ++described === 1 ? { code: 1, stdout: '', stderr: 'ValidationError: Stack does not exist' } : success(output);
      if (args[1] === 'get-account-settings') return success({ AccountLimit: { ConcurrentExecutions: 10 } });
      if (args[1] === 'describe-secret') return { code: 1, stdout: '', stderr: 'ResourceNotFoundException' };
      if (args[1] === 'create-secret') return success({ ARN, VersionId: VERSION });
      if (args[1] === 'create-invalidation') return success({ Invalidation: { Id: 'I123' } });
      return success({});
    };
    const result = await deploy(context(run, root), async outputs => { assert.equal(outputs.website, 'https://d123abc.cloudfront.net'); smoke = true; });
    assert(smoke); assert.equal(result.distribution, 'E123ABC');
    const index = (command: string, arg: string): number => calls.findIndex(call => call.command === command && call.args.includes(arg));
    assert(index('npm', 'check') < index('aws', 'create-secret')); assert(index('sam', 'validate') < index('aws', 'create-secret'));
    assert(index('sam', 'deploy') < index('aws', 'cp')); assert(index('aws', 'cp') < index('aws', 'create-invalidation'));
    assert(calls.every(call => !call.args.includes('--delete') && !call.args.includes('public-read')));
    assert.equal(calls.filter(call => call.args.includes('--content-type')).length, 8);
    assert((await readFile(join(root, '.deploy', 'outputs.json'), 'utf8')).includes('us-east-1'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed local quality gate stops before secret/resource creation', async () => {
  const calls: string[] = [];
  const run: RunCommand = async (command, args) => {
    calls.push(`${command}:${args.join(',')}`);
    if (command === 'sam' && args[0] === '--version') return success('SAM CLI, version 1.150.0');
    if (command === 'aws' && args[0] === '--version') return { code: 0, stdout: 'aws-cli/2.0', stderr: '' };
    if (args[0] === 'sts') return success({ Account: config.account, Arn: `arn:aws:iam::${config.account}:user/demo` });
    if (args[1] === 'describe-stacks') return { code: 1, stdout: '', stderr: 'ValidationError: Stack does not exist' };
    if (args[1] === 'get-account-settings') return success({ AccountLimit: { ConcurrentExecutions: 10 } });
    if (command === 'npm' && args.includes('check')) return { code: 1, stdout: '', stderr: 'Test failure' };
    return success({});
  };
  await assert.rejects(deploy(context(run), async () => {}), /npm failed/);
  assert(!calls.some(call => call.includes('create-secret') || call.includes('sam:deploy') || call.includes('s3,')));
});

test('native command runner handles spaced paths, literal shell characters and streaming redaction', async testContext => {
  const messages: string[] = [];
  const run = commandRunner(process.cwd(), config, value => messages.push(value));
  const literal = "literal $variable ' & ; %PATH%";
  let result: CommandResult;
  try {
    result = await run(process.execPath, ['-e', 'console.log(process.argv[1]); console.log(process.argv[2]);', literal, config.orsKey], true);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      testContext.skip('This restricted environment forbids native child-process creation. CI/unrestricted terminals run this check.'); return;
    }
    throw error;
  }
  assert.equal(result.code, 0); assert(result.stdout.includes(literal));
  assert(messages.includes(literal)); assert(messages.includes('[REDACTED]'));
});

test('failed secret writes still remove private payloads and do not expose the supplied key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paanipath-deploy-failure-'));
  try {
    const run: RunCommand = async (_command, args) => args[1] === 'describe-secret'
      ? { code: 1, stdout: '', stderr: 'ResourceNotFoundException' }
      : { code: 1, stdout: '', stderr: `AccessDeniedException ${config.orsKey}` };
    await assert.rejects(ensureSecret(context(run, root)), error => error instanceof Error &&
      error.message.includes('AccessDeniedException') && !error.message.includes(config.orsKey));
    assert.deepEqual(await readdir(join(root, '.deploy', 'private')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public deployment smoke uses the real API contract, session cookie and asset MIME checks', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  const locations = [{ id: 'a', name: 'A', coords: [28.46, 77.03] }, { id: 'b', name: 'B', coords: [28.48, 77.04] }];
  let badMime = false;
  try {
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname; paths.push(path);
      if (path === '/api/health') return Response.json({ status: 'ok', graphSource: 'openrouteservice' });
      if (path === '/api/bootstrap') return Response.json({ journeys: Array.from({ length: 10 }, () => ({ locations })),
        profiles: [{ type: 'car', name: 'Car', marginal: 3, damaging: 4 }] }, { headers: { 'set-cookie': 'session=test; HttpOnly; Secure' } });
      if (path === '/api/routes') {
        assert.equal(init?.method, 'POST'); assert.equal(new Headers(init.headers).get('cookie'), 'session=test');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.deepEqual(body.locations, locations); assert.equal(body.detourFactor, 2);
        return Response.json({ routes: [{ recommended: true, fastest: true }], warning: 'Never enter standing water.' });
      }
      return new Response('asset', { headers: { 'content-type': path.endsWith('.js') && !badMime ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' } });
    };
    const outputs = stackOutputs(output, config);
    await smokeDeployment(outputs, true); assert(paths.includes('/api/routes'));
    paths.length = 0;
    await smokeDeployment(outputs, false); assert(!paths.includes('/api/routes'));
    badMime = true;
    await assert.rejects(smokeDeployment(outputs, false), /MIME type/);
  } finally { globalThis.fetch = original; }
});
