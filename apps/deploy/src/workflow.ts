import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aws, awsArgs, checked, record, string } from './commands.ts';
import type { DeployContext } from './commands.ts';
import { secretReference } from './config.ts';
import { ensureSecret } from './secrets.ts';
import type { SecretVersion } from './secrets.ts';

export interface DeploymentOutputs { readonly website: string; readonly bucket: string; readonly distribution: string; readonly api: string }

export function stackOutputs(response: Record<string, unknown>, config: DeployContext['config']): DeploymentOutputs {
  const stacks = Array.isArray(response.Stacks) ? response.Stacks : [];
  const stack = record(stacks[0]);
  const outputs = Array.isArray(stack.Outputs) ? stack.Outputs.map(record) : [];
  const get = (key: string): string => string(outputs.find(output => output.OutputKey === key)?.OutputValue, key);
  const result = { website: get('WebsiteUrl'), bucket: get('WebBucketName'), distribution: get('DistributionId'), api: get('ApiUrl') };
  if (!/^https:\/\/[a-z0-9-]+\.cloudfront\.net$/.test(result.website) || !/^[A-Z0-9]+$/.test(result.distribution) ||
      !/^[a-z0-9.-]{3,63}$/.test(result.bucket) || !result.bucket.startsWith(`${config.stack.toLowerCase()}-`)) throw new Error('Stack output targets are unexpected. Refusing frontend upload.');
  if (!new URL(result.api).hostname.endsWith(`.execute-api.${config.region}.amazonaws.com`)) throw new Error('API output is outside the selected region.');
  return result;
}

async function checkExistingStack(context: DeployContext): Promise<void> {
  const response = await context.run('aws', awsArgs(context.config, ['cloudformation', 'describe-stacks', '--stack-name', context.config.stack]));
  if (response.code !== 0) {
    if (/ValidationError[\s\S]*does not exist/i.test(response.stderr)) return;
    throw new Error('Cannot inspect target stack. Check CloudFormation read permissions and credentials.');
  }
  const body = record(JSON.parse(response.stdout));
  const stack = record((Array.isArray(body.Stacks) ? body.Stacks : [])[0]);
  const tags = Array.isArray(stack.Tags) ? stack.Tags.map(record) : [];
  if (!tags.some(tag => tag.Key === 'ManagedBy' && tag.Value === 'PaaniPathDeploy')) throw new Error('Target stack is not managed by this script. Choose another DEPLOY_STACK_NAME or review migration manually.');
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(string(stack.StackStatus, 'StackStatus'))) throw new Error('Stack is busy or failed. Inspect CloudFormation events; no automatic deletion is performed.');
}

export async function preflight(context: DeployContext): Promise<void> {
  if (!context.config.approved) throw new Error('Set DEPLOY_APPROVED=true only after reviewing the billable deployment plan.');
  context.log('Checking tools, AWS identity, target ownership and regional concurrency…');
  const version = await checked(context, 'aws', ['--version']);
  if (!version.includes('aws-cli/2.')) throw new Error('AWS CLI v2 is required.');
  await checked(context, 'sam', ['--version']);
  const identity = await aws(context, ['sts', 'get-caller-identity']);
  if (identity.Account !== context.config.account) throw new Error('AWS account mismatch. Nothing was deployed; review credentials/AWS_ACCOUNT_ID.');
  if (String(identity.Arn).endsWith(':root')) throw new Error('Do not deploy with root-account credentials. Use an approved IAM/SSO deployment identity.');
  await checkExistingStack(context);
  const account = await aws(context, ['lambda', 'get-account-settings']);
  const limits = record(account.AccountLimit);
  const concurrency = Number(limits.ConcurrentExecutions);
  if (!Number.isFinite(concurrency) || concurrency < 1) throw new Error('Regional Lambda concurrency is unavailable. Request capacity before deployment.');
  if (context.config.concurrency > 0 && concurrency < 100 + context.config.concurrency) throw new Error('Reserved concurrency exceeds this account quota. Use DEPLOY_RESERVED_CONCURRENCY=0 or request a quota increase.');
}

export function samArguments(context: DeployContext, secret: SecretVersion): string[] {
  const config = context.config;
  return ['deploy', '--template-file', 'infra/template.json', '--stack-name', config.stack, '--region', config.region,
    '--config-file', join(context.root, '.deploy', 'samconfig.toml'),
    ...(config.profile ? ['--profile', config.profile] : []), '--resolve-s3', '--capabilities', 'CAPABILITY_IAM',
    '--no-confirm-changeset', '--no-fail-on-empty-changeset', '--tags', 'ManagedBy=PaaniPathDeploy', 'Application=PaaniPath',
    '--parameter-overrides', `SessionSecret=${secretReference(secret.arn, 'SESSION_SECRET', secret.version)}`,
    `OrsApiKey=${secretReference(secret.arn, 'ORS_API_KEY', secret.version)}`, `DemoMode=${config.demoMode}`, `SeedMode=${config.seedMode}`,
    `PhotonUrl=${config.photonUrl}`, `OrsUrl=${config.orsUrl}`, `FunctionMemory=${config.memory}`, `ReservedConcurrency=${config.concurrency}`,
    `AlertEmail=${config.email}`, `MonthlyBudgetUsd=${config.budget}`];
}

