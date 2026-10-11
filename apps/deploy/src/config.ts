import { parseEnv } from 'node:util';

export interface DeployConfig {
  readonly account: string;
  readonly region: string;
  readonly profile: string;
  readonly stack: string;
  readonly approved: boolean;
  readonly email: string;
  readonly budget: number;
  readonly memory: number;
  readonly concurrency: number;
  readonly orsKey: string;
  readonly sessionSecret: string;
  readonly orsUrl: string;
  readonly photonUrl: string;
  readonly demoMode: string;
  readonly seedMode: string;
  readonly smokeRoute: boolean;
  readonly credentials: Readonly<Record<string, string>>;
}

const KEYS = new Set(['AWS_ACCOUNT_ID', 'AWS_REGION', 'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'DEPLOY_STACK_NAME', 'DEPLOY_APPROVED', 'DEPLOY_ALERT_EMAIL', 'DEPLOY_MONTHLY_BUDGET_USD', 'DEPLOY_MEMORY_MB',
  'DEPLOY_RESERVED_CONCURRENCY', 'ORS_API_KEY', 'SESSION_SECRET', 'ORS_URL', 'PHOTON_URL', 'DEMO_MODE', 'SEED_MODE', 'DEPLOY_SMOKE_ROUTE']);

function requireValue(valid: boolean, message: string): void { if (!valid) throw new Error(message); }
function numeric(env: NodeJS.Dict<string>, key: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(env[key] || fallback);
  requireValue(Number.isFinite(value) && value >= minimum && value <= maximum, `${key} must be between ${minimum} and ${maximum}.`);
  return value;
}
function boolean(env: NodeJS.Dict<string>, key: string, fallback: string): string {
  const value = env[key] || fallback;
  requireValue(value === 'true' || value === 'false', `${key} must be true or false.`); return value;
}
function endpoint(value: string, key: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${key} must be a valid HTTPS endpoint.`); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, `${key} requires HTTPS without credentials/query/fragment.`);
  return value;
}

/** An inert, allowlisted configuration file: never executes dotenv content or prints its values. */
export function deploymentConfig(source: string): DeployConfig {
  const env = parseEnv(source);
  for (const key of Object.keys(env)) {
    requireValue(KEYS.has(key), `Unknown deployment setting: ${key}.`);
    requireValue(!/[\r\n\0]/.test(env[key] ?? ''), `Multiline values are not supported: ${key}.`);
  }
  const account = env.AWS_ACCOUNT_ID ?? '';
  const region = env.AWS_REGION || 'us-east-1';
  const profile = env.AWS_PROFILE ?? '';
  const stack = env.DEPLOY_STACK_NAME || 'paanipath-ncr';
  const email = env.DEPLOY_ALERT_EMAIL ?? '';
  requireValue(/^\d{12}$/.test(account), 'AWS_ACCOUNT_ID must be the expected 12-digit deployment account.');
  requireValue(region === 'us-east-1', 'This audited deployment targets Northern Virginia: AWS_REGION=us-east-1.');
  requireValue(!profile || /^[\w.@+-]{1,128}$/.test(profile), 'AWS_PROFILE contains unsupported characters.');
  requireValue(/^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(stack), 'DEPLOY_STACK_NAME must start with a letter and contain letters, digits or hyphens (max 32).');
  requireValue(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email), 'DEPLOY_ALERT_EMAIL is required for budget and operational alerts.');
  const orsKey = env.ORS_API_KEY?.trim() ?? '';
  const sessionSecret = env.SESSION_SECRET ?? '';
  requireValue(orsKey.length >= 16 && !/\s/.test(orsKey), 'Provide a valid server-side ORS_API_KEY in the deployment env file.');
  requireValue(!sessionSecret || sessionSecret.length >= 32, 'SESSION_SECRET must be blank (generate/reuse) or at least 32 characters.');
  const memory = numeric(env, 'DEPLOY_MEMORY_MB', 2048, 128, 10240);
  const concurrency = numeric(env, 'DEPLOY_RESERVED_CONCURRENCY', 0, 0, 1000);
  requireValue(Number.isInteger(memory) && Number.isInteger(concurrency), 'Memory and reserved concurrency must be integers.');
  const credentials: Record<string, string> = {};
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) if (env[key]) credentials[key] = env[key];
  requireValue(Boolean(credentials.AWS_ACCESS_KEY_ID) === Boolean(credentials.AWS_SECRET_ACCESS_KEY), 'AWS access-key ID and secret must be provided together.');
  requireValue(!credentials.AWS_SESSION_TOKEN || Boolean(credentials.AWS_ACCESS_KEY_ID), 'AWS_SESSION_TOKEN requires the access-key pair.');
  requireValue(!profile || !credentials.AWS_ACCESS_KEY_ID, 'Choose an AWS profile OR environment credentials, not both.');
  return { account, region, profile, stack, email, orsKey, sessionSecret, memory, concurrency, credentials,
    budget: numeric(env, 'DEPLOY_MONTHLY_BUDGET_USD', 10, 1, 100000), approved: boolean(env, 'DEPLOY_APPROVED', 'false') === 'true',
    orsUrl: endpoint(env.ORS_URL || 'https://api.openrouteservice.org/v2/directions', 'ORS_URL'),
    photonUrl: endpoint(env.PHOTON_URL || 'https://photon.komoot.io/api/', 'PHOTON_URL'),
    demoMode: boolean(env, 'DEMO_MODE', 'false'), seedMode: boolean(env, 'SEED_MODE', 'true'),
    smokeRoute: boolean(env, 'DEPLOY_SMOKE_ROUTE', 'true') === 'true' };
}

export function secretReference(arn: string, key: string, version: string): string {
  return `{{resolve:secretsmanager:${arn}:SecretString:${key}::${version}}}`;
}
