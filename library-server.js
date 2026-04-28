#!/usr/bin/env node
// MIDI Library Server — personal use
// Run: node library-server.js
// Then open http://127.0.0.1:3722 in Chrome
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const LIBRARY = '/Users/tolga.oezdemir/Documents/MIDI Banks';
const PORT    = 3722;
const HTML    = path.join(__dirname, 'index.library.html');

// ── search index (built async on startup) ─────────────────────

let searchIdx = null; // [{ p: relPath, n: name, lc: lowercase }]

function buildIndex(dir, rel) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r    = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && e.name !== 'Harmonic Wireframes')
        out.push(...buildIndex(full, r));
    } else if (/\.(mid|midi)$/i.test(e.name) && !/_cc\.mid$/i.test(e.name) && !/_chord\.mid$/i.test(e.name)) {
      out.push({ p: r, n: e.name, lc: r.toLowerCase() });
    }
  }
  return out;
}

setImmediate(() => {
  console.log('Building search index…');
  try {
    searchIdx = buildIndex(LIBRARY, '');
    console.log(`Search index ready: ${searchIdx.length} files`);
  } catch(e) {
    console.error('Index build failed:', e.message);
    searchIdx = [];
  }
});

// ── CC-tag scanner (checks _cc.mid for actual CC 85/86 bytes) ─

function midiHasCcTags(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    let has85 = false, has86 = false;
    for (let i = 0; i + 1 < buf.length; i++) {
      if ((buf[i] & 0xF0) === 0xB0) {          // CC status byte
        const cc = buf[i + 1];
        if (cc === 85) has85 = true;
        else if (cc === 86) has86 = true;
        if (has85 && has86) return true;
      }
    }
  } catch {}
  return false;
}

// ── metadata (_lib_meta.json at library root) ─────────────────

