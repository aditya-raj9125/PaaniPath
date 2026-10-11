import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { aws, awsArgs, record, string } from './commands.ts';
import type { DeployContext } from './commands.ts';

interface RuntimeSecret { readonly ORS_API_KEY: string; readonly SESSION_SECRET: string }
interface ManagedSecret { readonly arn: string; readonly version: string; readonly value: RuntimeSecret }
export interface SecretVersion { readonly arn: string; readonly version: string }

export async function existingSecret(context: DeployContext): Promise<ManagedSecret | undefined> {
  const name = `paanipath/${context.config.stack}/runtime`;
  const result = await context.run('aws', awsArgs(context.config, ['secretsmanager', 'describe-secret', '--secret-id', name]));
  if (result.code !== 0) {
    if (result.stderr.includes('ResourceNotFoundException')) return undefined;
    throw new Error('Cannot inspect deployment secret. Check Secrets Manager permissions and credentials.');
  }
  const metadata = record(JSON.parse(result.stdout));
  if (metadata.DeletedDate) throw new Error('Deployment secret is pending deletion. Restore it deliberately before deploying.');
  const tags = Array.isArray(metadata.Tags) ? metadata.Tags.map(record) : [];
  if (!tags.some(tag => tag.Key === 'ManagedBy' && tag.Value === 'PaaniPathDeploy') ||
      !tags.some(tag => tag.Key === 'StackName' && tag.Value === context.config.stack)) throw new Error('Secret name belongs to an unmanaged resource. Choose another stack name.');
  const current = await aws(context, ['secretsmanager', 'get-secret-value', '--secret-id', name]);
  let value: Record<string, unknown>;
  try { value = record(JSON.parse(string(current.SecretString, 'SecretString'))); } catch { throw new Error('Existing deployment secret has invalid structure. Review it privately.'); }
  const session = string(value.SESSION_SECRET, 'SESSION_SECRET');
  if (session.length < 32) throw new Error('Existing session secret is too short. Review it privately.');
  return { arn: string(current.ARN, 'ARN'), version: string(current.VersionId, 'VersionId'),
    value: { ORS_API_KEY: string(value.ORS_API_KEY, 'ORS_API_KEY'), SESSION_SECRET: session } };
}

/** Reuses session identity; writes a new version only when the supplied runtime values change. */
export async function ensureSecret(context: DeployContext): Promise<SecretVersion> {
  const old = await existingSecret(context);
  const value: RuntimeSecret = { ORS_API_KEY: context.config.orsKey,
    SESSION_SECRET: context.config.sessionSecret || old?.value.SESSION_SECRET || randomBytes(32).toString('hex') };
  if (old?.value.ORS_API_KEY === value.ORS_API_KEY && old.value.SESSION_SECRET === value.SESSION_SECRET) return { arn: old.arn, version: old.version };
  const version = randomUUID();
  const directory = join(context.root, '.deploy', 'private');
  const filename = join(directory, `runtime-${version}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(filename, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  try {
    const name = `paanipath/${context.config.stack}/runtime`;
    const args = old ? ['secretsmanager', 'put-secret-value', '--secret-id', old.arn] :
      ['secretsmanager', 'create-secret', '--name', name, '--tags', 'Key=ManagedBy,Value=PaaniPathDeploy', `Key=StackName,Value=${context.config.stack}`];
    const result = await aws(context, [...args, '--secret-string', `file://${filename}`, '--client-request-token', version]);
    return { arn: string(result.ARN, 'ARN'), version: string(result.VersionId, 'VersionId') };
  } finally { await unlink(filename); }
}
