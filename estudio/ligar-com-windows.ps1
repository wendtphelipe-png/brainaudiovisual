# Faz o estúdio ligar sozinho (sem janela) quando o Windows inicia, criando um
# atalho na pasta Inicializar do usuário atual. Para desfazer, apague o atalho
# "Estudio de dublagem Brain" em:
#   shell:startup  (cole isso na barra do Explorer)
# Uso: powershell -ExecutionPolicy Bypass -File estudio\ligar-com-windows.ps1
$vbs = Join-Path $PSScriptRoot 'ligar-estudio.vbs'
$pasta = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $pasta 'Estudio de dublagem Brain.lnk'
$sh = New-Object -ComObject WScript.Shell
$a = $sh.CreateShortcut($lnk)
$a.TargetPath = "$env:WINDIR\System32\wscript.exe"
$a.Arguments = "`"$vbs`""
$a.WorkingDirectory = Split-Path $PSScriptRoot -Parent
$a.Description = 'Liga o Estudio de dublagem v2 da Brain Audiovisual'
$a.Save()
Write-Output "Atalho criado: $lnk"
