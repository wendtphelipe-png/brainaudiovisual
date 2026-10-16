// Motor do Estúdio v2: transforma um vídeo (link ou arquivo) em 6 arquivos,
// áudio dublado .mp3 e legenda .vtt em português, inglês e espanhol,
// sincronizados com a fala original.
//
// Etapas: obter o áudio (yt-dlp ou arquivo local) → transcrever com o
// Whisper na placa de vídeo (detecta o idioma) → montar frases e legendas →
// traduzir frase inteira → gerar as vozes → encaixar cada fala no tempo
// original → gravar na pasta com o nome do vídeo.
//
// O idioma original não é dublado: o .mp3 dele é o próprio áudio do vídeo.
// A voz (masculina ou feminina) segue a altura da voz de quem fala.
//
// Uso direto: node estudio/motor.js <link-ou-arquivo> [--ambas] [--cookies arquivo.txt]
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { translate } = require('../cabine/translate');
const vimeo = require('./vimeo');

const CONFIG = {
  python: process.env.ESTUDIO_PY || 'D:/Projetos/estudio-py/Scripts/python.exe',
  modelos: process.env.ESTUDIO_MODELOS || 'D:/Projetos/estudio-modelos',
  modelo: process.env.ESTUDIO_MODELO || 'large-v3-turbo',
  ffmpeg: process.env.FFMPEG || 'ffmpeg',
  ytdlp: process.env.YTDLP || 'yt-dlp',
  dados: process.env.ESTUDIO_DADOS || path.join(__dirname, 'dados'),
  saida: process.env.ESTUDIO_SAIDA || 'G:/Meu Drive/BR.AIN Dublagens',
};

const IDIOMAS = ['pt', 'en', 'es'];
const SIGLA = { pt: 'PT', en: 'EN', es: 'ES' };
const VOZES = {
  pt: { f: 'pt-BR-FranciscaNeural', m: 'pt-BR-AntonioNeural' },
  en: { f: 'en-US-AvaNeural', m: 'en-US-AndrewNeural' },
  es: { f: 'es-ES-ElviraNeural', m: 'es-ES-AlvaroNeural' },
};
// Abaixo disso a voz é tratada como masculina (homens ~85–155 Hz, mulheres ~165–255 Hz)
const LIMITE_F0 = 163;
const TAXA = 24000;                // taxa das vozes do edge-tts (mono)
const MAX_LINHA = 42;              // caracteres por linha de legenda
const MAX_LEGENDA = 2 * MAX_LINHA; // até duas linhas
const MAX_SEG_LEGENDA = 6.5;       // segundos na tela, no máximo
const VELOCIDADE_MAX = 40;         // % a mais pedido à voz para caber no tempo
const ATEMPO_MAX = 1.12;           // aceleração extra no fim, se ainda não couber

// ---------- utilidades ----------

function rodar(cmd, args, { aoLinha, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let out = '', err = '', resto = '';
    p.stdout.on('data', d => {
      const s = d.toString('utf8');
      out += s;
      if (!aoLinha) return;
      const linhas = (resto + s).split(/\r?\n/);
      resto = linhas.pop();
      for (const l of linhas) if (l.trim()) aoLinha(l);
    });
    p.stderr.on('data', d => { err += d.toString('utf8'); if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', code => {
      if (aoLinha && resto.trim()) aoLinha(resto);
      if (code === 0) resolve(out);
      else reject(Object.assign(new Error(`${path.basename(cmd)} terminou com código ${code}`), { stderr: err, stdout: out }));
    });
  });
}

function rodarBinario(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const partes = [];
    let err = '';
    p.stdout.on('data', d => partes.push(d));
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(Buffer.concat(partes)) : reject(new Error(err.slice(-500)))));
  });
}

async function emParalelo(itens, limite, fn) {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; await fn(itens[k], k); }
  });
  await Promise.all(trabalhadores);
}

function nomeSeguro(titulo) {
  const s = String(titulo || 'video').replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (s || 'video').slice(0, 120);
}

