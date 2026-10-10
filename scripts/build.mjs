/** Portable ESM compiler. No subprocess or platform-specific native bundler is required. */
import ts from 'typescript';
import { mkdir, cp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative, dirname, join, sep } from 'node:path';

const root = process.cwd();
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
export async function compileTree(sourceRoots, outputRoot) {
  async function files(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []))).flat();
  }
  const inputs = (await Promise.all(sourceRoots.map(files))).flat();
  for (const file of inputs) {
    const destination = resolve(outputRoot, file.replace(/\.ts$/, '.js'));
    const source = await readFile(file, 'utf8');
    const output = ts.transpileModule(source, { fileName: file, compilerOptions: { ...parsed.options, noEmit: false, sourceMap: true } });
    const rewritten = output.outputText.replace(/(from\s*['"]|import\s*['"])([^'"]+)(['"])/g, (match, prefix, specifier, suffix) => {
      if (!specifier.startsWith('@paanipath/') && !specifier.endsWith('.ts')) return match;
      const resolved = ts.resolveModuleName(specifier, resolve(file), parsed.options, ts.sys).resolvedModule;
      if (!resolved) throw new Error(`Cannot resolve ${specifier} in ${file}`);
      const target = resolve(outputRoot, relative(root, resolved.resolvedFileName).replace(/\.ts$/, '.js'));
      let path = relative(dirname(destination), target).replaceAll('\\', '/');
      if (!path.startsWith('.')) path = `./${path}`;
      return `${prefix}${path}${suffix}`;
    });
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, rewritten);
    if (output.sourceMapText) await writeFile(`${destination}.map`, output.sourceMapText);
  }
  return inputs.length;
}

export async function buildProject() {
  const generated = resolve(root, 'dist');
  if (generated !== root + sep + 'dist') throw new Error('Unexpected build output directory.');
  await rm(generated, { recursive: true, force: true });
  const count = await compileTree(['apps', 'packages'], 'dist/modules');
  await mkdir('dist/web', { recursive: true });
  for (const directory of ['apps/web', 'packages/domain', 'packages/ui']) {
    await mkdir(`dist/web/modules/${directory}`, { recursive: true });
    await cp(`dist/modules/${directory}`, `dist/web/modules/${directory}`, { recursive: true });
  }
  await cp('dist/modules', 'dist/lambda/modules', { recursive: true });
  await cp('apps/web/index.html', 'dist/web/index.html');
  await cp('apps/web/public', 'dist/web', { recursive: true });
  async function moduleAssets(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => entry.isDirectory() ? moduleAssets(join(directory, entry.name)) : entry.name.endsWith('.js') ? ['/' + relative('dist/web', join(directory, entry.name)).replaceAll('\\', '/')] : []))).flat();
  }
  await writeFile('dist/web/asset-manifest.json', JSON.stringify(await moduleAssets('dist/web/modules')));
  await writeFile('dist/web/app.js', "import './modules/apps/web/src/app.js';\n");
  await writeFile('dist/server.mjs', "import './modules/apps/api/src/server.js';\n");
  await writeFile('dist/lambda/index.mjs', "export { handler } from './modules/apps/api/src/lambda.js';\n");
  await writeFile('dist/lambda/package.json', '{"type":"module"}\n');
  const css = (await readFile('apps/web/src/tokens.css', 'utf8')) + (await readFile('apps/web/src/styles.css', 'utf8')).replace(/@import[^;]+;/, '');
  await writeFile('dist/web/app.css', css.replace(/\s+/g, ' '));
  console.log(`Compiled ${count} strict TypeScript modules, web assets, local API and AWS Lambda.`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/build.mjs')) await buildProject();
