// Teste de ponta a ponta com o servidor rodando (usa a tradução real).
// Cria DUAS salas ao mesmo tempo; em cada uma, finge ser o cockpit falando
// sem pausa e duas saídas (EN e ES) recebendo. Confere que nada se perde e
// que uma sala não recebe nada da outra.
// Uso: node cabine/test/simular.js [porta] [repetições] [chave da equipe]
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 8790);
const REPEAT = Number(process.argv[3] || 2);
const URL = `ws://localhost:${PORT}/ws`;
const KEY = process.argv[4] || '';
const TEXT = ('agora nós vamos abrir o retroperitônio e identificar o ureter esquerdo ao longo de todo o seu trajeto ' +
  'o nervo hipogástrico passa medial a este plano então mantemos a dissecção bem próxima ao reto para preservar a inervação ' +
  'percebam que a paciente tem um nódulo de endometriose profunda que infiltra o ligamento uterossacro do lado esquerdo ' +
  'e por isso a ressecção precisa ser feita com muito cuidado porque o ureter está muito próximo da lesão').split(' ');
const TARGETS = ['en-US', 'es-ES'];

const open = url => new Promise((res, rej) => { const ws = new WebSocket(url); ws.on('open', () => res(ws)); ws.on('error', rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runRoom(label, text) {
  const res = await fetch(`http://localhost:${PORT}/api/salas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: label, key: KEY }) });
  if (!res.ok) throw new Error('não criou a sala: ' + res.status);
  const { code, token } = await res.json();
  const cockpit = await open(URL);
  const blocks = [];
  cockpit.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'block') blocks.push(m.block); });
  cockpit.send(JSON.stringify({ type: 'hello', role: 'cockpit', sala: code, token }));
  await sleep(200);
  cockpit.send(JSON.stringify({ type: 'config', source: 'pt-BR', targets: TARGETS }));
  await sleep(200);

  const received = {};
  const outs = [];
  for (const lang of TARGETS) {
    const ws = await open(URL);
    received[lang] = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.type === 'welcome') received[lang].push(...m.items);
      if (m.type === 'tr') received[lang].push(m.item);
    });
    ws.send(JSON.stringify({ type: 'hello', role: 'saida', sala: code, lang, id: `teste-${code}-${lang}`, after: 0 }));
    outs.push(ws);
  }

  const all = [];
  for (let r = 0; r < REPEAT; r++) all.push(...text);
  const t0 = Date.now();
  let shown = 0;
  while (shown < all.length) {
    shown = Math.min(all.length, Math.floor(((Date.now() - t0) / 1000) * 2.5));
    cockpit.send(JSON.stringify({ type: 'stt', utt: 'sim:1:0', text: all.slice(0, shown).join(' '), final: false }));
    await sleep(150);
  }
  await sleep(1500);
  cockpit.send(JSON.stringify({ type: 'stt', utt: 'sim:1:0', text: all.join(' '), final: true }));
  await sleep(4000);

  const okWords = blocks.map(b => b.text).join(' ') === all.join(' ');
  console.log(`\nSala ${code} (${label}): ${all.length} palavras, ${blocks.length} blocos (média ${(all.length / blocks.length).toFixed(1)} palavras)`);
  console.log(`  Original sem perdas nem repetições: ${okWords ? 'SIM' : 'NÃO'}`);
  let ok = okWords;
  for (const lang of TARGETS) {
    const items = received[lang];
    const seqs = items.map(i => i.seq);
    const inOrder = seqs.every((s, i) => s === i + 1);
    const complete = seqs.length === blocks.length;
    // Só pode ter recebido texto desta sala: o original de cada tradução tem de bater
    const ownRoom = items.every(i => i.mergedInto || blocks.some(b => b.seq === i.seq && (i.src || '').endsWith(b.text)));
    const lat = items.filter(i => i.tTr && i.tClose && !i.mergedInto).map(i => i.tTr - i.tClose);
    const avg = lat.reduce((s, x) => s + x, 0) / (lat.length || 1);
    console.log(`  ${lang}: ${seqs.length}/${blocks.length} blocos, na ordem: ${inOrder ? 'sim' : 'NÃO'}, só desta sala: ${ownRoom ? 'sim' : 'NÃO'}, tradução média ${(avg / 1000).toFixed(2)} s`);
    console.log(`     1: ${items[0] && items[0].text}`);
    ok = ok && inOrder && complete && ownRoom;
  }
  for (const ws of [cockpit, ...outs]) ws.close();
  return ok;
}

(async () => {
  const OTHER = 'bom dia a todos hoje vamos falar sobre cirurgia bariátrica e as técnicas de bypass gástrico que usamos no hospital nos últimos dez anos com resultados muito bons para os pacientes'.split(' ');
  const results = await Promise.all([runRoom('Sala de teste A', TEXT), runRoom('Sala de teste B', OTHER)]);
  const allOk = results.every(Boolean);
  console.log(allOk ? '\nRESULTADO: OK, nada perdido e nenhuma mistura entre salas\n' : '\nRESULTADO: FALHOU\n');
  process.exit(allOk ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
