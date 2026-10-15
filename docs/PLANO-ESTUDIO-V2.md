# Plano: Estúdio de dublagem v2

Escrito em 15/10/2026. Objetivo: colocar vídeos numa fila (arquivo local, YouTube ou Vimeo, inclusive privados e playlists inteiras) e, para cada um, receber **6 arquivos**: áudio dublado e legenda `.vtt` em **português, inglês e espanhol**, sincronizados com a fala original, salvos numa pasta com o nome do vídeo, de preferência no Google Drive.

## 1. O que o Phelipe precisa (premissas)

| Item | Detalhe |
|---|---|
| Entrada | Arquivo local, link do YouTube ou do Vimeo, playlists inteiras e vídeos privados |
| Fila | Os vídeos esperam numa fila; 1, 2 ou 3 processando ao mesmo tempo, com monitor de uso do PC |
| Idioma de entrada | Detectado sozinho em cada vídeo (uma playlist pode misturar aulas em idiomas diferentes) |
| Saída | 3 áudios (PT, EN, ES) + 3 legendas `.vtt` (PT, EN, ES), sincronizados com o original |
| Destino | Pasta com o nome do vídeo, no Google Drive (para outras pessoas acessarem) ou numa pasta local |
| Depois | Automação para subir os áudios e as legendas no vídeo original do YouTube ou do Vimeo |

## 2. O estúdio atual: o que serve e o que não serve

O estúdio atual (`audiovisual-edition/`, 2.000 linhas num arquivo só) já faz o caminho completo, mas as partes mais importantes estão frágeis:

| Parte | Hoje | Avaliação |
|---|---|---|
| Baixar do YouTube/Vimeo, cookies, playlists | yt-dlp, com tratamento de vídeo privado e não listado | **Aproveitar** |
| Fila, pasta de destino, monitor de CPU/GPU/RAM | Funciona, salva o estado em disco | **Aproveitar a ideia**, reescrever mais simples |
| Divisão do áudio | Corta nos silêncios (pausas de 0,55 s) | Trocar: o Whisper já devolve frases com tempo exato |
| Transcrição | Reconhecimento gratuito do Google, trecho por trecho, sem contexto | **Trocar** pelo Whisper na placa de vídeo |
| Idioma de entrada | Escolhido à mão (tem um teste rudimentar) | **Trocar**: o Whisper detecta sozinho |
| Tradução | Endereço do Google bloqueado (429); quando falha, devolve o texto em português **sem avisar** | **Trocar** pelo tradutor da Cabine v2 (3 endereços, conferência de idioma) |
| Voz | edge-tts, com encaixe no tempo (acelera ou completa com silêncio) | **Aproveitar a lógica**, com novas tentativas e aviso de falha |
| Saída | MP3 + `.vtt` + `.srt` + `.zip` numa pasta escolhida | Ajustar para os 6 arquivos e a pasta do Drive |

**Recomendação: reescrever o núcleo (Estúdio v2), aproveitando os trechos que já funcionam**, do mesmo jeito que foi feito com a Cabine v2. O estúdio atual continua como reserva até a v2 ser aprovada.

## 3. Como o Estúdio v2 funciona

```
Fila (links, playlists, arquivos)
   │
   ├─ 1. Baixar ........... yt-dlp (privados: cookies do navegador logado)
   ├─ 2. Áudio ............ FFmpeg extrai o áudio em 16 kHz para a transcrição
   ├─ 3. Transcrever ...... Whisper na GTX 1070 Ti: detecta o idioma e devolve
   │                        frases com início e fim exatos e pontuação
   ├─ 4. Legenda original . .vtt no idioma detectado (linhas de até 42 caracteres)
   ├─ 5. Traduzir ......... frase inteira (com contexto), depois redistribuída
   │                        nos mesmos tempos das legendas originais
   ├─ 6. Dublar ........... voz neural por frase, encaixada no tempo de cada fala
   │                        (acelera até 1,25x se precisar; nunca invade a próxima)
   ├─ 7. Montar ........... uma faixa contínua por idioma, do tamanho do vídeo
   └─ 8. Entregar ......... G:\Meu Drive\<pasta>\<nome do vídeo>\
                              PT.mp3  EN.mp3  ES.mp3  PT.vtt  EN.vtt  ES.vtt
```

