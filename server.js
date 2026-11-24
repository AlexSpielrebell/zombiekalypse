// Zombiekalypse – Online-Spieltisch (Charaktere, Whiteboard, Würfel)
// Ohne externe Abhängigkeiten: Node.js >= 18. Start: `node server.js`
//
// Umgebungsvariablen:
//   PORT          Port (Render setzt ihn automatisch)
//   DATA_DIR      Ordner für die Daten (Standard: ./data). Auf Render: Pfad der Persistent Disk, z. B. /var/data
//   ACCESS_CODE   optional: Zugangscode, den Spielerinnen und Spieler einmal eingeben müssen
//
// Protokoll: POST /api/hello  -> Sitzung
//            GET  /api/events?s=<sitzung>  (Server-Sent Events: snap, peers, reset)
//            POST /api/op     {s, op, ...}  (get, set, update, delete, sub, unsub, profiles, join, presence, leave)
//
// Datenpfade:  chars/<uid>/c/<charId>          Charaktere (nur Besitzer schreibt, alle lesen)
//              games/<gameId>                   Runde {name, owner} (Ersteller oder Spielleitung schreibt)
//              games/<gameId>/members/<uid>     Teilnahme mit Rolle gm|player (die Person selbst, Ersteller oder Spielleitung)
//              games/<gameId>/board|tokens|rolls|combat/<id>   Whiteboard, Figuren, Würfe, Kampf (alle Teilnehmenden)

"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const ACCESS_CODE = (process.env.ACCESS_CODE || "").trim();
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_DOC = 256 * 1024, MAX_DOCS = 50000, MAX_BODY = 600 * 1024;

// ---------------------------------------------------------------- Speicher
// Lokal: db.json/users.json im DATA_DIR. Auf Render ohne Persistent Disk geht dieser Ordner bei jedem Deploy verloren.
// Deshalb optional zusätzlich ein externer Speicher (Upstash Redis über dessen REST-API, kostenloser Plan reicht):
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN  -> beim Start wird von dort geladen, jede Änderung dorthin gesichert.
const zlib = require("zlib");
const KV_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, ""), KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const KV_KEY = process.env.STORAGE_KEY || "zombiekalypse";
const KV = !!(KV_URL && KV_TOKEN);
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, "db.json"), USERS_FILE = path.join(DATA_DIR, "users.json");
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const docs = new Map(Object.entries(readJSON(DB_FILE, {})));   // Pfad -> Dokument
const users = readJSON(USERS_FILE, {});                          // uid -> {th, name, color}
const colIndex = new Map();                                      // Sammlungspfad -> Set(Dokumentpfade)
const parentOf = p => p.slice(0, p.lastIndexOf("/"));
for (const p of docs.keys()) indexAdd(p);
function indexAdd(p) { const c = parentOf(p); if (!colIndex.has(c)) colIndex.set(c, new Set()); colIndex.get(c).add(p); }
function indexDel(p) { const c = parentOf(p); colIndex.get(c)?.delete(p); }

