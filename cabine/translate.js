// Tradução gratuita (fase de validação): endereço público do Google Tradutor.
// Com o segmentador, só blocos fechados são traduzidos (alguns por minuto por
// idioma), em vez de cada texto provisório, o que evita o bloqueio 429.
// Para trocar de motor depois (DeepL, Azure, IA com contexto), basta outra
// função com a mesma assinatura: translate(text, from, to) -> Promise<string>.

const RETRY_MS = [400, 1200, 3000];

function base(code) {
  return String(code || '').split('-')[0].toLowerCase();
}

// Três endereços públicos do Google; quando um bloqueia (429), usa o próximo
const ENDPOINTS = [
  { name: 'dict-chrome-ex', url: (q, sl, tl) => `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&dt=t&sl=${sl}&tl=${tl}&q=${q}`,
    parse: d => (d[0] || []).map(p => p[0]).join('') },
  { name: 'clients5', url: (q, sl, tl) => `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${sl}&tl=${tl}&q=${q}`,
    parse: d => (Array.isArray(d) ? d.map(x => (Array.isArray(x) ? x[0] : x)).join(' ') : '') },
  { name: 'gtx', url: (q, sl, tl) => `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${sl}&tl=${tl}&q=${q}`,
    parse: d => (d[0] || []).map(p => p[0]).join('') },
];
let current = 0;

async function googleFree(text, from, to) {
  const ep = ENDPOINTS[current];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(ep.url(encodeURIComponent(text), base(from), base(to)), { signal: ctrl.signal });
    if (!res.ok) {
      if (res.status === 429 || res.status === 403) current = (current + 1) % ENDPOINTS.length;
      throw new Error(`HTTP ${res.status} (${ep.name})`);
    }
    const out = ep.parse(await res.json()).trim();
    if (!out) throw new Error(`resposta vazia (${ep.name})`);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// Tenta de novo com espera crescente. Se mesmo assim falhar, quem chamou
// guarda o trecho e manda junto com o próximo bloco: nada é descartado.
async function translate(text, from, to) {
  if (base(from) === base(to)) return text;
  let lastErr;
  for (let i = 0; i <= RETRY_MS.length; i++) {
    try {
      return await googleFree(text, from, to);
    } catch (err) {
      lastErr = err;
      if (i < RETRY_MS.length) await new Promise(r => setTimeout(r, RETRY_MS[i]));
    }
  }
  throw lastErr;
}

module.exports = { translate };
