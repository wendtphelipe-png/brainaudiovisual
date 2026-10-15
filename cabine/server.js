// Cabine v2: servidor local de tradução simultânea.
//
// Roda no PC central. O cockpit (navegador deste PC) manda o texto do
// reconhecimento de voz; o servidor corta em blocos, traduz para cada idioma
// e entrega os blocos numerados para as páginas de saída (um notebook por
// idioma, na mesma rede). Tudo trafega por WebSocket (TCP): chega inteiro e
// na ordem. Quem se reconecta pede de volta o que perdeu pelo número do bloco.
//
// Uso: node cabine/server.js   (porta 8790, ou CABINE_PORT)

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Segmenter } = require('./segmenter');
const { translate } = require('./translate');

const PORT = Number(process.env.CABINE_PORT || 8790);
const PUBLIC = path.join(__dirname, 'public');
const LOGO = path.join(__dirname, '..', 'design', 'logo');
const DATA = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');
fs.mkdirSync(path.join(DATA, 'sessoes'), { recursive: true });

// ---------------- Configuração e sessão ----------------
let config = { source: 'pt-BR', targets: ['en-US', 'es-ES'] };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch (_) {}
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

let session, blocks, translations, langChains, carry, logStream, segmenter;

function newSession() {
  if (logStream) logStream.end();
  session = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  blocks = [];                 // blocos do original, na ordem
  translations = {};           // idioma -> Map(seq -> {seq, text, mergedInto, tTr})
  langChains = {};             // idioma -> fila (promessa) que garante a ordem
  carry = {};                  // idioma -> blocos que falharam e vão junto com o próximo
  logStream = fs.createWriteStream(path.join(DATA, 'sessoes', session + '.jsonl'), { flags: 'a' });
  segmenter = new Segmenter({ onBlock });
  log({ type: 'session', session, config });
}

function log(ev) {
  logStream.write(JSON.stringify({ t: Date.now(), ...ev }) + '\n');
}

// ---------------- Pipeline: bloco -> tradução por idioma ----------------
function onBlock(block) {
  blocks.push(block);
  log({ type: 'block', ...block });
  broadcast({ type: 'block', block }, c => c.role === 'cockpit');
  for (const lang of config.targets) enqueue(lang, block);
}

function enqueue(lang, block) {
  translations[lang] = translations[lang] || new Map();
  carry[lang] = carry[lang] || [];
  queued[lang] = (queued[lang] || 0) + 1;
  const prev = langChains[lang] || Promise.resolve();
  langChains[lang] = prev.then(() => translateBlock(lang, block)).catch(err => console.error('[fila]', lang, err))
    .finally(() => { queued[lang]--; });
}

const busy = {};   // idioma -> traduzindo agora
const queued = {}; // idioma -> blocos na fila

async function translateBlock(lang, block) {
  // Pega os blocos atrasados deste idioma e traduz tudo junto, na ordem
  const pending = carry[lang];
  carry[lang] = [];
  busy[lang] = true;
  const source = [...pending.map(b => b.text), block.text].join(' ');
  try {
    const text = await translate(source, config.source, lang);
    const tTr = Date.now();
    for (const b of pending) publish(lang, { seq: b.seq, text: '', mergedInto: block.seq, tClose: b.tClose, tTr });
    publish(lang, { seq: block.seq, text, src: source, tClose: block.tClose, tTr });
  } catch (err) {
    console.warn(`[tradução] ${lang} bloco ${block.seq} falhou (${err.message}); vai junto com o próximo`);
    log({ type: 'tr-fail', lang, seq: block.seq, error: err.message });
    carry[lang] = [...pending, block, ...carry[lang]];
    broadcast({ type: 'alert', text: `Tradução para ${lang} atrasada no bloco ${block.seq}; será enviada com o próximo.` }, c => c.role === 'cockpit');
  } finally {
    busy[lang] = false;
  }
}

function publish(lang, item) {
  translations[lang].set(item.seq, item);
  log({ type: 'tr', lang, ...item });
  broadcast({ type: 'tr', lang, item }, c => c.role === 'cockpit' || (c.role === 'saida' && c.lang === lang));
}

