// Cabine v2: servidor de tradução simultânea com salas independentes.
//
// Cada cabine é uma SALA com código próprio (ex.: K7P2). O cockpit da sala
// manda o texto do reconhecimento de voz; o servidor corta em blocos,
// traduz para cada idioma e entrega os blocos numerados às páginas de saída
// daquela sala (um notebook por idioma). Salas não se misturam.
// Tudo trafega por WebSocket (TCP): chega inteiro e na ordem. Quem se
// reconecta pede de volta o que perdeu pelo número do bloco.
//
// Roda igual no PC (INICIAR_CABINE.bat) e na VPS (cabine.brainaudiovisual.com.br).
// Uso: node cabine/server.js   (porta 8790, ou CABINE_PORT)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Segmenter } = require('./segmenter');
const { translate } = require('./translate');

const PORT = Number(process.env.CABINE_PORT || 8790);
const HOST = process.env.CABINE_HOST || '0.0.0.0';
// Endereço público (na VPS). Vazio = modo local: links usam o IP da rede.
const PUBLIC_URL = (process.env.CABINE_PUBLIC_URL || '').replace(/\/+$/, '');
const PUBLIC = path.join(__dirname, 'public');
const LOGO = path.join(__dirname, '..', 'design', 'logo');
const DATA = process.env.CABINE_DATA || path.join(__dirname, 'data');
const ROOMS_DIR = path.join(DATA, 'salas');
const SESSIONS_DIR = path.join(DATA, 'sessoes');
const ROOM_TTL_MS = 14 * 24 * 3600 * 1000; // sala sem uso some depois de 14 dias
// Código de acesso da equipe para criar salas (na VPS). Vazio = qualquer um cria (modo local).
const CREATE_KEY = process.env.CABINE_CREATE_KEY || '';
fs.mkdirSync(ROOMS_DIR, { recursive: true });
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Código curto e fácil de ditar (sem 0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(4), b => ALPHABET[b % ALPHABET.length]).join('');
const validCode = c => typeof c === 'string' && /^[A-Z2-9]{4,8}$/.test(c);

// ======================================================================
// SALA
// ======================================================================
class Room {
  constructor(code, saved = {}) {
    this.code = code;
    this.token = saved.token || crypto.randomBytes(16).toString('hex'); // chave do cockpit
    this.name = saved.name || '';
    this.config = { source: 'pt-BR', targets: ['en-US', 'es-ES'], ...(saved.config || {}) };
    this.createdAt = saved.createdAt || Date.now();
    this.lastUsed = Date.now();
    this.outputs = new Map(); // id -> status de cada notebook de saída
    this.newSession();
  }

  save() {
    const data = { code: this.code, token: this.token, name: this.name, config: this.config, createdAt: this.createdAt, lastUsed: this.lastUsed };
    fs.writeFileSync(path.join(ROOMS_DIR, this.code + '.json'), JSON.stringify(data, null, 2));
  }

  newSession() {
    if (this.logStream) this.logStream.end();
    this.session = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.blocks = [];          // blocos do original, na ordem
    this.translations = {};    // idioma -> Map(seq -> item)
    this.chains = {};          // idioma -> fila (promessa) que garante a ordem
    this.carry = {};           // idioma -> blocos que falharam e vão junto com o próximo
    this.busy = {};            // idioma -> traduzindo agora
    this.queued = {};          // idioma -> blocos na fila
    this.logStream = fs.createWriteStream(path.join(SESSIONS_DIR, `${this.code}_${this.session}.jsonl`), { flags: 'a' });
    this.segmenter = new Segmenter({ onBlock: b => this.onBlock(b) });
    this.log({ type: 'session', session: this.session, config: this.config });
  }

  log(ev) { this.logStream.write(JSON.stringify({ t: Date.now(), ...ev }) + '\n'); }

  clients(filter) { return [...clients].filter(c => c.room === this && filter(c)); }
  broadcast(msg, filter = () => true) {
    const data = JSON.stringify(msg);
    for (const c of this.clients(filter)) if (c.readyState === 1) c.send(data);
  }