async function kv(cmd) {
  const r = await fetch(KV_URL, { method: "POST", headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "HTTP " + r.status);
  return j.result;
}
const snapshot = () => zlib.gzipSync(JSON.stringify({ v: 1, ts: Date.now(), docs: Object.fromEntries(docs), users })).toString("base64");
async function loadRemote() {
  if (!KV) return;
  try {
    const raw = await kv(["GET", KV_KEY]);
    if (!raw) { console.log("Externer Speicher ist leer – starte mit lokalen Daten."); return; }
    const data = JSON.parse(zlib.gunzipSync(Buffer.from(raw, "base64")).toString("utf8"));
    docs.clear(); colIndex.clear();
    for (const [k, v] of Object.entries(data.docs || {})) { docs.set(k, v); indexAdd(k); }
    for (const k of Object.keys(users)) delete users[k];
    Object.assign(users, data.users || {});
    console.log(`Externer Speicher geladen: ${docs.size} Dokumente, Stand ${new Date(data.ts).toISOString()}`);
  } catch (e) { console.error("Externer Speicher konnte nicht geladen werden:", e.message); }
}
let remoteBusy = null, remoteAgain = false, lastRemoteOk = null;
async function saveRemote() {
  if (!KV) return;
  if (remoteBusy) { remoteAgain = true; return remoteBusy; }
  remoteBusy = (async () => {
    do {
      remoteAgain = false;
      try { await kv(["SET", KV_KEY, snapshot()]); lastRemoteOk = Date.now(); }
      catch (e) { console.error("Externes Speichern fehlgeschlagen:", e.message); }
    } while (remoteAgain);
    remoteBusy = null;
  })();
  return remoteBusy;
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeAtomic(DB_FILE, JSON.stringify(Object.fromEntries(docs)));
    writeAtomic(USERS_FILE, JSON.stringify(users));
  }, 800);
  if (KV) { clearTimeout(remoteTimer); remoteTimer = setTimeout(saveRemote, 4000); } // seltener extern sichern (Kontingent schonen)
}
let remoteTimer = null;
function writeAtomic(f, text) { try { fs.writeFileSync(f + ".tmp", text); fs.renameSync(f + ".tmp", f); } catch (e) { console.error("Speichern fehlgeschlagen:", e.message); } }
async function flushNow() { clearTimeout(saveTimer); clearTimeout(remoteTimer); writeAtomic(DB_FILE, JSON.stringify(Object.fromEntries(docs))); writeAtomic(USERS_FILE, JSON.stringify(users)); if (KV) { await remoteBusy; await saveRemote(); } }
const shutdown = () => { const t = setTimeout(() => process.exit(0), 8000); flushNow().finally(() => { clearTimeout(t); process.exit(0); }); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ---------------------------------------------------------------- Pfade & Rechte
const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
function validPath(p, wantDoc) {
  if (typeof p !== "string" || p.length > 1000) return false;
  const s = p.split("/");
  if (s.length > 16 || s.some(x => !SEG.test(x) || x === "." || x === "..")) return false;
  return wantDoc ? s.length % 2 === 0 : s.length % 2 === 1;
}
function canRead(uid, p) { const s = p.split("/"); return !(s[0] === "data" && s[1] === "users" && s[2] !== uid); }
// Runde: games/<gid> {name, owner}. Spielleitung ist, wer als Mitglied die Rolle "gm" gewählt hat.
const ownerOf = gid => { const g = docs.get("games/" + gid); return g ? (g.owner || g.gm) : undefined; };
const isGmMember = (gid, uid) => docs.get(`games/${gid}/members/${uid}`)?.role === "gm";
function canWrite(uid, p, data) {
  const s = p.split("/");
  if (s[0] === "chars") return s[1] === uid;                 // nur die eigenen Charaktere
  if (s[0] === "data" && s[1] === "users") return s[2] === uid; // private Daten
  if (s[0] === "games") {
    const owner = ownerOf(s[1]);
    if (s.length === 2) return owner ? (owner === uid || isGmMember(s[1], uid)) : (!data || data.owner === uid); // neue Runde: Ersteller ist Besitzer
    if (!owner) return false;                                 // Runde existiert nicht
    if (s[2] === "members") return s[3] === uid || owner === uid || isGmMember(s[1], uid);
    return ["board", "tokens", "rolls", "combat"].includes(s[2]);
  }
  return false;
}

// ---------------------------------------------------------------- Sitzungen
const sessions = new Map(); // sid -> {uid, res, subs: Map(subId -> {path, kind, q, last}), rooms: Set, seen}
const rooms = new Map();    // Raumname -> Map(sid -> presence)
const COLORS = ["#5cc0b2", "#e8a54b", "#a77de0", "#e57fa1", "#7cc26b", "#5b8fe0", "#e05a4f", "#d9b45f"];

function sendEvent(sess, type, data) {
  if (!sess.res) return;
  try { sess.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) {}
}
function snapFor(uid, sub) {
  if (sub.kind === "doc") {
    const ok = docs.has(sub.path) && canRead(uid, sub.path);
    return { id: sub.path.split("/").pop(), exists: ok, data: ok ? docs.get(sub.path) : undefined };
  }
  let list = [...(colIndex.get(sub.path) || [])].filter(p => canRead(uid, p)).map(p => ({ id: p.split("/").pop(), data: docs.get(p) }));
  const q = sub.q || {};
  if (q.order) {
    const [f, dir] = q.order, m = dir === "desc" ? -1 : 1;
    list.sort((a, b) => {
      const x = a.data?.[f], y = b.data?.[f];
      if (x === undefined && y === undefined) return a.id.localeCompare(b.id);
      if (x === undefined) return 1; if (y === undefined) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * m;
    });
  } else list.sort((a, b) => a.id.localeCompare(b.id));
  if (q.limit) list = list.slice(0, Math.min(1000, q.limit));
  return { docs: list };
}
function pushSub(sess, subId, sub, force) {
  const snap = snapFor(sess.uid, sub);
  const key = JSON.stringify(snap);
  if (!force && key === sub.last) return;
  sub.last = key;
  sendEvent(sess, "snap", { id: subId, snap });
}
function notify(p) {
  const col = parentOf(p);
  for (const sess of sessions.values())
    for (const [id, sub] of sess.subs)
      if ((sub.kind === "doc" && sub.path === p) || (sub.kind === "col" && sub.path === col)) pushSub(sess, id, sub);
}
function peersOf(room, viewerSid) {
  const m = rooms.get(room); if (!m) return [];
  return [...m.entries()].filter(([sid]) => sessions.get(sid)?.res).map(([sid, pres]) => ({ by: sessions.get(sid).uid, peer: sid.slice(0, 10), presence: pres, isMe: sessions.get(sid).uid === sessions.get(viewerSid)?.uid, sameTab: sid === viewerSid }));
}
function broadcastRoom(room) {
  const m = rooms.get(room); if (!m) return;
  for (const sid of m.keys()) { const s = sessions.get(sid); if (s) sendEvent(s, "peers", { room, peers: peersOf(room, sid) }); }
}
function dropSession(sid) {
  const s = sessions.get(sid); if (!s) return;
  for (const r of s.rooms) { rooms.get(r)?.delete(sid); broadcastRoom(r); }
  sessions.delete(sid);
}
// verwaiste Sitzungen aufräumen (kein Ereignis-Kanal seit 10 Minuten)
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (!s.res && now - s.seen > 10 * 60 * 1000) dropSession(sid);
  for (const s of sessions.values()) if (s.res) { try { s.res.write(": ping\n\n"); } catch (e) {} }
}, 25000);

