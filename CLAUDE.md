# Brain Audiovisual: contexto para o Claude

Leia antes de qualquer tarefa. Atualizado em 28/10/2026.

## Quem e como falar
- Quem pede é o **Phelipe**, que não é programador. Responda em **português, com linguagem simples**, explicando o que mudou e o que ele precisa fazer.
- A **Brain Audiovisual** (BR.AIN) transmite cirurgias ao vivo e eventos médicos desde 2003. O contato comercial é o Thiago Magalhães Bramante.
- **Sem emojis.** Ícones são SVG no estilo Lucide.
- O design deve ser premium e não pode parecer template. Use o azul Brain `#3FA9F5`, o fundo azul-noite e a fonte Archivo. O âmbar `#FFB224` é só para tradução e dublagem ("no ar"). O logo é o **original** (o "B" de circuito, em degradê `#46C3EE` → `#3576C2`); o Thiago não quis trocar.
- Motores **gratuitos primeiro**; os pagos ficam para depois e só com a aprovação dele.

## Regras de segurança (sempre)
- **Nunca** ler, mostrar ou enviar ao git: `credentials.json`, `token.json`, `estudio/dados/` (token do Vimeo, cookies, fila) e `cabine/data/`.
- Nunca digitar senhas ou tokens. Logins são sempre feitos pelo Phelipe.
- Pergunte antes de ações destrutivas: apagar, `reset --hard`, mexer na VPS, apagar vídeos.
- Enviar para a `main` é permitido. **Toda mudança enviada vai para o ar sozinha** (veja "Publicação").
- Os commits terminam com a linha `Co-Authored-By` que o próprio Claude Code indicar.

## O que existe no repositório

| Pasta ou arquivo | O que é | Onde roda |
|---|---|---|
| `index.html` | Site público (PT/EN/ES), Área da equipe (login) e Hub. Arquivo único, grande | Hostinger (brainaudiovisual.com.br) |
| `cabine/` | **Cabine v2**: tradução simultânea ao vivo (cockpit, saídas por idioma, telão) | VPS (cabine.brainaudiovisual.com.br) |
| `estudio/` | **Estúdio de dublagem v2**: fila de vídeos → áudio dublado + legendas | **Só no PC do Phelipe** (precisa da placa de vídeo) |
| `design/` | Gerador do logo (`gerar-logo.js`) e os arquivos do logo | – |
| `deploy/vps/` | Instalação e atualização da cabine na VPS | VPS |
| `docs/` | Planos: `PLANO-TRADUCAO-AO-VIVO.md` e `PLANO-ESTUDIO-V2.md` | – |
| `site/img/` | Fotos do site | Hostinger |
| `audiovisual-edition/` | Estúdio **antigo**, guardado só como reserva. Não usar | – |
| `frontend/`, `backend/`, `server.js`, `*.php`, `backups/` | Sistema antigo (Antigravity). Não mexer sem pedido | – |

### Cabine v2 (`cabine/`)
- Servidor Node (porta 8790) com WebSocket (`ws`). Salas têm código e token. Os papéis são `cockpit` (operador), `monitor` (cockpit só de leitura, sem token), `saida` (um notebook por idioma, voz do Microsoft Edge) e `telao`.
- Arquivos principais: `server.js` (salas, rotas, `/saude`), `segmenter.js` (fecha frases estáveis), `translate.js` (Google gratuito, troca de endereço quando um falha e confere o idioma), `public/` (cockpit, saida, telao, inicio).
- Testes: `cd cabine && npm test`. Teste ponta a ponta: `npm run simular`.
- Preferências de tela já pedidas:
  - nada de tempos ou números de bloco à mostra (ficam em "Detalhes");
  - frases grandes;
  - o mais novo embaixo;
  - telão com uma linha por idioma e texto corrido.

### Estúdio v2 (`estudio/`)
- `motor.js` faz o caminho inteiro:
  1. baixa o vídeo (yt-dlp, ou a API do Vimeo com token);
  2. transcreve com o **Whisper** (`transcrever.py`, faster-whisper large-v3-turbo na GTX 1070 Ti, int8), detectando o idioma sozinho;
  3. monta frases e legendas;
  4. traduz com o `../cabine/translate.js`;
  5. dubla com as vozes do Edge (`vozes.py`, edge-tts), com voz masculina ou feminina conforme a altura da voz original, ou com a voz clonada de quem fala (veja abaixo);
  6. encaixa cada fala no tempo original.
