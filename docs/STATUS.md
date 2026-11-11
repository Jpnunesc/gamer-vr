# STATUS — authoritative per-phase state

Updated 2026-11-11. States (plan §10): `not started` · `in progress` ·
`technically done` · `pending hardware/data` · `physically validated`.
Pendencies are never converted to success to close a phase.

## Snapshot

| Phase | State | One line |
|---|---|---|
| F0 — base, inventory, reproduction | **technically done** (gameplay route `pending data`) | Pinned engine fetched; reproducible WASM build succeeds; integration points mapped. |
| F1 — independent WebXR diagnostic | **technically done** (`pending hardware` for physical validation) | Diagnostic app + dev server built; lifecycle + both input modes implemented; math tests pass. |
| F2 — stereo render proof in engine | **in progress** (real world in WebXR + stereo + head-look working; obstacle #4 math **resolved+tested**; empirical sign/anchor tuning + headset pending) | The **real Vice City world renders inside an immersive WebXR session** (WebXR API Emulator): `Enter VR` parks the engine and drives `xrGameAdvance` + per-eye `xrRenderWorld` into the `XRWebGLLayer` — `viewCount=2`, one sim tick / N views, no errors. `makeXRCompatible` on the engine's GL context works (obstacle #2 ✓). Data: classic install (junction `local-game-data/vice-city`) + re3 overlay → MEMFS (216 files, 459 MB, ~2 s). **Obstacle #4 (handedness / real projection) now resolved in math and wired in:** the WebXR GL per-eye projection + view are converted to librw's convention by `P_rw = P_gl·M`, `Δ = M·viewInv·M` with `M=diag(-1,1,-1,1)` (derivation + 8 invariants in `tests/xr-rw.test.mjs`, all green) and pushed **verbatim** through a new librw override — real asymmetric frustum + 6DoF head pose, no eye-offset/aspect hack. This is the default; `?proj=crude` restores the old path for A/B. Remaining for F2: confirm the **empirical anchor signs** (which way XR forward maps onto the game heading; translation scale) in the emulator/headset; perceptual depth on PS VR2 (`pending hardware`). See `STEREO-SPIKE.md §9–§11`. |
| F3 — first-person walking | **in progress** (anchor + body-hide + WASD locomotion **confirmed in-game** on flat screen; headset/XR-pose validation pending) | Plan F3 items 1–2, first increments. **Item 1:** `?fp=1` renders from the **player's head** (hides the model); the XR head pose decouples look from body (rides the F2 verbatim delta). `xrSetFirstPerson(on,eyeHeight)` re-poses `Scene.camera` to `FindPlayerCoors()+eyeHeight` facing `FindPlayerHeading()`. **Anchor confirmed correct by live readout** (`eye z=11.0`, ground 9.4 → 1.6 m eye height). Cull frustum widened in FP so the wider render FOV doesn't "see between walls" (`xrSetCullVW`). **Item 2:** WASD walks Tommy through **native control/physics/collision** — `xrSetMove(fwd,strafe)` overwrites pad 0's left stick at the end of `CPad::UpdatePads` (runs inside `xrGameAdvance`); camera-relative ≈ body-relative, so head-look doesn't change the walk direction. Also added `xrSetTime(h,m)` (daylight) + an eye-position readout + a **MONO** full-screen preview (flat-screen stereo looks broken by design; only a headset fuses it). **Confirmed in-game (flat screen): first-person + WASD walking work, signs correct.** **Increment 3 (2026-11-11):** VR **left-thumbstick locomotion** added host-side (no rebuild) — reuses `xrSetMove` via a new pure, unit-tested `locomotion.js` (WASD + stick mapping: signs/deadzone/ramp/merge, 12 invariants in `tests/locomotion.test.mjs`); exercised only in-session so it's `pending hardware`. Pending: headset/emulator pass to confirm the XR head-pose signs + perceptual stereo + the stick walk (`pending hardware`). Later (needs an engine rebuild): sprint/jump, snap-turn/comfort, positional audio, interiors/pause. See `WALKING-TEST.md`. |
| F4–F7 | **not started** | Depend on F3. |

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