// ---------------------------------------------------------------- Operationen
function err(code, message) { return { ok: false, error: { code, message } }; }
function handleOp(sess, m) {
  const uid = sess.uid;
  switch (m.op) {
    case "get": {
      if (!validPath(m.path, m.kind === "doc")) return err("invalid_argument", "Pfad ungültig");
      return { ok: true, snap: snapFor(uid, { path: m.path, kind: m.kind, q: m.q }) };
    }
    case "set": case "update": {
      if (!validPath(m.path, true)) return err("invalid_argument", "Pfad ungültig");
      if (!m.data || typeof m.data !== "object" || Array.isArray(m.data)) return err("invalid_argument", "Dokument muss ein Objekt sein");
      if (!canWrite(uid, m.path, m.op === "set" ? m.data : null)) return err("permission_denied", "Keine Schreibrechte für diesen Pfad");
      if (m.path.split("/").length === 2 && m.path.startsWith("games/") && docs.has(m.path) && "owner" in m.data && m.data.owner !== docs.get(m.path).owner) return err("permission_denied", "Besitz der Runde kann nicht übertragen werden");
      let next;
      if (m.op === "update") {
        if (!docs.has(m.path)) return err("invalid_argument", "Dokument existiert nicht");
        next = deepMerge(structuredClone(docs.get(m.path)), m.data);
      } else next = m.data;
      if (JSON.stringify(next).length > MAX_DOC) return err("invalid_argument", "Dokument zu groß (max. 256 KB)");
      if (!docs.has(m.path) && docs.size >= MAX_DOCS) return err("quota_exceeded", "Speicher voll");
      if (!docs.has(m.path)) indexAdd(m.path);
      docs.set(m.path, next); persist(); notify(m.path);
      return { ok: true };
    }
    case "delete": {
      if (!validPath(m.path, true)) return err("invalid_argument", "Pfad ungültig");
      if (!canWrite(uid, m.path)) return err("permission_denied", "Keine Schreibrechte für diesen Pfad");
      if (docs.delete(m.path)) { indexDel(m.path); persist(); notify(m.path); }
      return { ok: true };
    }
    case "sub": {
      if (!validPath(m.path, m.kind === "doc")) return err("invalid_argument", "Pfad ungültig");
      if (sess.subs.size >= 64 && !sess.subs.has(m.id)) return err("resource_exhausted", "Zu viele Abos");
      const sub = { path: m.path, kind: m.kind, q: m.q || {}, last: null };
      sess.subs.set(String(m.id), sub); pushSub(sess, String(m.id), sub, true);
      return { ok: true };
    }
    case "unsub": sess.subs.delete(String(m.id)); return { ok: true };
    case "profiles": {
      const out = {};
      (m.ids || []).slice(0, 500).forEach(i => { const u = users[i]; out[i] = { id: i, name: u?.name || "", color: u?.color || "#888888", avatarUrl: "", email: null, isMe: i === uid, guest: false }; });
      return { ok: true, profiles: out };
    }
    case "join": {
      const r = String(m.room || "").slice(0, 48); if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(r)) return err("invalid_argument", "Raumname ungültig");
      if (!rooms.has(r)) rooms.set(r, new Map());
      rooms.get(r).set(sess.id, rooms.get(r).get(sess.id) || {}); sess.rooms.add(r); broadcastRoom(r);
      return { ok: true };
    }
    case "presence": {
      const r = rooms.get(String(m.room)); if (!r || !r.has(sess.id)) return err("invalid_argument", "Nicht im Raum");
      const p = { ...r.get(sess.id), ...(m.patch || {}) };
      Object.keys(p).forEach(k => p[k] === null && delete p[k]);
      if (JSON.stringify(p).length > 4096) return err("invalid_argument", "Präsenz zu groß");
      r.set(sess.id, p); broadcastRoom(String(m.room));
      return { ok: true };
    }
    case "leave": { const r = String(m.room); rooms.get(r)?.delete(sess.id); sess.rooms.delete(r); broadcastRoom(r); return { ok: true }; }
  }
  return err("invalid_argument", "Unbekannte Operation");
}
function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) a[k] = deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}

