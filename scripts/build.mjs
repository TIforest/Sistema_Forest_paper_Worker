import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('../', import.meta.url);
const checkOnly = process.argv.includes('--check');
const blockedExtensions = new Set(['.xlsx', '.xls', '.xlsm', '.csv', '.tsv']);
const blockedNames = [/^\.env($|\.)/i, /credential/i, /secret/i, /config\.local/i];
const sensitivePatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /forestpapercombr-my\.sharepoint\.com\/personal\//i,
  /(?:password|client_secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['\"][^'\"]+/i
];

async function walk(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['.git', 'dist', 'node_modules'].includes(entry.name)) continue;
    const childRelative = join(relative, entry.name);
    const child = new URL(childRelative.replaceAll('\\', '/') + (entry.isDirectory() ? '/' : ''), root);
    if (entry.isDirectory()) files.push(...await walk(child, childRelative));
    else files.push({ name: entry.name, relative: childRelative, url: child });
  }
  return files;
}

const files = await walk(root);
const forbidden = files.filter(file => blockedExtensions.has(extname(file.name).toLowerCase()) || blockedNames.some(pattern => pattern.test(file.name)));
if (forbidden.length) throw new Error(`Arquivos proibidos no repositorio: ${forbidden.map(file => file.relative).join(', ')}`);

const html = await readFile(new URL('app.html', root), 'utf8');
for (const pattern of sensitivePatterns) {
  if (pattern.test(html)) throw new Error(`Possivel dado sensivel encontrado no app.html: ${pattern}`);
}
if (!html.includes('<!DOCTYPE html>') || !html.includes('Content-Security-Policy')) {
  throw new Error('O app.html nao passou pela verificacao de estrutura e seguranca.');
}
const inlineScript = html.match(/<script>\s*\(function\(\)\{[\s\S]*?<\/script>/);
if (!inlineScript) throw new Error('O JavaScript principal nao foi encontrado no index.html.');
new Function(inlineScript[0].replace(/^<script>/, '').replace(/<\/script>$/, ''));

if (!checkOnly) {
  const dist = new URL('dist/', root);
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await cp(new URL('app.html', root), new URL('index.html', dist));
  for (const file of ['_headers', 'robots.txt']) await cp(new URL(file, root), new URL(file, dist));
  await cp(new URL('assets/', root), new URL('assets/', dist), { recursive: true });
  if (await readFile(new URL('forest-icon.png', root)).catch(() => null)) await cp(new URL('forest-icon.png', root), new URL('forest-icon.png', dist));
  console.log('Pacote de publicacao criado em dist/.');
} else {
  console.log('Verificacao concluida sem dados sensiveis conhecidos.');
}
