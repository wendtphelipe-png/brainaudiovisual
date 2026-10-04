@echo off
chcp 65001 >nul
title Brain Audiovisual - Inicializador Local

echo ========================================================
echo   BRAIN AUDIOVISUAL - AUDIOVISUAL STUDIO ^& HUB
echo ========================================================
echo.

:: Garantir que Node.js, Python e ferramentas estejam no PATH desta sessao
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\Python\Python314;%LOCALAPPDATA%\Programs\Python\Python314\Scripts;%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%LOCALAPPDATA%\Programs\Python\Python313;%LOCALAPPDATA%\Programs\Python\Python313\Scripts;%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-N-126374-g089a48eb36-win64-gpl\bin;%LOCALAPPDATA%\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"

cd /d "%~dp0"

echo [1/3] Limpando portas locais 3050 e 8765 se estiverem ocupadas...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3050, 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo [2/3] Iniciando Audiovisual Edition Engine (Porta 3050)...
start "Brain Audiovisual - Engine 3050" /min /d "%~dp0" cmd /c "node audiovisual-edition\server.js"

echo [3/3] Iniciando BrainLingo Hub / Proxy (Porta 8765)...
start "Brain Audiovisual - Hub 8765" /min /d "%~dp0" cmd /c "node server.js"

:: Aguardar inicializacao dos servicos
ping 127.0.0.1 -n 3 >nul

echo Abrindo o Audiovisual Studio no navegador...
start http://127.0.0.1:3050

echo.
echo ========================================================
echo  Servidores ativos em segundo plano!
echo   - AudioVisual Edition: http://127.0.0.1:3050
echo   - Console / Hub Local: http://127.0.0.1:8765/admin?module=audiovisual
echo ========================================================
echo  Para encerrar os servidores, execute PARAR_AUDIOVISUAL.bat
echo.
pause