  // ---------- Pipeline: bloco -> tradução por idioma ----------
  onBlock(block) {
    this.lastUsed = Date.now();
    this.blocks.push(block);
    if (this.blocks.length > 5000) this.blocks.splice(0, 1000);
    this.log({ type: 'block', ...block });
    this.broadcast({ type: 'block', block }, c => c.role === 'cockpit');
    for (const lang of this.config.targets) this.enqueue(lang, block);
  }

  enqueue(lang, block) {
    this.translations[lang] = this.translations[lang] || new Map();
    this.carry[lang] = this.carry[lang] || [];
    this.queued[lang] = (this.queued[lang] || 0) + 1;
    // A tradução começa já, em paralelo com as anteriores (a fila não espera
    // um bloco terminar para começar o próximo)...
    const attempt = translate(block.text, this.config.source, lang).then(text => ({ ok: true, text }), err => ({ ok: false, err }));
    // ...mas a publicação respeita sempre a ordem dos blocos
    const prev = this.chains[lang] || Promise.resolve();
    this.chains[lang] = prev.then(() => this.publishInOrder(lang, block, attempt))
      .catch(err => console.error(`[${this.code}] fila ${lang}`, err))
      .finally(() => { this.queued[lang]--; });
  }

  async publishInOrder(lang, block, attempt) {
    // Blocos deste idioma que falharam antes vão junto com este, na ordem
    const pending = this.carry[lang];
    this.carry[lang] = [];
    this.busy[lang] = true;
    try {
      let result = await attempt;
      let source = block.text;
      if (pending.length) {
        source = [...pending.map(b => b.text), block.text].join(' ');
        result = await translate(source, this.config.source, lang).then(text => ({ ok: true, text }), err => ({ ok: false, err }));
      }
      if (!result.ok) throw result.err;
      const tTr = Date.now();
      for (const b of pending) this.publish(lang, { seq: b.seq, text: '', mergedInto: block.seq, tClose: b.tClose, tTr });
      this.publish(lang, { seq: block.seq, text: result.text, src: source, tClose: block.tClose, tTr });
    } catch (err) {
      console.warn(`[${this.code}] tradução ${lang} bloco ${block.seq} falhou (${err && err.message}); vai junto com o próximo`);
      this.log({ type: 'tr-fail', lang, seq: block.seq, error: String(err && err.message) });
      this.carry[lang] = [...pending, block, ...this.carry[lang]];
      this.broadcast({ type: 'alert', text: `Tradução para ${lang} atrasada no bloco ${block.seq}; será enviada com o próximo.` }, c => c.role === 'cockpit');
    } finally {
      this.busy[lang] = false;
    }
  }

  publish(lang, item) {
    const map = this.translations[lang];
    map.set(item.seq, item);
    if (map.size > 5000) map.delete(map.keys().next().value);
    this.log({ type: 'tr', lang, ...item });
    this.broadcast({ type: 'tr', lang, item }, c => c.role === 'cockpit' || c.role === 'telao' || (c.role === 'saida' && c.lang === lang));
  }

  // Se o fim da fala ficou sem tradução (internet caiu), tenta de novo sozinho
  retryCarry() {
    for (const lang of Object.keys(this.carry)) {
      const pend = this.carry[lang];
      // Só com a fila parada, para não passar na frente de ninguém
      if (!pend || !pend.length || this.busy[lang] || this.queued[lang]) continue;
      this.enqueue(lang, pend.pop());
    }
  }

  outputsList() { return [...this.outputs.values()].map(o => ({ ...o, age: Date.now() - o.lastSeen })); }

  // Telão: só leitura, todas as traduções e o que cada saída está falando
  telaoWelcome() {
    return { type: 'welcome', room: this.code, name: this.name, session: this.session, config: this.config,
      translations: Object.fromEntries(Object.entries(this.translations).map(([l, m]) => [l, [...m.values()].slice(-80)])),
      outputs: this.outputsList() };
  }

  cockpitWelcome() {
    return { type: 'welcome', room: this.code, name: this.name, session: this.session, config: this.config, blocks: this.blocks.slice(-300),
      translations: Object.fromEntries(Object.entries(this.translations).map(([l, m]) => [l, [...m.values()].slice(-300)])),
      outputs: this.outputsList(), links: linksFor(this) };
  }
}

