// Regenerate the source-level JSX and stylesheet inventory used by the design audit.
// It deliberately reports visual verification as outstanding: source analysis is
// not a substitute for rendering and reviewing an element in every state.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'app/src');
const require = createRequire(join(root, 'app/package.json'));
const postcss = require('postcss');
const all = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? all(join(dir, entry.name)) : [join(dir, entry.name)]);
const files = all(src).filter(file => /\.(tsx|ts|css)$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes('/test/'));
const source = new Map(files.filter(file => /\.tsx?$/.test(file)).map(file => { const text = readFileSync(file, 'utf8'); return [file, { text, ast: parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) }]; }));
function graph(entry) {
  const reached = new Set();
  function visit(file) {
    if (reached.has(file) || !source.has(file)) return;
    reached.add(file);
    for (const statement of source.get(file).ast.program.body) {
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(statement.type) || !statement.source) continue;
      const spec = statement.source.value;
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      const candidates = extname(target) ? [target] : [`${target}.ts`, `${target}.tsx`, join(target, 'index.ts'), join(target, 'index.tsx')];
      for (const next of candidates) if (source.has(next)) { visit(next); break; }
    }
  }
  visit(join(src, entry));
  return reached;
}
const product = graph('main.tsx');
const showcase = graph('showcase.tsx');
const escape = value => String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').replace(/`/g, "'").trim();
const output = ['# Frontend element inventory (generated)', '', 'Regenerate with `node scripts/frontend-inventory.mjs`. The table lists every static JSX opening/self-closing element in non-test source, including component invocations and third-party components. Dynamic loops and branches are flagged syntactically; nested conditional logic, runtime reachability and visual states require manual review. Fragments are not visible elements. Imported test fixtures are excluded from the inventory. This is **not** a claim of complete rendered verification.', '', 'Reachability: product = imported from `main.tsx`; showcase = only from the development fixture harness; isolated = not reached from either. A product-reachable module can still contain unreachable branches. All individual elements are marked source-reviewed only; see the main matrix for the limited browser evidence.', '', '| Source:line | Element | Reachability / branch | Styling observed | Responsive / verification |', '| --- | --- | --- | --- | --- |'];
let count = 0;
for (const [file, tree] of [...source].sort(([a], [b]) => a.localeCompare(b))) {
  if (!file.endsWith('.tsx')) continue;
  function walk(node, parents = []) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXOpeningElement') {
      const line = node.loc.start.line;
      const text = tree.text;
      const name = text.slice(node.name.start, node.name.end);
      const styling = node.attributes.filter(attr => attr.type === 'JSXAttribute' && ['className', 'style'].includes(attr.name.name)).map(attr => text.slice(attr.start, attr.end));
      const flags = new Set();
      for (const parent of parents) {
        if (['ConditionalExpression', 'LogicalExpression', 'IfStatement'].includes(parent.type)) flags.add('conditional');
        if (parent.type === 'CallExpression' && parent.callee?.type === 'MemberExpression' && ['map', 'flatMap'].includes(parent.callee.property?.name)) flags.add('repeated');
      }
      const reach = product.has(file) ? 'product' : showcase.has(file) ? 'showcase' : 'isolated';
      const branch = flags.size ? [...flags].join(', ') : 'no local branch detected';
      output.push(`| \`${escape(relative(root, file))}:${line}\` | \`${escape(name)}\` | ${reach}; ${branch} | ${styling.length ? styling.map(x => `\`${escape(x)}\``).join(', ') : 'inherited, native, or component-owned'} | Source only; individual states and widths not certified |`);
      count++;
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'comments', 'errors'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, [...parents, node]));
      else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, [...parents, node]);
    }
  }
  walk(tree.ast);
}
output.push('', `Total: ${count} JSX elements.`, '', '## Stylesheet selector inventory', '', 'Selectors are listed as written, with their enclosing media/support rules. Inclusion here records source coverage only, not a finding that every selector is used or responsive.', '', '| Source:line | Selector | Context |', '| --- | --- | --- |');
let selectors = 0;
for (const file of files.filter(file => file.endsWith('.css')).sort()) {
  const css = postcss.parse(readFileSync(file, 'utf8'), { from: file });
  css.walkRules(rule => {
    const contexts = [];
    for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) if (parent.type === 'atrule') contexts.unshift(`@${parent.name} ${parent.params}`);
    output.push(`| \`${escape(relative(root, file))}:${rule.source.start.line}\` | \`${escape(rule.selector)}\` | ${escape(contexts.join(' / ') || 'all widths')} |`);
    selectors++;
  });
}
output.push('', `Total: ${selectors} stylesheet rules.`, '');
const destination = join(root, 'docs/frontend-element-inventory.md');
const result = output.join('\n');
if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== result) { console.error('Frontend inventory is stale; run npm run inventory:frontend'); process.exitCode = 1; }
} else writeFileSync(destination, result);
console.log(`Inventoried ${count} JSX elements and ${selectors} stylesheet rules.`);