// ---------------------------------------------------------------- HTTP
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function json(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
const hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/healthz") return json(res, 200, { ok: true, docs: docs.size, sessions: sessions.size, storage: KV ? "extern" : "lokal", lastRemoteSave: lastRemoteOk, keepalive: !!SELF_URL, tableOpen: tableOpen(), lastPing });

    if (req.method === "POST" && url.pathname === "/api/hello") {
      const b = await readBody(req);
      if (ACCESS_CODE && String(b.code || "").trim() !== ACCESS_CODE) return json(res, 403, { ok: false, error: { code: "access_code", message: "Zugangscode erforderlich" } });
      const uid = String(b.uid || ""), token = String(b.token || "");
      if (!/^u_[a-z0-9]{8,40}$/.test(uid) || token.length < 16) return json(res, 400, { ok: false, error: { code: "invalid_argument", message: "Ungültige Identität" } });
      const u = users[uid];
      if (u && u.th !== hash(token)) return json(res, 403, { ok: false, error: { code: "identity", message: "Diese Identität gehört jemand anderem" } });
      const name = String(b.name || "").trim().slice(0, 40);
      users[uid] = { th: hash(token), name: name || u?.name || "", color: u?.color || COLORS[Object.keys(users).length % COLORS.length] };
      persist();
      const sid = crypto.randomBytes(18).toString("hex");
      sessions.set(sid, { id: sid, uid, res: null, subs: new Map(), rooms: new Set(), seen: Date.now() });
      return json(res, 200, { ok: true, s: sid, uid, name: users[uid].name, color: users[uid].color });
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const sess = sessions.get(url.searchParams.get("s") || "");
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
      if (!sess) { res.write(`event: reset\ndata: {}\n\n`); return res.end(); }
      if (sess.res) { try { sess.res.end(); } catch (e) {} }
      sess.res = res; sess.seen = Date.now();
      res.write(`retry: 2000\n\n`);
      for (const [id, sub] of sess.subs) pushSub(sess, id, sub, true);
      for (const r of sess.rooms) broadcastRoom(r);
      req.on("close", () => { if (sess.res === res) { sess.res = null; sess.seen = Date.now(); for (const r of sess.rooms) broadcastRoom(r); } });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/op") {
      const b = await readBody(req);
      const sess = sessions.get(String(b.s || ""));
      if (!sess) return json(res, 401, { ok: false, error: { code: "session", message: "Sitzung abgelaufen" } });
      sess.seen = Date.now();
      return json(res, 200, handleOp(sess, b));
    }

    if (req.method === "GET" || req.method === "HEAD") {
      let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
      const f = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[\/\\])+/, ""));
      if (!f.startsWith(PUBLIC_DIR)) return json(res, 403, { ok: false });
      return fs.readFile(f, (e, buf) => {
        if (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Nicht gefunden"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : buf);
      });
    }
    json(res, 405, { ok: false });
  } catch (e) {
    json(res, 400, { ok: false, error: { code: "invalid_argument", message: String(e.message || e) } });
  }
});
server.keepAliveTimeout = 65000;
// ---------------------------------------------------------------- Wachhalten
// Kostenlose Render-Dienste schlafen nach 15 Minuten ohne Anfragen ein. Solange jemand die Seite offen hat
// (aktive Sitzung in den letzten 15 Minuten), ruft sich der Server alle 10 Minuten selbst über seine öffentliche Adresse auf.
// Ist niemand mehr da, hört der Ping auf und der Dienst darf schlafen. Die Seite selbst pingt zusätzlich (adapter.js).
const SELF_URL = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
const KEEPALIVE_MS = Math.max(0.05, Number(process.env.KEEPALIVE_MINUTES) || 10) * 60 * 1000;
let lastPing = null;
function tableOpen() { const now = Date.now(); for (const s of sessions.values()) if (s.res || now - s.seen < 15 * 60 * 1000) return true; return false; }
if (SELF_URL) setInterval(() => {
  if (!tableOpen()) return;
  fetch(SELF_URL + "/healthz?ping=server", { cache: "no-store" }).then(() => { lastPing = Date.now(); }).catch(e => console.error("Ping fehlgeschlagen:", e.message));
}, KEEPALIVE_MS);

loadRemote().then(() => server.listen(PORT, () => console.log(`Zombiekalypse-Server läuft auf Port ${PORT} · Daten: ${DATA_DIR}${KV ? " + externer Speicher" : ""}${SELF_URL ? " · Wachhalten aktiv" : ""}${ACCESS_CODE ? " · Zugangscode aktiv" : ""}`)));
