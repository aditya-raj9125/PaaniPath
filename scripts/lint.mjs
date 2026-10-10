/** TypeScript AST linting. Dependency-light, deterministic, and stricter than text greps. */
import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []))).flat();
}
const files = (await Promise.all(['apps', 'packages', 'tests'].map(sources))).flat();
const failures = [];
let maxComplexity = 0;
const branch = node => ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isCaseClause(node) || ts.isCatchClause(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind));
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const fail = (node, message) => { const loc = source.getLineAndCharacterOfPosition(node.getStart(source)); failures.push(`${file}:${loc.line + 1} ${message}`); };
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) fail(node, 'Explicit any is forbidden. Use unknown and validate.');
    if (ts.isNonNullExpression(node)) fail(node, 'Non-null assertions are forbidden. Check the value.');
    if (ts.isDebuggerStatement(node)) fail(node, 'Debugger statements are forbidden.');
    if (ts.isFunctionLike(node) && node.body) {
      let complexity = 1;
      function count(child) { if (child !== node && ts.isFunctionLike(child)) return; if (branch(child)) complexity++; ts.forEachChild(child, count); }
      count(node.body); maxComplexity = Math.max(maxComplexity, complexity);
      if (complexity > 25) fail(node, `Cyclomatic complexity ${complexity} exceeds 25. Extract a focused function.`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (/\b(?:@ts-ignore|@ts-nocheck)\b/.test(text)) failures.push(`${file}: Type-check suppression is forbidden.`);
  if (/[ \t]+$/m.test(text)) failures.push(`${file}: Trailing whitespace.`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`AST lint passed: ${files.length} TypeScript files; maximum cyclomatic complexity ${maxComplexity}/25; no any, non-null assertions, type suppressions or debugger statements.`);
