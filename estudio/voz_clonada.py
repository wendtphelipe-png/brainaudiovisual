# Voz clonada do Estúdio v2: dubla com a voz de quem fala no vídeo, usando o
# MOSS-TTS-Nano (Apache-2.0) na placa de vídeo. Roda no ambiente
# D:\Projetos\estudio-voz-py (torch 2.7 cu128, que ainda suporta a GTX 1070 Ti).
#
# Dois comandos:
#
#   falantes <audio24k.wav> <frases.json> <pasta-referencias> <saida.json>
#     frases.json = [{"s": início, "e": fim}, ...] em segundos.
#     Mede a "impressão digital" da voz de cada frase (ECAPA), agrupa as frases
#     por pessoa e recorta de 8 a 12 s de fala limpa de cada pessoa como
#     referência. Grava {"porFrase": [falante...], "falantes": [{"id", "segundos",
#     "referencia"}]}.
#
#   gerar <pedidos.json>
#     pedidos.json = [{"texto", "referencia", "saida", "semente"}, ...].
#     Gera cada fala (wav mono 24 kHz) e escreve no stdout uma linha JSON por
#     fala: {"ok": i, "dur": segundos} ou {"erro": i, "motivo"}.
#
# Antes de tudo escreve {"pronto": true, "dispositivo": "cuda"|"cpu"}.
import json
import os
import sys
import tempfile
import time

import numpy as np
import soundfile as sf
import torch
import torchaudio

TAXA = 24000
MODELOS = os.environ.get('ESTUDIO_MODELOS', r'D:\Projetos\estudio-modelos')
DISPOSITIVO = 'cuda' if torch.cuda.is_available() else 'cpu'


