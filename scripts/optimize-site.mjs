import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dependencies = process.env.MOE4ALL_BUILD_MODULES;
const load = name => dependencies ? require(path.join(dependencies, name)) : require(name);
const esbuild = load('esbuild');
const { parse } = load('acorn');
const sourceFiles = ['index.html', 'technical.html', 'demo.html', 'app.js', 'everyday.js', 'demo.js', 'agent-showcase.js', 'site-dialogs.js'];

export async function usedIcons(root) {
  const names = new Set();
  const collectValues = node => {
    if (node?.type === 'Literal' && typeof node.value === 'string') names.add(node.value);
    else if (node?.type === 'ConditionalExpression') { collectValues(node.consequent); collectValues(node.alternate); }
    else throw new Error('Icon names must be literal strings or conditional string values');
  };
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'icon') collectValues(node.arguments[0]);
    if (node.type === 'VariableDeclarator' && node.id.name === 'icon' && node.init?.type === 'ConditionalExpression') collectValues(node.init);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  for (const file of sourceFiles) {
    const source = await readFile(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/data-lucide=["']([a-z0-9-]+)["']/g)) names.add(match[1]);
    if (file.endsWith('.js')) visit(parse(source, { ecmaVersion: 'latest' }));
  }
  return [...names].sort();
}

export async function buildIcons(root, destination) {
  const names = await usedIcons(root);
  const exports = names.map(name => name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(''));
  const entry = `import { createIcons, ${exports.join(', ')} } from 'lucide';\nconst icons = {${exports.join(',')}};\nglobalThis.lucide = { icons, createIcons(options = {}) { createIcons({ ...options, icons: options.icons || icons }); } };`;
  const modulePath = dependencies || path.join(root, 'node_modules');
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'moe4all-icons.js' },
    nodePaths: [modulePath], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true, legalComments: 'eof'
  });
  await writeFile(destination, result.outputFiles[0].contents);
  return { names, bytes: result.outputFiles[0].contents.length };
}

export async function optimizeSite(root, destination, files) {
  const icons = await buildIcons(root, path.join(destination, 'assets/lucide.min.js'));
  for (const file of files) {
    const source = await readFile(path.join(destination, file), 'utf8');
    const result = await esbuild.transform(source, {
      loader: file.endsWith('.css') ? 'css' : 'js', minify: true, target: 'es2022', legalComments: 'eof', charset: 'utf8'
    });
    await writeFile(path.join(destination, file), result.code);
  }
  return icons;
}