const META_PATH = path.join(LIBRARY, '_lib_meta.json');
let metaCache = null;
function readMeta()  {
  if (!metaCache) { try { metaCache = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { metaCache = {}; } }
  return metaCache;
}
function writeMeta() {
  try { fs.writeFileSync(META_PATH, JSON.stringify(metaCache)); } catch(e) { console.error('meta write:', e.message); }
}

// ── path safety ───────────────────────────────────────────────

function safeResolve(rel) {
  if (!rel) return null;
  const norm = path.normalize(rel).replace(/^(\.\.[\\/])+/, '');
  const full = path.join(LIBRARY, norm);
  const sep  = path.sep;
  if (full !== LIBRARY && !full.startsWith(LIBRARY + sep)) return null;
  return full;
}

// ── response helpers ──────────────────────────────────────────

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function err(res, status, msg) {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*' });
  res.end(msg);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── server ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname, query: qs } = url.parse(req.url, true);

  // ── Serve HTML app ──
  if (pathname === '/' || pathname === '/index.library.html' || pathname === '/index.library.htnl') {
    try {
      const html = fs.readFileSync(HTML);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
      res.end(html);
    } catch(e) {
      err(res, 500, 'index.library.html not found — make sure both files are in the same directory.');
    }
    return;
  }

  // ── List directory ──
  // GET /api/list?p=relative/path  (empty p = root)
  if (pathname === '/api/list') {
    const relPath = qs.p || '';
    const full    = safeResolve(relPath === '' ? '.' : relPath);
    if (!full) return err(res, 400, 'bad path');
    let entries;
    try { entries = fs.readdirSync(full, { withFileTypes: true }); }
    catch(e) { return err(res, 404, e.message); }

    const items = entries
      .filter(e => {
        if (e.isDirectory()) return !e.name.startsWith('.') && e.name !== 'Harmonic Wireframes';
        return /\.(mid|midi)$/i.test(e.name) &&
               !/_cc\.mid$/i.test(e.name) &&
               !/_chord\.mid$/i.test(e.name);
      })
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      })
      .map(e => {
        const isDir  = e.isDirectory();
        const rel    = relPath ? relPath + '/' + e.name : e.name;
        let   hasCc  = false;
        if (!isDir) {
          const base = e.name.replace(/\.(mid|midi)$/i, '');
          try { hasCc = fs.existsSync(path.join(full, base + '_cc.mid')); } catch {}
        }
        return { name: e.name, type: isDir ? 'folder' : 'file', path: rel, hasCc };
      });

    return json(res, items);
  }

  // ── Search ──
  // GET /api/search?q=query
  if (pathname === '/api/search') {
    if (!searchIdx) return json(res, []);
    const q = (qs.q || '').toLowerCase().trim();
    if (!q) return json(res, []);
    const terms = q.split(/\s+/).filter(Boolean);
    const hits  = searchIdx
      .filter(f => terms.every(t => f.lc.includes(t)))
      .slice(0, 60);
    return json(res, hits.map(f => ({ path: f.p, name: f.n })));
  }

  // ── All files (for batch processing) ──
  // GET /api/all?offset=0&limit=500
  if (pathname === '/api/all') {
    if (!searchIdx) return json(res, { ready: false, total: 0, items: [] });
    const offset = Math.max(0, parseInt(qs.offset || '0', 10));
    const limit  = Math.min(500, Math.max(1, parseInt(qs.limit || '500', 10)));
    const slice  = searchIdx.slice(offset, offset + limit);
    return json(res, { ready: true, total: searchIdx.length, offset, items: slice.map(f => {
      const base   = f.n.replace(/\.(mid|midi)$/i, '');
      const dir    = path.join(LIBRARY, path.dirname(f.p));
      const hwDir  = path.join(LIBRARY, 'Harmonic Wireframes', path.dirname(f.p));
      let hasCc = false, hasChord = false;
      try { const ccPath = path.join(dir, base + '_cc.mid'); if (fs.existsSync(ccPath)) hasCc = midiHasCcTags(ccPath); } catch {}
      try { hasChord = fs.existsSync(path.join(hwDir, base + '_chord.mid')); } catch {}
      return { path: f.p, name: f.n, hasCc, hasChord };
    }) });
  }

  // ── Serve MIDI file ──
  // GET /api/midi?p=relative/path.mid
  if (pathname === '/api/midi') {
    const full = safeResolve(qs.p);
    if (!full || !/\.(mid|midi)$/i.test(full)) return err(res, 400, 'bad path');
    try {
      const data = fs.readFileSync(full);
      res.writeHead(200, {
        'Content-Type':   'audio/midi',
        'Content-Length': data.length,
        'Cache-Control':  'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch { err(res, 404, 'not found'); }
    return;
  }

  // ── Save tagged MIDI ──
  // POST /api/save?p=relative/path.mid  body=bytes
  if (pathname === '/api/save' && req.method === 'POST') {
    const full = safeResolve(qs.p);
    if (!full || !/\.(mid|midi)$/i.test(full)) return err(res, 400, 'bad path');
    const dir     = path.dirname(full);
    const base    = path.basename(full).replace(/\.(mid|midi)$/i, '');
    const outPath = path.join(dir, base + '_cc.mid');
    try {
      const body = await readBody(req);
      fs.writeFileSync(outPath, body);
      json(res, { ok: true, savedAs: outPath });
    } catch(e) { err(res, 500, e.message); }
    return;
  }

  // ── Save chord MIDI to Harmonic Wireframes ──
  // POST /api/save-chord?p=relative/path.mid  body=bytes
  if (pathname === '/api/save-chord' && req.method === 'POST') {
    if (!qs.p || !/\.(mid|midi)$/i.test(qs.p)) return err(res, 400, 'bad path');
    const hwDir  = path.join(LIBRARY, 'Harmonic Wireframes', path.dirname(qs.p));
    const base   = path.basename(qs.p).replace(/\.(mid|midi)$/i, '');
    const outPath = path.join(hwDir, base + '_chord.mid');
    try {
      const body = await readBody(req);
      fs.mkdirSync(hwDir, { recursive: true });
      fs.writeFileSync(outPath, body);
      json(res, { ok: true, savedAs: outPath });
    } catch(e) { err(res, 500, e.message); }
    return;
  }

  // ── Metadata ──
  // GET /api/meta  → full metadata map
  // POST /api/meta?p=path  body=JSON
  if (pathname === '/api/meta') {
    if (req.method === 'GET') {
      return json(res, readMeta());
    }
    if (req.method === 'POST') {
      if (!qs.p) return err(res, 400, 'missing p');
      try {
        const body = await readBody(req);
        const meta = JSON.parse(body.toString('utf8'));
        const m = readMeta();
        m[qs.p] = { ...meta, updatedAt: Date.now() };
        writeMeta();
        json(res, { ok: true });
      } catch(e) { err(res, 500, e.message); }
      return;
    }
  }

  err(res, 404, 'not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ♪  MIDI Library → http://127.0.0.1:${PORT}\n`);
  console.log(`  Library path: ${LIBRARY}\n`);
  console.log('  Open Chrome and navigate to http://127.0.0.1:3722\n');
});
