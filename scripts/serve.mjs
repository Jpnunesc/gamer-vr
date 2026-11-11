// Zero-dependency dev server for the WebXR shell / F1 diagnostic.
//
// Why a custom server: WebXR + the engine's threaded WASM need a cross-origin
// isolated context. We send COOP: same-origin + COEP: require-corp (matching
// the production headers observed on the port) so crossOriginIsolated is true
// and SharedArrayBuffer is available. We also set the correct .wasm MIME type
// and support HTTP Range (useful once large engine assets stream).
//
// Serves ./web by default. localhost is a secure context, so WebXR works
// without a TLS cert for same-machine development. Access from another device
// on the LAN would need HTTPS — out of scope here (see docs/STATUS.md).

import { createServer } from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(process.argv[2] || join(__dirname, '..', 'web'));
const PORT = Number(process.env.PORT || 8080);

// F2 step 2: game-data roots. The legit install is junctioned into
// local-game-data/; the re3 overlay (neo shaders, fonts, text) is the engine's
// gamefiles/. Served under /vc/ and /vcx/ (with Range); file lists at
// /vc-manifest and /vcx-manifest. Nothing here is committed or redistributed.
const VC_ROOT = resolve(__dirname, '..', 'local-game-data', 'vice-city');
const VCX_ROOT = resolve(__dirname, '..', 'engine', 'wasm-revc', 'gamefiles');
// A NULL-audio build with no movies needs only these dirs from the install.
const VC_INCLUDE = ['models', 'data', 'anim', 'text', 'txd', 'skins', 'scripts'];

async function walk(root, includeTop) {
  let entries;
  try { entries = await readdir(root, { recursive: true, withFileTypes: true }); }
  catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const rel = join(e.parentPath, e.name).slice(root.length + 1).split('\\').join('/');
    if (includeTop && !includeTop.includes(rel.split('/')[0].toLowerCase())) continue;
    out.push(rel);
  }
  return out;
}

function sendManifest(res, files) {
  isolationHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(200).end(JSON.stringify(files));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function isolationHeaders(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // F2 spike: client log sink. host.js mirrors every log line (and uncaught
    // errors) here so the engineer can read the browser logs from this server's
    // stdout while iterating. Dev-only; never ship this.
    if (req.method === 'POST' && url.pathname === '/__log') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        for (const l of body.split('\n')) if (l) console.log('[client] ' + l);
        isolationHeaders(res);
        res.writeHead(204).end();
      });
      return;
    }

    // Game-data manifests (recursive file lists for the client to mount).
    if (url.pathname === '/vc-manifest')  { sendManifest(res, await walk(VC_ROOT, VC_INCLUDE)); return; }
    if (url.pathname === '/vcx-manifest') { sendManifest(res, await walk(VCX_ROOT, null)); return; }

    // Pick the physical root by URL prefix: web/ (default), the install (/vc/),
    // or the re3 overlay (/vcx/).
    let baseRoot = ROOT;
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/vc/'))       { baseRoot = VC_ROOT;  pathname = pathname.slice(3); }
    else if (pathname.startsWith('/vcx/')) { baseRoot = VCX_ROOT; pathname = pathname.slice(4); }
    if (pathname === '/') pathname = '/index.html';

    // Contain path traversal: resolve under the chosen root and verify.
    const filePath = normalize(join(baseRoot, pathname));
    if (!filePath.startsWith(baseRoot)) { res.writeHead(403).end('Forbidden'); return; }

    let info;
    try { info = await stat(filePath); }
    catch { res.writeHead(404).end('Not found: ' + pathname); return; }
    if (info.isDirectory()) { res.writeHead(404).end('Not found'); return; }

    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    isolationHeaders(res);
    res.setHeader('Content-Type', type);
    // no-store (not no-cache): during the F2 spike we rebuild reVC.wasm often and
    // the browser was reusing a cached compiled module. no-store forbids storing,
    // so every load fetches the freshly built artifact.
    res.setHeader('Cache-Control', 'no-store');

    // Range support (engine assets / wasm streaming).
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : info.size - 1;
        if (start > end || end >= info.size) { res.writeHead(416).end(); return; }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') { res.writeHead(200).end(); return; }
    res.writeHead(200);
    createReadStream(filePath).pipe(res);
  } catch (e) {
    res.writeHead(500).end('Server error: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log(`vr-vice-city dev server`);
  console.log(`  root:  ${ROOT}`);
  console.log(`  url:   http://localhost:${PORT}/`);
  console.log(`  COOP/COEP isolation: on  (crossOriginIsolated expected true)`);
});
