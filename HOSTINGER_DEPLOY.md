# 🚀 Guia de Implantação na Hostinger — Brain Audiovisual

Este documento detalha o procedimento padrão para colocar o **Brain Audiovisual** no ar na **Hostinger** (hPanel / VPS / Cloud).

---

## 📁 Estrutura de Arquivos Criada para a Hostinger

Dentro de `frontend/public/` (e copiado para `dist/` no build):
1. **`.htaccess`**:
   - Redirecionamento forçado para HTTPS (SSL).
   - Roteamento SPA (Single Page Application) para que rotas e links diretos funcionem sem erro 404.
   - Compressão Gzip/Deflate para carregamento ultra-rápido.
   - Cache de navegador configurado para assets (`.js`, `.css`, imagens e fontes).
   - Cabeçalhos de segurança (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
2. **`robots.txt`**:
   - Regras de rastreamento para o Google e apontamento para o `sitemap.xml`.
3. **`sitemap.xml`**:
   - Mapa de URLs para indexação nos motores de busca.
4. **`404.html`**:
   - Página de erro 404 estilizada com a identidade visual da Brain Audiovisual.
5. **`construction.html`**:
   - Versão estática autônoma e leve da página "Estamos em Construção".

---

## 🌐 Opções de Implantação na Hostinger

### Opção 1: Deploy Automático via Git na Hostinger (Recomendado para hPanel)
1. No painel da Hostinger (**hPanel**), acesse **Avançado** ➔ **Git**.
2. Cole a URL do repositório:
   ```text
   https://github.com/wendtphelipe-png/brainaudiovisual.git
   ```
3. Defina o branch como `main`.
4. Clique em **Criar**. A Hostinger clonará o repositório automaticamente e você poderá acionar o botão de **Auto Deployment** para novos commits.

---

### Opção 2: Publicação Estática Direta no `public_html` (Imediato)
Se você deseja colocar a página "Estamos em Construção" no ar imediatamente sem compilar Node.js no servidor:
1. Abra o **Gerenciador de Arquivos** no hPanel da Hostinger.
2. Acesse a pasta `public_html/`.
3. Suba os arquivos da pasta `frontend/public/`:
   - Copie `construction.html` renomeando para `index.html` (ou use o `.htaccess` já preparado).
   - `.htaccess`
   - `robots.txt`
   - `sitemap.xml`
   - `404.html`
   - `favicon.svg`

---

### Opção 3: Build Completo do Frontend (React + Vite + WebRTC)
Para subir o WebApp completo com todas as telas interativas:
1. Execute o build no seu terminal local:
   ```bash
   cd frontend
   npm run build
   ```
2. O Vite gerará a pasta `frontend/dist/`.
3. Envie o conteúdo interno de `frontend/dist/` diretamente para o `public_html/` do seu domínio na Hostinger (via Gerenciador de Arquivos ou FTP/FileZilla).

---

### Opção 4: Backend e Robô Tradutor (Hostinger VPS / Cloud)
Como o backend do projeto utiliza **Playwright / Chromium** para entrar em reuniões do Google Meet e capturar o áudio traduzido, ele requer um ambiente com suporte a processos contínuos (VPS Hostinger ou Cloud Server):
1. No VPS Ubuntu/Debian da Hostinger:
   ```bash
   git clone https://github.com/wendtphelipe-png/brainaudiovisual.git
   cd brainaudiovisual/backend
   npm install
   npx playwright install --with-deps chromium
   npm run build
   pm2 start dist/index.js --name "brainaudiovisual-backend"
   ```
2. Configure as variáveis de ambiente (`.env`) com as credenciais do LiveKit e OAuth2 do Google.
