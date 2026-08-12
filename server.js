#!/usr/bin/env node
/* Heirloom — optional local server.

   The app runs fine straight from index.html; this only adds two things:
     - short share links (POST /api/share -> id, GET /api/share/:id)
     - a real http origin, so localStorage and the clipboard behave normally

   Zero dependencies. Snapshots are written as JSON files under ./shares/. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SHARE_DIR = path.join(ROOT, 'shares');
const PORT = Number(process.env.PORT) || 5173;
const MAX_BODY = 5 * 1024 * 1024; // a very large family tree is still well under this

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

fs.mkdirSync(SHARE_DIR, { recursive: true });

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(url.pathname);

  // --- share API ---------------------------------------------------------

  if (pathname === '/api/share' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const doc = JSON.parse(raw);
      if (!doc || typeof doc !== 'object' || typeof doc.people !== 'object') {
        return send(res, 400, JSON.stringify({ error: 'not a family tree' }), TYPES['.json']);
      }
      const id = crypto.randomBytes(5).toString('hex');
      fs.writeFileSync(path.join(SHARE_DIR, id + '.json'), JSON.stringify(doc));
      console.log('  shared -> #s=' + id + '  (' + Object.keys(doc.people).length + ' people)');
      return send(res, 200, JSON.stringify({ id }), TYPES['.json']);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: String(e.message || e) }), TYPES['.json']);
    }
  }

  const shareGet = /^\/api\/share\/([a-f0-9]{10})$/.exec(pathname);
  if (shareGet && req.method === 'GET') {
    const file = path.join(SHARE_DIR, shareGet[1] + '.json');
    if (!fs.existsSync(file)) {
      return send(res, 404, JSON.stringify({ error: 'no such share' }), TYPES['.json']);
    }
    return send(res, 200, fs.readFileSync(file), TYPES['.json']);
  }

  if (pathname.startsWith('/api/')) {
    return send(res, 404, JSON.stringify({ error: 'unknown endpoint' }), TYPES['.json']);
  }

  // --- static files ------------------------------------------------------

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  // Refuse anything that escapes the project directory or reaches into ./shares.
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(SHARE_DIR + path.sep)) {
    return send(res, 403, 'Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log('\n  Heirloom running at  http://localhost:' + PORT + '\n');
  console.log('  Share links are stored in ./shares/ — delete a file to revoke it.\n');
});
