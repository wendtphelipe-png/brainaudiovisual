# Começar o trabalho: baixa do GitHub o que foi feito em outro computador.
# Uso: atalho "BrainLingo - Começar" (ou: powershell -ExecutionPolicy Bypass -File scripts\comecar-trabalho.ps1)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = 'BrainLingo - Começar o trabalho'

function Fim($codigo) {
    Write-Host ''
    Read-Host 'Pressione Enter para fechar'
    exit $codigo
}

Write-Host ''
Write-Host '=== BrainLingo: começando o trabalho ===' -ForegroundColor Cyan
Write-Host "Pasta: $repo"
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host 'ERRO: o Git não está instalado neste computador (https://git-scm.com).' -ForegroundColor Red
    Fim 1
}

# Alterações locais não salvas no GitHub (ex.: o trabalho anterior não foi encerrado)
$pendentes = git status --porcelain
if ($pendentes) {
    Write-Host 'ATENÇÃO: há alterações neste computador que ainda NÃO foram enviadas ao GitHub:' -ForegroundColor Yellow
    $pendentes | ForEach-Object { Write-Host "   $_" }
    Write-Host ''
    Write-Host 'Provavelmente o "Terminar o trabalho" não foi rodado da última vez.'
    Write-Host 'Rode o atalho "BrainLingo - Terminar" primeiro e depois este de novo.' -ForegroundColor Yellow
    Fim 1
}

Write-Host 'Buscando novidades no GitHub...'
git fetch origin 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERRO: não consegui acessar o GitHub. Verifique a internet e tente de novo.' -ForegroundColor Red
    Fim 1
}

$ramo = git rev-parse --abbrev-ref HEAD
$novos = git log --oneline "HEAD..origin/$ramo"
if (-not $novos) {
    Write-Host 'Tudo em dia: nenhuma novidade no GitHub.' -ForegroundColor Green
} else {
    Write-Host 'Novidades encontradas:' -ForegroundColor Cyan
    $novos | ForEach-Object { Write-Host "   $_" }
    git pull --ff-only origin $ramo
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host 'ERRO: não deu para atualizar automaticamente (as versões divergiram).' -ForegroundColor Red
        Write-Host 'Nada foi perdido. Peça ajuda ao Claude: "o começar-trabalho do BrainLingo deu erro".'
        Fim 1
    }
    Write-Host 'Atualizado com sucesso.' -ForegroundColor Green
}

# Arquivos de login do Google não vão para o GitHub: cada computador precisa da sua cópia
$faltando = @('backend\credentials.json', 'backend\token.json') | Where-Object { -not (Test-Path (Join-Path $repo $_)) }
if ($faltando) {
    Write-Host ''
    Write-Host 'AVISO: faltam arquivos de login (não ficam no GitHub, copie da sua pasta privada):' -ForegroundColor Yellow
    $faltando | ForEach-Object { Write-Host "   $_" }
}

Write-Host ''
Write-Host 'Últimas alterações:' -ForegroundColor Cyan
git log --format='   %h  %cd  %s' --date=format:'%d/%m %H:%M' -5
Write-Host ''
Write-Host 'Pronto! Pode trabalhar.' -ForegroundColor Green
Fim 0
