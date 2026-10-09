# Cria os atalhos "BrainLingo - Começar" e "BrainLingo - Terminar" na Área de Trabalho e no Menu Iniciar.
# Rode uma vez em cada computador, depois de clonar o projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\criar-atalhos.ps1

$shell = New-Object -ComObject WScript.Shell
$destinos = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
$atalhos = @(
    @{ Nome = 'BrainLingo - Começar';  Script = 'comecar-trabalho.ps1';  Icone = 'shell32.dll,122' },
    @{ Nome = 'BrainLingo - Terminar'; Script = 'terminar-trabalho.ps1'; Icone = 'shell32.dll,258' }
)

foreach ($pasta in $destinos) {
    foreach ($a in $atalhos) {
        $lnk = $shell.CreateShortcut((Join-Path $pasta "$($a.Nome).lnk"))
        $lnk.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot $a.Script)`""
        $lnk.WorkingDirectory = Split-Path -Parent $PSScriptRoot
        $lnk.IconLocation = "$env:SystemRoot\System32\$($a.Icone)"
        $lnk.Save()
    }
    Write-Host "Atalhos criados em: $pasta"
}
