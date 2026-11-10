<#
  fetch-engine.ps1 -- Reproducible, pinned checkout of the engine base.

  Fetches origami-ltd/wasm-revc at the exact commit documented in the
  technical report, plus its submodules (notably vendor/librw), checked out
  at the commits recorded by the superproject. No floating dependencies.

  Output lands in engine/wasm-revc (git-ignored; it is an external pinned
  dependency reproduced by this script, not vendored into our history).

  See docs/SOURCES.md for origins and licensing.
#>
[CmdletBinding()]
param(
  [string]$EngineDir
)

$ErrorActionPreference = 'Stop'

if (-not $EngineDir) {
  $here = if ($PSScriptRoot) { $PSScriptRoot }
          elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath }
          else { (Get-Location).Path }
  $EngineDir = Join-Path $here '..\engine\wasm-revc'
}

# --- Pinned identity (do not float) -----------------------------------------
$RepoUrl    = 'https://github.com/origami-ltd/wasm-revc'
$RepoCommit = 'acde392e0ba582156fcf516dbaeb73b73adebb3e'
# librw is pinned transitively via the superproject's recorded submodule commit:
$LibrwExpected = 'ac6b902bc0a16950a7ac63ca7b2702e13b598af9'
# ----------------------------------------------------------------------------

$EngineDir = [System.IO.Path]::GetFullPath($EngineDir)
Write-Host "Engine target: $EngineDir"

# Force LF line endings. The shell build scripts must stay LF or bash in the
# Linux build container chokes on "set -euo pipefail\r". (C++ tolerates CRLF,
# the *.sh scripts do not.)
if (-not (Test-Path (Join-Path $EngineDir '.git'))) {
  Write-Host "Cloning $RepoUrl ..."
  git clone -c core.autocrlf=false -c core.eol=lf $RepoUrl $EngineDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed ($LASTEXITCODE)" }
}

Push-Location $EngineDir
try {
  git config core.autocrlf false
  git config core.eol lf
  git fetch --tags origin
  Write-Host "Checking out pinned commit $RepoCommit ..."
  git checkout --detach $RepoCommit
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed ($LASTEXITCODE)" }

  Write-Host "Initializing submodules at recorded commits ..."
  git -c core.autocrlf=false -c core.eol=lf submodule update --init --recursive
  if ($LASTEXITCODE -ne 0) { throw "git submodule update failed ($LASTEXITCODE)" }

  # Verify the pinned identity we actually got.
  $head = (git rev-parse HEAD).Trim()
  Write-Host "wasm-revc HEAD : $head"
  if ($head -ne $RepoCommit) { Write-Warning "HEAD != expected pinned commit!" }

  if (Test-Path 'vendor/librw/.git') {
    $librw = (git -C 'vendor/librw' rev-parse HEAD).Trim()
    Write-Host "librw HEAD     : $librw"
    if ($librw -ne $LibrwExpected) { Write-Warning "librw != expected pinned commit!" }
  } else {
    Write-Warning "vendor/librw not found -- inspect .gitmodules."
  }
}
finally {
  Pop-Location
}

Write-Host "`nDone. Record any divergence in docs/SOURCES.md."
