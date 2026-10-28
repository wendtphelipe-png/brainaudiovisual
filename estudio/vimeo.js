// Acesso direto ao Vimeo pela API oficial, com o token pessoal salvo em
// estudio/dados/vimeo-token.txt (fica só no PC, fora do git, e nunca é
// mostrado em tela ou registro). Com ele os vídeos privados da conta são
// baixados sem cookies e as legendas traduzidas são enviadas ao vídeo original.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const API = 'https://api.vimeo.com';

function lerToken(dados) {
  const arq = path.join(dados, 'vimeo-token.txt');
  if (!fs.existsSync(arq)) return null;
  return fs.readFileSync(arq, 'utf8').trim() || null;
}

// Aceita vimeo.com/123, vimeo.com/123/abcdef (não listado),
// player.vimeo.com/video/123?h=abcdef e links de pastas com /video/123
function idDoLink(link) {
  const m = String(link).match(/vimeo\.com\/(?:.*\/)?(?:video\/)?(\d{6,})(?:\/([0-9a-f]{6,}))?/i);
  if (!m) return null;
  const h = String(link).match(/[?&]h=([0-9a-f]+)/i);
  return { id: m[1], hash: m[2] || (h && h[1]) || null };
}

async function chamar(token, rota, metodo = 'GET', corpo) {
  const res = await fetch(API + rota, {
    method: metodo,
    headers: { Authorization: 'bearer ' + token, Accept: 'application/vnd.vimeo.*+json;version=3.4', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('O token do Vimeo foi recusado (vencido ou apagado). Gere outro e salve em estudio/dados/vimeo-token.txt.');
    if (res.status === 404 || res.status === 403) throw new Error('Este vídeo não pertence à conta do token do Vimeo, ou não pode ser baixado por ela.');
    throw new Error(`Vimeo respondeu ${res.status}: ${corpo.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function info(token, { id, hash }) {
  const campos = 'name,duration,download.rendition,download.size,download.link,download.expires';
  // Vídeo não listado de outra conta precisa do código depois da barra
  const rota = hash ? `/videos/${id}:${hash}?fields=${campos}` : `/videos/${id}?fields=${campos}`;
  return chamar(token, rota);
}

// Baixa a versão de menor tamanho: o áudio é o mesmo em todas e o estúdio
// só usa o som
async function baixar(token, ref, destino, log = () => {}) {
  const v = await info(token, ref);
  const opcoes = (v.download || []).filter(d => d.link).sort((a, b) => a.size - b.size);
  if (!opcoes.length) throw new Error('O Vimeo não liberou o download deste vídeo para o token (confira a permissão "Video Files").');
  const escolha = opcoes[0];
  log(`Vídeo: ${v.name} (${Math.round(v.duration / 60)} min), baixando pelo Vimeo (${escolha.rendition}, ${Math.round(escolha.size / 1e6)} MB)…`);
  const res = await fetch(escolha.link);
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar do Vimeo (HTTP ${res.status}).`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destino));
  return { arquivo: destino, titulo: v.name, duracao: v.duration };
}

// Conta do token (nome e plano), para mostrar na tela
async function conta(token) {
  const u = await chamar(token, '/me?fields=name,account');
  return { nome: u.name, plano: u.account };
}

// Percorre todas as páginas de uma listagem da API
async function todas(token, rota) {
  const itens = [];
  let prox = rota;
  while (prox) {
    const r = await chamar(token, prox);
    itens.push(...(r.data || []));
    prox = r.paging && r.paging.next;
  }
  return itens;
}

const ultimoNumero = uri => String(uri).split('/').filter(Boolean).pop();

// Pastas (projects) e álbuns (showcases) da conta
async function listarPastas(token) {
  const campos = 'fields=uri,name,metadata.connections.videos.total,metadata.connections.ancestor_path&per_page=100';
  const [pastas, albuns] = await Promise.all([
    todas(token, '/me/projects?' + campos).catch(() => []),
    todas(token, '/me/albums?' + campos).catch(() => []),
  ]);
  // Pastas com o mesmo nome (ex.: "01 Janeiro" em cada ano) aparecem com o caminho
  const caminho = p => [...(p.metadata?.connections?.ancestor_path || [])].reverse().map(a => a.name).concat(p.name).join(' / ');
  // "pai" é a pasta imediatamente acima (para montar a árvore na tela)
  const pai = p => { const a = p.metadata?.connections?.ancestor_path || []; return a.length ? ultimoNumero(a[0].uri) : null; };
  const item = tipo => p => ({ tipo, id: ultimoNumero(p.uri), nome: tipo === 'pasta' ? caminho(p) : p.name, curto: p.name, pai: tipo === 'pasta' ? pai(p) : null, total: p.metadata?.connections?.videos?.total ?? null });
  return [...pastas.map(item('pasta')), ...albuns.map(item('album'))].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

// Link de pasta ou álbum copiado do navegador
function pastaDoLink(link) {
  let m = String(link).match(/vimeo\.com\/(?:.*\/)?(?:folder|folders|project|projects)\/(\d+)/i);
  if (m) return { tipo: 'pasta', id: m[1] };
  m = String(link).match(/vimeo\.com\/(?:.*\/)?(?:showcase|showcases|album|albums)\/(\d+)/i);
  if (m) return { tipo: 'album', id: m[1] };
  return null;
}

// Vídeos de uma pasta ou álbum, na ordem da conta
async function videosDe(token, { tipo, id }) {
  const rota = tipo === 'pasta' ? `/me/projects/${id}/videos` : `/me/albums/${id}/videos`;
  const lista = await todas(token, rota + '?fields=uri,name,duration&per_page=100');
  // Em ordem de nome (as aulas costumam ser numeradas: 01, 02, 03…)
  return lista.map(v => ({ origem: `https://vimeo.com/${ultimoNumero(v.uri)}`, titulo: v.name, duracao: v.duration }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt', { numeric: true }));
}

// ---------- legendas (texttracks) ----------

const contarFalas = vtt => (String(vtt).match(/-->/g) || []).length;

// Legendas do vídeo, com o total de falas de cada uma (baixa o .vtt de cada faixa)
async function legendas(token, id) {
  const r = await chamar(token, `/videos/${id}/texttracks?per_page=100`);
  const faixas = [];
  for (const t of r.data || []) {
    let falas = null;
    if (t.link) { try { falas = contarFalas(await (await fetch(t.link)).text()); } catch { /* sem conferência */ } }
    faixas.push({ id: String(t.id), idioma: t.language, nome: t.name, ativa: t.active, falas });
  }
  return faixas;
}

// Envia um .vtt como legenda ativa. Apaga antes a faixa antiga que o próprio
// estúdio enviou (idAntigo), para não duplicar. Confere baixando de volta.
async function enviarLegenda(token, id, { idioma, nome, arquivo, idAntigo }) {
  if (idAntigo) await chamar(token, `/videos/${id}/texttracks/${idAntigo}`, 'DELETE').catch(() => {});
  const texto = fs.readFileSync(arquivo, 'utf8');
  const faixa = await chamar(token, `/videos/${id}/texttracks`, 'POST', { type: 'subtitles', language: idioma, name: nome });
  const up = await fetch(faixa.link, { method: 'PUT', body: texto });
  if (!up.ok) throw new Error(`O Vimeo recusou o arquivo da legenda ${nome} (HTTP ${up.status}).`);
  await chamar(token, `/videos/${id}/texttracks/${faixa.id}`, 'PATCH', { active: true });
  const local = contarFalas(texto);
  const noVimeo = (await legendas(token, id)).find(t => t.id === String(faixa.id));
  const ok = !!noVimeo && noVimeo.falas === local;
  return { id: String(faixa.id), falas: local, falasVimeo: noVimeo ? noVimeo.falas : null, ok };
}

// Desliga as legendas automáticas (IA) que o Vimeo cria sozinho no idioma
// original (ex.: "pt-x-autogen"), para valer só a legenda do estúdio.
// Não apaga: só tira de "ativa". Devolve quantas desligou.
async function desligarAutomaticas(token, id) {
  const r = await chamar(token, `/videos/${id}/texttracks?per_page=100`);
  let n = 0;
  for (const t of r.data || []) {
    if (!t.active || !/-x-autogen$/i.test(t.language || '')) continue;
    await chamar(token, `/videos/${id}/texttracks/${t.id}`, 'PATCH', { active: false });
    n++;
  }
  return n;
}

module.exports = { lerToken, idDoLink, info, baixar, conta, listarPastas, pastaDoLink, videosDe, legendas, enviarLegenda, desligarAutomaticas, contarFalas };
