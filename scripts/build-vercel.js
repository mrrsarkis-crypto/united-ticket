import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, 'public');
const outDir = path.join(root, 'dist');
const scannerClientTag = '<script src="/scanner-client.js"></script>';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(sourceDir, outDir, { recursive: true });

let normalHtml = 0;
let ampHtml = 0;
for (const file of await walk(outDir)) {
  if (!file.toLowerCase().endsWith('.html')) continue;
  let html = await readFile(file, 'utf8');
  const rel = path.relative(outDir, file).replaceAll('\\', '/');
  const isAmp = rel.startsWith('amp/');

  if (isAmp) {
    ampHtml++;
    continue;
  }

  let changed = false;
  if (!html.includes('/scanner-client.js')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${scannerClientTag}`);
    changed = true;
  }

  if (changed) await writeFile(file, html, 'utf8');
  normalHtml++;
}

console.log(`Static build complete: ${normalHtml} standard HTML pages with scanner optimizer; ${ampHtml} AMP pages (untouched).`);
