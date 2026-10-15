// Teste de ponta a ponta com o servidor rodando (usa a tradução real).
// Finge ser o cockpit falando sem pausa e duas saídas (EN e ES) recebendo.
// Uso: node cabine/test/simular.js [porta] [repetições]
const WebSocket = require('ws');

const PORT = Number(process.argv[2] || 8790);
const REPEAT = Number(process.argv[3] || 2);
const URL = `ws://localhost:${PORT}/ws`;
const TEXT = ('agora nós vamos abrir o retroperitônio e identificar o ureter esquerdo ao longo de todo o seu trajeto ' +
  'o nervo hipogástrico passa medial a este plano então mantemos a dissecção bem próxima ao reto para preservar a inervação ' +
  'percebam que a paciente tem um nódulo de endometriose profunda que infiltra o ligamento uterossacro do lado esquerdo ' +
  'e por isso a ressecção precisa ser feita com muito cuidado porque o ureter está muito próximo da lesão').split(' ');
const TARGETS = ['en-US', 'es-ES'];

const open = url => new Promise((res, rej) => { const ws = new WebSocket(url); ws.on('open', () => res(ws)); ws.on('error', rej); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const cockpit = await open(URL);
  const blocks = [];
  let session = null;
  cockpit.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'welcome') session = m.session;
    if (m.type === 'block') blocks.push(m.block);
  });
  cockpit.send(JSON.stringify({ type: 'hello', role: 'cockpit' }));
  await sleep(200);
  cockpit.send(JSON.stringify({ type: 'config', source: 'pt-BR', targets: TARGETS }));
  cockpit.send(JSON.stringify({ type: 'new-session' }));
  await sleep(400);

  const received = {};
  const outs = [];
  for (const lang of TARGETS) {
    const ws = await open(URL);
    received[lang] = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.type === 'welcome') received[lang].push(...m.items);
      if (m.type === 'tr') received[lang].push({ ...m.item, tRecv: Date.now() });
    });
    ws.send(JSON.stringify({ type: 'hello', role: 'saida', lang, id: 'teste-' + lang, after: 0 }));
    outs.push(ws);
  }

  // Fala contínua: 2,5 palavras por segundo, texto provisório a cada 150 ms
  const all = [];
  for (let r = 0; r < REPEAT; r++) all.push(...TEXT);
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

  // ---------- Verificação ----------
  const joined = blocks.map(b => b.text).join(' ').split(' ');
  const okWords = joined.join(' ') === all.join(' ');
  console.log(`\nFala: ${all.length} palavras em ${((Date.now() - t0) / 1000).toFixed(0)} s, ${blocks.length} blocos (média ${(all.length / blocks.length).toFixed(1)} palavras)`);
  console.log(`Original sem perdas nem repetições: ${okWords ? 'SIM' : 'NÃO'}`);
  let allOk = okWords;
  for (const lang of TARGETS) {
    const items = received[lang];
    const seqs = items.map(i => i.seq);
    const inOrder = seqs.every((s, i) => s === i + 1);
    const complete = seqs.length === blocks.length;
    const lat = items.filter(i => i.tTr && i.tClose && !i.mergedInto).map(i => i.tTr - i.tClose);
    const avg = lat.reduce((s, x) => s + x, 0) / (lat.length || 1);
    const max = Math.max(...lat);
    const merged = items.filter(i => i.mergedInto).length;
    console.log(`${lang}: ${seqs.length}/${blocks.length} blocos, na ordem: ${inOrder ? 'sim' : 'NÃO'}, tradução média ${(avg / 1000).toFixed(2)} s (máx ${(max / 1000).toFixed(2)} s), juntados por falha: ${merged}`);
    for (const it of items.slice(0, 3)) console.log(`   ${it.seq}: ${it.text}`);
    allOk = allOk && inOrder && complete;
  }
  console.log(allOk ? '\nRESULTADO: OK, nada perdido\n' : '\nRESULTADO: FALHOU\n');
  for (const ws of [cockpit, ...outs]) ws.close();
  process.exit(allOk ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
