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


@torch.no_grad()
def gerar_lote(svc, textos, referencia, semente):
    # Gera várias frases da mesma pessoa numa passada só da placa de vídeo:
    # a voz de referência é codificada uma vez e as frases andam juntas na
    # geração. Usa as mesmas partes internas do MOSS que o synthesize() usa
    # quando divide um texto longo em pedaços. Devolve uma lista de wav
    # (mono, 24 kHz, já com as pausas encurtadas).
    with svc._lock:
        modelo = svc._restore_model_execution_state(svc._load_model_locked())
        _, atn_global, atn_local = svc._resolve_request_attention_implementation(None)
        tok_audio = svc._load_audio_tokenizer_locked(tts_attn_implementation=atn_global)
        svc._apply_model_attention_implementation(modelo, global_attn=atn_global, local_attn=atn_local)
    dev = svc.device
    nq = modelo._resolve_inference_nq(None)
    tok_texto = modelo._load_text_tokenizer(text_tokenizer=None, text_tokenizer_path=svc.checkpoint_path)
    taxa_alvo = modelo._resolve_audio_tokenizer_sample_rate(tok_audio)
    canais = modelo._resolve_audio_tokenizer_channels(tok_audio)
    chave = (referencia, taxa_alvo)
    if getattr(svc, '_ref_cache', (None,))[0] != chave:
        wav, taxa = modelo._load_reference_audio(referencia, taxa_alvo, canais)
        cod = modelo._call_audio_encode(audio_tokenizer=tok_audio, waveform=wav.to(dev), sample_rate=taxa)
        svc._ref_cache = (chave, modelo._mask_unused_audio_channels(modelo._normalize_audio_codes(cod), nq=nq).to(dev))
    codigos = svc._ref_cache[1]

    ids, mascaras = [], []
    for t in textos:
        i, m = modelo.build_inference_input_ids(text=t, text_tokenizer=tok_texto, mode='voice_clone', prompt_text=None,
                                                prompt_audio_codes=codigos, device=dev)
        ids.append(i)
        mascaras.append(m)
    ids_lote, masc_lote = modelo._left_pad_inference_batch(input_id_batches=ids, attention_mask_batches=mascaras, device=dev)
    torch.manual_seed(semente)
    torch.cuda.manual_seed_all(semente)
    # Mesmos parâmetros de amostragem que o synthesize() usa por padrão
    gerados = modelo._generate_audio_token_ids_with_fallback(
        prompt_input_ids=ids_lote, attention_mask=masc_lote, effective_nq=nq, max_new_frames=375, do_sample=True,
        text_temperature=1.0, text_top_p=1.0, text_top_k=50, audio_temperature=0.8, audio_top_p=0.95, audio_top_k=25,
        audio_repetition_penalty=1.2, use_kv_cache=True, resolved_device=dev)
    tokens = [modelo._trim_generated_audio_token_ids(gerados[k], effective_nq=nq) for k in range(len(textos))]
    saida = []
    for t in tokens:
        # Decodifica uma frase por vez: em lote, o decodificador de áudio pedia mais de 4 GB da placa
        w, taxa = modelo._decode_audio_token_ids_to_waveform(
            audio_tokenizer=tok_audio, audio_token_ids=t, target_sample_rate=taxa_alvo,
            effective_nq=nq, resolved_device=dev)
        w = w.detach().float().cpu()
        if w.ndim == 2:
            w = w.mean(dim=0)
        w = torchaudio.functional.resample(w, int(taxa), TAXA).clamp(-1, 1).numpy()
        saida.append(encurtar_pausas(w, TAXA))
    return saida


def duracao_esperada(texto):
    return max(0.6, len(texto) / 15.0)   # ~15 caracteres por segundo de fala


LOTE = int(os.environ.get('ESTUDIO_VOZ_LOTE', '8'))   # frases por passada na placa (8 rendeu 3,6× no teste)
MAX_CHARS_TOTAL = 900   # caracteres somados por lote (frases longas juntas estouravam a memória da placa)
MAX_CHARS_LOTE = 280   # frase maior que isso o MOSS divide em pedaços: vai pelo caminho de uma por vez


def fora_do_esperado(dur, texto):
    # Fala longa ou curta demais costuma ser erro do modelo (repetição, corte)
    esperado = duracao_esperada(texto)
    return dur > max(3.0, esperado * 2.6) or dur < esperado * 0.3


def gerar(arq_pedidos):
    pedidos = json.load(open(arq_pedidos, encoding='utf-8'))
    svc = carregar_moss()
    emitir({'pronto': True, 'dispositivo': DISPOSITIVO})

    # 1º: em lotes, frases da mesma pessoa e de tamanho parecido juntas
    sozinhas = []
    grupos = {}
    for i, p in enumerate(pedidos):
        if LOTE > 1 and DISPOSITIVO == 'cuda' and len(p['texto']) <= MAX_CHARS_LOTE:
            grupos.setdefault(p['referencia'], []).append(i)
        else:
            sozinhas.append(i)
    for ref, idx in grupos.items():
        idx.sort(key=lambda i: len(pedidos[i]['texto']))
        lotes, atual = [], []
        for i in idx:   # até LOTE frases e até MAX_CHARS_TOTAL caracteres por lote
            if atual and (len(atual) >= LOTE or sum(len(pedidos[j]['texto']) for j in atual + [i]) > MAX_CHARS_TOTAL):
                lotes.append(atual)
                atual = []
            atual.append(i)
        if atual:
            lotes.append(atual)
        for parte in lotes:
            try:
                ondas = gerar_lote(svc, [pedidos[i]['texto'] for i in parte], ref, int(pedidos[parte[0]].get('semente', parte[0])))
            except Exception:  # noqa: BLE001 — o lote todo vai para o caminho de uma por vez
                sozinhas += parte
                torch.cuda.empty_cache()
                continue
            for i, w in zip(parte, ondas):
                dur = len(w) / TAXA
                if fora_do_esperado(dur, pedidos[i]['texto']):
                    sozinhas.append(i)
                    continue
                sf.write(pedidos[i]['saida'], w, TAXA, subtype='PCM_16')
                emitir({'ok': i, 'dur': round(dur, 3)})

    # 2º: uma por vez (frases longas, e as que saíram estranhas no lote, com outra semente)
    tmp = os.path.join(svc.output_dir, 'ultima.wav')
    for i in sorted(sozinhas):
        p = pedidos[i]
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
                if fora_do_esperado(dur, p['texto']):
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