function tempoVtt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

// Quebra em até duas linhas equilibradas
function quebrarLinhas(texto) {
  if (texto.length <= MAX_LINHA) return texto;
  const meio = texto.length / 2;
  let melhor = -1;
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === ' ' && (melhor < 0 || Math.abs(i - meio) < Math.abs(melhor - meio))) melhor = i;
  }
  return melhor < 0 ? texto : texto.slice(0, melhor) + '\n' + texto.slice(melhor + 1);
}

function escreverVtt(arquivo, legendas) {
  // Legenda que ficou vazia na tradução cede o tempo para a anterior
  const finais = [];
  for (const c of legendas) {
    const texto = (c.texto || '').trim();
    if (!texto) { if (finais.length) finais[finais.length - 1].e = c.e; continue; }
    finais.push({ s: c.s, e: c.e, texto });
  }
  const corpo = finais.map((c, i) => `${i + 1}\n${tempoVtt(c.s)} --> ${tempoVtt(c.e)}\n${quebrarLinhas(c.texto)}\n`).join('\n');
  fs.writeFileSync(arquivo, 'WEBVTT\n\n' + corpo, 'utf8');
}

// ---------- 1. obter o áudio ----------

async function obterAudio(job, pasta, log) {
  const ehLink = /^https?:\/\//i.test(job.origem);
  if (!ehLink) {
    if (!fs.existsSync(job.origem)) throw new Error(`Arquivo não encontrado: ${job.origem}`);
    return { arquivo: job.origem, titulo: job.titulo || path.parse(job.origem).name };
  }
  // Vimeo com token da conta: API oficial, sem cookies
  const refVimeo = vimeo.idDoLink(job.origem);
  const token = refVimeo && vimeo.lerToken(CONFIG.dados);
  if (token) {
    const r = await vimeo.baixar(token, refVimeo, path.join(pasta, 'origem.mp4'), log);
    return { arquivo: r.arquivo, titulo: job.titulo || r.titulo };
  }

  const extra = [];
  const cookies = job.cookies || path.join(CONFIG.dados, 'cookies.txt');
  if (fs.existsSync(cookies)) extra.push('--cookies', cookies);
  else if (job.navegador) extra.push('--cookies-from-browser', job.navegador);
  if (job.referer) extra.push('--referer', job.referer);

  let titulo = job.titulo;
  try {
    const info = JSON.parse(await rodar(CONFIG.ytdlp, ['--no-warnings', '--no-playlist', '-J', ...extra, job.origem]));
    titulo = titulo || info.title;
    log(`Vídeo: ${info.title} (${Math.round((info.duration || 0) / 60)} min)`);
  } catch (e) {
    const msg = e.stderr || e.message;
    if (/404|private|login|logged|password|403|Unauthorized/i.test(msg)) {
      throw new Error('O vídeo é privado ou pede login. Exporte os cookies do Vimeo/YouTube com a extensão do navegador e salve em estudio/dados/cookies.txt (formato Netscape).');
    }
    throw new Error('Não foi possível ler o link: ' + msg.split('\n').filter(Boolean).pop());
  }
  log('Baixando o áudio…');
  const modelo = path.join(pasta, 'origem.%(ext)s');
  const saida = await rodar(CONFIG.ytdlp, ['--no-warnings', '--no-playlist', '-f', 'bestaudio/best', '-o', modelo, '--print', 'after_move:filepath', ...extra, job.origem]);
  const arquivo = saida.trim().split(/\r?\n/).pop();
  if (!arquivo || !fs.existsSync(arquivo)) throw new Error('O download terminou sem arquivo de áudio.');
  return { arquivo, titulo };
}

// ---------- 2. transcrever ----------

