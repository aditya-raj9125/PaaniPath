import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { buildProject } from './build.mjs';
await buildProject();

let server = spawn(process.execPath, ['dist/server.mjs'], { stdio: 'inherit', env: process.env });
let timer;
let rebuilding = false;
async function rebuild() {
  if (rebuilding) return;
  rebuilding = true;
  try {
    const result = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
    const code = await new Promise(resolve => result.on('exit', resolve));
    if (code === 0) {
      server.kill();
      await new Promise(resolve => server.once('exit', resolve));
      server = spawn(process.execPath, ['dist/server.mjs'], { stdio: 'inherit', env: process.env });
      console.log('Rebuilt. Refresh the browser to see changes.');
    }
  } finally { rebuilding = false; }
}
for (const root of ['apps', 'packages']) watch(root, { recursive: true }, () => {
  clearTimeout(timer); timer = setTimeout(() => { void rebuild(); }, 200);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.kill(signal); process.exit(); });
