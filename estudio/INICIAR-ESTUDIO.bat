@echo off
rem Liga o Estudio de dublagem v2 e abre a tela no navegador
cd /d "%~dp0.."
start "Estudio de dublagem" /min cmd /c "node estudio\server.js"
timeout /t 2 /nobreak >nul
start http://127.0.0.1:3050
