// Gera os arquivos do logo da Brain Audiovisual a partir do logo ORIGINAL
// (o "B" de circuito, escolhido pelo Thiago), redesenhado em vetor para ficar
// nítido em qualquer tamanho e permitir as camadas de profundidade.
//
// - simbolo.svg ............ o "B" de circuito com o degradê original
// - simbolo-escuro.svg ..... igual (o degradê funciona em fundo escuro e claro)
// - simbolo-claro.svg ...... igual
// - icone.svg / favicon .... símbolo sobre o azul-noite
// - wordmark-claro.png ..... "BRAIN AUDIOVISUAL" claro, para fundo escuro
// - wordmark-original.png .. as cores originais, para fundo claro
//
// O desenho segue o logo original na escala 600x700 (o símbolo de 500 px
// ampliado 4 vezes). Uso: node design/gerar-logo.js
const fs = require('fs');
const path = require('path');

const THICK = 22, MID = 18, THIN = 12;
const BIG = 38, NODE = 40, SMALL = 22;

// Espinha do "B": nó grande do topo, três nós da esquerda e nó grande de baixo
const SPINE = 'M437 68H232C186 68 152 98 140 155C70 182 30 250 58 312C66 330 78 342 95 350C40 380 30 455 88 494C104 505 120 512 140 515C156 572 190 625 232 625H437';
// Traços de circuito (linhas finas) e ramos médios
const THIN_LINES = [
  'M140 175V270H355',          // do 1º nó: desce e vai até o ponto do meio
  'M95 350H437V165',           // do nó do meio: vai à direita e sobe
  'M437 270H520',              // ramo para a direita
  'M140 500V425H485',          // do 3º nó: sobe e vai à direita
  'M395 425V530H520',          // ramo que desce até o ponto de baixo
];
const MID_LINES = ['M140 158H295', 'M140 530H295'];
const NODES = [
  [437, 68, BIG], [437, 625, BIG],
  [140, 155, NODE], [95, 350, NODE], [140, 515, NODE],
  [295, 160, SMALL], [355, 270, SMALL], [437, 165, SMALL], [520, 270, SMALL],
  [485, 425, SMALL], [520, 530, SMALL], [295, 530, SMALL],
];

function art(id) {
  return `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="160" y1="40" x2="380" y2="660"><stop offset="0" stop-color="#46C3EE"/><stop offset="1" stop-color="#3576C2"/></linearGradient></defs>`
    + `<g fill="none" stroke="url(#${id})" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${SPINE}" stroke-width="${THICK}"/>`
    + MID_LINES.map(d => `<path d="${d}" stroke-width="${MID}"/>`).join('')
    + THIN_LINES.map(d => `<path d="${d}" stroke-width="${THIN}" stroke-linecap="butt"/>`).join('')
    + `</g><g fill="url(#${id})">`
    + NODES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')
    + `</g>`;
}

// Quadrado 700x700 com o símbolo centralizado (para caber em ícones redondos)
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 0 700 700">${art('g')}</svg>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="#0C111B"/><svg x="5" y="5" width="30" height="30" viewBox="-30 0 700 700">${art('g')}</svg></svg>`;

const out = path.join(__dirname, 'logo');
fs.mkdirSync(out, { recursive: true });
// brain-b-*: os mesmos desenhos com nomes novos, que o site usa. A Hostinger
// guarda cópia dos arquivos por 7 dias e devolvia o logo antigo com o nome velho.
for (const name of ['simbolo.svg', 'simbolo-escuro.svg', 'simbolo-claro.svg', 'brain-b-escuro.svg', 'brain-b-claro.svg']) fs.writeFileSync(path.join(out, name), symbol + '\n');
fs.writeFileSync(path.join(out, 'icone.svg'), icon + '\n');
fs.writeFileSync(path.join(out, 'brain-b-icone.svg'), icon + '\n');
fs.writeFileSync(path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg'), icon + '\n');
fs.writeFileSync(path.join(__dirname, '..', 'audiovisual-edition', 'public', 'favicon.svg'), icon + '\n');
console.log('ok símbolo e ícone');