// ======================================================================
// SALAS: criar, carregar do disco, limpar as antigas
// ======================================================================
const rooms = new Map();

function loadRoom(code) {
  if (!validCode(code)) return null;
  if (rooms.has(code)) return rooms.get(code);
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, code + '.json'), 'utf8'));
    const room = new Room(code, saved);
    rooms.set(code, room);
    return room;
  } catch (_) { return null; }
}

function createRoom(name) {
  let code;
  do { code = newCode(); } while (rooms.has(code) || fs.existsSync(path.join(ROOMS_DIR, code + '.json')));
  const room = new Room(code, { name: String(name || '').slice(0, 80) });
  rooms.set(code, room);
  room.save();
  return room;
}

function cleanupRooms() {
  for (const f of fs.readdirSync(ROOMS_DIR)) {
    try {
      const file = path.join(ROOMS_DIR, f);
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      const live = rooms.get(saved.code);
      const lastUsed = live ? live.lastUsed : saved.lastUsed;
      if (Date.now() - lastUsed > ROOM_TTL_MS && !(live && live.clients(() => true).length)) {
        fs.unlinkSync(file);
        if (live) { live.logStream.end(); rooms.delete(saved.code); }
      }
    } catch (_) {}
  }
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

// Links que o cockpit mostra para abrir as saídas
function linksFor(room) {
  const base = PUBLIC_URL || `http://${lanAddresses()[0] || 'localhost'}:${PORT}`;
  return { base, saida: `${base}/saida?sala=${room.code}`, cockpit: `${base}/cockpit?sala=${room.code}` };
}

// ======================================================================
// HTTP: páginas e criação de salas
// ======================================================================
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); } });
  });
}

// Limite simples: no máximo 20 salas por hora por endereço
const creations = new Map();
function tooManyCreations(ip) {
  const now = Date.now();
  const list = (creations.get(ip) || []).filter(t => now - t < 3600 * 1000);
  list.push(now);
  creations.set(ip, list);
  return list.length > 20;
}
function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (p === '/' || p === '/nova') return sendFile(res, path.join(PUBLIC, 'inicio.html'));
  if (p === '/cockpit') return sendFile(res, path.join(PUBLIC, 'cockpit.html'));
  if (p === '/saida') return sendFile(res, path.join(PUBLIC, 'saida.html'));
  if (p === '/telao') return sendFile(res, path.join(PUBLIC, 'telao.html'));
  if (p === '/saude') return sendJson(res, 200, { ok: true, salas: rooms.size, conexoes: [...clients].filter(c => c.role).length });
  if (p === '/api/info') return sendJson(res, 200, { requiresKey: !!CREATE_KEY, local: !PUBLIC_URL });

  // Criar sala nova: devolve o código e a chave do cockpit
  if (p === '/api/salas' && req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (tooManyCreations(ip)) return sendJson(res, 429, { error: 'Muitas salas criadas em pouco tempo. Tente de novo em alguns minutos.' });
    const body = await readBody(req);
    if (CREATE_KEY && !safeEqual(String(body.key || ''), CREATE_KEY)) return sendJson(res, 401, { error: 'Código de acesso da equipe incorreto.' });
    const room = createRoom(body.name);
    console.log(`[sala] criada ${room.code} ${room.name ? '(' + room.name + ')' : ''}`);
    return sendJson(res, 201, { code: room.code, token: room.token, name: room.name, links: linksFor(room) });
  }
  // Conferir se uma sala existe (para a página de saída e para entrar de novo)
  const m = p.match(/^\/api\/salas\/([A-Z2-9]{4,8})$/);
  if (m) {
    const room = loadRoom(m[1]);
    if (!room) return sendJson(res, 404, { error: 'Sala não encontrada' });
    return sendJson(res, 200, { code: room.code, name: room.name, config: room.config });
  }

  if (p.startsWith('/logo/')) return sendFile(res, path.join(LOGO, path.basename(p)));
  const file = path.join(PUBLIC, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  sendFile(res, file);
});

// ======================================================================
// WebSocket
// ======================================================================
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const clients = new Set();
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

