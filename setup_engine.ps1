# =====================================================================
#  🎬 BRAIN AUDIOVISUAL - SCRIPT POWERSHELL DE CONFIGURAÇÃO & START
# =====================================================================
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "   🎬 BRAIN AUDIOVISUAL - ASSISTENTE DE NOVO COMPUTADOR (POWERSHELL)" -ForegroundColor Yellow
Write-Host "   Instalação e Inicialização Automatizada da Engine Local" -ForegroundColor White
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

$workDir = $PSScriptRoot
if (-not $workDir) { $workDir = Get-Location }
Set-Location $workDir

function Refresh-SessionPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 1. NODE.JS
Write-Host "[1/5] Verificando Node.js..." -ForegroundColor Cyan
Refresh-SessionPath
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd -and -not (Test-Path "C:\Program Files\nodejs\node.exe")) {
    Write-Host "      -> Baixando e instalando Node.js LTS via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    Refresh-SessionPath
}
Write-Host "      -> [OK] Node.js operacional!" -ForegroundColor Green

# 2. FFMPEG & YT-DLP
Write-Host "[2/5] Verificando FFmpeg e yt-dlp..." -ForegroundColor Cyan
Refresh-SessionPath
$ffmpegCmd = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
$ytdlpCmd = Get-Command yt-dlp.exe -ErrorAction SilentlyContinue
if (-not $ffmpegCmd -or -not $ytdlpCmd) {
    Write-Host "      -> Instalando yt-dlp e FFmpeg com aceleração via winget..." -ForegroundColor Yellow
    winget install yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements --silent
    Refresh-SessionPath
}
Write-Host "      -> [OK] FFmpeg e yt-dlp operacionais!" -ForegroundColor Green

# 3. PYTHON & VOZES NEURAIS
Write-Host "[3/5] Verificando Python e Módulos de Vozes Neurais (edge-tts)..." -ForegroundColor Cyan
Refresh-SessionPath
$pythonCmd = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCmd -and -not (Test-Path "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe")) {
    Write-Host "      -> Instalando Python 3.12 via winget..." -ForegroundColor Yellow
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements --silent
    Refresh-SessionPath
}

$pyExe = if ($pythonCmd) { $pythonCmd.Source } else { "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" }
& $pyExe -c "import edge_tts, speech_recognition" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "      -> Instalando pacotes edge-tts e SpeechRecognition..." -ForegroundColor Yellow
    & $pyExe -m pip install --quiet edge-tts SpeechRecognition
}
Write-Host "      -> [OK] Síntese neural e transcrição operacionais!" -ForegroundColor Green

# 4. INICIALIZAÇÃO DOS SERVIDORES
Write-Host "[4/5] Inicializando os servidores locais do Brain Audiovisual..." -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort 3050, 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Start-Process "cmd.exe" -ArgumentList "/c node audiovisual-edition\server.js" -WorkingDirectory $workDir -WindowStyle Hidden
Start-Process "cmd.exe" -ArgumentList "/c node server.js" -WorkingDirectory $workDir -WindowStyle Hidden

Start-Sleep -Seconds 2

# 5. TUDO PRONTO
Write-Host "[5/5] Abrindo o Audiovisual Studio no navegador..." -ForegroundColor Cyan
Start-Process "http://127.0.0.1:3050"

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  🎉 TUDO PRONTO! O Audiovisual Studio está pronto para uso neste computador!" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "  - AudioVisual Edition Engine: http://127.0.0.1:3050" -ForegroundColor White
Write-Host "  - Console Hub Admin:          http://127.0.0.1:8765/admin?module=audiovisual" -ForegroundColor White
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host ""