def emitir(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# ---------- falantes ----------

MIN_EMB = 1.2        # frases mais curtas que isso não têm voz suficiente para medir
SEMELHANCA = 0.45    # abaixo disso (cosseno) são pessoas diferentes
MIN_FALANTE = 12.0   # quem fala menos que isso no vídeo é juntado ao mais parecido


def falantes(audio, arq_frases, pasta_ref, saida):
    from scipy.cluster.hierarchy import fcluster, linkage
    from speechbrain.inference.speaker import EncoderClassifier

    frases = json.load(open(arq_frases, encoding='utf-8'))
    wav, taxa = sf.read(audio, dtype='float32')
    if wav.ndim == 2:
        wav = wav.mean(axis=1)
    pasta_ecapa = os.path.join(MODELOS, 'spkrec-ecapa')
    modelo = EncoderClassifier.from_hparams(source=pasta_ecapa, savedir=pasta_ecapa, run_opts={'device': DISPOSITIVO})
    emitir({'pronto': True, 'dispositivo': DISPOSITIVO})

    def trecho(s, e):
        return wav[int(s * taxa):int(e * taxa)]

    medidas, embs = [], []
    with torch.no_grad():
        for i, f in enumerate(frases):
            if f['e'] - f['s'] < MIN_EMB:
                continue
            meio = (f['s'] + f['e']) / 2
            s, e = max(f['s'], meio - 5), min(f['e'], meio + 5)   # até 10 s do meio da frase
            x = torch.from_numpy(trecho(s, e)).unsqueeze(0)
            x16 = torchaudio.functional.resample(x, taxa, 16000).to(DISPOSITIVO)
            v = modelo.encode_batch(x16).squeeze().float().cpu().numpy()
            embs.append(v / (np.linalg.norm(v) + 1e-9))
            medidas.append(i)
            if len(medidas) % 50 == 0:
                emitir({'progresso': len(medidas) / max(1, len(frases))})

    por_frase = [None] * len(frases)
    if len(embs) >= 2:
        rotulos = fcluster(linkage(np.stack(embs), method='average', metric='cosine'),
                           t=1 - SEMELHANCA, criterion='distance')
    else:
        rotulos = [1] * len(embs)
    for i, r in zip(medidas, rotulos):
        por_frase[i] = int(r)

    def tempo_de(g):
        return sum(frases[i]['e'] - frases[i]['s'] for i, r in enumerate(por_frase) if r == g)

    def centro(g):
        vs = [embs[k] for k, i in enumerate(medidas) if por_frase[i] == g]
        c = np.mean(vs, axis=0)
        return c / (np.linalg.norm(c) + 1e-9)

    # Quem fala muito pouco (ruído, uma tosse, uma palavra solta) vai para o grupo mais parecido
    while True:
        grupos = sorted(set(r for r in por_frase if r is not None), key=tempo_de)
        if len(grupos) < 2 or tempo_de(grupos[0]) >= MIN_FALANTE:
            break
        pequeno = grupos[0]
        alvo = max(grupos[1:], key=lambda g: float(centro(pequeno) @ centro(g)))
        por_frase = [alvo if r == pequeno else r for r in por_frase]

    # Frases curtas demais para medir ficam com a pessoa da frase vizinha
    for i in range(len(frases)):
        if por_frase[i] is None:
            vizinhos = [j for j in (i - 1, i + 1) if 0 <= j < len(frases) and por_frase[j] is not None]
            if vizinhos:
                por_frase[i] = por_frase[min(vizinhos, key=lambda j: abs(frases[j]['s'] - frases[i]['s']))]
    for i in range(len(frases)):          # sobra (sequência longa de frases curtas): segue a anterior
        if por_frase[i] is None:
            por_frase[i] = por_frase[i - 1] if i else next((r for r in por_frase if r is not None), 1)

    # Numera por ordem de quem mais fala (0 = falante principal)
    ordem = sorted(set(por_frase), key=tempo_de, reverse=True)
    novo = {g: k for k, g in enumerate(ordem)}

    os.makedirs(pasta_ref, exist_ok=True)
    lista = []
    for g in ordem:
        c = centro(g) if any(por_frase[i] == g for i in medidas) else None
        # Referência: as frases mais típicas da pessoa, de 2 a 12 s, até somar 8–12 s
        candidatas = []
        for k, i in enumerate(medidas):
            d = frases[i]['e'] - frases[i]['s']
            if por_frase[i] == g and 2 <= d <= 12:
                candidatas.append((float(embs[k] @ c) if c is not None else 0, i))
        if not candidatas:
            candidatas = [(0, i) for i in range(len(frases)) if por_frase[i] == g]
        candidatas.sort(reverse=True)
        pedacos, total = [], 0.0
        silencio = np.zeros(int(0.15 * taxa), dtype=np.float32)
        for _, i in candidatas:
            p = trecho(frases[i]['s'], frases[i]['e'])
            if total and total + len(p) / taxa > 12:
                continue
            pedacos += [p, silencio]
            total += len(p) / taxa
            if total >= 8:
                break
        ref = os.path.join(pasta_ref, f'falante-{novo[g] + 1}.wav')
        sf.write(ref, np.concatenate(pedacos) if pedacos else silencio, taxa, subtype='PCM_16')
        lista.append({'id': novo[g], 'segundos': round(tempo_de(g)), 'referencia': ref, 'refSeg': round(total, 1)})

    json.dump({'porFrase': [novo[r] for r in por_frase], 'falantes': lista}, open(saida, 'w', encoding='utf-8'))
    emitir({'fim': True, 'falantes': len(lista)})


# ---------- gerar ----------

def carregar_moss():
    sys.path.insert(0, os.path.join(MODELOS, 'MOSS-TTS-Nano'))
    os.environ.setdefault('HF_HOME', MODELOS)
    os.environ.setdefault('HF_HUB_OFFLINE', '1')
    from moss_tts_nano_runtime import NanoTTSService
    # float16: a GTX 1070 Ti não acelera bfloat16 (o padrão automático)
    svc = NanoTTSService(device=DISPOSITIVO, dtype='float16' if DISPOSITIVO == 'cuda' else 'float32',
                         output_dir=tempfile.mkdtemp(prefix='moss-'))
    svc.preload(load_model=True)
    return svc


PAUSA_MAX = 0.3   # segundos: pausas maiores dentro da fala são encurtadas para isto


def encurtar_pausas(w, taxa):
    # A voz clonada faz pausas longas no meio das frases (16% do tempo no
    # teste), o que atrasava a dublagem em relação ao vídeo. Corta o silêncio
    # das pontas e reduz cada pausa interna a PAUSA_MAX.
    passo = int(taxa * 0.02)
    n = len(w) // passo
    if n < 3:
        return w
    energia = np.sqrt(np.mean(w[:n * passo].reshape(n, passo) ** 2, axis=1))
    voz = energia >= 10 ** (-38 / 20)
    if not voz.any():
        return w
    primeiro, ultimo = np.argmax(voz), n - 1 - np.argmax(voz[::-1])
    manter = int(PAUSA_MAX / 0.02)
    partes, k = [], primeiro
    while k <= ultimo:
        fim = k
        while fim <= ultimo and voz[fim] == voz[k]:
            fim += 1
        trecho = w[k * passo:fim * passo]
        if not voz[k] and fim - k > manter:
            meio = manter // 2
            trecho = np.concatenate([trecho[:meio * passo], trecho[-(manter - meio) * passo:]])
        partes.append(trecho)
        k = fim
    return np.concatenate(partes)


def duracao_esperada(texto):
    return max(0.6, len(texto) / 15.0)   # ~15 caracteres por segundo de fala


def gerar(arq_pedidos):
    pedidos = json.load(open(arq_pedidos, encoding='utf-8'))
    svc = carregar_moss()
    emitir({'pronto': True, 'dispositivo': DISPOSITIVO})
    tmp = os.path.join(svc.output_dir, 'ultima.wav')
    for i, p in enumerate(pedidos):
        motivo = ''
        esperado = duracao_esperada(p['texto'])
        for tentativa in range(3):
            try:
                r = svc.synthesize(text=p['texto'], mode='voice_clone', prompt_audio_path=p['referencia'],
                                   output_audio_path=tmp, seed=int(p.get('semente', i)) + tentativa * 7919)
                w = torch.from_numpy(np.asarray(r['waveform_numpy'], dtype=np.float32))
                if w.ndim == 2:
                    w = w.mean(dim=1)
                w = torchaudio.functional.resample(w, int(r['sample_rate']), TAXA).clamp(-1, 1).numpy()
                w = encurtar_pausas(w, TAXA)
                dur = len(w) / TAXA
                # Fala que saiu longa ou curta demais costuma ser erro do modelo (repetição, corte): refaz
                if dur > max(3.0, esperado * 2.6) or dur < esperado * 0.3:
                    motivo = f'duração fora do esperado ({dur:.1f}s para ~{esperado:.1f}s)'
                    continue
                sf.write(p['saida'], w, TAXA, subtype='PCM_16')
                emitir({'ok': i, 'dur': round(dur, 3)})
                break
            except Exception as erro:  # noqa: BLE001
                motivo = str(erro) or type(erro).__name__
        else:
            emitir({'erro': i, 'motivo': motivo})


if __name__ == '__main__':
    t = time.time()
    if sys.argv[1] == 'falantes':
        falantes(*sys.argv[2:6])
    elif sys.argv[1] == 'gerar':
        gerar(sys.argv[2])
    else:
        sys.exit('comando desconhecido')
