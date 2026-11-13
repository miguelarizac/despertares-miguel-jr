// Despertares Miguel Jr. — botón para registrar la hora de cada despertar nocturno.
// Una "noche" va de las 18:00 a las 17:59 del día siguiente (hora de Madrid) y se
// etiqueta con la fecha de la tarde en que empieza.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const TZ = 'Europe/Madrid';

// Claves de acceso. APP_KEYS = "Miguel:clave1,Lucía:clave2" (una por persona, para saber quién anota cada cosa).
// APP_KEY = clave compartida antigua: sigue funcionando (Atajos, app de iOS) pero queda como "sin identificar".
const KEYS = new Map();
for (const part of (process.env.APP_KEYS || '').split(',')) {
  const i = part.lastIndexOf(':'); if (i < 1) continue;
  const name = part.slice(0, i).trim(), key = part.slice(i + 1).trim().toLowerCase();
  if (name && key) KEYS.set(key, name);
}
const LEGACY_KEY = (process.env.APP_KEY || '').trim().toLowerCase();
const LEGACY_NAME = 'Sin identificar';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } })
  : null;

// Respaldo en memoria si no hay base de datos (solo para pruebas locales).
const mem = []; let memId = 1; const memDays = {}; const memChanges = [];

async function init() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS wakes (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT
  )`);
  await pool.query(`ALTER TABLE wakes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'wake'`);
  await pool.query(`ALTER TABLE wakes ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS wakes_client_id ON wakes (client_id)`);
  await pool.query(`ALTER TABLE wakes ADD COLUMN IF NOT EXISTS created_by TEXT`);
  await pool.query(`ALTER TABLE wakes ADD COLUMN IF NOT EXISTS updated_by TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS days (day DATE PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb)`);
  // Registro de cambios: quién hizo qué y cuándo.
  await pool.query(`CREATE TABLE IF NOT EXISTS changes (
    id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), by_user TEXT, action TEXT NOT NULL, detail JSONB
  )`);
}
const KINDS = ['bath', 'room_in', 'crib', 'room_out', 'asleep', 'wake', 'resleep', 'df', 'up', 'outcrib'];

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
// Hora local de Madrid (noche + HH:MM) -> Date en UTC. Las horas >= 18 son de la tarde de 'night'; el resto, de la madrugada siguiente.
function fromNightTime(night, time) {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(night || ''); const tt = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!mt || !tt) return null;
  const hh = +tt[1], mm = +tt[2]; if (hh > 23 || mm > 59) return null;
  const add = hh >= 18 ? 0 : 1;
  const guess = Date.UTC(+mt[1], +mt[2] - 1, +mt[3] + add, hh, mm);
  const p = madridParts(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  const ts = new Date(guess - (asUtc - guess));
  if (ts > new Date(Date.now() + 5 * 60000) || ts < new Date(Date.now() - 10 * 86400000)) return null;
  return ts;
}
function hhmm(date) { const p = madridParts(date); return String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0'); }

async function listWakes(days) {
  const since = new Date(Date.now() - days * 86400000);
  let rows;
  if (pool) rows = (await pool.query('SELECT id, ts, note, kind, client_id, created_by, updated_by FROM wakes WHERE ts >= $1 ORDER BY ts', [since])).rows;
  else rows = mem.filter(r => r.ts >= since).sort((a, b) => a.ts - b.ts);
  const nights = {};
  for (const r of rows) {
    const ts = new Date(r.ts); const k = nightKey(ts);
    (nights[k] ||= []).push({ id: r.id, time: hhmm(ts), iso: ts.toISOString(), note: r.note || '', kind: r.kind || 'wake',
      client_id: r.client_id || null, by: r.created_by || null, upd: r.updated_by || null });
  }
  return { tonight: nightKey(new Date()), nights };
}

async function logChange(user, action, detail) {
  if (pool) await pool.query('INSERT INTO changes (by_user, action, detail) VALUES ($1, $2, $3::jsonb)', [user, action, JSON.stringify(detail || {})]);
  else memChanges.push({ id: memChanges.length + 1, at: new Date(), by_user: user, action, detail });
}

function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
// Devuelve el nombre de quien usa la app (según su clave) o null si la clave no vale.
function whoIs(req, url) {
  if (!KEYS.size && !LEGACY_KEY) return LEGACY_NAME;
  const got = (req.headers['x-app-key'] || url.searchParams.get('k') || '').toString().trim().toLowerCase();
  if (!got) return null;
  if (KEYS.has(got)) return KEYS.get(got);
  if (LEGACY_KEY && got === LEGACY_KEY) return LEGACY_NAME;
  return null;
}
function readBody(req) {
  return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
}

const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, indexHtml, 'text/html');
    if (req.method === 'GET' && url.pathname === '/sw.js') return send(res, 200, swJs, 'text/javascript', { 'Service-Worker-Allowed': '/' });
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const user = whoIs(req, url);
    if (!user) return send(res, 401, { error: 'clave incorrecta' });

    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user });

    if (req.method === 'GET' && url.pathname === '/api/changes') {
      const limit = Math.min(+url.searchParams.get('limit') || 50, 200);
      let rows;
      if (pool) rows = (await pool.query('SELECT id, at, by_user, action, detail FROM changes ORDER BY id DESC LIMIT $1', [limit])).rows;
      else rows = memChanges.slice(-limit).reverse();
      return send(res, 200, rows.map(r => ({ id: r.id, iso: new Date(r.at).toISOString(), time: hhmm(new Date(r.at)), by: r.by_user, action: r.action, detail: r.detail })));
    }

    if (req.method === 'GET' && url.pathname === '/api/days') {
      let out = {};
      if (pool) for (const r of (await pool.query("SELECT to_char(day,'YYYY-MM-DD') AS day, data FROM days WHERE day >= now() - interval '40 days'")).rows) out[r.day] = r.data;
      else out = memDays;
      return send(res, 200, out);
    }
    const dm = url.pathname.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})$/);
    if (dm && req.method === 'PUT') {
      const body = await readBody(req); const patch = {}; const by = {};
      for (const [k, v] of Object.entries(body || {})) if (/^[a-z_0-9]{1,30}$/.test(k)) { patch[k] = String(v ?? '').slice(0, 2000); by[k] = user; }
      if (pool) await pool.query(`INSERT INTO days (day, data) VALUES ($1, $2::jsonb || jsonb_build_object('_by', $3::jsonb))
        ON CONFLICT (day) DO UPDATE SET data = days.data || $2::jsonb || jsonb_build_object('_by', COALESCE(days.data->'_by', '{}'::jsonb) || $3::jsonb)`,
        [dm[1], JSON.stringify(patch), JSON.stringify(by)]);
      else { const cur = memDays[dm[1]] || {}; memDays[dm[1]] = { ...cur, ...patch, _by: { ...(cur._by || {}), ...by } }; }
      await logChange(user, 'day', { day: dm[1], ...patch });
      return send(res, 200, { ok: true, by: user });
    }
    if (req.method === 'GET' && url.pathname === '/api/wakes') {
      const days = Math.min(+url.searchParams.get('days') || 8, 60);
      return send(res, 200, await listWakes(days));
    }
    if (req.method === 'POST' && url.pathname === '/api/wakes') {
      const body = await readBody(req);
      const note = (body.note || '').toString().slice(0, 200) || null;
      const kind = KINDS.includes(body.kind) ? body.kind : 'wake';
      let at = new Date();
      if (body.ts) {
        // Hora exacta del cliente (ISO 8601): pulsaciones guardadas sin conexión (web o app de iOS).
        at = new Date(body.ts);
        if (isNaN(at) || at > new Date(Date.now() + 5 * 60000) || at < new Date(Date.now() - 10 * 86400000)) return send(res, 400, { error: 'hora no válida' });
      } else if (body.time) { at = fromNightTime(body.night, body.time); if (!at) return send(res, 400, { error: 'hora no válida' }); }
      // client_id opcional: si se reenvía el mismo evento (reintento), no se duplica.
      const clientId = body.client_id ? String(body.client_id).slice(0, 64) : null;
      let row, isNew = true;
      if (pool) {
        row = (await pool.query(`INSERT INTO wakes (note, kind, ts, client_id, created_by) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id RETURNING id, ts, kind, (xmax = 0) AS inserted`, [note, kind, at, clientId, user])).rows[0];
        isNew = row.inserted;
      } else {
        row = clientId && mem.find(r => r.client_id === clientId);
        if (row) isNew = false;
        else { row = { id: memId++, ts: at, note, kind, client_id: clientId, created_by: user }; mem.push(row); }
      }
      const ts = new Date(row.ts);
      if (isNew) await logChange(user, 'add', { id: row.id, kind: row.kind, time: hhmm(ts), night: nightKey(ts), note });
      return send(res, 201, { id: row.id, time: hhmm(ts), iso: ts.toISOString(), night: nightKey(ts), kind: row.kind, by: user });
    }
    const m = url.pathname.match(/^\/api\/wakes\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const id = +m[1]; const body = await readBody(req); const changed = { id };
      let before = null;
      if (pool) before = (await pool.query('SELECT ts, kind, note FROM wakes WHERE id=$1', [id])).rows[0];
      else before = mem.find(x => x.id === id);
      if (!before) return send(res, 404, { error: 'no existe' });
      changed.was = { kind: before.kind, time: hhmm(new Date(before.ts)), note: before.note || '' };
      if ('note' in body) {
        const note = (body.note || '').toString().slice(0, 200) || null; changed.note = note;
        if (pool) await pool.query('UPDATE wakes SET note=$1, updated_by=$3 WHERE id=$2', [note, id, user]);
        else { before.note = note; before.updated_by = user; }
      }
      if (body.time || body.ts) {
        const at = body.ts ? new Date(body.ts) : fromNightTime(body.night, body.time);
        if (!at || isNaN(at)) return send(res, 400, { error: 'hora no válida' });
        changed.time = hhmm(at);
        if (pool) await pool.query('UPDATE wakes SET ts=$1, updated_by=$3 WHERE id=$2', [at, id, user]);
        else { before.ts = at; before.updated_by = user; }
      }
      if (KINDS.includes(body.kind)) {
        changed.kind = body.kind;
        if (pool) await pool.query('UPDATE wakes SET kind=$1, updated_by=$3 WHERE id=$2', [body.kind, id, user]);
        else { before.kind = body.kind; before.updated_by = user; }
      }
      await logChange(user, 'edit', changed);
      return send(res, 200, { ok: true, by: user });
    }
    if (m && req.method === 'DELETE') {
      const id = +m[1]; let before = null;
      if (pool) before = (await pool.query('DELETE FROM wakes WHERE id=$1 RETURNING ts, kind, note', [id])).rows[0];
      else { const i = mem.findIndex(x => x.id === id); if (i >= 0) before = mem.splice(i, 1)[0]; }
      if (before) await logChange(user, 'delete', { id, kind: before.kind, time: hhmm(new Date(before.ts)), night: nightKey(new Date(before.ts)), note: before.note || '' });
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e); send(res, 500, { error: 'error del servidor' });
  }
}).listen(PORT, () => console.log('Escuchando en', PORT));

init().catch(e => console.error('init', e));
