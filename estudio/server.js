// Servidor do Estúdio v2 (roda no PC com a placa de vídeo).
// Fila de vídeos com 1 a 3 trabalhos ao mesmo tempo, monitor do PC e acesso
// às pastas e álbuns do Vimeo. Sem dependências: só Node.
//
//   node estudio/server.js        → http://127.0.0.1:3050
//
// Cada vídeo em andamento roda num processo próprio (trabalho.js); a placa
// de vídeo transcreve um por vez, enquanto os outros baixam, traduzem e dublam.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, spawn } = require('child_process');
const { CONFIG } = require('./motor');
const vimeo = require('./vimeo');

const PORTA = Number(process.env.PORTA || 3050);
const PUBLICO = path.join(__dirname, 'public');
const LOGO = path.join(__dirname, '..', 'design', 'logo');
const ARQ_FILA = path.join(CONFIG.dados, 'fila.json');
const ENVIOS = path.join(CONFIG.dados, 'envios');
const EXT_MIDIA = /\.(mp4|mov|mkv|avi|webm|m4v|m4a|mp3|wav|aac|flac|ogg)$/i;
fs.mkdirSync(ENVIOS, { recursive: true });

// ---------- estado ----------

let estado = { config: { simultaneos: 1, vozes: 'auto', saida: CONFIG.saida, pausado: false }, fila: [] };
try {
  const salvo = JSON.parse(fs.readFileSync(ARQ_FILA, 'utf8'));
  estado = { config: { ...estado.config, ...salvo.config }, fila: salvo.fila || [] };
  // O que estava rodando quando o PC desligou volta para a fila
  for (const it of estado.fila) if (it.estado === 'processando') Object.assign(it, { estado: 'aguardando', etapa: 'Retomado após reinício', progresso: 0, arquivos: [] });
} catch { /* primeira vez */ }

let salvarTimer = null;
function salvar() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(() => {
    const tmp = ARQ_FILA + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(estado), 'utf8');
    fs.renameSync(tmp, ARQ_FILA);
  }, 300);
}

const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const processos = new Map(); // id → processo filho

function addLog(it, texto) {
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  it.log = [...(it.log || []), `${hora}  ${texto}`].slice(-60);
}

// ---------- placa de vídeo: um vídeo transcreve por vez ----------

let gpuDono = null;
const gpuEspera = [];
function pedirGpu(id) {
  if (!gpuDono) { gpuDono = id; processos.get(id)?.send({ gpu: 'ok' }); }
  else if (!gpuEspera.includes(id)) gpuEspera.push(id);
}
function devolverGpu(id) {
  const i = gpuEspera.indexOf(id);
  if (i >= 0) gpuEspera.splice(i, 1);
  if (gpuDono !== id) return;
  gpuDono = null;
  while (gpuEspera.length) {
    const prox = gpuEspera.shift();
    if (processos.has(prox)) { gpuDono = prox; processos.get(prox).send({ gpu: 'ok' }); break; }
  }
}

// ---------- fila ----------

function agendar() {
  if (estado.config.pausado) return;
  const rodando = estado.fila.filter(i => i.estado === 'processando').length;
  let vagas = estado.config.simultaneos - rodando;
  for (const it of estado.fila) {
    if (vagas <= 0) break;
    if (it.estado === 'aguardando') { iniciar(it); vagas--; }
  }
}