export async function publish(context: DeployContext, outputs: DeploymentOutputs): Promise<void> {
  context.log('Uploading version-matched web assets to the stack-owned private bucket…');
  await checked(context, 'aws', awsArgs(context.config, ['s3', 'cp', 'dist/web', `s3://${outputs.bucket}/`, '--recursive',
    '--exclude', 'index.html', '--exclude', '*.js', '--exclude', '*.css', '--exclude', '*.svg', '--exclude', '*.json', '--exclude', '*.webmanifest',
    '--cache-control', 'public,max-age=300', '--only-show-errors']));
  for (const [pattern, type] of [['*.js', 'application/javascript'], ['*.css', 'text/css'], ['*.svg', 'image/svg+xml'],
    ['*.json', 'application/json'], ['*.webmanifest', 'application/manifest+json']]) {
    await checked(context, 'aws', awsArgs(context.config, ['s3', 'cp', 'dist/web', `s3://${outputs.bucket}/`, '--recursive',
      '--exclude', '*', '--include', pattern ?? '', '--exclude', 'sw.js', '--exclude', 'asset-manifest.json',
      '--content-type', type ?? '', '--cache-control', 'public,max-age=300', '--only-show-errors']));
  }
  // Entrypoints last, never --delete / public ACL. This reduces but does not eliminate mixed-version risk.
  for (const path of ['asset-manifest.json', 'sw.js', 'index.html']) {
    await checked(context, 'aws', awsArgs(context.config, ['s3', 'cp', `dist/web/${path}`, `s3://${outputs.bucket}/${path}`,
      '--content-type', path === 'index.html' ? 'text/html' : path === 'sw.js' ? 'application/javascript' : 'application/json',
      '--cache-control', 'no-cache,no-store,must-revalidate', '--only-show-errors']));
  }
  context.log('Waiting for CloudFront configuration and cache invalidation…');
  await checked(context, 'aws', awsArgs(context.config, ['cloudfront', 'wait', 'distribution-deployed', '--id', outputs.distribution]));
  const invalidation = await aws(context, ['cloudfront', 'create-invalidation', '--distribution-id', outputs.distribution, '--paths', '/*']);
  const id = string(record(invalidation.Invalidation).Id, 'Invalidation.Id');
  await checked(context, 'aws', awsArgs(context.config, ['cloudfront', 'wait', 'invalidation-completed', '--distribution-id', outputs.distribution, '--id', id]));
}

export async function deploy(context: DeployContext, smoke: (outputs: DeploymentOutputs) => Promise<void>): Promise<DeploymentOutputs> {
  await preflight(context);
  context.log('Installing locked dependencies and running all local quality gates…');
  // Do not pass deployment credentials to dependency lifecycle scripts.
  await checked(context, 'npm', ['ci', '--ignore-scripts'], true);
  await checked(context, 'npm', ['run', 'check'], true);
  await checked(context, 'npm', ['run', 'test:http'], true);
  await checked(context, 'sam', ['validate', '--template-file', 'infra/template.json', '--lint', '--region', context.config.region,
    ...(context.config.profile ? ['--profile', context.config.profile] : [])], true);
  await mkdir(join(context.root, '.deploy'), { recursive: true, mode: 0o700 });
  await writeFile(join(context.root, '.deploy', 'samconfig.toml'), 'version = 0.1\n');
  context.log('Creating/reusing the stack-specific runtime secret in Secrets Manager…');
  const secret = await ensureSecret(context);
  context.log('Deploying SAM infrastructure (CloudFront can take 15–30+ minutes)…');
  await checked(context, 'sam', samArguments(context, secret), true);
  const outputs = stackOutputs(await aws(context, ['cloudformation', 'describe-stacks', '--stack-name', context.config.stack]), context.config);
  await publish(context, outputs);
  const directory = join(context.root, '.deploy'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'outputs.json'), JSON.stringify({ ...outputs, account: context.config.account, region: context.config.region, stack: context.config.stack }, null, 2) + '\n');
  context.log('Checking the public HTTPS website, API, assets and real routing…');
  await smoke(outputs);
  context.log(`Deployment verified: ${outputs.website}`);
  context.log('Confirm the SNS email subscription, check budgets/credits, then perform browser/mobile demo acceptance.');
  return outputs;
}
