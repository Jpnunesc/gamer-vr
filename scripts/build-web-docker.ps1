<#
  build-web-docker.ps1 -- Reproducible engine web build via the Emscripten image.

  The build toolchain (emcc/cmake/ninja) is NOT installed on the Windows host.
  We use the official emscripten/emsdk container, which is reproducible and
  needs no sudo (the plan allows "WSL2 or an equivalent reproducible env").

  Toolchain observed in emscripten/emsdk:latest on 2026-11-10:
    emcc   7.0.0 (777e6e5db7b4990bcaeb1b9998ed642cc84e6629)
    cmake  3.28.3
    node   24.19.0  / python 3.12.3
    ninja  NOT bundled -> installed inside the container below.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/build-web-docker.ps1
    powershell ... -Audio OAL        # production default (needs OpenAL)
    powershell ... -Audio NULL -Clean
#>
[CmdletBinding()]
param(
  [ValidateSet('NULL', 'OAL')]
  [string]$Audio = 'NULL',          # NULL = lean proof-of-build; OAL = production
  [switch]$Clean,
  [string]$Image = 'emscripten/emsdk:latest'
)

$ErrorActionPreference = 'Stop'

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$engine = [System.IO.Path]::GetFullPath((Join-Path $here '..\engine\wasm-revc'))
if (-not (Test-Path (Join-Path $engine 'scripts\build-web.sh'))) {
  throw "Engine not found at $engine. Run scripts/fetch-engine.ps1 first."
}

$cleanArg = if ($Clean) { 'clean' } else { '' }

# Container-side script. Container runs as root, so ninja install needs no sudo.
$inner = @"
set -euo pipefail
echo '== toolchain =='
emcc --version | head -1
cmake --version | head -1
echo '== ensuring ninja =='
if ! command -v ninja >/dev/null 2>&1; then
  python3 -m pip install --quiet ninja 2>/dev/null || { apt-get update -qq && apt-get install -y -qq ninja-build; }
fi
ninja --version
echo '== building (REVC_AUDIO=$Audio) =='
export REVC_AUDIO=$Audio
bash scripts/build-web.sh $cleanArg
echo '== artifacts =='
ls -la web/public/reVC.js web/public/reVC.wasm
"@

# PowerShell here-strings are CRLF; bash in the container needs LF.
$inner = $inner -replace "`r`n", "`n"

Write-Host "Engine : $engine"
Write-Host "Image  : $Image"
Write-Host "Audio  : $Audio  Clean: $Clean"
Write-Host "Starting container build..."

docker run --rm -v "${engine}:/src" -w /src $Image bash -lc $inner
if ($LASTEXITCODE -ne 0) { throw "Docker build failed ($LASTEXITCODE)" }
Write-Host "`nBuild finished. See engine/wasm-revc/web/public/ for reVC.js / reVC.wasm."
