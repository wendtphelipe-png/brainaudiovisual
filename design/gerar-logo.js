// Gera os arquivos do logo da Brain Audiovisual.
//
// Versão 2 (out/2026): cérebro visto de cima, dois hemisférios. O esquerdo
// leva os traços de circuito com pontos do "B" da apresentação original
// (azul); o direito leva as ondas de fala do sistema "Sinal", com a linha
// do meio em âmbar. Junta a identidade antiga com a nova e deixa claro que
// o desenho é um cérebro.
//
// Uso: node design/gerar-logo.js
const fs = require('fs');
const path = require('path');

const BLUE = '#3FA9F5';
const AMBER = '#FFB224';

// Hemisférios no espaço 400x320 (os mesmos do quadro de direções)
const HEMI_L = 'M194 30C140 28 92 62 82 120C72 180 92 250 150 282C168 292 186 292 194 284C197 230 197 90 194 30Z';
const HEMI_R = 'M206 30C260 28 308 62 318 120C328 180 308 250 250 282C232 292 214 292 206 284C203 230 203 90 206 30Z';
// Traços de circuito saindo da linha do meio para a esquerda, terminando em pontos
const TRACES = [
  { d: 'M182 78H146L126 58', node: [126, 58] },
  { d: 'M182 128H108', node: [108, 128] },
  { d: 'M182 176H152L132 196H104', node: [104, 196] },
  { d: 'M182 232H146L128 250', node: [128, 250] },
];
const NODE_R = 13;

function wavePath(y, amp, phase) {
  let d = `M200 ${y}`;
  for (let x = 200; x <= 330; x += 6) d += ` L${x} ${(y + Math.sin(x * 0.075 + phase) * amp).toFixed(1)}`;
  return d;
}

// Desenho no espaço 400x320; o transform encaixa no quadrado 40x40
function art(line, bg, id) {
  const waves = [90, 128, 166, 204, 242].map((y, i) => {
    const mid = i === 2;
    return `<path d="${wavePath(y, mid ? 14 : 8 - Math.abs(i - 2) * 1.5, i * 1.3)}" fill="none" stroke="${mid ? AMBER : line}" stroke-width="${mid ? 15 : 12}" stroke-linecap="round"/>`;
  }).join('');
  const traces = TRACES.map(t => `<path d="${t.d}" fill="none" stroke="${BLUE}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<circle cx="${t.node[0]}" cy="${t.node[1]}" r="${NODE_R}" fill="${bg}" stroke="${BLUE}" stroke-width="10"/>`).join('');
  return `<g transform="translate(-4 0.6) scale(0.12)">`
    + `<defs><clipPath id="${id}"><path d="${HEMI_R}" transform="translate(8 0)"/></clipPath></defs>`
    + `<g clip-path="url(#${id})">${waves}</g>`
    + traces
    + `<path d="${HEMI_L}" transform="translate(-8 0)" fill="none" stroke="${BLUE}" stroke-width="15" stroke-linejoin="round"/>`
    + `<path d="${HEMI_R}" transform="translate(8 0)" fill="none" stroke="${line}" stroke-width="15" stroke-linejoin="round"/>`
    + `</g>`;
}

const out = path.join(__dirname, 'logo');
fs.mkdirSync(out, { recursive: true });

const files = {
  // Para fundo escuro (traços claros)
  'simbolo-escuro.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${art('#EAF0F7', '#0C111B', 'h')}</svg>`,
  // Para fundo claro (traços escuros)
  'simbolo-claro.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${art('#131A27', '#FFFFFF', 'h')}</svg>`,
  // Ícone de app / favicon: símbolo sobre o azul-noite
  'icone.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0C111B"/><g transform="translate(3 3) scale(0.85)">${art('#EAF0F7', '#0C111B', 'h')}</g></svg>`,
};

for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(out, name), svg + '\n');
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg'), files['icone.svg'] + '\n');
fs.writeFileSync(path.join(__dirname, '..', 'audiovisual-edition', 'public', 'favicon.svg'), files['icone.svg'] + '\n');
console.log('ok', Object.keys(files).join(', '));
