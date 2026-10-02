@echo off
powershell -NoProfile -Command "Import-Module AudioDeviceCmdlets; Set-AudioDevice -Index 6; Write-Host 'Microfone padrao restaurado para: Microphone (High Definition Audio Device)' -ForegroundColor Green"
pause
