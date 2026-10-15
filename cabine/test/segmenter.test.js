// Testes do segmentador: node --test cabine/test
const test = require('node:test');
const assert = require('node:assert');
const { Segmenter } = require('../segmenter');

const SPEECH = ('agora nós vamos abrir o retroperitônio e identificar o ureter esquerdo ao longo de todo o seu trajeto ' +
  'o nervo hipogástrico passa medial a este plano então mantemos a dissecção bem próxima ao reto para preservar a inervação ' +
  'percebam que a paciente tem um nódulo de endometriose profunda que infiltra o ligamento uterossacro do lado esquerdo ' +
  'e por isso a ressecção precisa ser feita com muito cuidado porque o ureter está muito próximo da lesão').split(' ');

// Fala contínua, sem pausa: 2,5 palavras por segundo, texto provisório a cada
// 150 ms e a última palavra às vezes chega errada antes de ser corrigida.
function simulate({ words, final = false, wps = 2.5, repeat = 1 }) {
  let clock = 0;
  const blocks = [];
  const seg = new Segmenter({ now: () => clock, onBlock: b => blocks.push(b) });
  const all = [];
  for (let r = 0; r < repeat; r++) all.push(...words);
  const spokenAt = [];
  let shown = 0;
  for (let t = 0; shown < all.length || t < (all.length / wps) * 1000 + 2000; t += 150) {
    clock = t;
    const due = Math.min(all.length, Math.floor((t / 1000) * wps));
    while (spokenAt.length < due) spokenAt.push(t);
    shown = due;
    const text = all.slice(0, shown);
    // Enquanto fala, a última palavra às vezes chega errada e depois é corrigida
    if (shown > 0 && shown < all.length && (t / 150) % 4 === 1) text[shown - 1] = text[shown - 1] + 'x';
    seg.update('frase-1', text.join(' '), false);
    seg.tick();
  }
  clock += 200;
  if (final) seg.update('frase-1', all.join(' '), true); else seg.flush();
  return { blocks, all, spokenAt };
}

test('fala longa sem pausa: nenhuma palavra perdida ou repetida', () => {
  const { blocks, all } = simulate({ words: SPEECH, repeat: 6 });
  const out = blocks.map(b => b.text).join(' ').split(' ');
  assert.deepStrictEqual(out, all);
  assert.deepStrictEqual(blocks.map(b => b.seq), blocks.map((_, i) => i + 1));
});

test('blocos curtos: no máximo 22 palavras', () => {
  const { blocks } = simulate({ words: SPEECH, repeat: 6 });
  for (const b of blocks) assert.ok(b.words <= 22, `bloco ${b.seq} com ${b.words} palavras`);
  const avg = blocks.reduce((s, b) => s + b.words, 0) / blocks.length;
  assert.ok(avg >= 5 && avg <= 16, `média ${avg}`);
});

test('atraso curto: cada palavra vira bloco em poucos segundos, sem esperar pausa', () => {
  const { blocks, spokenAt } = simulate({ words: SPEECH, repeat: 6 });
  let idx = 0, worst = 0, total = 0;
  for (const b of blocks) {
    for (let k = 0; k < b.words; k++, idx++) {
      const lag = b.tClose - spokenAt[idx];
      worst = Math.max(worst, lag);
      total += lag;
    }
  }
  const avg = total / idx;
  // Exclui o fim (encerramento), que é forçado
  assert.ok(avg < 3000, `atraso médio ${avg} ms`);
  assert.ok(worst < 6000, `pior atraso ${worst} ms`);
});

test('frase final do reconhecimento fecha o bloco na hora', () => {
  const { blocks, all } = simulate({ words: SPEECH.slice(0, 9), final: true });
  assert.strictEqual(blocks.map(b => b.text).join(' '), all.join(' '));
});

test('troca de frase sem "final": confirma o que sobrou da anterior', () => {
  let clock = 0;
  const blocks = [];
  const seg = new Segmenter({ now: () => clock, onBlock: b => blocks.push(b) });
  seg.update('a', 'o nervo hipogástrico passa', false);
  clock = 300;
  seg.update('b', 'medial ao plano', false);
  clock = 2000;
  seg.flush();
  assert.strictEqual(blocks.map(b => b.text).join(' '), 'o nervo hipogástrico passa medial ao plano');
});

test('corte natural antes de conjunção', () => {
  let clock = 0;
  const blocks = [];
  const seg = new Segmenter({ now: () => clock, onBlock: b => blocks.push(b), maxAgeMs: 99999 });
  const words = 'a paciente tem um nódulo de endometriose profunda no ligamento uterossacro esquerdo bem visível e por isso fazemos a ressecção'.split(' ');
  seg.update('x', words.join(' '), true);
  assert.ok(blocks[0].text.endsWith('visível'), blocks[0].text);
  assert.ok(blocks[1].text.startsWith('e por isso'), blocks[1].text);
});