async function transcrever(wav, pasta, aoProgresso, log) {
  const saida = path.join(pasta, 'transcricao.json');
  await rodar(CONFIG.python, [path.join(__dirname, 'transcrever.py'), wav, saida, CONFIG.modelo], {
    env: { HF_HOME: CONFIG.modelos, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    aoLinha: l => {
      let m; try { m = JSON.parse(l); } catch { return; }
      if (m.progresso != null) aoProgresso(m.progresso);
      if (m.idioma) log(`Idioma detectado: ${m.idioma} (certeza ${Math.round(m.certeza * 100)}%)`);
      if (m.aviso) log('Aviso: ' + m.aviso);
      if (m.dispositivo) log(`Transcrevendo ${m.dispositivo === 'cuda' ? 'na placa de vídeo' : 'no processador'}…`);
    },
  });
  return JSON.parse(fs.readFileSync(saida, 'utf8'));
}

// ---------- 3. frases e legendas ----------

const ABREV = new Set(['dr', 'dra', 'sr', 'sra', 'prof', 'profa', 'etc', 'vs', 'mr', 'mrs', 'ms', 'st', 'no', 'nº', 'p', 'pág', 'fig']);

function fimDeFrase(palavra) {
  const p = palavra.trim();
  if (!/[.!?…]["')\]]*$/.test(p)) return false;
  const base = p.replace(/[.!?…"')\]]+$/, '').toLowerCase();
  return !ABREV.has(base) && !/^\d+$/.test(base);
}

// Junta as palavras do Whisper em frases (pontuação ou pausa longa) e
// guarda a altura da voz de cada frase
function montarFrases(trans) {
  const palavras = [];
  for (const f of trans.falas) {
    const lista = f.palavras.length ? f.palavras : [{ w: f.texto, s: f.s, e: f.e }];
    for (const p of lista) if (p.w.trim()) palavras.push({ ...p, w: p.w.trim(), f0: f.f0 });
  }
  const frases = [];
  let atual = [];
  const fechar = () => {
    if (!atual.length) return;
    const f0s = atual.map(p => p.f0).filter(v => v != null).sort((a, b) => a - b);
    frases.push({ palavras: atual, s: atual[0].s, e: atual[atual.length - 1].e, texto: atual.map(p => p.w).join(' '),
      f0: f0s.length ? f0s[Math.floor(f0s.length / 2)] : null });
    atual = [];
  };
  for (let i = 0; i < palavras.length; i++) {
    const p = palavras[i];
    if (atual.length && p.s - atual[atual.length - 1].e > 1.5) fechar();
    atual.push(p);
    const longa = atual.length >= 45 || (atual.length >= 25 && /[,;:]$/.test(p.w));
    if (fimDeFrase(p.w) || longa) fechar();
  }
  fechar();
  return frases;
}

// Divide cada frase em legendas de até duas linhas e 6,5 s
function montarLegendas(frases) {
  const legendas = [];
  frases.forEach((fr, iFrase) => {
    let grupo = [];
    const fechar = () => {
      if (!grupo.length) return;
      legendas.push({ frase: iFrase, s: grupo[0].s, e: grupo[grupo.length - 1].e, texto: grupo.map(p => p.w).join(' ') });
      grupo = [];
    };
    for (const p of fr.palavras) {
      const texto = [...grupo, p].map(x => x.w).join(' ');
      if (grupo.length && (texto.length > MAX_LEGENDA || p.e - grupo[0].s > MAX_SEG_LEGENDA)) fechar();
      grupo.push(p);
      if (grupo.length >= 4 && /[,;:]$/.test(p.w) && texto.length > MAX_LINHA) fechar();
    }
    fechar();
  });
  // Legenda fica na tela até a próxima começar (até 1 s a mais), sem sobrepor
  for (let i = 0; i < legendas.length; i++) {
    const prox = legendas[i + 1];
    legendas[i].e = Math.max(legendas[i].e, Math.min(legendas[i].e + 1, prox ? prox.s : Infinity));
    if (prox && legendas[i].e > prox.s) legendas[i].e = prox.s;
  }
  return legendas;
}

// Reparte o texto traduzido de uma frase entre as legendas dela, na
// proporção do tamanho de cada legenda original
function distribuir(texto, pesos) {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const total = pesos.reduce((a, b) => a + b, 0) || 1;
  const totalChars = palavras.reduce((a, w) => a + w.length + 1, 0) || 1;
  const partes = pesos.map(() => []);
  let acum = 0, chars = 0, j = 0;
  const limites = pesos.map(p => (acum += p) / total);
  for (const w of palavras) {
    const meio = (chars + (w.length + 1) / 2) / totalChars;
    while (j < limites.length - 1 && meio > limites[j]) j++;
    partes[j].push(w);
    chars += w.length + 1;
  }
  return partes.map(p => p.join(' '));
}

// ---------- 4. traduzir ----------

// Traduz várias frases por pedido (separadas por quebra de linha), o que
// reduz o número de chamadas; se a resposta vier com outra quantidade de
// linhas, traduz aquele grupo frase por frase. Erro aqui para o trabalho:
// nunca grava texto sem tradução como se fosse traduzido.
async function traduzirFrases(textos, de, para, aoProgresso) {
  const grupos = [];
  let g = [], n = 0;
  textos.forEach((t, i) => {
    if (g.length && n + t.length > 1200) { grupos.push(g); g = []; n = 0; }
    g.push(i); n += t.length + 1;
  });
  if (g.length) grupos.push(g);
  const saida = new Array(textos.length);
  let feitos = 0;
  await emParalelo(grupos, 3, async grupo => {
    const r = await translate(grupo.map(i => textos[i].replace(/\n/g, ' ')).join('\n'), de, para);
    const linhas = r.split('\n').map(s => s.trim()).filter(Boolean);
    if (linhas.length === grupo.length) grupo.forEach((i, k) => { saida[i] = linhas[k]; });
    else for (const i of grupo) saida[i] = (await translate(textos[i], de, para)).trim();
    feitos += grupo.length;
    aoProgresso(feitos / textos.length);
  });
  return saida;
}

// ---------- 5. voz masculina ou feminina ----------

function generos(frases) {
  let somaM = 0, somaF = 0;
  for (const f of frases) if (f.f0 != null) (f.f0 < LIMITE_F0 ? (somaM += f.e - f.s) : (somaF += f.e - f.s));
  const predominante = somaM >= somaF ? 'm' : 'f';
  const g = frases.map(f => (f.f0 == null ? null : f.f0 < LIMITE_F0 ? 'm' : 'f'));
  // Frase sem voz clara, ou trocando sozinha entre vizinhas iguais com altura
  // perto do limite, segue as vizinhas
  for (let i = 0; i < g.length; i++) {
    const ant = g[i - 1], prox = g[i + 1];
    const duvidosa = frases[i].f0 == null || Math.abs(frases[i].f0 - LIMITE_F0) < 22;
    if (duvidosa && ant && ant === prox) g[i] = ant;
    if (!g[i]) g[i] = ant || predominante;
  }
  return { porFrase: g, predominante, segundosM: Math.round(somaM), segundosF: Math.round(somaF) };
}

// ---------- 6. vozes e montagem ----------

async function gerarVozes(pedidos, pasta, nome, aoProgresso) {
  const arq = path.join(pasta, `pedidos-${nome}.json`);
  fs.writeFileSync(arq, JSON.stringify(pedidos), 'utf8');
  const erros = [];
  let prontos = 0;
  await rodar(CONFIG.python, [path.join(__dirname, 'vozes.py'), arq, '6'], {
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    aoLinha: l => {
      let m; try { m = JSON.parse(l); } catch { return; }
      if (m.ok != null) aoProgresso(++prontos / pedidos.length);
      if (m.erro != null) erros.push(`fala ${m.erro + 1}: ${m.motivo}`);
    },
  });
  if (erros.length) throw new Error(`Falha ao gerar ${erros.length} falas (${erros.slice(0, 3).join('; ')})`);
}

// Duração de um mp3 do edge-tts (taxa constante de 48 kbit/s)
function duracaoVoz(arquivo) {
  return (fs.statSync(arquivo).size * 8) / 48000;
}

async function dublarIdioma({ frases, textos, generoPorFrase, idioma, duracao, pasta, aoProgresso, rotulo }) {
  const dir = path.join(pasta, `vozes-${rotulo}`);
  fs.mkdirSync(dir, { recursive: true });
  const unidades = frases.map((f, i) => ({
    i, s: f.s, texto: textos[i],
    vaga: Math.max(0.4, (frases[i + 1] ? frases[i + 1].s : duracao) - f.s),
    voz: VOZES[idioma][generoPorFrase[i]], arquivo: path.join(dir, `${String(i).padStart(5, '0')}.mp3`),
  })).filter(u => u.texto && u.texto.trim());

  // 1ª passada na velocidade normal
  await gerarVozes(unidades.map(u => ({ texto: u.texto, voz: u.voz, velocidade: '+0%', saida: u.arquivo })), dir, '1', p => aoProgresso(p * 0.6));
  // 2ª passada: falas que passaram do tempo são refeitas mais rápidas
  const longas = unidades.filter(u => duracaoVoz(u.arquivo) > u.vaga * 1.03);
  for (const u of longas) u.velocidade = Math.min(VELOCIDADE_MAX, Math.ceil((duracaoVoz(u.arquivo) / u.vaga - 1) * 100) + 4);
  if (longas.length) {
    await gerarVozes(longas.map(u => ({ texto: u.texto, voz: u.voz, velocidade: `+${u.velocidade}%`, saida: u.arquivo })), dir, '2', p => aoProgresso(0.6 + p * 0.2));
  }

  // Montagem: cada fala começa no tempo original; se ainda não couber,
  // acelera um pouco mais e, no limite, empurra a próxima (recupera na pausa)
  const total = new Int16Array(Math.ceil((duracao + 30) * TAXA));
  let cursor = 0, empurradas = 0, atrasoMax = 0, feitos = 0;
  const pcm = new Array(unidades.length);
  await emParalelo(unidades, 6, async (u, k) => {
    const tempo = Math.min(ATEMPO_MAX, Math.max(1, duracaoVoz(u.arquivo) / u.vaga));
    const filtro = tempo > 1.01 ? ['-af', `atempo=${tempo.toFixed(3)}`] : [];
    pcm[k] = await rodarBinario(CONFIG.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', u.arquivo, ...filtro, '-f', 's16le', '-ac', '1', '-ar', String(TAXA), '-']);
    aoProgresso(0.8 + (++feitos / unidades.length) * 0.15);
  });
  unidades.forEach((u, k) => {
    const amostras = new Int16Array(pcm[k].buffer, pcm[k].byteOffset, Math.floor(pcm[k].length / 2));
    const inicio = Math.max(Math.round(u.s * TAXA), cursor);
    if (inicio > Math.round(u.s * TAXA) + TAXA * 0.05) { empurradas++; atrasoMax = Math.max(atrasoMax, inicio / TAXA - u.s); }
    for (let j = 0; j < amostras.length && inicio + j < total.length; j++) total[inicio + j] = amostras[j];
    cursor = inicio + amostras.length;
  });
  const fim = Math.min(total.length, Math.max(Math.ceil(duracao * TAXA), cursor));
  const bruto = path.join(pasta, `faixa-${rotulo}.pcm`);
  fs.writeFileSync(bruto, Buffer.from(total.buffer, 0, fim * 2));
  const mp3 = path.join(pasta, `faixa-${rotulo}.mp3`);
  await rodar(CONFIG.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(TAXA), '-ac', '1', '-i', bruto,
    '-ar', '44100', '-ac', '2', '-b:a', '128k', mp3]);
  fs.unlinkSync(bruto);
  aoProgresso(1);
  return { mp3, falas: unidades.length, aceleradas: longas.length, empurradas, atrasoMax: Math.round(atrasoMax * 10) / 10 };
}

// ---------- trabalho completo ----------

// Opções: aoProgresso({etapa,total}), log(texto), aoTitulo(titulo), aoIdioma(info),
// aoArquivo(nome) e comGpu(fn) (a fila usa para a placa transcrever um vídeo por vez)
async function processar(job, { aoProgresso = () => {}, log = () => {}, aoTitulo = () => {}, aoIdioma = () => {}, aoArquivo = () => {}, comGpu = fn => fn() } = {}) {
  const inicioTrabalho = Date.now();
  const id = job.id || `${Date.now().toString(36)}`;
  const pasta = path.join(CONFIG.dados, 'trabalhos', id);
  fs.mkdirSync(pasta, { recursive: true });
  const etapa = (nome, ini, peso) => p => aoProgresso({ etapa: nome, total: Math.round((ini + peso * p) * 100) / 100 });
  const tempos = {};
  const medir = async (nome, fn) => { const t = Date.now(); const r = await fn(); tempos[nome] = Math.round((Date.now() - t) / 1000); return r; };

  etapa('Baixando', 0, 0.08)(0);
  const { arquivo, titulo } = await medir('obter', () => obterAudio(job, pasta, log));
  aoTitulo(titulo);
  const wav = path.join(pasta, 'fala16k.wav');
  await rodar(CONFIG.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', arquivo, '-vn', '-ac', '1', '-ar', '16000', wav]);

  etapa('Aguardando a placa de vídeo', 0.08, 0)(0);
  const trans = await medir('transcrever', () => comGpu(() => transcrever(wav, pasta, etapa('Transcrevendo', 0.08, 0.32), log)));
  const origem = trans.idioma;
  if (trans.certeza < 0.6) log(`Atenção: idioma "${origem}" detectado com pouca certeza (${Math.round(trans.certeza * 100)}%). Confira o resultado.`);
  const frases = montarFrases(trans);
  aoIdioma({ idioma: origem, certeza: trans.certeza });
  const legendas = montarLegendas(frases);
  if (!frases.length) throw new Error('Nenhuma fala encontrada no áudio.');
  log(`${frases.length} frases, ${legendas.length} legendas`);

  const destino = path.join(CONFIG.saida, nomeSeguro(titulo));
  fs.mkdirSync(destino, { recursive: true });
  const arquivos = [];
  const alvos = IDIOMAS.filter(l => l !== origem);

  // Idioma original: áudio do próprio vídeo e a transcrição como legenda
  if (IDIOMAS.includes(origem)) {
    const mp3 = path.join(destino, `${SIGLA[origem]}.mp3`);
    await rodar(CONFIG.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', arquivo, '-vn', '-ar', '44100', '-b:a', '192k', mp3]);
    const vtt = path.join(destino, `${SIGLA[origem]}.vtt`);
    escreverVtt(vtt, legendas);
    arquivos.push(mp3, vtt);
    aoArquivo(path.basename(mp3)); aoArquivo(path.basename(vtt));
  }

  const gen = generos(frases);
  const variantes = job.vozes === 'ambas' ? ['f', 'm'] : [null];
  aoIdioma({ idioma: origem, certeza: trans.certeza, voz: job.vozes === 'ambas' ? 'ambas' : gen.predominante });
  log(`Voz: ${gen.predominante === 'm' ? 'masculina' : 'feminina'} predominante (${gen.segundosM}s masc., ${gen.segundosF}s fem.)`);

  const relatorio = { titulo, origem, certeza: trans.certeza, duracao: trans.duracao, dispositivo: trans.dispositivo, frases: frases.length, voz: gen, idiomas: {} };
  const passo = 0.6 / alvos.length;
  for (const [k, alvo] of alvos.entries()) {
    const base = 0.4 + k * passo;
    const textos = await medir(`traduzir-${alvo}`, () => traduzirFrases(frases.map(f => f.texto), origem, alvo, etapa(`Traduzindo (${SIGLA[alvo]})`, base, passo * 0.1)));
    // Legenda traduzida com os mesmos tempos da original
    const legAlvo = [];
    frases.forEach((f, i) => {
      const minhas = legendas.filter(c => c.frase === i);
      distribuir(textos[i], minhas.map(c => c.texto.length)).forEach((t, j) => legAlvo.push({ ...minhas[j], texto: t }));
    });
    const vtt = path.join(destino, `${SIGLA[alvo]}.vtt`);
    escreverVtt(vtt, legAlvo);
    arquivos.push(vtt);
    aoArquivo(path.basename(vtt));

    for (const [v, variante] of variantes.entries()) {
      const generoPorFrase = variante ? frases.map(() => variante) : gen.porFrase;
      const rotulo = variante ? `${alvo}-${variante}` : alvo;
      const pesoV = (passo * 0.9) / variantes.length;
      const r = await medir(`vozes-${rotulo}`, () => dublarIdioma({ frases, textos, generoPorFrase, idioma: alvo, duracao: trans.duracao, pasta, rotulo,
        aoProgresso: etapa(`Dublando (${SIGLA[alvo]})`, base + passo * 0.1 + v * pesoV, pesoV) }));
      const nome = variante ? `${SIGLA[alvo]} - voz ${variante === 'f' ? 'feminina' : 'masculina'}.mp3` : `${SIGLA[alvo]}.mp3`;
      const final = path.join(destino, nome);
      fs.copyFileSync(r.mp3, final);
      arquivos.push(final);
      aoArquivo(nome);
      relatorio.idiomas[rotulo] = { falas: r.falas, aceleradas: r.aceleradas, empurradas: r.empurradas, atrasoMaxSeg: r.atrasoMax };
      log(`${SIGLA[alvo]}${variante ? ' ' + variante : ''}: ${r.falas} falas, ${r.aceleradas} aceleradas, ${r.empurradas} com atraso (máx. ${r.atrasoMax}s)`);
    }
  }

  relatorio.tempos = tempos;
  relatorio.totalSeg = Math.round((Date.now() - inicioTrabalho) / 1000);
  relatorio.destino = destino;
  relatorio.arquivos = arquivos.map(a => path.basename(a));
  fs.writeFileSync(path.join(pasta, 'relatorio.json'), JSON.stringify(relatorio, null, 2), 'utf8');

  // Limpa o que é grande; mantém transcrição e relatório para conferência
  for (const nome of fs.readdirSync(pasta)) {
    const p = path.join(pasta, nome);
    if (nome.startsWith('vozes-')) fs.rmSync(p, { recursive: true, force: true });
    else if (/^(origem\.|fala16k\.wav|faixa-)/.test(nome)) fs.rmSync(p, { force: true });
  }
  aoProgresso({ etapa: 'Pronto', total: 1 });
  return relatorio;
}

module.exports = { processar, CONFIG, montarFrases, montarLegendas, distribuir, generos };

if (require.main === module) {
  const args = process.argv.slice(2);
  const origem = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--cookies');
  if (!origem) { console.log('Uso: node estudio/motor.js <link-ou-arquivo> [--ambas] [--cookies arquivo.txt]'); process.exit(1); }
  const iCookies = args.indexOf('--cookies');
  let ultimo = '';
  processar({ origem, vozes: args.includes('--ambas') ? 'ambas' : 'auto', cookies: iCookies >= 0 ? args[iCookies + 1] : undefined }, {
    log: m => console.log('·', m),
    aoProgresso: p => { const s = `${p.etapa} ${Math.round(p.total * 100)}%`; if (s !== ultimo) { ultimo = s; if (Math.round(p.total * 100) % 5 === 0) console.log('  ', s); } },
  }).then(r => { console.log(JSON.stringify(r, null, 2)); }).catch(e => { console.error('ERRO:', e.message); if (e.stderr) console.error(e.stderr.slice(-1500)); process.exit(1); });
}
