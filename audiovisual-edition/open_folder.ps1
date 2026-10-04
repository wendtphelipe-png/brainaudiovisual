param(
    [string]$FolderPath = ""
)

if (-not $FolderPath -or -not (Test-Path $FolderPath)) {
    $FolderPath = Join-Path $env:USERPROFILE "Downloads\BrainAudiovisual_Saida"
    if (-not (Test-Path $FolderPath)) {
        New-Item -ItemType Directory -Path $FolderPath -Force | Out-Null
    }
}

try {
    $shell = New-Object -ComObject Shell.Application
    $shell.Explore($FolderPath)
    Write-Output "EXPLORER_OPENED_VIA_SHELL_COM"
} catch {
    try {
        Invoke-Item $FolderPath
        Write-Output "EXPLORER_OPENED_VIA_INVOKE_ITEM"
    } catch {
        Start-Process explorer.exe -ArgumentList "`"$FolderPath`""
        Write-Output "EXPLORER_OPENED_VIA_START_PROCESS"
    }
}
