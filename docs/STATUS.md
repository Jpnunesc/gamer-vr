# STATUS — authoritative per-phase state

Updated 2026-11-10. States (plan §10): `not started` · `in progress` ·
`technically done` · `pending hardware/data` · `physically validated`.
Pendencies are never converted to success to close a phase.

## Snapshot

| Phase | State | One line |
|---|---|---|
| F0 — base, inventory, reproduction | **technically done** (gameplay route `pending data`) | Pinned engine fetched; reproducible WASM build succeeds; integration points mapped. |
| F1 — independent WebXR diagnostic | **technically done** (`pending hardware` for physical validation) | Diagnostic app + dev server built; lifecycle + both input modes implemented; math tests pass. |
| F2 — stereo render proof in engine | **not started** | Entry checklist ready (see below + ENGINE-MAP §F2). Highest technical risk. |
| F3–F7 | **not started** | Depend on F2. |

## F0 — what was done

- Created this workspace (sibling of the planning repo), structure per plan §3.
- `scripts/fetch-engine.*` pins `wasm-revc@acde392e` + `librw@ac6b902b`
  (+ ogg/opus/opusfile) with LF line endings. Ran it; commits verified.
- Reproducible build via `emscripten/emsdk` container →
  `reVC.js` + `reVC.wasm` (316/316 targets). See `BASELINE.md`.
- Mapped loop/sim/render/camera/target/input/saves/streaming/bridge to real
  `file:line` in `ENGINE-MAP.md`.
- Recorded origins, pinned commits, toolchain and MIT-PoU licensing in
  `SOURCES.md` (incl. the automated-systems proof-of-usage term — no external
  action taken; deferred to owner).

Files: `scripts/fetch-engine.ps1|sh`, `scripts/build-web-docker.ps1`,
`docs/SOURCES.md`, `docs/BASELINE.md`, `docs/ENGINE-MAP.md`.

Pending: gameplay reference route (needs a user-supplied classic install in
`local-game-data/`); optional OAL-audio build.

## F1 — what was done

- `web/` diagnostic (vanilla ES modules, zero build): WebGL2 scene (1 m grid,
  reference cubes, controller gizmos, aim ray) with per-eye scissored clears.
- Feature probe: secure context, crossOriginIsolated, SAB, WebGL2 (+unmasked
  GPU), `navigator.xr`, `immersive-vr`, pointer lock, gamepad.
- Session lifecycle: request on gesture, `local-floor`→`bounded-floor`→`local`→
  `viewer` fallback, **one update / N views**, runtime projection verbatim,
  null-pose handling, `visibilitychange`/blur neutralization, input-sources
  change, enter/exit/re-enter.
- Input: independent `displayMode` vs `inputMode` (persisted); `InputArbiter`
  enforcing single active source + safe switching (neutralize old, require
  neutral new) without ending the session; keyboard/mouse (WASD body-relative,
  mouse X = body yaw, mouse Y = weapon pitch only — never head; pointer lock /
  relative movement; blur panic); XR controllers (handedness, grip/target-ray
  poses, xr-standard gamepad, snap-turn hysteresis, graceful missing features).
- `scripts/serve.mjs`: COOP/COEP isolation, correct `.wasm` MIME, Range support,
  path-traversal guard. Verified: `/` 200 html, modules `text/javascript`,
  `reVC.wasm` `application/wasm`, COOP=same-origin COEP=require-corp.
- `tests/math.test.mjs`: 10 invariants (axis/scale/handedness, composition
  order, inverse view, no doubled eye height) — all pass (`npm test`).

Verified by: `node --check` on all modules (0 failures); server header probe;
`node --test`. **Not** verified: in-headset depth/latency, pointer lock *inside*
an immersive session, real controller profiles — all `pending hardware`.

## F2 — entry checklist (do this next)

Highest technical risk; the plan reserves 2–3 days just to find the mechanism
and obstacles, not to promise a solution. From `ENGINE-MAP.md §F2`:

1. **Scheduling ownership.** Suspend the Asyncify rAF yield
   (`sdl2.cpp:12-56`) during a session; drive the engine from the XR raf loop.
   Restore exactly one loop on exit.
2. **Split `Idle()`** (`main.cpp:1575`): one `CGame::Process` + render-list
   build; per-eye `RenderScene`/`RenderEffects`; single present. Note
   `Idle(nil)` already gives a sim-only tick (`main.cpp:1612`).
3. **librw override** (`gl3device.cpp`): bind `XRWebGLLayer.framebuffer`
   (`setFrameBuffer:1207`), per-eye `XRView` viewport (`setViewport:1282`),
   verbatim `XRView.projectionMatrix` + XR view matrix (`beginUpdate:1296`,
   mind the X-flip/handedness), scissored clear (`clearCamera:1379`). Invalidate
   `glGlobals.present*` / `rwStateCache` on eye switch and desktop restore.
4. **Bridge contracts** (plan §4) are new `EMSCRIPTEN_KEEPALIVE`/Embind exports
   to create (`xrSetMode`, `gameAdvance`, `gamePrepareFrame`, `xrRenderView`,
   `xrSubmitInput`, `xrGetAnchor`, `xrGetTelemetry`, `xrResetInput`) — none
   exist yet.
5. First draw diagnostic geometry through the native backend, then a paused real
   world slice; show separate update/view counters. If projection/framebuffer/
   loop access is not functional, record the concrete obstacle and revise the
   estimate **before** advancing gameplay.

## Open questions / needs from the user

- A classic Vice City install (to lift F0/F1 gameplay out of "pending data").
- Confirm the browser/runtime for first physical tests (SteamVR + which
  browser's WebXR). Adapter ETA ~1 week.
- Decision on the MIT-PoU proof-of-usage obligation before any publication
  (see `SOURCES.md`).
