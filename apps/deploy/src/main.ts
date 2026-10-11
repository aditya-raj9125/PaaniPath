import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentConfig } from './config.ts';
import { commandRunner } from './commands.ts';
import { deploy } from './workflow.ts';
import { smokeDeployment } from './smoke.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--plan'].includes(arg))) throw new Error('Usage: npm run deploy:aws [-- --plan]');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  const root = resolve(import.meta.dirname, '../../..');
  let source: string;
  try { source = await readFile(resolve(root, '.env.deploy'), 'utf8'); } catch { throw new Error('Copy .env.deploy.example to .env.deploy and fill the required settings first.'); }
  const config = deploymentConfig(source);
  console.log(`PaaniPath deployment: ${config.stack}, ${config.region}, expected account ${config.account}.`);
  console.log('Plan: quality gates → SAM validation → Secrets Manager → SAM stack + budget/alarms → private web upload → CDN refresh → smoke checks.');
  if (args.includes('--plan')) { console.log('Plan only. No commands, AWS calls or resource changes were made.'); return; }
  const log = (message: string): void => { console.log(message); };
  await deploy({ root, config, log, run: commandRunner(root, config, log) }, outputs => smokeDeployment(outputs, config.smokeRoute));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Deployment failed. Review the guide and AWS stack status.');
  console.error('No automatic resource deletion or rollback of data is performed. See docs/DEPLOYMENT.md.');
  process.exitCode = 1;
});
