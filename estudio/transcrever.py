# Transcrição do Estúdio v2: Whisper (faster-whisper) na placa de vídeo.
#
# Recebe um áudio WAV mono 16 kHz e grava um JSON com:
#   - o idioma detectado e a certeza;
#   - as falas, com início e fim e o tempo de cada palavra;
#   - a altura média da voz (F0, em Hz) de cada fala, usada para escolher
#     voz masculina ou feminina na dublagem.
# Durante o trabalho escreve no stdout linhas JSON {"progresso": 0..1}.
#
# Uso: python transcrever.py entrada.wav saida.json [modelo]
import json
import os
import sys
import wave

import numpy as np


def preparar_dlls():
    # As bibliotecas da NVIDIA (cuBLAS e cuDNN) vêm como pacotes do pip; no
    # Windows é preciso dizer onde estão as DLLs.
    import importlib.util
    for pacote in ('nvidia.cublas', 'nvidia.cudnn', 'nvidia.cuda_nvrtc'):
        spec = importlib.util.find_spec(pacote)
        if not spec or not spec.submodule_search_locations:
            continue
        pasta = os.path.join(list(spec.submodule_search_locations)[0], 'bin')
        if os.path.isdir(pasta):
            os.add_dll_directory(pasta)
            os.environ['PATH'] = pasta + os.pathsep + os.environ.get('PATH', '')


def emitir(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def carregar_modelo(nome):
    from faster_whisper import WhisperModel
    try:
        # Placa Pascal (GTX 1070 Ti): int8 é o formato rápido; float16 não é
        return WhisperModel(nome, device='cuda', compute_type='int8'), 'cuda'
    except Exception as erro:
        emitir({'aviso': f'placa de vídeo indisponível ({erro}); usando o processador'})
        return WhisperModel(nome, device='cpu', compute_type='int8'), 'cpu'


def ler_wav(caminho):
    with wave.open(caminho, 'rb') as w:
        taxa = w.getframerate()
        dados = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return dados.astype(np.float32) / 32768.0, taxa


def altura_da_voz(sinal, taxa, ini, fim):
    """Mediana da frequência fundamental (Hz) dos trechos com voz, por
    autocorrelação em janelas de 40 ms. Homens ficam em geral entre 85 e
    155 Hz, mulheres entre 165 e 255 Hz. Devolve None se não houver voz clara."""
    a, b = int(ini * taxa), int(fim * taxa)
    trecho = sinal[a:b]
    jan, passo = int(0.04 * taxa), int(0.02 * taxa)
    if len(trecho) < jan:
        return None
    lag_min, lag_max = int(taxa / 350), int(taxa / 70)
    energia_ref = np.percentile(np.abs(trecho), 90) or 1e-9
    valores = []
    for i in range(0, len(trecho) - jan, passo):
        q = trecho[i:i + jan]
        if np.sqrt(np.mean(q * q)) < energia_ref * 0.25:
            continue  # silêncio ou respiração
        q = q - q.mean()
        ac = np.correlate(q, q, mode='full')[jan - 1:]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        seg = ac[lag_min:lag_max]
        k = int(np.argmax(seg))
        if seg[k] < 0.45:
            continue  # som sem tom definido (consoantes, ruído)
        valores.append(taxa / (lag_min + k))
    if len(valores) < 5:
        return None
    return float(np.median(valores))


def main():
    entrada, saida = sys.argv[1], sys.argv[2]
    nome_modelo = sys.argv[3] if len(sys.argv) > 3 else 'large-v3-turbo'
    preparar_dlls()
    emitir({'etapa': 'carregando o modelo'})
    modelo, dispositivo = carregar_modelo(nome_modelo)
    emitir({'etapa': 'transcrevendo', 'dispositivo': dispositivo})

    # Passa o áudio já lido (o leitor de arquivos do faster-whisper não é
    # compatível com a versão atual do PyAV)
    sinal, taxa = ler_wav(entrada)
    segmentos, info = modelo.transcribe(
        sinal,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 500},
        # Sem herdar o texto anterior: evita o Whisper repetir frases em loop
        condition_on_previous_text=False,
        # Ouve vários trechos para decidir o idioma (vinheta no começo não engana)
        language_detection_segments=4,
    )
    emitir({'idioma': info.language, 'certeza': round(info.language_probability, 3)})

    falas = []
    for s in segmentos:
        palavras = [{'w': p.word, 's': round(p.start, 2), 'e': round(p.end, 2)} for p in (s.words or [])]
        falas.append({
            's': round(s.start, 2), 'e': round(s.end, 2), 'texto': s.text.strip(),
            'palavras': palavras, 'f0': altura_da_voz(sinal, taxa, s.start, s.end),
        })
        emitir({'progresso': round(min(1.0, s.end / max(info.duration, 1)), 3)})

    with open(saida, 'w', encoding='utf-8') as f:
        json.dump({
            'idioma': info.language, 'certeza': info.language_probability,
            'duracao': info.duration, 'dispositivo': dispositivo, 'falas': falas,
        }, f, ensure_ascii=False)
    emitir({'fim': True})


if __name__ == '__main__':
    main()