- **Saída por vídeo:** `PT/EN/ES.mp3` e `PT/EN/ES.vtt`. O idioma original usa o próprio áudio do vídeo. Tudo vai para `G:\Meu Drive\BR.AIN Dublagens\<título>\`.
- `server.js`: fila com 1 a 3 vídeos ao mesmo tempo (a placa transcreve um por vez), monitor do PC, árvore de pastas do Vimeo, histórico de processados e tela em `public/index.html`. Abre em http://127.0.0.1:3050.
- `trabalho.js`: um processo por vídeo, que permite cancelar.
- Para ligar:
  - O estúdio **liga sozinho com o Windows**. O atalho na pasta Inicializar é criado por `estudio\ligar-com-windows.ps1` e roda `ligar-estudio.vbs` sem janela.
  - O botão "Abrir estúdio" do Hub só abre http://127.0.0.1:3050.
  - Se precisar ligar à mão: dois cliques em `estudio\INICIAR-ESTUDIO.bat`.
  - O registro do servidor fica em `estudio\dados\servidor.log`.
  - O atalho `brain-estudio://` (`registrar-atalho.ps1`) continua registrado, mas o Chrome não o chamou nos testes, então o Hub não depende dele. O ambiente Python fica em `D:\Projetos\estudio-py` e os modelos em `D:\Projetos\estudio-modelos`, ambos fora do repositório.
- **Voz clonada** (opção "Voz do próprio professor" na tela, `vozes: 'clonada'`; na linha de comando, `--clonada`):
  - `voz_clonada.py` roda no ambiente `D:\Projetos\estudio-voz-py` (torch 2.7 cu128, o último que suporta a GTX 1070 Ti/sm_61). Os modelos ficam em `D:\Projetos\estudio-modelos` (`hub/` com o MOSS, `MOSS-TTS-Nano/` com o código, `spkrec-ecapa/`).
  - `falantes`: mede a voz de cada frase (ECAPA, SpeechBrain), agrupa por pessoa e recorta de 8 a 12 s de referência de cada uma.
  - `gerar`: dubla com a voz da pessoa (**MOSS-TTS-Nano**, Apache-2.0, na placa em float16), **em lotes de até 8 frases da mesma pessoa** (até 900 caracteres por lote, decodificando uma frase por vez; lote maior estourou a memória da placa). Encurta as pausas internas para 0,3 s (sem isso a dublagem atrasava). Uma aula sai em ~1× a duração do vídeo (12 min → 13–16 min; 27 min → 29 min).
  - Se o gerador cair (falta de RAM no PC, que tem 16 GB e o Chrome ocupa ~6 GB), o `motor.js` religa até 3 vezes com as falas que faltam. A fala que falhar mesmo assim sai com a voz do Edge, sem parar a fila. Se o ambiente faltar, o vídeo inteiro sai com o Edge.
  - Motores avaliados e descartados em 28/10/2026: VoxCPM2 (não cabe na placa de 8 GB nem na RAM), OmniVoice (licença não comercial), PocketTTS (pesos com acesso restrito no Hugging Face).
  - Clonar a voz de um professor exige autorização por escrito dele.