### 3.1 Detecção automática do idioma
O Whisper ouve o começo de cada vídeo e informa o idioma (português, inglês, espanhol e mais de 90 outros). Cada vídeo da fila pode ser de um idioma diferente. Se a certeza for baixa, o vídeo fica marcado para conferência, em vez de seguir com o idioma errado.

### 3.2 Por que o Whisper (e não o reconhecimento atual)
- Entende a frase inteira com contexto: erra muito menos termos médicos.
- Devolve tempo de início e fim de cada frase, e até de cada palavra, o que dá legendas precisas.
- Detecta o idioma sozinho.
- Roda na placa de vídeo do PC, **sem custo por minuto**. Estimativa: uma aula de 1 hora transcrita em cerca de 10 a 15 minutos na GTX 1070 Ti (a medir no teste).

### 3.3 O arquivo no idioma original
Se a aula é em português, o "PT.mp3" é o **próprio áudio original**, extraído do vídeo, e o "PT.vtt" é a transcrição. Os outros dois idiomas são dublados. Assim sempre saem os 6 arquivos, com nomes iguais em todas as pastas.

### 3.4 Vídeos privados
- **Vimeo não listado:** basta o link completo (com o código depois da barra).
- **Vimeo e YouTube privados ou com login:** o yt-dlp usa os cookies do navegador onde a conta está logada. O caminho mais confiável é o **Firefox**: o Chrome e o Edge passaram a criptografar os cookies de um jeito que o yt-dlp nem sempre consegue ler. A alternativa é colar um arquivo de cookies exportado (o estúdio atual já aceita).

### 3.5 Google Drive
O PC já tem o **Google Drive para computador** (unidade `G:`). O estúdio salva direto numa pasta compartilhada dentro de `G:\Meu Drive\`, e o próprio Drive sincroniza e libera o acesso para a equipe. Não precisa de login nem de chave de API.

### 3.6 Fila, simultâneos e monitor
- Escolha de 1, 2 ou 3 vídeos ao mesmo tempo, com o monitor de CPU, GPU e RAM.
- A transcrição usa a placa de vídeo um vídeo por vez (é a etapa mais pesada). Enquanto isso, os outros vídeos baixam, traduzem e dublam. Assim os 3 simultâneos aproveitam o PC sem travar a placa.
- A fila fica salva em disco: se o PC reiniciar, continua de onde parou.
- Cada vídeo mostra a etapa atual, o idioma detectado e, se falhar, o motivo em português e um botão para tentar de novo.

## 4. Onde roda
No **PC com a placa de vídeo** (o mesmo do estúdio atual). A VPS não tem placa de vídeo, e o Whisper lá levaria várias vezes mais tempo. A tela pode ser aberta pela Área da equipe nesse PC, como hoje.

## 5. Fases

| Fase | Entrega | Como saber que deu certo |
|---|---|---|
| 0. Decisões | Pasta do Drive, formato do áudio, voz padrão | Lista fechada (seção 6) |
| 1. Motor | Fila, download (inclusive privado), Whisper com detecção de idioma, tradução, voz e montagem, salvando os 6 arquivos | Uma aula real de 20 a 60 min com os 6 arquivos certos |
| 2. Tela | Nova tela do estúdio no visual da marca: fila, etapas, idioma detectado, monitor, 1 a 3 simultâneos, playlists | Operar a fila inteira sem abrir o terminal |
| 3. Teste de bancada | 3 aulas em idiomas diferentes numa mesma playlist | Idioma certo em todas, legendas alinhadas, áudio sem cortes |
| 4. Depois | Envio automático ao YouTube e ao Vimeo; motores pagos opcionais (voz Azure, tradução com IA) | Arquivos aparecendo no vídeo original sem trabalho manual |

## 6. Perguntas para fechar a fase 0

1. **Pasta no Drive:** onde salvar? Sugestão: `G:\Meu Drive\BR.AIN Dublagens\`, compartilhada com a equipe.
2. **Formato do áudio:** MP3 serve? (O YouTube aceita MP3 e WAV nas faixas de áudio; o Vimeo aceita MP3 e AAC.)
3. **Voz padrão:** feminina ou masculina? Ou escolher por vídeo?
4. **Idioma original:** confirma que o áudio no idioma da aula é o próprio original (seção 3.3)?
5. **Vídeos privados:** a conta com acesso aos vídeos privados fica logada em qual navegador do PC? (O Firefox é o mais garantido.)
6. **Uma aula de teste:** um link do Vimeo ou do YouTube para usarmos na fase 1.
