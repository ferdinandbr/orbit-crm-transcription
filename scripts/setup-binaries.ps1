<#
.SYNOPSIS
  Baixa os binários necessários para a transcrição (whisper.cpp + ffmpeg) no Windows,
  sem compilador, e grava os caminhos no .env do serviço.

.DESCRIPTION
  1. Baixa o release mais recente do whisper.cpp (asset whisper-bin-x64.zip, CPU x64).
  2. Baixa o ffmpeg "release-essentials" do gyan.dev.
  3. Extrai ambos em transcription-service/bin, localiza whisper-cli.exe e ffmpeg.exe.
  4. Escreve WHISPER_BIN e FFMPEG_BIN no .env (criando a partir do .env.example se preciso).
  5. (Opcional) baixa o modelo small via scripts/download-model.mjs.

.PARAMETER SkipModel
  Não baixa o modelo ggml-small.bin (rode "npm run setup:model" depois).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-binaries.ps1
#>

[CmdletBinding()]
param(
  [switch]$SkipModel
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceRoot = Split-Path -Parent $scriptDir
$binDir     = Join-Path $serviceRoot "bin"
$whisperDir = Join-Path $binDir "whisper"
$ffmpegDir  = Join-Path $binDir "ffmpeg"

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# 1. whisper.cpp (whisper-bin-x64.zip do release mais recente)
# ---------------------------------------------------------------------------
Write-Step "Procurando o release do whisper.cpp com binário Windows..."
# IMPORTANTE: nem todo release anexa binários. O endpoint /releases/latest pode
# apontar para uma versão SEM assets (ex.: v1.9.5). Varremos a lista e pegamos o
# release mais recente que de fato tenha o whisper-bin-x64.zip (build CPU).
$headers = @{ "User-Agent" = "crm-orbit-setup"; "Accept" = "application/vnd.github+json" }
$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=40" -Headers $headers

$asset = $null
$tag = $null
foreach ($rel in $releases) {
  $a = $rel.assets | Where-Object { $_.name -eq "whisper-bin-x64.zip" } | Select-Object -First 1
  if ($a) { $asset = $a; $tag = $rel.tag_name; break }
}
if ($null -eq $asset) {
  throw "Nenhum release recente tem whisper-bin-x64.zip. Baixe manualmente em https://github.com/ggml-org/whisper.cpp/releases"
}

$whisperZip = Join-Path $binDir $asset.name
Write-Host "   $tag -> $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $whisperZip -Headers @{ "User-Agent" = "crm-orbit-setup" }

Write-Host "   extraindo..."
if (Test-Path $whisperDir) { Remove-Item -Recurse -Force $whisperDir }
Expand-Archive -Path $whisperZip -DestinationPath $whisperDir -Force
Remove-Item -Force $whisperZip

$whisperExe = Get-ChildItem -Path $whisperDir -Recurse -Filter "whisper-cli.exe" | Select-Object -First 1
if ($null -eq $whisperExe) {
  # releases antigos usam main.exe (compatível com os mesmos argumentos)
  $whisperExe = Get-ChildItem -Path $whisperDir -Recurse -Filter "main.exe" | Select-Object -First 1
}
if ($null -eq $whisperExe) {
  throw "Binário do whisper (whisper-cli.exe/main.exe) não encontrado após extrair em $whisperDir"
}
Write-Host "   OK: $($whisperExe.FullName)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. ffmpeg (release-essentials do gyan.dev)
# ---------------------------------------------------------------------------
Write-Step "Baixando ffmpeg (release-essentials)..."
$ffmpegZip = Join-Path $binDir "ffmpeg-release-essentials.zip"
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip

Write-Host "   extraindo..."
if (Test-Path $ffmpegDir) { Remove-Item -Recurse -Force $ffmpegDir }
Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegDir -Force
Remove-Item -Force $ffmpegZip

$ffmpegExe = Get-ChildItem -Path $ffmpegDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if ($null -eq $ffmpegExe) {
  throw "ffmpeg.exe não encontrado após extrair em $ffmpegDir"
}
Write-Host "   OK: $($ffmpegExe.FullName)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Grava os caminhos no .env (upsert, preservando o resto)
# ---------------------------------------------------------------------------
Write-Step "Atualizando .env..."
$envPath     = Join-Path $serviceRoot ".env"
$envExample  = Join-Path $serviceRoot ".env.example"
if (-not (Test-Path $envPath)) {
  if (Test-Path $envExample) { Copy-Item $envExample $envPath } else { New-Item -ItemType File -Path $envPath | Out-Null }
}

# Caminhos com barras normais (o Node aceita e evita problemas de escape no .env)
$whisperPath = ($whisperExe.FullName) -replace "\\", "/"
$ffmpegPath  = ($ffmpegExe.FullName) -replace "\\", "/"

function Set-EnvVar($path, $key, $value) {
  $lines = @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)
  $set = $false
  $out = foreach ($line in $lines) {
    if ($line -match "^\s*$([regex]::Escape($key))\s*=") { "$key=$value"; $set = $true }
    else { $line }
  }
  if (-not $set) { $out += "$key=$value" }
  Set-Content -LiteralPath $path -Value $out -Encoding utf8
}

Set-EnvVar $envPath "WHISPER_BIN" $whisperPath
Set-EnvVar $envPath "FFMPEG_BIN"  $ffmpegPath
Write-Host "   WHISPER_BIN=$whisperPath" -ForegroundColor Green
Write-Host "   FFMPEG_BIN=$ffmpegPath" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Modelo small (opcional)
# ---------------------------------------------------------------------------
if (-not $SkipModel) {
  Write-Step "Baixando o modelo small (ggml-small.bin)..."
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) {
    Write-Host "   node não encontrado no PATH. Rode 'npm run setup:model' manualmente." -ForegroundColor Yellow
  } else {
    & node (Join-Path $serviceRoot "scripts/download-model.mjs")
    if ($LASTEXITCODE -ne 0) { Write-Host "   Falha ao baixar o modelo. Rode 'npm run setup:model' depois." -ForegroundColor Yellow }
  }
} else {
  Write-Host "`n(SkipModel) Lembre de rodar: npm run setup:model" -ForegroundColor Yellow
}

Write-Step "Concluído."
Write-Host "Teste com:  npm start   e abra http://localhost:8090/health (modelAvailable deve ser true)."
Write-Host "No backend .env, defina: TRANSCRIPTION_SERVICE_URL=http://localhost:8090"
