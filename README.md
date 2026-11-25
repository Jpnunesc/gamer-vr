# vr-vice-city

Experimental first-person **WebXR** adaptation of the Vice City web port
(`gta.rabisco.net`). First target: **PS VR2 on PC** via adapter + SteamVR/OpenXR.
Desktop mode is preserved for development and regression.

> This is an implementation workspace. The engineering plan and the evidence it
> is based on live in the `plano/` folder of this repo:
> `plano/` (`ANALISE-TECNICA.md`, `PLANO-EXECUCAO.md`, `PROMPT-PARA-CLAUDE.md`).
> Read those first. Facts, hypotheses and proposed decisions are kept distinct
> there and in `docs/`.

## Hard requirements (from the plan)

Visualization and input are **independent** choices. Three combinations must work:

1. Monitor + keyboard/mouse
2. **Headset VR + keyboard/mouse** (priority for the first integrated route;
   stereoscopic depth + 6DoF head tracking, no Sense controllers required
   during play)
3. Headset VR + VR controllers

Head pose stays live whenever an XR session exists, regardless of input source.

## Layout

```
docs/               decisions, sources, baseline, status, XR compatibility
web/                WebXR shell + F1 diagnostic (vanilla ES modules, zero build)
  src/gl/           WebGL2 renderer + matrix math
  src/xr/           session lifecycle, feature detection, XR input sources
  src/input/        common actions, keyboard/mouse, device selection
  src/ui/           diagnostic panel
scripts/            fetch-engine (pinned), dev server
src/xr/             (future) native C++/WASM XR integration
vendor/             (future) small tracked patch to librw backend
engine/             pinned external checkout of wasm-revc (git-ignored)
tests/              matrix math + invariants (node --test)
local-game-data/    user's classic install (git-ignored, never committed)
```

## Current phase

- **F0** — base, inventory, reproduction (in progress)
- **F1** — independent WebXR diagnostic (in progress)

See `docs/STATUS.md` for the authoritative per-phase state and next steps.

## Quick start

### 1. Fetch the engine base (pinned)

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts/fetch-engine.ps1
```

```bash
# WSL / Unix
bash scripts/fetch-engine.sh
```

This lands `origami-ltd/wasm-revc @ acde392e` + `librw @ ac6b902b` under
`engine/` (not committed). See `docs/SOURCES.md`.

### 2. Run the WebXR diagnostic (F1)

```bash
node scripts/serve.mjs
# then open the printed http://localhost:<port>/ URL
```

The dev server sets `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` (so `crossOriginIsolated` /
`SharedArrayBuffer` are available, matching the production isolation the port
requires) and serves `.wasm` with the correct MIME type.

The diagnostic needs **no** engine or game data. It probes WebXR/WebGL2 support,
runs the session lifecycle, and exercises both input modes
(keyboard/mouse and VR controllers) with its own geometry.

### 3. Run the math tests

```bash
npm test
```

## Game data

Bring your own files from a legally obtained classic Vice City install into
`local-game-data/`. They are never committed and never redistributed. This
project does not use the Rabisco site as a CDN.

## Licensing

The engine base is **MIT-PoU** (MIT with additional attribution/registration
conditions) and bundles dependencies under their own terms — it is **not**
uniformly MIT. See `docs/SOURCES.md` before redistributing anything.
