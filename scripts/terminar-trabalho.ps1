# Terminar o trabalho: salva tudo no GitHub para continuar em outro computador.
# Uso: atalho "BrainLingo - Terminar" (ou: powershell -ExecutionPolicy Bypass -File scripts\terminar-trabalho.ps1)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = 'BrainLingo - Terminar o trabalho'

function Fim($codigo) {
    Write-Host ''
    Read-Host 'Pressione Enter para fechar'
    exit $codigo
}

Write-Host ''
Write-Host '=== BrainLingo: terminando o trabalho ===' -ForegroundColor Cyan
Write-Host "Pasta: $repo"
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host 'ERRO: o Git não está instalado neste computador.' -ForegroundColor Red
    Fim 1
}

$ramo = git rev-parse --abbrev-ref HEAD
$pendentes = git status --porcelain

if ($pendentes) {
    Write-Host 'Alterações a salvar:' -ForegroundColor Cyan
    $pendentes | ForEach-Object { Write-Host "   $_" }
    Write-Host ''

    # O GitHub recusa arquivos acima de 100 MB; vídeos e áudios grandes não devem ir para o repositório
    git add -A
    $grandes = git diff --cached --name-only | Where-Object { (Test-Path $_) -and (Get-Item $_).Length -gt 50MB }
    if ($grandes) {
        git reset -q
        Write-Host 'PAREI: há arquivos grandes demais (acima de 50 MB) para o GitHub:' -ForegroundColor Red
        $grandes | ForEach-Object { Write-Host "   $_" }
        Write-Host 'Peça ao Claude para colocá-los no .gitignore e rode de novo.'
        Fim 1
    }

    $padrao = "Trabalho de $(Get-Date -Format 'dd/MM/yyyy HH:mm') em $env:COMPUTERNAME"
    $mensagem = Read-Host "Descreva rapidamente o que foi feito (Enter = `"$padrao`")"
    if ([string]::IsNullOrWhiteSpace($mensagem)) { $mensagem = $padrao }

    git commit -q -m $mensagem
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERRO ao salvar as alterações (commit).' -ForegroundColor Red
        Fim 1
    }
    Write-Host 'Alterações salvas localmente.' -ForegroundColor Green
} else {
    Write-Host 'Nenhuma alteração nova neste computador.'
}

# Traz o que possa ter sido enviado de outro computador antes de enviar
git fetch origin 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERRO: sem acesso ao GitHub. Seu trabalho está salvo neste computador;' -ForegroundColor Red
    Write-Host 'rode este atalho de novo quando a internet voltar.'
    Fim 1
}

if (git log --oneline "HEAD..origin/$ramo") {
    git pull --rebase -q origin $ramo
    if ($LASTEXITCODE -ne 0) {
        git rebase --abort 2>&1 | Out-Null
        Write-Host 'ERRO: o mesmo trecho foi alterado aqui e em outro computador (conflito).' -ForegroundColor Red
        Write-Host 'Nada foi perdido. Peça ajuda ao Claude: "o terminar-trabalho do BrainLingo deu conflito".'
        Fim 1
    }
}

if (-not (git log --oneline "origin/$ramo..HEAD")) {
    Write-Host 'Tudo já está no GitHub. Nada a enviar.' -ForegroundColor Green
    Fim 0
}

Write-Host 'Enviando para o GitHub...'
git push -q origin $ramo
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERRO ao enviar ao GitHub. Seu trabalho está salvo neste computador; tente de novo.' -ForegroundColor Red
    Fim 1
}

Write-Host ''
Write-Host 'Pronto! Tudo salvo no GitHub. Pode continuar em qualquer computador.' -ForegroundColor Green
Fim 0
