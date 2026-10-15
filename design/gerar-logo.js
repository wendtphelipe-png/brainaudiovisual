// Gera os arquivos do logo "Sinal": o contorno do cérebro preenchido por
// linhas de onda, com a linha do meio em âmbar (a fala "no ar").
// Uso: node design/gerar-logo.js
const fs = require('fs');
const path = require('path');

const BRAIN_SIDE = 'M80 190C58 160 62 110 98 80C130 52 180 38 230 42C290 46 338 74 352 120C362 152 352 182 330 196C342 214 330 240 302 242C284 244 268 236 260 226C252 236 246 256 244 282C243 292 228 292 226 282C224 262 222 246 214 236C190 238 160 232 140 220C120 222 96 212 80 190Z';
const AMBER = '#FFB224';

// Ondas no espaço 40x40 do símbolo (as mesmas do quadro de direções)
function waves(lineColor) {
  let out = '';
  for (let k = 0; k < 7; k++) {
    const y = 7 + k * 3.6;
    let d = `M0 ${y}`;
    for (let x = 0; x <= 40; x += 2) d += ` L${x} ${(y + Math.sin(x * 0.55 + k) * (1.1 - Math.abs(k - 3) * 0.2)).toFixed(2)}`;
    out += `<path d="${d}" fill="none" stroke="${k === 3 ? AMBER : lineColor}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  return out;
}

function mark(lineColor, id) {
  return `<defs><clipPath id="${id}"><path d="${BRAIN_SIDE}" transform="translate(1.2 2.6) scale(0.094)"/></clipPath></defs><g clip-path="url(#${id})">${waves(lineColor)}</g>`;
}

const out = path.join(__dirname, 'logo');
fs.mkdirSync(out, { recursive: true });

const files = {
  // Símbolo para fundo escuro (linhas claras)
  'simbolo-escuro.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${mark('#EAF0F7', 'b')}</svg>`,
  // Símbolo para fundo claro (linhas escuras)
  'simbolo-claro.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${mark('#121722', 'b')}</svg>`,
  // Ícone de app / favicon: símbolo sobre o azul-noite
  'icone.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0C111B"/><g transform="translate(4 4) scale(0.8)">${mark('#EAF0F7', 'b')}</g></svg>`,
};

for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(out, name), svg + '\n');

// O favicon do app usa o ícone
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg'), files['icone.svg'] + '\n');

// Trecho para o index.html: ondas do símbolo como string (usado por brandMark())
fs.writeFileSync(path.join(out, 'ondas.txt'), waves('LINE') + '\n');
console.log('ok', Object.keys(files).join(', '));
