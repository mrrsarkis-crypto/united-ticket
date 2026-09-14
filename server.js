import http from 'node:http';
import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, 'dist');
const publicDir = path.join(__dirname, 'public');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

const root = (await exists(distDir)) ? distDir : publicDir;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf'
};

async function resolveFile(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const safePath = path.normalize(pathname).replace(/^([.][.][\\/])+/, '');
  let candidate = path.join(root, safePath === '/' ? 'index.html' : safePath);
  try {
    if ((await stat(candidate)).isDirectory()) candidate = path.join(candidate, 'index.html');
  } catch {}
  if (await exists(candidate)) return candidate;
  if (!path.extname(candidate)) {
    const htmlCandidate = `${candidate}.html`;
    if (await exists(htmlCandidate)) return htmlCandidate;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const file = await resolveFile(req.url || '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(body);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`United Traffic Tickets Defense listening on port ${port}`);
});
