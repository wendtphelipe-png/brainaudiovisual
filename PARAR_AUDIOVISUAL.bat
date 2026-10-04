@echo off
chcp 65001 >nul
title Brain Audiovisual - Encerrar Servicos

echo ========================================================
echo   Encerrando servidores do Brain Audiovisual...
echo ========================================================
echo.

:: Localizar e encerrar os processos escutando nas portas 3050 e 8765
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3050, 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host 'Servicos das portas 3050 e 8765 finalizados com sucesso.'"

echo.
pause
