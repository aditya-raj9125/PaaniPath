import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import type { DeployConfig } from './config.ts';

export interface CommandResult { readonly code: number; readonly stdout: string; readonly stderr: string }
export type RunCommand = (command: string, args: readonly string[], stream?: boolean) => Promise<CommandResult>;
export interface DeployContext {
  readonly run: RunCommand;
  readonly log: (message: string) => void;
  readonly root: string;
  readonly config: DeployConfig;
}

export function redact(value: string, secrets: readonly string[]): string {
  return secrets.filter(secret => secret.length > 0).reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value);
}
export function windowsInvocation(command: string, args: readonly string[]): readonly string[] {
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  // Single-quoted literals + encoded PowerShell avoid cmd.exe expansion and shell injection.
  const source = `$ErrorActionPreference = 'Stop'; try { $global:LASTEXITCODE = $null; & ${quote(command)} ${args.map(quote).join(' ')}; if ($null -eq $LASTEXITCODE) { throw 'Tool did not return a native exit code.' }; exit $LASTEXITCODE } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')];
}

function executableFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

/** Resolve native tools using the calling process PATH, not PowerShell aliases/profiles. */
export function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv, exists: (path: string) => boolean = executableFile): string {
  const extensions = ['.exe', '.cmd', '.bat'];
  if (win32.isAbsolute(command)) {
    if (extensions.includes(win32.extname(command).toLowerCase()) && exists(command)) return command;
    throw new Error('Configured tool path must identify an existing .exe, .cmd or .bat file.');
  }
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const entry of path.split(';')) {
    const directory = entry.trim().replace(/^"|"$/g, '');
    if (!win32.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const candidate = win32.join(directory, command + extension);
      if (exists(candidate)) return candidate;
    }
  }
  throw new Error(`${command} is not on this process PATH. Reopen the terminal after installation; for SAM, set SAM_CLI_PATH to its absolute executable path in .env.deploy.`);
}

function streamLines(chunk: Buffer, pending: string, log: (message: string) => void, secrets: readonly string[]): string {
  const lines = (pending + chunk.toString()).split(/\r?\n/);
  const remainder = lines.pop() ?? '';
  for (const line of lines) log(redact(line, secrets));
  return remainder;
}

export function commandRunner(root: string, config: DeployConfig, log: (message: string) => void): RunCommand {
  const secrets = [config.orsKey, config.sessionSecret, ...Object.values(config.credentials)];
  const env: NodeJS.ProcessEnv = { ...process.env, ...config.credentials, AWS_REGION: config.region, AWS_DEFAULT_REGION: config.region,
    AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off', SAM_CLI_TELEMETRY: '0' };
  if (config.profile) env.AWS_PROFILE = config.profile;
  else delete env.AWS_PROFILE;
  if (config.profile || config.credentials.AWS_ACCESS_KEY_ID) {
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete env[key];
    Object.assign(env, config.credentials);
  }
  return (command, args, stream = false) => new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const requested = command === 'sam' && config.samPath ? config.samPath : command;
    const target = windows ? resolveWindowsCommand(requested, env) : requested;
    const child = spawn(windows ? 'powershell.exe' : target, windows ? windowsInvocation(target, args) : [...args],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let pending = ''; let errorPending = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} exceeded the 60-minute deployment timeout. Inspect AWS status before retrying.`)); }, 60 * 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stream) pending = streamLines(chunk, pending, log, secrets);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stream) errorPending = streamLines(chunk, errorPending, log, secrets);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error(`${command} could not start. Install it and reopen the terminal.`)); });
    child.on('close', code => {
      clearTimeout(timer); if (stream && pending) log(redact(pending, secrets));
      if (stream && errorPending) log(redact(errorPending, secrets));
      resolve({ code: code ?? 1, stdout, stderr: redact(stderr, secrets) });
    });
  });
}

export async function checked(context: DeployContext, command: string, args: readonly string[], stream = false): Promise<string> {
  const result = await context.run(command, args, stream);
  if (result.code !== 0) throw new Error(`${command} failed (exit ${result.code}). ${redact(result.stderr, [context.config.orsKey, context.config.sessionSecret, ...Object.values(context.config.credentials)]).slice(0, 1600)}`);
  return result.stdout;
}
export function awsArgs(config: DeployConfig, args: readonly string[]): string[] {
  return [...args, '--region', config.region, ...(config.profile ? ['--profile', config.profile] : []), '--output', 'json', '--no-cli-pager'];
}
export async function aws(context: DeployContext, args: readonly string[]): Promise<Record<string, unknown>> {
  const text = await checked(context, 'aws', awsArgs(context.config, args));
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('AWS CLI returned unreadable JSON; inspect CLI installation/configuration.'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('AWS CLI returned an unexpected response.');
  return body as Record<string, unknown>;
}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected AWS response structure.');
  return value as Record<string, unknown>;
}
export function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Missing AWS response field: ${field}.`); return value;
}
