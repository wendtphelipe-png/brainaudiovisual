Aqui está o escopo técnico e o script de briefing estruturado para o **Antigravity** (sua estrutura de agentes de IA). Este documento foi desenhado para modelar os agentes, prever os gargalos técnicos reais da sua solução atual e ditar as regras de desenvolvimento para criar um sistema estável de tradução em tempo real com distribuição de ultra-baixa latência.

---

# Script de Briefing: Projeto LiveTranslate API & WebRTC

## 1. Perfil e Arquitetura dos Agentes (Antigravity Team)

Para executar este projeto com sucesso, o Antigravity deve instanciar três perfis de agentes especializados:

### 🤖 Agente 1: Arquiteto de Integrações & Automação (Lead)

* **Foco:** Gerenciamento de ciclo de vida de sessões, APIs do Google Workspace, OAuth2 e persistência de conexões.
* **Missão:** Resolver a queda de 1h30 da reunião do Google Meet através de renovação automatizada de tokens/credenciais e criar o mecanismo de contingência (*failover*) invisível.

### 🤖 Agente 2: Engenheiro de Infraestrutura de Áudio & Streaming

* **Foco:** Captura de áudio de baixo nível, codificação, protocolos de streaming e servidores Cloud.
* **Missão:** Extrair o áudio traduzido da conta receptora do Meet e transmiti-lo para um servidor de distribuição de ultra-baixa latência (WebRTC), eliminando a necessidade do Zoom.

### 🤖 Agente 3: Desenvolvedor Web & UX (Frontend)

* **Foco:** Criação de interfaces web leves, performance mobile e consumo de streams WebRTC.
* **Missão:** Desenvolver a página receptora acessada por QR Code, garantindo que o aluno clique em "Ouvir" e receba o áudio instantaneamente, sem baixar aplicativos e com consumo otimizado de bateria/dados.

---

## 2. Regras de Desenvolvimento (Rules)

* **Regra 01 (Latência Máxima):** O atraso (delay) entre a fala traduzida capturada no Meet e o ouvido do aluno na plateia não pode ultrapassar **800ms**. Protocolos baseados em HTTP (HLS/DASH) estão terminantemente proibidos. O padrão obrigatório é **WebRTC**.
* **Regra 02 (Zero Atrito para o Usuário):** A plateia não deve instalar nada. O fluxo deve ser estritamente: *Escanear QR Code ➔ Abrir WebApp ➔ Clicar em Play*.
* **Regra 03 (Persistência de Sessão):** O sistema de renovação de credenciais deve ser preditivo. A atualização de tokens ou a troca de salas (se necessária) deve ocorrer em background, usando buffers ou canais paralelos para que a plateia não perceba nenhum corte abrupto.
* **Regra 04 (Design Clean & Mobile-First):** A interface do aluno deve ser minimalista: um botão de Play/Pause, um seletor de volume e um indicador de status de conexão ("Ao Vivo" / "Conectando").

---

## 3. Impedimentos Técnicos & Diagnósticos Preliminares (Impediments)

O Antigravity deve iniciar o projeto ciente e focado em resolver os seguintes obstáculos:

> ⚠️ **O Gargalo dos 90 Minutos (Google Meet):**
> Contas premium do Google Meet em uso normal duram até 24h. Se a sua automação cai em exatamente ~1h30 (90 minutos), o impedimento real **não é o limite do Meet**, mas sim a **expiração do Token de Acesso OAuth2** (que dura entre 60 e 90 minutos) ou o timeout de uma sessão headless (Puppeteer/Playwright) por vazamento de memória. Os agentes devem focar na implementação correta do `refresh_token` no backend ou na reciclagem programada da instância do navegador de captura.

> ⚠️ **O Problema do Zoom como Distribuidor:**
> Utilizar o Zoom como input de áudio para a plateia adiciona uma camada pesada de processamento, compressão proprietária e latência variável (frequentemente > 2 segundos), além de forçar parte da plateia a baixar o app do Zoom para uma melhor experiência. **Substituir o Zoom é prioritário.**

---

## 4. Instruções Iniciais para Execução (Step-by-Step)

O Antigravity deve iniciar o desenvolvimento seguindo estritamente os passos abaixo:

### Fase 1: Estabilização do Input (Google Meet API & Sessão)

1. **Mecanismo de Auth:** Configurar o fluxo de autenticação do Google via API utilizando uma conta de serviço (*Service Account*) ou garantir que o backend implemente a rota de renovação automática usando o `refresh_token` antes que o `access_token` de 3600 segundos expire.
2. **Abordagem Headless (Se aplicável):** Se a extração do áudio traduzido do Meet é feita via automação de navegador (ex: robô que entra na chamada e captura o áudio da tab), configurar uma rota de *hot-swap*. Criar uma segunda instância invisível 5 minutos antes do limite, conectá-la à mesma chamada, e alternar o feed de áudio antes de derrubar a instância antiga.

### Fase 2: Extração e Pipeline de Áudio

1. Capturar o dispositivo de áudio de saída (output) do Meet receptor.
2. Canalizar esse áudio (input) para um codificador leve (como Opus, ideal para voz e WebRTC).
3. Em vez de injetar no Zoom, direcionar esse stream de áudio para um servidor de mídia WebRTC de código aberto (sugestões para a infraestrutura: **LiveKit**, **Mediasoup** ou **Agora.io SDK**), que gerenciam milhares de conexões simultâneas com latência sub-segundo.

### Fase 3: Distribuição (Web App da Plateia)

1. Desenvolver uma Single Page Application (SPA) ultra-leve em HTML/JS nativo ou React/Vue, hospedada em servidores Cloud de alta performance (borda/Edge).
2. Implementar o player WebRTC que se conecta diretamente ao servidor de mídia definido na Fase 2.
3. Gerar o QR Code dinâmico que aponta para esta URL com os parâmetros da sala/evento (ex: `[seusite.com/live?room=evento-01](https://seusite.com/live?room=evento-01)`).
