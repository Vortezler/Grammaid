// Development harness server: runs the BUILT extension (dist/) against test/fixtures/playground.html
// in any ordinary browser, with test/harness/shim.js standing in for the WebExtensions API.
// Handy for working on the UI without reinstalling the add-on. Usage: npm run harness
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 4173);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const shim = '<script src="/harness/shim.js"></script>';
const TOOLBAR = `
<style>
  body { transition: margin-right .25s ease; }
  body.sidebar-open { margin-right: 372px; }
  #gh-bar { position: fixed; left: 12px; bottom: 12px; z-index: 10; display: flex; gap: 6px; font: 12px system-ui, sans-serif; background: #222; color: #fff; padding: 6px 8px; border-radius: 8px; align-items: center; }
  #gh-bar button { font: inherit; padding: 3px 8px; border-radius: 5px; border: 0; cursor: pointer; }
  #gh-side { position: fixed; top: 0; right: 0; bottom: 0; width: 360px; height: 100%; border: 0; border-left: 1px solid #ccc; display: none; background: #fff; z-index: 9; }
  body.sidebar-open #gh-side { display: block; }
</style>
<div id="gh-bar">harness
  <button onmousedown="event.preventDefault()" onclick="__grammaidToolbarClick()">Toolbar button <span id="gh-badge">[off]</span></button>
  <button onmousedown="event.preventDefault()" onclick="__grammaidCommand('toggle-sidebar')">Sidebar (Alt+Shift+G)</button>
  <button onmousedown="event.preventDefault()" onclick="__grammaidCommand('synonyms')">Synonyms (Alt+Shift+S)</button>
  <button onmousedown="event.preventDefault()" onclick="__grammaidCommand('rephrase')">Rephrase (Alt+Shift+R)</button>
</div>
<iframe id="gh-bg" src="/background.html" style="display:none" title="background"></iframe>
<iframe id="gh-side" src="/sidebar.html" title="Grammaid sidebar"></iframe>
<script src="/content.js"></script>`;

/** Rewrites pages so each context gets the shim (and, for the playground, the extension itself). */
function transform(urlPath, html) {
  if (urlPath === '/' || urlPath === '/playground.html') return html.replace('<head>', `<head>${shim}`).replace('</body>', `${TOOLBAR}</body>`);
  if (urlPath === '/playground-frame.html') return html.replace('<head>', `<head>${shim}`).replace('</body>', '<script src="/content.js"></script></body>');
  if (urlPath === '/background.html') return html.replace('<!doctype html>', `<!doctype html><html data-grammaid-role="background">${shim}`);
  if (urlPath === '/sidebar.html') return html.replace('<html lang="en">', '<html lang="en" data-grammaid-role="sidebar">').replace('<head>', `<head>${shim}`);
  return html;
}

function resolveFile(urlPath) {
  if (urlPath === '/' || urlPath === '/playground.html') return 'test/fixtures/playground.html';
  if (urlPath === '/playground-frame.html') return 'test/fixtures/playground-frame.html';
  if (urlPath.startsWith('/harness/')) return 'test' + urlPath;
  if (urlPath.startsWith('/fixtures/')) return 'test' + urlPath;
  return 'dist' + urlPath;
}

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, resolveFile(urlPath));
    if (!file.startsWith(root)) throw new Error('outside root');
    let body = await readFile(file);
    const ext = path.extname(file);
    if (ext === '.html') body = Buffer.from(transform(urlPath, body.toString('utf8')));
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Grammaid harness: http://localhost:${port}/  (run "npm run build" first)`));