wss.on('connection', ws => {
  clients.add(ws);
  ws.role = null;
  ws.room = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.type === 'hello') {
      const room = loadRoom(msg.sala);
      if (!room) return send(ws, { type: 'error', code: 'sala', text: 'Sala não encontrada. Confira o código ou crie uma cabine nova.' });
      if (msg.role === 'cockpit') {
        if (msg.token !== room.token) return send(ws, { type: 'error', code: 'chave', text: 'Este navegador não tem a chave desta sala. Abra o cockpit pelo navegador que criou a sala.' });
        ws.role = 'cockpit'; ws.room = room;
        room.lastUsed = Date.now();
        return send(ws, room.cockpitWelcome());
      }
      if (msg.role === 'telao') {
        ws.role = 'telao'; ws.room = room;
        return send(ws, room.telaoWelcome());
      }
      if (msg.role === 'saida') {
        ws.role = 'saida'; ws.room = room; ws.lang = msg.lang; ws.outputId = msg.id;
        // Reenvia tudo o que esta saída ainda não recebeu (mesma sessão)
        const after = msg.session === room.session ? Number(msg.after || 0) : 0;
        const items = [...(room.translations[msg.lang] || new Map()).values()].filter(i => i.seq > after);
        return send(ws, { type: 'welcome', room: room.code, name: room.name, session: room.session, config: room.config, items });
      }
      return;
    }

    const room = ws.room;
    if (!room) return;

    if (ws.role === 'cockpit') {
      switch (msg.type) {
        case 'stt':
          room.segmenter.update(msg.utt, msg.text, !!msg.final);
          if (!msg.final) room.broadcast({ type: 'interim', text: msg.text }, c => c.role === 'cockpit' && c !== ws);
          break;
        case 'stt-end': room.segmenter.finishUtterance(); break;
        case 'flush': room.segmenter.flush(); break;
        case 'config':
          room.config = { source: msg.source || room.config.source, targets: Array.isArray(msg.targets) ? msg.targets.slice(0, 12) : room.config.targets };
          if (typeof msg.name === 'string') room.name = msg.name.slice(0, 80);
          room.save();
          room.log({ type: 'config', config: room.config });
          room.broadcast({ type: 'config', config: room.config, name: room.name });
          break;
        case 'new-session':
          room.segmenter.flush();
          room.newSession();
          for (const c of room.clients(() => true)) {
            if (c.role === 'cockpit') send(c, room.cockpitWelcome());
            if (c.role === 'telao') send(c, room.telaoWelcome());
            if (c.role === 'saida') send(c, { type: 'welcome', room: room.code, name: room.name, session: room.session, config: room.config, items: [] });
          }
          break;
      }
    } else if (ws.role === 'saida' && msg.type === 'status') {
      room.outputs.set(msg.id, { id: msg.id, lang: msg.lang, voice: msg.voice, spokenSeq: msg.spokenSeq, receivedSeq: msg.receivedSeq, currentSeq: msg.currentSeq || 0,
        backlogWords: msg.backlogWords, rate: msg.rate, playing: msg.playing, lastSeen: Date.now() });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws.room && ws.outputId) ws.room.outputs.delete(ws.outputId);
  });
});

// Relógio: fecha blocos por tempo, refaz traduções pendentes, atualiza saídas
setInterval(() => { for (const r of rooms.values()) r.segmenter.tick(); }, 200);
setInterval(() => { for (const r of rooms.values()) r.retryCarry(); }, 5000);
setInterval(() => {
  for (const r of rooms.values()) {
    for (const [id, o] of r.outputs) if (Date.now() - o.lastSeen > 15000) r.outputs.delete(id);
    r.broadcast({ type: 'outputs', outputs: r.outputsList() }, c => c.role === 'cockpit' || c.role === 'telao');
  }
}, 1000);
setInterval(() => { for (const r of rooms.values()) r.save(); cleanupRooms(); }, 10 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log('\nCabine v2 no ar');
  if (PUBLIC_URL) console.log(`  Endereço público: ${PUBLIC_URL}/`);
  console.log(`  Neste computador: http://localhost:${PORT}/`);
  if (!PUBLIC_URL) for (const ip of lanAddresses()) console.log(`  Na rede local:    http://${ip}:${PORT}/`);
  console.log('');
});
