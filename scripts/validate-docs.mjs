/** Validate the small public documentation set without requiring network access. */
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';

const root = process.cwd();
const publicDocs = ['API.md', 'ALGORITHMS.md', 'ENGINEERING.md'];
const entries = (await readdir('docs')).filter(name => name.endsWith('.md') && name !== 'DEPLOYMENT.md').sort();
assert.deepEqual(entries, [...publicDocs].sort(), 'Keep exactly three consolidated public docs.');
const files = ['README.md', ...publicDocs.map(name => `docs/${name}`)];
const content = new Map(await Promise.all(files.map(async file => [resolve(file), await readFile(file, 'utf8')])));
const marker = String.fromCharCode(96).repeat(3);
function anchors(text) {
  const result = new Set();
  const counts = new Map();
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(marker)) { fenced = !fenced; continue; }
    const match = fenced ? undefined : /^#{1,6}\s+(.+)$/.exec(line);
    if (!match) continue;
    const slug = match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
    const count = counts.get(slug) ?? 0;
    result.add(count === 0 ? slug : `${slug}-${count}`);
    counts.set(slug, count + 1);
  }
  assert(!fenced, 'Unclosed Markdown code fence.');
  return result;
}
let links = 0;
for (const [file, text] of content) {
  anchors(text);
  assert(!text.includes('docs/DEPLOYMENT.md'), 'Do not link an ignored deployment guide from public docs.');
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [path, fragment] = link.split('#');
    const target = path ? resolve(dirname(file), path) : file;
    assert(!relative(root, target).startsWith('..'), `Link leaves repository: ${link}`);
    assert((await stat(target)).isFile(), `Missing linked file: ${link}`);
    if (fragment) {
      const targetText = content.get(target) ?? await readFile(target, 'utf8');
      assert(anchors(targetText).has(fragment), `Missing heading: ${link}`);
    }
    links++;
  }
}
console.log(`Documentation passed: README, three public docs, ${links} local links and heading targets.`);