function iniciar(it) {
  Object.assign(it, { estado: 'processando', etapa: 'Começando', progresso: 0, erro: null, arquivos: [], inicio: Date.now(), fim: null });
  addLog(it, 'Começou');
  const p = fork(path.join(__dirname, 'trabalho.js'), [], { windowsHide: true, silent: true });
  processos.set(it.id, p);
  p.stderr.on('data', () => {});
  p.stdout.on('data', () => {});
  p.on('message', m => {
    if (m.gpu === 'pedir') pedirGpu(it.id);
    else if (m.gpu === 'devolver') devolverGpu(it.id);
    else if (m.log) addLog(it, m.log);
    else if (m.progresso) { it.etapa = m.progresso.etapa; it.progresso = m.progresso.total; }
    else if (m.titulo) it.titulo = m.titulo;
    else if (m.idioma) Object.assign(it, { idioma: m.idioma.idioma, certeza: m.idioma.certeza, voz: m.idioma.voz || it.voz });
    else if (m.arquivo) it.arquivos = [...new Set([...(it.arquivos || []), m.arquivo])];
    else if (m.fim) {
      Object.assign(it, { estado: 'pronto', etapa: 'Pronto', progresso: 1, destino: m.fim.destino, arquivos: m.fim.arquivos, fim: Date.now(),
        resumo: { idiomas: m.fim.idiomas, tempos: m.fim.tempos, duracao: m.fim.duracao } });
      addLog(it, `Pronto em ${Math.round(m.fim.totalSeg / 60)} min`);
    } else if (m.erro) {
      Object.assign(it, { estado: 'erro', erro: m.erro, fim: Date.now() });
      addLog(it, 'Erro: ' + m.erro);
    }
    salvar();
  });
  p.on('exit', code => {
    processos.delete(it.id);
    devolverGpu(it.id);
    if (it.estado === 'processando') {
      Object.assign(it, it.cancelando
        ? { estado: 'cancelado', etapa: 'Cancelado', fim: Date.now() }
        : { estado: 'erro', erro: `O processo parou inesperadamente (código ${code}).`, fim: Date.now() });
      addLog(it, it.estado === 'cancelado' ? 'Cancelado' : it.erro);
    }
    delete it.cancelando;
    salvar();
    agendar();
  });
  p.send({ job: { id: it.id, origem: it.origem, titulo: it.tituloFixo || undefined, vozes: estado.config.vozes } });
  it.voz = estado.config.vozes === 'ambas' ? 'ambas' : null;
  salvar();
}

function cancelar(it) {
  const p = processos.get(it.id);
  if (!p) return;
  it.cancelando = true;
  // Encerra o processo e tudo o que ele abriu (yt-dlp, Whisper, ffmpeg)
  spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true });
}

// Transforma o que foi colado em itens da fila: links soltos, playlists do
// YouTube, pastas e álbuns do Vimeo, arquivos e pastas do PC
async function expandir(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const itens = [], avisos = [];
  const token = vimeo.lerToken(CONFIG.dados);
  for (const linha of linhas) {
    try {
      if (/^https?:\/\//i.test(linha)) {
        const pasta = vimeo.pastaDoLink(linha);
        if (pasta && token) {
          const vs = await vimeo.videosDe(token, pasta);
          itens.push(...vs.map(v => ({ ...v, fonte: 'vimeo' })));
          if (!vs.length) avisos.push(`Pasta do Vimeo vazia: ${linha}`);
          continue;
        }
        const ref = vimeo.idDoLink(linha);
        if (ref && token) {
          const v = await vimeo.info(token, ref).catch(() => null);
          itens.push({ origem: linha, titulo: v ? v.name : null, duracao: v ? v.duration : null, fonte: 'vimeo' });
          continue;
        }
        if (/[?&]list=|\/playlist|\/showcase\/|\/album\/|\/channels?\/|\/@[^/]+\/?(videos)?$/i.test(linha)) {
          const saida = await rodarTexto(CONFIG.ytdlp, ['--no-warnings', '--flat-playlist', '-J', linha]);
          const j = JSON.parse(saida);
          const entradas = (j.entries || []).filter(e => e && (e.url || e.id));
          for (const e of entradas) {
            const url = e.url && /^https?:/.test(e.url) ? e.url : (/youtu/i.test(linha) ? `https://www.youtube.com/watch?v=${e.id}` : e.url);
            itens.push({ origem: url, titulo: e.title || null, duracao: e.duration || null, fonte: /vimeo/i.test(url) ? 'vimeo' : 'youtube' });
          }
          if (!entradas.length) avisos.push(`Playlist sem vídeos: ${linha}`);
          continue;
        }
        itens.push({ origem: linha, titulo: null, fonte: /vimeo/i.test(linha) ? 'vimeo' : /youtu/i.test(linha) ? 'youtube' : 'link' });
      } else if (fs.existsSync(linha)) {
        const st = fs.statSync(linha);
        const arquivos = st.isDirectory() ? fs.readdirSync(linha).filter(n => EXT_MIDIA.test(n)).sort().map(n => path.join(linha, n)) : [linha];
        if (!arquivos.length) avisos.push(`Nenhum vídeo ou áudio na pasta: ${linha}`);
        itens.push(...arquivos.map(a => ({ origem: a, titulo: path.parse(a).name, fonte: 'arquivo' })));
      } else {
        avisos.push(`Não reconheci: ${linha}`);
      }
    } catch (e) {
      avisos.push(`${linha}: ${String(e.message || e).split('\n').filter(Boolean).pop()}`);
    }
  }
  return { itens, avisos };
}