// Se o fim da fala ficou sem tradução (internet caiu), tenta de novo sozinho
setInterval(() => {
  for (const lang of Object.keys(carry)) {
    const pend = carry[lang];
    // Só tenta de novo com a fila parada, para não passar na frente de ninguém
    if (!pend || !pend.length || busy[lang] || queued[lang]) continue;
    enqueue(lang, pend.pop());
  }
}, 5000);

// ---------------- Servidor HTTP (páginas) ----------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/cockpit') return sendFile(res, path.join(PUBLIC, 'cockpit.html'));
  if (p === '/saida') return sendFile(res, path.join(PUBLIC, 'saida.html'));
  if (p === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ port: PORT, addresses: lanAddresses(), session, config }));
  }
  if (p.startsWith('/logo/')) return sendFile(res, path.join(LOGO, path.basename(p)));
  const file = path.join(PUBLIC, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  sendFile(res, file);
});

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();
const outputs = new Map(); // id -> status de cada notebook de saída

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg, filter = () => true) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1 && filter(c)) c.send(data);
}
function outputsList() {
  return [...outputs.values()].map(o => ({ ...o, age: Date.now() - o.lastSeen }));
}

wss.on('connection', ws => {
  clients.add(ws);
  ws.role = 'desconhecido';

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    switch (msg.type) {
      case 'hello': {
        ws.role = msg.role;
        if (msg.role === 'cockpit') {
          send(ws, { type: 'welcome', session, config, blocks: blocks.slice(-300),
            translations: Object.fromEntries(Object.entries(translations).map(([l, m]) => [l, [...m.values()].slice(-300)])),
            outputs: outputsList(), addresses: lanAddresses(), port: PORT });
        } else if (msg.role === 'saida') {
          ws.lang = msg.lang;
          ws.outputId = msg.id;
          // Reenvia tudo o que esta saída ainda não recebeu (mesma sessão)
          const after = msg.session === session ? Number(msg.after || 0) : 0;
          const items = [...(translations[msg.lang] || new Map()).values()].filter(i => i.seq > after);
          send(ws, { type: 'welcome', session, config, items });
        }
        break;
      }
      case 'stt':
        if (ws.role !== 'cockpit') break;
        segmenter.update(msg.utt, msg.text, !!msg.final);
        if (!msg.final) broadcast({ type: 'interim', text: msg.text }, c => c.role === 'cockpit' && c !== ws);
        break;
      case 'stt-end':
        if (ws.role === 'cockpit') segmenter.finishUtterance();
        break;
      case 'flush':
        if (ws.role === 'cockpit') segmenter.flush();
        break;
      case 'config':
        if (ws.role !== 'cockpit') break;
        config = { source: msg.source || config.source, targets: Array.isArray(msg.targets) ? msg.targets : config.targets };
        saveConfig();
        log({ type: 'config', config });
        broadcast({ type: 'config', config });
        break;
      case 'new-session':
        if (ws.role !== 'cockpit') break;
        segmenter.flush();
        newSession();
        for (const c of clients) {
          if (c.role === 'cockpit') send(c, { type: 'welcome', session, config, blocks: [], translations: {}, outputs: outputsList(), addresses: lanAddresses(), port: PORT });
          if (c.role === 'saida') send(c, { type: 'welcome', session, config, items: [] });
        }
        break;
      case 'status':
        if (ws.role !== 'saida') break;
        outputs.set(msg.id, { id: msg.id, lang: msg.lang, voice: msg.voice, spokenSeq: msg.spokenSeq, receivedSeq: msg.receivedSeq,
          backlogWords: msg.backlogWords, rate: msg.rate, playing: msg.playing, device: msg.device, lastSeen: Date.now() });
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws.outputId) outputs.delete(ws.outputId);
  });
});

// Relógio: fecha blocos por tempo e atualiza o painel de saídas
setInterval(() => segmenter.tick(), 200);
setInterval(() => {
  for (const [id, o] of outputs) if (Date.now() - o.lastSeen > 15000) outputs.delete(id);
  broadcast({ type: 'outputs', outputs: outputsList() }, c => c.role === 'cockpit');
}, 1000);

newSession();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nCabine v2 no ar`);
  console.log(`  Cockpit (neste PC):  http://localhost:${PORT}/`);
  for (const ip of lanAddresses()) console.log(`  Saídas na rede:      http://${ip}:${PORT}/saida?lang=en-US`);
  console.log('');
});
