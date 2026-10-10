import { compileTree } from './build.mjs';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('dist/tests', { recursive: true });
await compileTree(['apps', 'packages', 'tests'], 'dist/test-modules');
const files = (await readdir('dist/test-modules/tests')).filter(name => name.endsWith('.test.js')).map(name => resolve('dist/test-modules/tests', name));
const stream = run({ files, isolation: 'none', concurrency: false });
stream.on('test:fail', () => { process.exitCode = 1; });
stream.compose(spec).pipe(process.stdout);
