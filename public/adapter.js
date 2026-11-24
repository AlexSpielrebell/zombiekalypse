// ===================== Verbindung zum eigenen Server =====================
// Stellt dieselbe Schnittstelle bereit wie claude.ai (claude.use("db"|"user"|"room"|"downloads")),
// damit der Generator unverändert auf dem eigenen Server läuft.
(() => {
  window.__SELFHOSTED = true;
  const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join("");
  let uid = LS.get("zk-uid"), token = LS.get("zk-token");
  if (!uid || !/^u_[a-z0-9]{8,40}$/.test(uid)) { uid = "u_" + rand(20); LS.set("zk-uid", uid); }
  if (!token || token.length < 16) { token = rand(40); LS.set("zk-token", token); }
  let sid = null, me = { name: LS.get("zk-name") || "", color: "#5cc0b2" }, es = null, ready = null, helloBusy = null;
  const subs = new Map();   // id -> {path, kind, q, next}
  const rooms = new Map();  // name -> {presence, handlers:Set, peers:[]}
  let subSeq = 0;
  const E = (code, message) => ({ code, message: message || code });

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch (e) {}
    return { status: r.status, j: j || { ok: false, error: E("unavailable") } };
  }
  async function askCode(again) {
    const msg = again ? "Der Zugangscode stimmt nicht. Bitte erneut eingeben:" : "Dieses Spiel ist mit einem Zugangscode geschützt. Bitte eingeben:";
    const v = typeof uiPrompt === "function" ? await uiPrompt(msg, "") : window.prompt(msg, "");
    if (v === null || v === undefined) return false;
    LS.set("zk-code", v.trim()); return true;
  }
  function hello() {
    if (helloBusy) return helloBusy;
    helloBusy = (async () => {
      let tries = 0;
      for (;;) {
        let r;
        try { r = await post("api/hello", { uid, token, name: me.name, code: LS.get("zk-code") || "" }); }
        catch (e) { await new Promise(res => setTimeout(res, Math.min(10000, 1000 * ++tries))); continue; }
        if (r.j.ok) { sid = r.j.s; me.name = r.j.name || me.name; me.color = r.j.color || me.color; break; }
        if (r.j.error?.code === "access_code") { if (!await askCode(tries++ > 0)) { await new Promise(res => setTimeout(res, 3000)); } continue; }
        if (r.j.error?.code === "identity") { uid = "u_" + rand(20); token = rand(40); LS.set("zk-uid", uid); LS.set("zk-token", token); continue; }
        await new Promise(res => setTimeout(res, Math.min(10000, 1000 * ++tries)));
      }
      openEvents();
      for (const [id, s] of subs) op({ op: "sub", id, path: s.path, kind: s.kind, q: s.q }).catch(() => {});
      for (const [name, r] of rooms) { await op({ op: "join", room: name }).catch(() => {}); if (r.presence) op({ op: "presence", room: name, patch: r.presence }).catch(() => {}); }
      helloBusy = null;
    })();
    return helloBusy;
  }
  function openEvents() {
    if (es) es.close();
    es = new EventSource("api/events?s=" + encodeURIComponent(sid));
    es.addEventListener("snap", ev => { const m = JSON.parse(ev.data); const s = subs.get(m.id); if (s) s.next(m.snap); });
    es.addEventListener("peers", ev => { const m = JSON.parse(ev.data); const r = rooms.get(m.room); if (!r) return; r.peers = Object.freeze(m.peers.map(p => Object.freeze({ ...p, kind: "viewer", guest: false, updatedAt: Date.now() }))); r.handlers.forEach(h => { try { h({ peers: r.peers, joined: [], left: [], updated: [] }); } catch (e) { console.error(e); } }); });
    es.addEventListener("reset", () => { es.close(); es = null; sid = null; hello(); });
  }
  async function op(body, retried) {
    await ready;
    if (!sid) await hello();
    let r;
    try { r = await post("api/op", { s: sid, ...body }); } catch (e) { throw E("unavailable", "Server nicht erreichbar"); }
    if (r.status === 401 && !retried) { sid = null; await hello(); return op(body, true); }
    if (!r.j.ok) throw r.j.error || E("unavailable");
    return r.j;
  }
  ready = hello();

  // Lebenszeichen: Solange die Seite bei jemandem geöffnet ist, meldet sie sich alle 10 Minuten kurz beim Server.
  // So schläft der Server auch dann nicht ein, wenn während des Spiels länger niemand klickt.
  setInterval(() => { fetch("healthz", { cache: "no-store" }).catch(() => {}); }, 10 * 60 * 1000);

  // ---------- Schnappschüsse im Stil von claude.ai ----------
  const meta = { fromCache: false, hasPendingWrites: false };
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const docSnap = s => ({ id: s.id, exists: !!s.exists, data: () => clone(s.data), metadata: meta });
  const colSnap = s => { const d = s.docs.map(x => ({ id: x.id, exists: true, data: () => clone(x.data), metadata: meta })); return { docs: d, size: d.length, empty: !d.length, metadata: meta, docChanges: () => [] }; };

  function docRef(path) {
    return {
      id: path.split("/").pop(), path,
      async get() { return docSnap((await op({ op: "get", path, kind: "doc" })).snap); },
      async set(data) { await op({ op: "set", path, data }); },
      async update(data) { await op({ op: "update", path, data }); },
      async delete() { await op({ op: "delete", path }); },
      async acquire() { return { acquired: true }; },
      onSnapshot(next, error) {
        const id = "s" + (++subSeq);
        subs.set(id, { path, kind: "doc", q: {}, next: s => next(docSnap(s)) });
        op({ op: "sub", id, path, kind: "doc" }).catch(e => { subs.delete(id); error && error(e); });
        return () => { if (subs.delete(id)) op({ op: "unsub", id }).catch(() => {}); };
      },
      collection(p) { return colRef(path + "/" + p); }
    };
  }
  function colRef(path, q = {}) {
    return {
      path,
      doc(id) { return docRef(path + "/" + (id || ("d" + Date.now().toString(36) + rand(6)))); },
      async add(data) { const r = this.doc(); await r.set(data); return r; },
      where() { return colRef(path, q); },
      orderBy(f, dir) { return colRef(path, { ...q, order: [f, dir || "asc"] }); },
      limit(n) { return colRef(path, { ...q, limit: n }); },
      async get() { return colSnap((await op({ op: "get", path, kind: "col", q })).snap); },
      onSnapshot(next, error) {
        const id = "s" + (++subSeq);
        subs.set(id, { path, kind: "col", q, next: s => next(colSnap(s)) });
        op({ op: "sub", id, path, kind: "col", q }).catch(e => { subs.delete(id); error && error(e); });
        return () => { if (subs.delete(id)) op({ op: "unsub", id }).catch(() => {}); };
      }
    };
  }
  const db = { doc: docRef, collection: p => colRef(p) };

  const user = {
    async id() { return uid; },
    async isOwner() { return false; }, async canEdit() { return false; }, async can() { return true; },
    async me() { await ready; return { id: uid, name: me.name, avatarUrl: "", color: me.color, email: null, isOwner: false, canEdit: false }; },
    async name() { return me.name; },
    async profiles(ids) { try { return (await op({ op: "profiles", ids: [...new Set(Array.isArray(ids) ? ids : [ids])] })).profiles; } catch (e) { const o = {}; (Array.isArray(ids) ? ids : [ids]).forEach(i => o[i] = { id: i, name: "", color: "#888", avatarUrl: "" }); return o; } },
    async search() { return []; }
  };

  const room = {
    async join(name) {
      if (!rooms.has(name)) rooms.set(name, { presence: null, handlers: new Set(), peers: Object.freeze([]) });
      await op({ op: "join", room: name });
      const r = rooms.get(name);
      return {
        name,
        async presence(patch) { r.presence = { ...(r.presence || {}), ...patch }; await op({ op: "presence", room: name, patch }); },
        onPeers(h) { r.handlers.add(h); setTimeout(() => h({ peers: r.peers, joined: [], left: [], updated: [] }), 0); return () => r.handlers.delete(h); },
        peers() { return r.peers; },
        connected() { return !!sid; },
        onConnection(h) { setTimeout(() => h(!!sid), 0); return () => {}; },
        emit: async () => {}, on: () => () => {},
        async leave() { rooms.delete(name); await op({ op: "leave", room: name }).catch(() => {}); }
      };
    }
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith(".html") ? "text/html" : "application/octet-stream" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      return { status: "saved" };
    }
  };

  // Namen ändern (aus der Lobby aufgerufen)
  window.__zkSetName = async n => { me.name = String(n || "").trim().slice(0, 40); LS.set("zk-name", me.name); sid = null; await hello(); };
  window.__zkName = () => me.name;
  window.claude = { use: async n => ({ db, user, room, downloads })[n] ?? null };
})();
