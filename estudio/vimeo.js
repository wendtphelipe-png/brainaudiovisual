// Acesso direto ao Vimeo pela API oficial, com o token pessoal salvo em
// estudio/dados/vimeo-token.txt (fica só no PC, fora do git, e nunca é
// mostrado em tela ou registro). Com ele os vídeos privados da conta são
// baixados sem cookies. Mais tarde: fila por pasta/álbum e envio das legendas.
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

async function chamar(token, rota) {
  const res = await fetch(API + rota, {
    headers: { Authorization: 'bearer ' + token, Accept: 'application/vnd.vimeo.*+json;version=3.4' },
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('O token do Vimeo foi recusado (vencido ou apagado). Gere outro e salve em estudio/dados/vimeo-token.txt.');
    if (res.status === 404 || res.status === 403) throw new Error('Este vídeo não pertence à conta do token do Vimeo, ou não pode ser baixado por ela.');
    throw new Error(`Vimeo respondeu ${res.status}: ${corpo.slice(0, 200)}`);
  }
  return res.json();
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

module.exports = { lerToken, idDoLink, info, baixar };
