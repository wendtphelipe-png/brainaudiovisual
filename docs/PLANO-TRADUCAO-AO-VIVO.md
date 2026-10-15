# Plano: tradução ao vivo sem perdas (Cabine v2)

Escrito em 15/10/2026. Objetivo: o que aparece no cockpit chega inteiro na saída de cada idioma, com voz fluida e atraso de poucos segundos.

## 0. Decisões do Phelipe (15/10/2026) e o que já foi construído

- **Gratuito primeiro.** Validar o processo sem custo; quando estiver confiável, migrar a voz (e talvez a tradução) para motores pagos.
- **Uma saída por idioma = um notebook por idioma** (cada notebook tem uma saída de som, ligada ao transmissor de rádio). Normalmente 2 idiomas (EN+ES, EN+PT ou PT+ES); às vezes 5 ou mais.
- **Teste de bancada:** aula de 1 h no Vimeo, som do navegador mandado para o VB-Cable, cockpit captando pela entrada CABLE Output.

### Ajustes no plano por causa disso

- **Voz gratuita = voz natural do Microsoft Edge no notebook de saída.** Medido neste PC: o edge-tts (servidor) estava bloqueado (403) até atualizar o pacote para 7.3.1, e mesmo atualizado levou 2 a 5 s para começar cada trecho. Já as vozes "Online (Natural)" do Edge são as mesmas vozes neurais, usadas pelo próprio navegador, e começam a falar quase na hora. Num notebook com tela ligada não há o corte que acontecia nos celulares.
- **Tradução gratuita:** endereço público do Google, só para blocos fechados. O endereço antigo (`client=gtx`) está bloqueado (429) para o servidor; o novo código alterna sozinho entre três endereços. Se um bloco falhar, ele vai junto com o próximo (nunca é descartado).
- **Servidor:** um PC central roda tudo; os notebooks de saída abrem uma página na rede local. Quantos notebooks forem precisos, sem sobrecarga.

### Primeira versão (pasta `cabine/`, branch `cabine-v2`)

| Peça | Arquivo | Estado |
|---|---|---|
| Segmentador (blocos sem esperar pausa) | `cabine/segmenter.js` | Pronto, 6 testes automáticos passando |
| Tradução gratuita com troca de endereço | `cabine/translate.js` | Pronto |
| Servidor local (WebSocket, blocos numerados, registro em disco, reenvio) | `cabine/server.js` | Pronto |
| Cockpit v2 | `cabine/public/cockpit.html` | Pronto (versão 1) |
| Página de saída por idioma | `cabine/public/saida.html` | Pronta (versão 1) |
| Teste de ponta a ponta | `cabine/test/simular.js` | Passou: 16/16 blocos em EN e ES, na ordem, tradução média de 0,5 a 0,8 s |

### Como testar com a aula do Vimeo

