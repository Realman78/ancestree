#!/usr/bin/env node
/* Ancestree — optional local static server.

   The app runs fine straight from index.html. This only serves the folder over
   http, which gives localStorage and downloads a normal origin to work with.
   Zero dependencies, and it stores nothing: every tree lives in the browser. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(url.pathname);

  // --- static files ------------------------------------------------------

  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  // Refuse anything that escapes the project directory.
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
});

server.listen(PORT, () => {
  console.log('\n  Ancestree running at  http://localhost:' + PORT + '\n');
});
