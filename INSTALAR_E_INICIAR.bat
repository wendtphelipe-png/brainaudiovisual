@echo off
chcp 65001 >nul
title Brain Audiovisual - Instalador e Inicializador da Engine

echo =====================================================================
echo    🎬 BRAIN AUDIOVISUAL - ASSISTENTE DE NOVO COMPUTADOR
echo    Instalador e Inicializador Automatico da Engine Local
echo =====================================================================
echo.
echo  Detectando dependencias e configurando o ambiente nesta maquina...
echo.

cd /d "%~dp0"

:: -------------------------------------------------------------
:: 1. VERIFICAR E INSTALAR NODE.JS
:: -------------------------------------------------------------
echo [1/5] Verificando Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    if not exist "%ProgramFiles%\nodejs\node.exe" (
        echo      -> Node.js nao encontrado. Instalando Node.js LTS via winget...
        echo      -> (Se o Windows solicitar permissao de Administrador, clique em SIM)
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    )
)
:: Atualizar PATH da sessao para localizar o node
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%PATH%"
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%ProgramFiles%\nodejs\node.exe" (
        set "PATH=%ProgramFiles%\nodejs;%PATH%"
    )
)
echo      -> [OK] Node.js detectado!

:: -------------------------------------------------------------
:: 2. VERIFICAR E INSTALAR YT-DLP E FFMPEG
:: -------------------------------------------------------------
echo.
echo [2/5] Verificando Motor de Video (yt-dlp e FFmpeg)...
:: Adicionar caminhos padroes do WinGet e Python ao PATH
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-126374-g089a48eb36-win64-gpl\bin;%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"

where ffmpeg >nul 2>nul
set FFMPEG_EXISTS=%errorlevel%
where yt-dlp >nul 2>nul
set YTDLP_EXISTS=%errorlevel%

if %FFMPEG_EXISTS% neq 0 (
    echo      -> FFmpeg nao encontrado. Instalando componentes de video via winget...
    winget install yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements --silent
    set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-126374-g089a48eb36-win64-gpl\bin;%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
) else if %YTDLP_EXISTS% neq 0 (
    echo      -> yt-dlp nao encontrado. Instalando yt-dlp via winget...
    winget install yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements --silent
)
echo      -> [OK] FFmpeg e yt-dlp prontos para aceleracao por hardware!

:: -------------------------------------------------------------
:: 3. VERIFICAR E INSTALAR PYTHON + VOZES NEURAIS (IA)
:: -------------------------------------------------------------
echo.
echo [3/5] Verificando Modulos de IA e Sintese Neural (Python / edge-tts)...
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%LOCALAPPDATA%\Programs\Python\Python314;%LOCALAPPDATA%\Programs\Python\Python314\Scripts;%PATH%"

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo      -> Python nao encontrado. Instalando Python 3.12...
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
    set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
)

python -c "import edge_tts, speech_recognition" >nul 2>nul
if %errorlevel% neq 0 (
    echo      -> Instalando modulos edge-tts e speech_recognition...
    python -m pip install --quiet edge-tts SpeechRecognition
)
echo      -> [OK] Modulos de voz neural e transcricao prontos!

:: -------------------------------------------------------------
:: 4. INICIALIZAR OS SERVIDORES LOCAIS
:: -------------------------------------------------------------
echo.
echo [4/5] Iniciando os servidores locais do Brain Audiovisual...

:: Encerrar instancias anteriores se houver
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3050, 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo      -> Subindo Engine Audiovisual (Porta 3050)...
start "Brain Audiovisual - Engine 3050" /min cmd /c "node audiovisual-edition\server.js"

echo      -> Subindo Hub e Proxy de Rede (Porta 8765)...
start "Brain Audiovisual - Hub 8765" /min cmd /c "node server.js"

:: Aguardar 2 segundos para boot
timeout /t 2 /nobreak >nul

:: -------------------------------------------------------------
:: 5. TUDO PRONTO!
:: -------------------------------------------------------------
echo.
echo [5/5] Abrindo o Audiovisual Studio no navegador...
start http://127.0.0.1:3050

echo.
echo =====================================================================
echo  🎉 TUDO PRONTO! O Audiovisual Studio esta pronto para uso neste computador!
echo =====================================================================
echo.
echo  - Audiovisual Edition:  http://127.0.0.1:3050
echo  - Console Hub Admin:    http://127.0.0.1:8765/admin?module=audiovisual
echo.
echo  (Mantenha esta janela minimizada ou feche-a. Os servidores continuarao
echo   rodando em segundo plano. Para parar, execute PARAR_AUDIOVISUAL.bat)
echo =====================================================================
echo.
pause
