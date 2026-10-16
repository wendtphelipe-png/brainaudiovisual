@echo off
rem Liga o Estudio de dublagem v2 (sem janela) e abre a tela no navegador
cd /d "%~dp0"
wscript "%~dp0ligar-estudio.vbs"
timeout /t 3 /nobreak >nul
start http://127.0.0.1:3050