- **Envio ao Vimeo e conferência** (desde 28/10/2026):
  - Quando um vídeo do Vimeo fica pronto, o `server.js` envia as legendas `PT/EN/ES.vtt` ao vídeo original, uma por vez (API texttracks, `vimeo.enviarLegenda`). Cada legenda fica ativa; depois o estúdio baixa de volta e confere o número de falas.
  - Registro em `estudio/dados/vimeo-envios.json` (o id da faixa que o estúdio criou; ao reenviar, só essa faixa é apagada e trocada).
  - Aba **Conferência** da tela: uma linha por aula da pasta de saída atual, com arquivos no Drive, legendas no Vimeo e áudio no Vimeo. Botões "Enviar pendentes" e "Conferir no Vimeo".
  - Depois de enviar, o estúdio desliga (não apaga) a legenda automática (IA) do Vimeo no idioma original (`*-x-autogen`).
  - **Áudios por idioma no Vimeo (teste de 28/10/2026, ainda sem solução):**
    - A rota é `/videos/{id}/versions/{versão}/audiotracks`. O token do estúdio só lê; para criar, é preciso o login do site (JWT de `vimeo.com/_next/jwt`).
    - Corpo usado: `{language_code, type: 'main', name, upload: {approach: 'gcs', size, mime_type}}`. Depois vem o PUT no link do GCS e o `POST /videos/{id}/upload_attempts/{gcs_uid}/complete`.
    - Tudo respondeu OK, mas a faixa ficou "in_progress" para sempre.
    - No site (no navegador do app e no Chrome do Phelipe), o painel faz `GET vimeo.com/api/v3/videos/{id}/versions/1182147807/audiotracks` (200), mas o envio vai para `POST vimeo.com/videos/{id}/versions/1182147807/audiotracks`, **sem o `/api/v3`**, e recebe 404. É defeito do site do Vimeo: o endereço é montado com `new URL("/videos/...", "https://vimeo.com/api/v3")`, que perde o `/api/v3`. Chamado no suporte: #28907962 (28/10/2026).
    - Corrigindo o endereço na página (trocando `window.URL`), o próprio site cria a faixa e envia o arquivo, mas ela fica "in_progress" do mesmo jeito: o processamento também está quebrado do lado do Vimeo.
    - A versão 1182147807 que o site usa não existe para a API (que diz que a atual é 1240112991).
    - As faixas de teste foram apagadas. O próximo passo é levar ao suporte do Vimeo, ou testar em outra aula.
  - Em 28/10/2026 as 108 aulas do histórico foram refeitas com a voz clonada, 1 por vez, em `G:\Meu Drive\BR.AIN Dublagens - Voz clonada`.
- **O disco D: (HD antigo) está com setores defeituosos** (28/10/2026). O estúdio, os ambientes Python e os modelos estão nele. A saída vai para o Drive, então o resultado de cada aula fica seguro.
- **Na nuvem o estúdio não roda** (não tem placa de vídeo, Drive G: nem token). Lá dá para editar o código; para testar, peça ao Phelipe que rode no PC.
- **Reiniciar o estúdio derruba os vídeos em andamento**, que recomeçam do zero. Só reinicie com a fila parada ou com o aviso dele.

## Publicação (automática)
- **Site:** a Hostinger puxa a `main` sozinha (Auto Deployment do hPanel) em uns 20 segundos. O `index.html` tem um marcador `<!-- versao: ... -->`.
- **Cabine:** o GitHub Actions ("Deploy", `.github/workflows/deploy.yml`) roda **só quando muda** `cabine/**`, `deploy/vps/**` ou o próprio workflow.
  - Ele usa uma chave restrita que só executa `/usr/local/bin/brain-cabine-atualizar` na VPS (Ubuntu, Caddy, serviço systemd `brain-cabine`, dados em `/var/lib/brain-cabine`).
  - **Proteção de evento ao vivo:** se houver gente conectada (`/saude` informa as conexões), a atualização é recusada. Nunca force sem o Phelipe confirmar que não há evento.
  - Para conferir: `gh run list --workflow Deploy` e `curl https://cabine.brainaudiovisual.com.br/saude`.
- Repositório: `github.com/wendtphelipe-png/brainaudiovisual`.

## Pendências e ideias combinadas
- Estúdio:
  - automatizar o envio dos áudios EN/ES ao Vimeo pelo site (sem API pública);
  - depois, o mesmo para o YouTube;
  - Vimeo com o inglês como áudio padrão: não há opção documentada. A ideia é gerar o vídeo com o inglês como áudio principal e usar "Substituir vídeo", com o português como faixa extra. Testar antes em UMA aula (legendas e faixas continuam?);
  - não usar a voz clonada na cabine ao vivo (aumenta o atraso). Para o atraso da cabine, o caminho é ajustar `cabine/segmenter.js`.
- Motores pagos, quando houver verba:
  - reconhecimento de fala com detecção de idioma: Soniox (~US$0,12/h + US$0,06/h por idioma) ou Deepgram Nova-3;
  - voz Azure (~US$0,90/h por idioma).
- Bugs conhecidos do sistema antigo: o overlay mostra o erro `currentAudienceLang is not defined`, e a senha da Área da equipe é conferida só no navegador (proteção fraca).
