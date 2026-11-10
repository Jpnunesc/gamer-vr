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
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(process.argv[2] || join(__dirname, '..', 'web'));
const PORT = Number(process.env.PORT || 8080);

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
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Contain path traversal: resolve under ROOT and verify.
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    let info;
    try { info = await stat(filePath); }
    catch { res.writeHead(404).end('Not found: ' + pathname); return; }
    if (info.isDirectory()) { res.writeHead(404).end('Not found'); return; }

    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    isolationHeaders(res);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');

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
