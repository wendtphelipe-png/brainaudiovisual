@echo off
powershell -NoProfile -Command "Import-Module AudioDeviceCmdlets; Set-AudioDevice -Index 5; Write-Host 'Microfone padrao alterado para: CABLE Output (VB-Audio Virtual Cable)' -ForegroundColor Green"
pause
