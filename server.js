// Despertares Miguel Jr. — botón para registrar la hora de cada despertar nocturno.
// Una "noche" va de las 18:00 a las 17:59 del día siguiente (hora de Madrid) y se
// etiqueta con la fecha de la tarde en que empieza.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const APP_KEY = process.env.APP_KEY || '';
const TZ = 'Europe/Madrid';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } })
  : null;

// Respaldo en memoria si no hay base de datos (solo para pruebas locales).
const mem = []; let memId = 1;

async function init() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS wakes (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT
  )`);
  await pool.query(`ALTER TABLE wakes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'wake'`);
}
const KINDS = ['asleep', 'wake', 'up'];

function madridParts(d) {
  const f = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute };
}
function nightKey(date) {
  const p = madridParts(date);
  let dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  if (p.hh < 18) dt = new Date(dt.getTime() - 86400000);
  return dt.toISOString().slice(0, 10);
}
function hhmm(date) { const p = madridParts(date); return String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0'); }

async function listWakes(days) {
  const since = new Date(Date.now() - days * 86400000);
  let rows;
  if (pool) rows = (await pool.query('SELECT id, ts, note, kind FROM wakes WHERE ts >= $1 ORDER BY ts', [since])).rows;
  else rows = mem.filter(r => r.ts >= since);
  const nights = {};
  for (const r of rows) {
    const ts = new Date(r.ts); const k = nightKey(ts);
    (nights[k] ||= []).push({ id: r.id, time: hhmm(ts), iso: ts.toISOString(), note: r.note || '', kind: r.kind || 'wake' });
  }
  return { tonight: nightKey(new Date()), nights };
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function authed(req, url) {
  if (!APP_KEY) return true;
  const want = APP_KEY.trim().toLowerCase();
  const got = (req.headers['x-app-key'] || url.searchParams.get('k') || '').toString().trim().toLowerCase();
  return got === want;
}
function readBody(req) {
  return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
}

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, indexHtml, 'text/html');
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (!authed(req, url)) return send(res, 401, { error: 'clave incorrecta' });

    if (req.method === 'GET' && url.pathname === '/api/wakes') {
      const days = Math.min(+url.searchParams.get('days') || 8, 60);
      return send(res, 200, await listWakes(days));
    }
    if (req.method === 'POST' && url.pathname === '/api/wakes') {
      const body = await readBody(req);
      const note = (body.note || '').toString().slice(0, 200) || null;
      const kind = KINDS.includes(body.kind) ? body.kind : 'wake';
      let row;
      if (pool) row = (await pool.query('INSERT INTO wakes (note, kind) VALUES ($1, $2) RETURNING id, ts', [note, kind])).rows[0];
      else { row = { id: memId++, ts: new Date(), note, kind }; mem.push(row); }
      return send(res, 201, { id: row.id, time: hhmm(new Date(row.ts)), kind });
    }
    const m = url.pathname.match(/^\/api\/wakes\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const body = await readBody(req);
      if ('note' in body) {
        const note = (body.note || '').toString().slice(0, 200) || null;
        if (pool) await pool.query('UPDATE wakes SET note=$1 WHERE id=$2', [note, +m[1]]);
        else { const r = mem.find(x => x.id === +m[1]); if (r) r.note = note; }
      }
      if (KINDS.includes(body.kind)) {
        if (pool) await pool.query('UPDATE wakes SET kind=$1 WHERE id=$2', [body.kind, +m[1]]);
        else { const r = mem.find(x => x.id === +m[1]); if (r) r.kind = body.kind; }
      }
      return send(res, 200, { ok: true });
    }
    if (m && req.method === 'DELETE') {
      if (pool) await pool.query('DELETE FROM wakes WHERE id=$1', [+m[1]]);
      else { const i = mem.findIndex(x => x.id === +m[1]); if (i >= 0) mem.splice(i, 1); }
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e); send(res, 500, { error: 'error del servidor' });
  }
}).listen(PORT, () => console.log('Escuchando en', PORT));

init().catch(e => console.error('init', e));