function adicionar(itens) {
  const ativos = new Set(estado.fila.filter(i => ['aguardando', 'processando'].includes(i.estado)).map(i => i.origem));
  let n = 0, repetidos = 0;
  for (const v of itens) {
    if (ativos.has(v.origem)) { repetidos++; continue; }
    ativos.add(v.origem);
    estado.fila.push({ id: novoId(), origem: v.origem, titulo: v.titulo, tituloFixo: v.titulo || null, fonte: v.fonte, duracaoVideo: v.duracao || null,
      estado: 'aguardando', etapa: 'Na fila', progresso: 0, arquivos: [], criado: Date.now(), log: [] });
    n++;
  }
  salvar();
  agendar();
  return { adicionados: n, repetidos };
}

function rodarTexto(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', c => (c === 0 ? resolve(out) : reject(new Error(err.trim() || `código ${c}`))));
  });
}

// ---------- monitor do PC ----------

const sistema = { cpu: 0, ram: {}, gpu: null, discos: [] };
let cpuAntes = os.cpus();
function medirSistema() {
  const agora = os.cpus();
  let ocupado = 0, total = 0;
  agora.forEach((c, i) => {
    const a = cpuAntes[i].times, b = c.times;
    const t = (b.user + b.nice + b.sys + b.irq + b.idle) - (a.user + a.nice + a.sys + a.irq + a.idle);
    ocupado += t - (b.idle - a.idle); total += t;
  });
  cpuAntes = agora;
  sistema.cpu = total ? Math.round((ocupado / total) * 100) : 0;
  sistema.ram = { usado: os.totalmem() - os.freemem(), total: os.totalmem() };
  sistema.discos = ['C:\\', 'D:\\', 'G:\\'].map(d => {
    try { const s = fs.statfsSync(d); return { nome: d.slice(0, 2), livre: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
  }).filter(Boolean);
  rodarTexto('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'])
    .then(o => {
      const [nome, uso, memUsada, memTotal, temp] = o.trim().split('\n')[0].split(',').map(s => s.trim());
      sistema.gpu = { nome, uso: +uso, memUsada: +memUsada, memTotal: +memTotal, temp: +temp };
    })
    .catch(() => { sistema.gpu = null; });
}
medirSistema();
setInterval(medirSistema, 2000);

// ---------- Vimeo ----------

let cacheVimeo = { quando: 0, dados: null };
async function estadoVimeo(forcar = false) {
  const token = vimeo.lerToken(CONFIG.dados);
  if (!token) return { conectado: false };
  if (!forcar && cacheVimeo.dados && Date.now() - cacheVimeo.quando < 5 * 60000) return cacheVimeo.dados;
  try {
    const [conta, pastas] = await Promise.all([vimeo.conta(token), vimeo.listarPastas(token)]);
    cacheVimeo = { quando: Date.now(), dados: { conectado: true, conta: conta.nome, pastas } };
  } catch (e) {
    cacheVimeo = { quando: Date.now(), dados: { conectado: false, erro: e.message } };
  }
  return cacheVimeo.dados;
}

// ---------- HTTP ----------

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function enviarArquivo(res, arq) {
  fs.readFile(arq, (err, dados) => {
    if (err) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dados);
  });
}
function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function itemPublico(it) {
  const { tituloFixo, cancelando, ...resto } = it;
  return resto;
}

