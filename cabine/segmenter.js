// Segmentador da Cabine v2.
//
// Recebe o texto provisório do reconhecimento de voz (que muda várias vezes
// por segundo) e entrega BLOCOS curtos e definitivos, sem esperar o
// palestrante respirar:
//
// 1. Uma palavra é confirmada quando continua igual há `stableMs`
//    (comparando o texto de agora com o de `stableMs` atrás). As últimas
//    `margin` palavras ficam sempre de fora, porque são as que mais mudam.
// 2. O bloco fecha no que vier primeiro: pontuação final, `softMax` palavras
//    num ponto natural de corte, `hardMax` palavras, `maxAgeMs` desde a
//    primeira palavra, ou fim de frase do reconhecimento.
//
// Uma palavra confirmada nunca é retirada: o que já saiu não volta atrás.

const CUT_BEFORE = new Set(['e', 'mas', 'que', 'porque', 'pois', 'então', 'entao', 'quando', 'onde', 'porém', 'porem',
  'ou', 'se', 'como', 'enquanto', 'depois', 'antes', 'agora', 'aqui', 'and', 'but', 'so', 'because', 'when', 'which', 'that']);
const END_PUNCT = /[.?!;:]$/;

function norm(w) {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && norm(a[i]) === norm(b[i])) i++;
  return i;
}

class Segmenter {
  constructor(opts = {}) {
    this.onBlock = opts.onBlock || (() => {});
    this.now = opts.now || Date.now;
    this.stableMs = opts.stableMs ?? 600;
    this.margin = opts.margin ?? 2;
    this.minWords = opts.minWords ?? 6;
    this.softMax = opts.softMax ?? 16;
    this.hardMax = opts.hardMax ?? 26;
    this.maxAgeMs = opts.maxAgeMs ?? 3000;
    this.seq = opts.startSeq ?? 0;
    this.pending = [];       // palavras confirmadas que ainda não viraram bloco
    this.pendingSince = 0;   // quando entrou a primeira palavra do bloco
    // Quantas palavras de cada frase já foram confirmadas. Se uma frase
    // "voltar" (o Chrome às vezes alterna entre dois trechos provisórios),
    // continua de onde parou em vez de mandar tudo de novo.
    this.seen = new Map();
    this.resetUtterance(null);
  }

  resetUtterance(id) {
    if (this.uttId !== null && this.uttId !== undefined) this.seen.set(this.uttId, this.committed);
    if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
    this.uttId = id;
    this.committed = id === null ? 0 : (this.seen.get(id) || 0); // quantas palavras desta frase já foram confirmadas
    this.history = [];       // [{t, words}] do texto provisório recente
  }

  // Texto do reconhecimento. `utt` identifica a frase; `final` = frase fechada.
  update(utt, text, final) {
    if (utt !== this.uttId) {
      // Trocou de frase: confirma o que sobrou da anterior, sem fechar o
      // bloco (quem fecha são as regras de tamanho, tempo e pontuação)
      const last = this.history[this.history.length - 1];
      if (this.uttId !== null && last) this.commitUpTo(last.words, last.words.length);
      this.resetUtterance(utt);
    }
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const t = this.now();
    this.history.push({ t, words });
    this.history = this.history.filter(h => t - h.t <= this.stableMs * 4);
    if (final) {
      // Frase fechada: confirma tudo e fecha o bloco. A contagem continua,
      // porque o cockpit pode seguir mandando o mesmo texto crescendo.
      this.commitUpTo(words, words.length);
      this.closeBlock('final');
      return;
    }
    this.evaluate();
  }

  // O reconhecimento reiniciou ou parou: confirma tudo o que estava na tela
  finishUtterance() {
    const last = this.history[this.history.length - 1];
    if (last) this.commitUpTo(last.words, last.words.length);
    this.resetUtterance(null);
    this.closeBlock('fim-de-frase');
  }

  // Confirma palavras estáveis e fecha blocos por tempo. Chamado também
  // pelo relógio, para funcionar mesmo quando não chega texto novo.
  evaluate() {
    const t = this.now();
    const last = this.history[this.history.length - 1];
    if (last) {
      // Texto mais recente que já tem pelo menos stableMs de idade
      let old = null;
      for (const h of this.history) if (t - h.t >= this.stableMs) old = h;
      if (old) {
        const stable = commonPrefix(old.words, last.words);
        this.commitUpTo(last.words, Math.min(stable, last.words.length - this.margin));
      }
    }
    this.checkClose();
  }

  tick() { this.evaluate(); }

  commitUpTo(words, upto) {
    if (upto <= this.committed) return;
    const fresh = words.slice(this.committed, upto);
    if (fresh.length && this.pending.length === 0) this.pendingSince = this.now();
    this.pending.push(...fresh);
    this.committed = upto;
    this.checkClose();
  }

  checkClose() {
    const p = this.pending;
    if (!p.length) return;
    // Pontuação final fecha na hora
    for (let i = 0; i < p.length; i++) {
      if (END_PUNCT.test(p[i]) && i + 1 >= 2) { this.emit(i + 1, 'pontuacao'); return this.checkClose(); }
    }
    if (p.length >= this.softMax) {
      const cut = this.findCut();
      if (cut) { this.emit(cut, 'corte-natural'); return this.checkClose(); }
    }
    if (p.length >= this.hardMax) { this.emit(this.findCut() || this.hardMax, 'limite'); return this.checkClose(); }
    // Por tempo: prefere um ponto natural; só corta em qualquer lugar se
    // passar bem do limite (fala sem vírgula nem conjunção)
    const age = this.now() - this.pendingSince;
    if (p.length >= this.minWords && age >= this.maxAgeMs) {
      const cut = this.findCut();
      if (cut) this.emit(cut, 'tempo-corte-natural');
      else if (age >= this.maxAgeMs * 1.6) this.emit(p.length, 'tempo');
    }
  }

  // Melhor ponto de corte: depois de vírgula ou antes de uma conjunção
  findCut() {
    const p = this.pending;
    const limit = Math.min(p.length, this.hardMax);
    for (let i = limit - 1; i >= this.minWords; i--) {
      if (/,$/.test(p[i - 1]) || CUT_BEFORE.has(norm(p[i]))) return i;
    }
    return 0;
  }

  closeBlock(reason) {
    if (this.pending.length) this.emit(this.pending.length, reason);
  }

  emit(n, reason) {
    const words = this.pending.splice(0, n);
    const block = { seq: ++this.seq, text: words.join(' '), words: words.length, reason, tFirst: this.pendingSince, tClose: this.now() };
    this.pendingSince = this.pending.length ? this.now() : 0;
    this.onBlock(block);
  }

  // Encerrar a sessão: nada fica para trás
  flush() {
    if (this.uttId !== null) this.finishUtterance();
    this.closeBlock('encerrar');
  }
}

module.exports = { Segmenter, commonPrefix };
