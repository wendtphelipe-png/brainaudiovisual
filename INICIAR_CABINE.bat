@echo off
chcp 65001 >nul
title Cabine v2 - Brain Audiovisual
cd /d "%~dp0cabine"
if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install --omit=dev
)
echo.
echo Abrindo o cockpit no Chrome. Deixe esta janela aberta durante o evento.
start "" chrome "http://localhost:8790/"
node server.js
pause
