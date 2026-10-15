# Vozes do Estúdio v2: gera as falas dubladas com as vozes neurais da
# Microsoft (edge-tts), várias ao mesmo tempo, com novas tentativas.
#
# Recebe um JSON com a lista de pedidos [{"texto", "voz", "velocidade", "saida"}]
# ("velocidade" no formato do edge-tts, ex.: "+0%", "+20%") e escreve no
# stdout uma linha JSON por fala pronta: {"ok": indice} ou {"erro": indice, "motivo"}.
#
# Uso: python vozes.py pedidos.json [simultaneas]
import asyncio
import json
import os
import sys

import edge_tts

TENTATIVAS = [1, 3, 8, 20]  # segundos de espera entre as tentativas


def emitir(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


async def gerar(i, pedido, limite):
    async with limite:
        motivo = ''
        for espera in [0] + TENTATIVAS:
            if espera:
                await asyncio.sleep(espera)
            try:
                tts = edge_tts.Communicate(pedido['texto'], pedido['voz'], rate=pedido.get('velocidade', '+0%'))
                await tts.save(pedido['saida'])
                if os.path.getsize(pedido['saida']) > 0:
                    emitir({'ok': i})
                    return
                motivo = 'arquivo vazio'
            except Exception as erro:
                motivo = str(erro) or type(erro).__name__
        emitir({'erro': i, 'motivo': motivo})


async def main():
    with open(sys.argv[1], encoding='utf-8') as f:
        pedidos = json.load(f)
    limite = asyncio.Semaphore(int(sys.argv[2]) if len(sys.argv) > 2 else 6)
    await asyncio.gather(*(gerar(i, p, limite) for i, p in enumerate(pedidos)))


if __name__ == '__main__':
    asyncio.run(main())