function escolherPasta() {
  // Janela do Windows para escolher a pasta de destino
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Pasta onde o estúdio salva os vídeos dublados'; $d.SelectedPath = '${estado.config.saida.replace(/'/g, "''").replace(/\//g, '\\')}'; $f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; Write-Output $d.SelectedPath }`;
  return rodarTexto('powershell', ['-NoProfile', '-STA', '-Command', ps]).then(s => s.trim());
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
    // O Hub do site confere este endereço para saber se o estúdio está ligado
    if (p === '/api/status') return json(res, { status: 'online', versao: 'v2' });
    if (p === '/api/estado') {
      return json(res, { config: estado.config, fila: estado.fila.map(itemPublico), sistema, gpuDono,
        vimeo: { conectado: !!vimeo.lerToken(CONFIG.dados), conta: cacheVimeo.dados && cacheVimeo.dados.conta } });
    }
    if (p === '/api/vimeo') return json(res, await estadoVimeo(url.searchParams.get('atualizar') === '1'));

    if (req.method === 'POST' && p === '/api/adicionar') {
      const corpo = await lerCorpo(req);
      let r;
      if (corpo.vimeo) {
        const token = vimeo.lerToken(CONFIG.dados);
        if (!token) return json(res, { erro: 'Vimeo não conectado.' }, 400);
        const vs = await vimeo.videosDe(token, corpo.vimeo);
        r = { itens: vs.map(v => ({ ...v, fonte: 'vimeo' })), avisos: vs.length ? [] : ['A pasta escolhida não tem vídeos.'] };
      } else {
        r = await expandir(corpo.texto);
      }
      return json(res, { ...adicionar(r.itens), avisos: r.avisos });
    }
    if (req.method === 'POST' && p === '/api/enviar') {
      // Arquivo do PC enviado pela tela (corpo = o próprio arquivo)
      const nome = path.basename(decodeURIComponent(req.headers['x-nome'] || 'video.mp4')).replace(/[<>:"/\\|?*]/g, '_');
      const destino = path.join(ENVIOS, `${Date.now().toString(36)}-${nome}`);
      const out = fs.createWriteStream(destino);
      req.pipe(out);
      out.on('finish', () => json(res, adicionar([{ origem: destino, titulo: path.parse(nome).name, fonte: 'arquivo' }])));
      out.on('error', e => json(res, { erro: e.message }, 500));
      return;
    }
    if (req.method === 'POST' && p === '/api/config') {
      const c = await lerCorpo(req);
      if (c.simultaneos != null) estado.config.simultaneos = Math.min(3, Math.max(1, Number(c.simultaneos) || 1));
      if (c.vozes) estado.config.vozes = c.vozes === 'ambas' ? 'ambas' : 'auto';
      if (c.pausado != null) estado.config.pausado = !!c.pausado;
      if (c.saida) {
        fs.mkdirSync(c.saida, { recursive: true });
        estado.config.saida = c.saida;
      }
      CONFIG.saida = estado.config.saida;
      process.env.ESTUDIO_SAIDA = estado.config.saida;
      salvar();
      agendar();
      return json(res, estado.config);
    }
    if (req.method === 'POST' && p === '/api/escolher-pasta') {
      const pasta = await escolherPasta();
      if (pasta) { estado.config.saida = pasta; CONFIG.saida = pasta; process.env.ESTUDIO_SAIDA = pasta; salvar(); }
      return json(res, estado.config);
    }
    if (req.method === 'POST' && p === '/api/limpar') {
      estado.fila = estado.fila.filter(i => !['pronto', 'cancelado'].includes(i.estado));
      salvar();
      return json(res, { ok: true });
    }
    const m = p.match(/^\/api\/item\/([\w-]+)\/(tentar|remover|cancelar|abrir|subir)$/);
    if (req.method === 'POST' && m) {
      const it = estado.fila.find(i => i.id === m[1]);
      if (!it) return json(res, { erro: 'Item não encontrado' }, 404);
      const acao = m[2];
      if (acao === 'tentar' && ['erro', 'cancelado', 'pronto'].includes(it.estado)) {
        Object.assign(it, { estado: 'aguardando', etapa: 'Na fila', progresso: 0, erro: null, arquivos: [] });
        addLog(it, 'Voltou para a fila');
      } else if (acao === 'remover' && it.estado !== 'processando') {
        estado.fila = estado.fila.filter(i => i !== it);
      } else if (acao === 'cancelar') {
        if (it.estado === 'processando') cancelar(it);
        else if (it.estado === 'aguardando') Object.assign(it, { estado: 'cancelado', etapa: 'Cancelado' });
      } else if (acao === 'abrir' && it.destino) {
        spawn('explorer', [it.destino.replace(/\//g, '\\')], { windowsHide: false, detached: true }).unref();
      } else if (acao === 'subir' && it.estado === 'aguardando') {
        // Passa para o começo da fila de espera
        estado.fila = estado.fila.filter(i => i !== it);
        const primeiro = estado.fila.findIndex(i => i.estado === 'aguardando');
        estado.fila.splice(primeiro < 0 ? estado.fila.length : primeiro, 0, it);
      }
      salvar();
      agendar();
      return json(res, { ok: true });
    }

    if (p === '/' || p === '/index.html') return enviarArquivo(res, path.join(PUBLICO, 'index.html'));
    if (p.startsWith('/logo/')) return enviarArquivo(res, path.join(LOGO, path.basename(p)));
    if (/^\/[\w.-]+\.(css|js|svg|png|ico)$/.test(p)) return enviarArquivo(res, path.join(PUBLICO, path.basename(p)));
    res.writeHead(404); res.end('Não encontrado');
  } catch (e) {
    json(res, { erro: e.message }, 500);
  }
});

CONFIG.saida = estado.config.saida;
process.env.ESTUDIO_SAIDA = estado.config.saida;
servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`Estúdio v2 em http://127.0.0.1:${PORTA}`);
  estadoVimeo().catch(() => {});
  agendar();
});
