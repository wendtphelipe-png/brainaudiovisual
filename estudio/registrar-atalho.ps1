# Registra o atalho brain-estudio:// no usuário atual do Windows (sem precisar
# de administrador). Com ele, o botão "Abrir estúdio" do Hub consegue ligar o
# estúdio neste PC. Para desfazer:
#   Remove-Item -Recurse HKCU:\Software\Classes\brain-estudio
# Uso: powershell -ExecutionPolicy Bypass -File estudio\registrar-atalho.ps1
$vbs = Join-Path $PSScriptRoot 'ligar-estudio.vbs'
$base = 'HKCU:\Software\Classes\brain-estudio'
New-Item -Path "$base\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $base -Name '(Default)' -Value 'URL:Estudio de dublagem Brain'
Set-ItemProperty -Path $base -Name 'URL Protocol' -Value ''
Set-ItemProperty -Path "$base\shell\open\command" -Name '(Default)' -Value "wscript.exe `"$vbs`""
Write-Output "Atalho brain-estudio:// registrado para $vbs"