1. No PC central, dê dois cliques em `INICIAR_CABINE.bat` (na raiz do projeto). Na primeira vez, o Windows pode perguntar sobre o firewall: permita em **redes privadas**, senão os notebooks não conseguem conectar.
2. No Windows, deixe **CABLE Output** como microfone padrão (Configurações > Sistema > Som > Entrada). O reconhecimento do Chrome escuta sempre o microfone padrão.
3. No navegador onde o Vimeo vai tocar, mande o som para **CABLE Input**.
4. No cockpit (abre sozinho em http://localhost:8790), escolha os idiomas de saída e clique em **Iniciar captação**. Dê play na aula.
5. Em cada notebook de saída (mesma rede Wi-Fi ou cabo), abra no **Microsoft Edge** o link que aparece no rodapé do cockpit, por exemplo `http://192.168.0.163:8790/saida?lang=en-US`, e clique em **Iniciar saída**. Escolha a voz "Online (Natural)".
6. Para testar com um notebook só, abra a página de saída numa aba do Edge no próprio PC central (o som vai para os alto-falantes dele).

O que observar: o atraso mostrado em cada saída ("Atraso desde a fala"), a fila para falar (deve ficar abaixo de 6 s na maior parte do tempo) e se algum bloco aparece como "traduzido junto com".

### Limitações conhecidas desta versão

- O Google às vezes deixa uma conjunção sem traduzir no começo do bloco (por exemplo, "e identificar" em espanhol). A tradução com contexto (fase de IA) resolve.
- A voz natural depende de internet no notebook de saída. Sem internet, o Edge usa as vozes do Windows, mais robóticas.
- O reconhecimento do Chrome escuta o microfone padrão; não dá para escolher outro dentro da página.

## 1. Como funciona hoje (e por que perde)

| Etapa | O que usa hoje | Onde roda | Problema |
|---|---|---|---|
| Transcrição | Reconhecimento de voz do Chrome (Web Speech) | PC, no cockpit | Só "fecha" a frase quando o palestrante pausa. Sem pausa, o texto fica esperando 10, 20, 30 s. |
| Tradução | Endereço gratuito e não oficial do Google Tradutor | PC, no cockpit | Bloqueia com erro 429 quando há muitas chamadas. A tradução daquele trecho some. |
| Envio | Servidor MQTT público e gratuito (broker.emqx.io) | Internet | Sem garantia de entrega, cai em horário de pico e qualquer pessoa que souber o nome da sala pode escutar. |
| Voz (dublagem) | Voz do próprio navegador do espectador (`speechSynthesis`) | Celular do espectador | É uma "leitura" do texto. O sistema do celular corta a voz quando a tela apaga, a qualidade muda de aparelho para aparelho, não dá para escolher a saída de som e não dá para controlar o ritmo. |

O atraso grande que foi colocado para "dar contexto" piorou tudo. Quando a tradução corrigida chegava, o sistema tentava falar de novo o trecho corrigido (repetição) ou descartava o trecho (perda).

## 2. O que mudou no projeto

Antes: centenas de celulares na plateia, cada um com sua página.
Agora: **uma saída de áudio por idioma**, ligada a um transmissor de rádio. A plateia ouve pelo fone de rádio.

Isso elimina a necessidade de nuvem. Tudo pode rodar no mesmo PC, sem internet entre as etapas.

## 3. A nova arquitetura

```
Áudio da aula (mesa de som / VB-Cable)
        │
        ▼
┌──────────────────── PC da cabine (servidor local) ────────────────────┐
│ 1. Transcrição contínua      palavras provisórias + palavras estáveis │
│ 2. Segmentador               fecha blocos curtos sem esperar pausa    │
│ 3. Tradução com contexto     só acrescenta, nunca reescreve           │
│ 4. Voz neural em áudio       um arquivo de áudio por bloco            │
│ 5. Fila por idioma           acelera um pouco se atrasar, nunca corta │
│ 6. Saída de som por idioma   placa USB 1 → transmissor EN             │
│                              placa USB 2 → transmissor ES             │
└───────────────────────────────────────────────────────────────────────┘
        │ WebSocket local (TCP: chega tudo, na ordem)
        ▼
Cockpit no navegador do mesmo PC  +  monitor opcional em outro aparelho da rede local
```

### 3.1 Segmentador: o coração da solução

O problema de "esperar a respiração" se resolve assim:

1. **Palavra estável.** O reconhecimento manda o texto provisório várias vezes por segundo. Uma palavra é confirmada quando fica igual por cerca de 0,6 s (ou em duas atualizações seguidas). As duas últimas palavras ficam sempre de fora, porque são as que mais mudam.
2. **Fechar o bloco** (o que vier primeiro):
   - pontuação final, quando houver;
   - 14 palavras ou mais e um ponto natural de corte (vírgula, "e", "mas", "que", "porque", "então", "quando");
   - 22 palavras, no máximo absoluto;
   - 2,5 s desde a primeira palavra do bloco, com pelo menos 5 palavras;
   - fim de frase indicado pelo reconhecimento.
3. Cada bloco ganha um **número de sequência**. É assim que se prova que nada se perdeu: se o bloco 41 chegou e o 40 não, o sistema pede de novo.

### 3.2 Tradução com contexto, sem atraso

Em vez de esperar segundos para "entender o contexto", cada bloco é traduzido junto com os 2 ou 3 blocos anteriores (original e tradução), e a instrução é: "traduza só o bloco novo, continuando a frase". Um glossário médico (ureter, nervo hipogástrico, plano de clivagem, retroperitônio...) vai junto.

Regra de ouro: **o que já foi falado nunca é corrigido nem repetido.** Isso acaba com o loop de repetição.

### 3.3 Voz em áudio, não leitura no navegador

Cada bloco traduzido vira um arquivo de áudio com voz neural. Isso permite:
- escolher a placa de som de cada idioma no Chrome (`setSinkId`), sem celular no meio;
- medir exatamente quanto atraso existe na fila;
- **controle de atraso:** se a fila passar de 6 s, a voz fala 1,15x mais rápido; acima de 10 s, 1,25x. Volta ao normal quando alcança. Nada é descartado.

## 4. Motores: o que usar em cada etapa

Os motores ficam "plugáveis": dá para trocar um pelo outro numa configuração, sem reescrever o resto.

| Etapa | Recomendação | Custo estimado | Alternativa gratuita |
|---|---|---|---|
| Transcrição | Manter o Chrome na fase 1 (você disse que no cockpit ela está fiel). O segmentador resolve a espera pela pausa. | Grátis | Whisper rodando na placa de vídeo (GTX 1070 Ti), com atraso de cerca de 3 s |
| Transcrição (se o Chrome errar termos médicos) | Deepgram Nova-3 em pt-BR, com lista de termos médicos | cerca de US$ 0,30 a 0,55 por hora | — |
| Tradução | Modelo de IA (Claude Haiku) com contexto e glossário | centavos por hora | Azure Translator, 2 milhões de caracteres grátis por mês (mais de 30 horas de fala) |
| Voz | Azure Neural TTS (as mesmas vozes do edge-tts, versão oficial) | cerca de US$ 16 por milhão de caracteres, ou cerca de US$ 0,90 por hora por idioma. Tem 0,5 milhão de caracteres grátis por mês (cerca de 9 horas). | Kokoro rodando no PC (PT, EN, ES, FR, IT; alemão e árabe não confirmados) |

Por que não continuar com o edge-tts (que já está no estúdio): ele é gratuito porque usa um acesso não oficial da Microsoft, que desde dezembro de 2025 bloqueia com erro 403 quando há muitas chamadas do mesmo computador. Para o estúdio de dublagem, uma falha só atrasa o vídeo. Ao vivo, uma falha é silêncio no fone da plateia.

Estimativa para um dia de congresso de 8 horas com 2 idiomas, com tudo pago: cerca de US$ 15 a 25. Com a cota grátis do Azure, os primeiros eventos do mês saem perto de zero.

Os preços são de páginas de terceiros e comparativos de 2026; confirmar no momento de criar as contas.

## 5. Reescrever do zero: sim, mas ao lado do atual

O `index.html` atual tem mais de 9.000 linhas, e cockpit, público, OBS, painel e estúdio estão misturados. A Cabine v2 nasce numa pasta nova (`cabine/`), com servidor e telas separados. O sistema atual continua funcionando como reserva até a v2 passar num evento real.

O cockpit v2 já nasce com o visual "Sinal" mais tecnológico: medidor de atraso por idioma, fila de voz, nível de áudio de cada saída e as faixas de texto lado a lado. Por isso não vale a pena redesenhar o cockpit antigo agora.

## 6. Fases

| Fase | Entrega | Como saber que deu certo |
|---|---|---|
| 0. Decisões | Idiomas por evento, como o áudio chega aos transmissores, orçamento e chaves das contas | Lista fechada |
| 1. Servidor local | Servidor Node com WebSocket, registro numerado de cada bloco salvo em disco, reconexão automática | Desligar e religar o Wi-Fi não perde nenhum bloco |
| 2. Segmentador + tradução | Blocos curtos sem esperar pausa, tradução com contexto, sem repetição | Teste automático: 100% dos blocos do cockpit chegam na saída, na ordem |
| 3. Voz e saídas | Áudio por bloco, fila com controle de atraso, uma placa de som por idioma | Atraso entre fala e voz traduzida de 3 a 5 s, sem crescer ao longo de 1 hora |
| 4. Cockpit v2 | Tela de operação nova, com visual Sinal | Operação completa sem abrir o sistema antigo |
| 5. Teste de bancada | Reproduzir 60 min de aula gravada (por exemplo, `test_thalita.mp3`) | Relatório: atraso médio e máximo, blocos perdidos (meta zero), repetições (meta zero) |
| 6. Evento piloto | Usar a v2 com o sistema antigo pronto como reserva | Plateia ouvindo sem cortes |
| 7. Opcional | Trocar a transcrição para Deepgram se o Chrome errar termos médicos | Menos erros nos termos do glossário |

## 7. Perguntas para fechar a fase 0

1. Quantos idiomas costumam sair ao mesmo tempo num evento? (Cada um precisa de uma saída de som.)
2. Os transmissores de rádio ficam perto do PC da cabine? Se sim, bastam placas de som USB baratas, uma por idioma. Se ficam longe, usamos um segundo aparelho na rede local.
3. Posso usar serviços pagos (por volta de US$ 1 a 3 por hora de evento), ou começamos só com os gratuitos?
4. Tem um áudio de aula longa (30 a 60 min) para usarmos no teste de bancada?

## Fontes da pesquisa

- [Deepgram Nova-3: preços 2026](https://convertaudiototext.com/blog/deepgram-nova-3-explained) e [pt-BR e termos-chave](https://deepgram.com/learn/deepgram-expands-nova-3-with-10-new-languages-and-multilingual-keyterm-prompting)
- [Preços do Azure Speech](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services) e [página da China com valores](https://www.azure.cn/en-us/pricing/details/cognitive-services/)
- [Comparativo de preços de tradução de fala (Soniox)](https://soniox.com/compare/translate/pricing)
- [Azure Live Interpreter em prévia](https://tech.slator.com/microsoft-live-interpreter-api-ai-live-speech-translation/)
- [ElevenLabs Flash v2.5: latência e preço](https://invideo.io/blog/ai-voice-model-pricing/)
- [Bloqueios do edge-tts (erro 403)](https://doc.pyvideotrans.com/en/edgetts-error)
- [Kokoro: idiomas](https://pykokoro.readthedocs.io/) e [desempenho em GPU](https://localaimaster.com/blog/local-tts-api-server-kokoro-fastapi)
- [Whisper-Streaming (LocalAgreement)](https://github.com/ufal/whisper_streaming)
- [Chrome: escolher a saída de som](https://developer.chrome.com/blog/audiocontext-setsinkid)
