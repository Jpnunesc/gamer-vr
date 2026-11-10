# BASELINE — reproducible engine build

F0 outcome, 2026-11-10. Status: **build reproduced successfully** (browser/WASM
target). Gameplay route is **pending game data** (not yet supplied).

## Result

A clean build of the pinned engine produced the browser engine artifacts:

| Artifact | Path | Size |
|---|---|---|
| `reVC.js` (glue) | `engine/wasm-revc/web/public/reVC.js` | 193,002 B |
| `reVC.wasm` | `engine/wasm-revc/web/public/reVC.wasm` | 4,796,907 B |

316/316 Ninja targets compiled and linked (`[316/316] Linking CXX executable
src/reVC.js`), warnings only (unused-parameter etc. in librw), no errors.

CMake configuration reported:
```
Building reVC GIT SHA1: acde392e0ba582156fcf516dbaeb73b73adebb3e
REVC_AUDIO       = NULL   (choices = OAL;NULL)
LIBRW_PLATFORM   = GL3
LIBRW_GL3_GFXLIB = SDL2
REVC_WITH_OPUS   = OFF
```

## How to reproduce

```powershell
# 1. Pinned source (wasm-revc @ acde392e + submodules), LF line endings
powershell -ExecutionPolicy Bypass -File scripts/fetch-engine.ps1

# 2. Build in the Emscripten container (NULL audio = lean proof-of-build)
powershell -ExecutionPolicy Bypass -File scripts/build-web-docker.ps1 -Audio NULL -Clean
```

Produces `engine/wasm-revc/web/public/reVC.{js,wasm}`.

## Environment notes (why Docker, not the host or WSL)

- The Windows host has **no** `emcc`/`cmake`/`ninja`.
- WSL2 Ubuntu is present and running but **bare** (no git/gcc/python/cmake) and
  has **no passwordless sudo**, so `apt install` would block on a password
  prompt. It is not a usable build env as-is.
- Docker Desktop is fully operational. The official `emscripten/emsdk` image is
  reproducible and root-in-container, so `ninja` installs without host sudo.
  This is the plan's "WSL2 or an equivalent reproducible environment".
- **Gotcha fixed:** a Windows git checkout rewrote the shell scripts to CRLF,
  which made bash reject `set -euo pipefail` (`pipefail\r`). `fetch-engine.*`
  now forces `core.autocrlf=false` / `core.eol=lf`; the build script also
  normalizes its own here-doc to LF.

## What was NOT done (honest limits)

- **No gameplay run.** No classic Vice City install was supplied, so the engine
  was not booted against real data and the reference route (start, move,
  enter/exit vehicle, pause, save/load) is **not** recorded yet. Per the plan,
  that leaves gameplay "pending data" while build and XR diagnostics proceed.
- **Audio = NULL.** The production default is `OAL` (OpenAL). NULL was used to
  prove the build cheaply; an OAL build is a follow-up (`-Audio OAL`).
- **No native desktop exe.** The "desktop mode" of this project is the non-VR
  browser build (reVC.js/.wasm served locally) used for regression — that is
  what was built. A standalone SDL2 native binary was not a target.
- **Toolchain tag** is `:latest` (captured as emcc 7.0.0); pin to a digest for
  byte-stable reproduction (see `SOURCES.md`).

## Next to lift gameplay out of "pending"

1. User supplies a classic install into `local-game-data/`.
2. Wire a supported data-selection flow and serve `reVC.{js,wasm}` + a minimal
   shell with the COOP/COEP server (`scripts/serve.mjs`) — do **not** substitute
   Definitive Edition data silently.
3. Record the reference route in this file with real observations.
