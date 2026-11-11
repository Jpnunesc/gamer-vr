# STEREO-SPIKE — F2 mechanism & obstacles (stereo render proof in the engine)

Started 2026-11-11. This is the F2 deliverable the plan asks for first: identify
**how** stereo rendering can be driven inside the real engine and **what blocks
it**, before promising a solution (plan §6 F2, "reservar 2–3 dias ... identificar
o mecanismo e os obstáculos"). It is a design + risk record, not a validated
result. Everything below cites real `file:line` in the pinned base
(`wasm-revc@acde392e`, `librw@ac6b902b`); re-verify after any re-fetch.

---

## 1. What the code actually does (confirmed by reading)

### Frame loop (C++ owns it, Asyncify yields to the browser)
- Main loop: `src/skel/sdl2/sdl2.cpp:1984` — a blocking
  `while(!quit ...)`. At the **top** of every iteration:
  `reVCFrames++; reVCYieldFrame();` (`sdl2.cpp:1991-1992`).
- `reVCYieldFrame` (`sdl2.cpp:33-56`) is an `EM_ASYNC_JS` that suspends the whole
  C++ stack via **Asyncify** and resumes on **`window.requestAnimationFrame`** (a
  hidden-tab worker `setInterval(16ms)` is the backup source). The top of the loop
  is explicitly the *only* place a yield is known to be safe to unwind through
  (`sdl2.cpp:1988-1990`, and the matching warning in `main.cpp:749-753`).
- Dispatch: `GS_PLAYING_GAME` → `RsEventHandler(rsIDLE,(void*)TRUE)`
  (`sdl2.cpp:2201`) → `Idle(TRUE)`. `GS_FRONTEND` → `rsFRONTENDIDLE`
  (`sdl2.cpp:2134`) → `FrontendIdle()`.

### Simulation vs. render seam
- `Idle(void*arg)` (`main.cpp:1575`): sim runs first — `CTimer::Update():1580`,
  `CGame::Process():1591`, `DMAudio.Service():1596`,
  `SetLightsWithTimeOfDayColour():1610` — then **`if(arg==nil) return;`**
  (`main.cpp:1612`). So **`Idle(nil)` is a ready-made sim-only tick.**
- Render (arg!=nil): `CRenderer::ConstructRenderList():1637` + `PreRender():1641`
  (once/frame), far-clip/fog `:1647-1648`, then
  `DoRWStuffStartOfFrame_Horizon()` (`main.cpp:231`: `CameraSize` →
  `RwCameraClear` → `RsCameraBeginUpdate` → `TheCamera.m_viewMatrix.Update()` →
  `CClouds::RenderBackground`), `DefinedState()`, **`RenderScene():1669`**,
  `RenderEffects():1677`, `RenderMotionBlur():1690`, then 2D/HUD
  (`Render2dStuff`, `RenderMenus`, `DoFade`, `Render2dStuffAfterFade`), and finally
  `DoRWStuffEndOfFrame()` (`main.cpp:363`: `RwCameraEndUpdate` →
  **`RsCameraShowRaster`** = present/swap).
- Draw-time state mutation to watch for per-eye double-advance:
  `TheCamera.SetMotionBlurAlpha(150)` (`main.cpp:1681`) and
  `RenderMotionBlur()` (`:1690`). 2D/HUD/`DoFade` assume one screen → **F4**, not
  F2. F2 draws world only.

### librw GL3 — the render-target / matrix override point
`vendor/librw/src/gl/gl3device.cpp`, wired into the device vtable at
`gl3device.cpp:2132` (`renderdevice = { ... gl3::beginUpdate, gl3::endUpdate,
gl3::clearCamera, gl3::showRaster, ... }`).
- `beginUpdate(cam):1296` builds `view[16]` from `invert(cam LTM)` and **flips X**
  (`:1304,1312,1316`) for a left-handed view space; builds `proj[16]` from
  `cam->viewWindow/viewOffset/near-far` (`:1324-1356`, note `proj[11]=1.0`,
  row-vector/left-handed RW convention — **not** the GL column-major right-handed
  `-Z` convention WebXR emits); pushes via `setViewMatrix:1321` /
  `setProjectionMatrix:1356`; then `setFrameBuffer:1369` + `setViewport:1371`.
- `setFrameBuffer(cam):1207` binds the camera FBO `natfb->fbo` (`:1218`) + depth.
- `setViewport(fb):1282` takes the rect from **SDL window size** (`:1258`) and
  **caches** it in `glGlobals.present{Width,Height,OffX,OffY}` (`:1285-1292`),
  re-applying `glViewport` only when the rect changes.
- `clearCamera(cam):1379` enables `GL_SCISSOR_TEST` **only** when the camera is
  subrastered (`:1389-1393`), then `glClear` (`:1406`).
- `showRaster():1413` → `SDL_GL_SwapWindow` (`:1429`); under Emscripten it already
  skips `SetSwapInterval` (`:1420-1428`).

### Web sides (two separate apps today)
- **Engine shell** `engine/wasm-revc/web/src/main.ts`: the author's licensed shell
  (`@wasm/shell`, `@wasm/runtime`, MIT-PoU header). Loads `/reVC.js` by indirect
  dynamic import (`:224-230`), calls `factory(config)` with `config.canvas`,
  `preRun`, `onRuntimeInitialized`. `main()` never returns (blocking loop). Exposes
  engine exports as `module._Vice*` (`_ViceGameState`, `_ViceLogicFrame`,
  `_ViceSetResolution`, ...). **`?engine=1` boots with an empty game dir**
  (`:177-183`) — proves wasm/SDL/WebGL/Asyncify **without any game assets**.
- **Our F1 diagnostic** `web/` (vanilla ES modules, separate from the engine).
  `web/src/xr/session.js` `XRSessionManager._frame` (`:90-136`) is a clean,
  JS-driven XR loop that already enforces the F2 invariants: one `hooks.update()`,
  then per-view `renderer.renderView(finalView, view.projectionMatrix, viewport,
  scene)` with `finalView = view.transform.inverse.matrix * worldToXr`.

---

## 2. The core conflict

| | Engine today | WebXR requires |
|---|---|---|
| Loop owner | C++ blocking `while`, parked on **`window.rAF`** via Asyncify | render inside **`session.requestAnimationFrame`** |
| Frame target | camera FBO, presented by `SDL_GL_SwapWindow` | draw into the **opaque** `XRWebGLLayer.framebuffer`, submitted by the UA at callback end |
| Validity | any time on the engine stack | poses + opaque FB valid **only during** the XR rAF callback |

Two loops cannot both own the engine. The opaque XR framebuffer and the viewer
pose are only usable *inside* the XR rAF callback — so the engine's world draw has
to happen there, not on its own window-rAF-paced stack.

---

## 3. Chosen architecture — invert the loop (JS drives, engine parked)

Reuse the F1 JS XR loop and make the **engine** the thing it drives, instead of
F1's placeholder renderer. The engine's own loop is **parked** for the whole
session; JS pumps one sim tick + N view draws per XR frame by calling bridge
exports **from inside `_frame`** — so every engine GL draw lands inside the XR rAF
callback while the opaque FB is bound and valid. This is the plan's "transferir a
propriedade do loop/câmera".

```
XRSession.requestAnimationFrame(_frame)         // JS owns the loop
  └─ _frame(t, xrFrame):
       pose = xrFrame.getViewerPose(refSpace)
       module._gameAdvance(dtMs)                 // ONE sim tick  (Idle(nil))
       module._gamePrepareFrame()                // ConstructRenderList + PreRender (once)
       gl.bindFramebuffer(FBO = glLayer.framebuffer)
       for view in pose.views:                   // N eyes, same sim state
         gl.viewport/scissor = glLayer.getViewport(view)
         writeMatrices(view.projectionMatrix, view.transform.inverse.matrix ∘ anchor)
         module._xrRenderView(eye)               // RenderScene + RenderEffects, NO present
       // UA submits the layer FB at callback end — no SDL_GL_SwapWindow
```

Why invert rather than keep the engine loop and swap its yield to the XR rAF:
driving from JS keeps the draw calls **synchronously inside** the XR callback.
The alternative (resume the C++ stack via Asyncify *after* the callback) runs the
draws in a microtask once the frame is no longer active, which the opaque-FB
contract forbids — the highest-uncertainty path. Inversion avoids it.

Parking mechanism: `xrSetMode(1)` sets an engine flag; while set, `reVCYieldFrame`
awaits an XR-controlled promise that only resolves on exit, so the blocking loop
suspends at the top of its iteration and never re-enters `Idle` on its own. On
`xrSetMode(0)` the promise resolves and the desktop loop resumes exactly once.

---

## 4. Bridge contract to implement (plan §4; none exist yet)

New `EMSCRIPTEN_KEEPALIVE` exports in `sdl2.cpp` + a tiny XR state in librw.
Matrices crossing the boundary are pre-allocated `Float32Array` views into WASM
memory (re-created if the heap grows); the opaque FB is **never** treated as an
int and never touched outside its callback.

| Export | Owns | Does |
|---|---|---|
| `xrSetMode(enabled)` | loop/present | Park/restore the desktop loop; make `setFrameBuffer`/`showRaster`/present no-ops; flag librw into XR mode. |
| `gameAdvance(dtMs)` | sim | One tick: the sim half of `Idle` (`Idle(nil)` path). Never per eye. |
| `gamePrepareFrame()` | render-list | `ConstructRenderList` + `PreRender` + far-clip/fog, once/frame. |
| `xrRenderView(eye)` | per-eye draw | Push the eye's view/proj/viewport (already staged in the shared buffer), begin camera, scissored clear, `RenderScene` + `RenderEffects`. No 2D, no present. |
| `xrResetInput()` | input | Neutralize staged actions after blur/exit (F4 use; stubbed in F2). |
| `xrGetAnchor()` / `xrGetTelemetry()` | state | Player/vehicle world transform for the anchor; counters (idle count vs view count) for the "one update / N views" proof. |

Staging buffer (one write per frame, read per eye): `eyeProj[16]`, `eyeView[16]`,
`eyeViewport[4]`, `eyeIndex`. View already composed JS-side as
`view.transform.inverse.matrix * worldToXr`.

---

## 5. librw override plan (gated by the XR flag; desktop path untouched)

Add file-scope XR state to `gl3device.cpp` (`xrActive`, `xrProj[16]`,
`xrView[16]`, `xrVp[4]`) set via the bridge, and branch the four seams:
- `beginUpdate`: when `xrActive`, **skip** the cam-derived view/proj build and push
  `xrView`/`xrProj` verbatim via `setViewMatrix`/`setProjectionMatrix` (still set
  fog from cam). Keeps the runtime's asymmetric projection; no invented IPD/FOV.
- `setFrameBuffer`: when `xrActive`, **no-op** — JS has already bound the opaque
  `glLayer.framebuffer` on the shared context; librw must not rebind the camera FBO
  or re-attach depth (the UA owns the FB's depth).
- `setViewport` + `clearCamera`: when `xrActive`, use `xrVp` and **always scissor**
  the clear to it, so clearing one eye never wipes the other. **Invalidate**
  `glGlobals.present*` on each eye switch so the cached-viewport early-out
  (`:1285`) does not skip the re-set.
- `showRaster`: when `xrActive`, **no-op** (the UA presents).

---

## 6. Concrete obstacles / risks (ranked; this is the real F2 output)

1. **Re-entrancy while Asyncify-suspended (highest risk).** Can we call
   `_gameAdvance`/`_xrRenderView` from JS while `main()` is parked inside
   `reVCYieldFrame`'s `await`? Expected yes (the stack is unwound, globals are not
   stack-bound, and the parked promise won't resolve until we say so), but this is
   the assumption the whole inversion rests on. **Test first, in isolation.**
   Fallback if it fails: keep the engine loop and drive the XR rAF from *inside*
   `reVCYieldFrame`, accepting the opaque-FB-timing problem (§3) — materially harder.
2. **Shared GL context + `makeXRCompatible`.** The `XRWebGLLayer` must be built from
   the **engine's** SDL/Emscripten WebGL2 context (so engine draws reach the layer),
   not a second context. Must obtain it in JS (`Module.GLctx` / the engine canvas)
   and `makeXRCompatible()` it without triggering a context loss on a multi-GPU
   machine (plan's context-loss/restore concern). **Obstacle if SDL created it on
   the wrong adapter.**
3. **Binding the opaque FB from the engine.** Resolved by design: JS binds
   `glLayer.framebuffer`; librw `setFrameBuffer` is a no-op under XR; the engine
   draws into the currently-bound FB on the same context. Must still verify
   Emscripten GLES draws actually land in the UA-bound opaque FB.
4. **Projection/handedness conversion. RESOLVED (math + wiring) 2026-11-11 — see §11.**
   WebXR proj (GL column-major, right-handed, `-Z`, metres) vs librw's RW proj
   (`proj[11]=1`, X-flipped left-handed view). Key fact: librw's gl3 shader is a
   plain `gl_Position = u_proj*u_view*(u_world*pos)`, and RW-eye ↔ GL-eye differ by
   the constant involution `M=diag(-1,1,-1,1)` (a 180° yaw). So the correct feed is
   `P_rw = P_gl·M` (negate cols 0,2) and a per-eye view delta `Δ = M·viewInv·M`
   left-multiplied onto the engine's own camera view. Proven by `tests/xr-rw.test.mjs`
   (grid corners, asymmetry preserved, the master identity `P_rw·Δ·V_cam ≡
   P_gl·viewInv·(M·V_cam)`, parallax symmetry). Still `pending hardware`: the
   empirical anchor signs (XR-forward↔game-heading, 6DoF translation scale).
5. **Factoring Idle for one-update/N-views.** `gameAdvance` = `Idle(nil)`;
   `xrRenderView` = a new `RenderWorldXR()` doing `DoRWStuffStartOfFrame`-equivalent
   (begin + scissored clear) → `RenderScene` + `RenderEffects`, with
   `ConstructRenderList`/`PreRender` lifted into `gamePrepareFrame` so they run once.
   Must ensure `CTimer`/`DMAudio`/motion-blur advance exactly once.
6. **World scale & anchor.** Confirm engine world units ↔ metres so 6DoF head
   motion has the right magnitude, and define the player→XR-origin anchor
   (`xrGetAnchor`). Testable with the grid before a headset.
7. **Culling for two eyes.** `ConstructRenderList` is built for one camera; a list
   culled to one eye can pop objects in the other. For F2 (seated, eyes close
   together) build once from the head/centre; record it as a known risk to revisit.

---

## 7. First experiment (minimal, no game assets)

Goal: prove **loop ownership + framebuffer + projection** against the real backend
with the least surface — exactly plan §6 F2 step "primeiro desenhar geometria de
diagnóstico pelo backend nativo".

- Boot the engine via the **`?engine=1`** empty-install path (`main.ts:177-183`) —
  no commercial data needed.
- Add `xrSetMode` + a throwaway `xrRenderView` that draws **im3d/diagnostic
  geometry** (a 1 m grid + reference cubes through librw's own immediate path), not
  the world. Drive it from our own minimal loader + the F1 `XRSessionManager`.
- Acceptance (diagnostic, pre-headset): two viewport-scissored images in the layer
  FB, per-eye asymmetric projection applied, head pose moving the camera 6DoF,
  `ViceIdleCount` advancing once per `viewCount==2` frame (the one-update/N-views
  counter). In-headset depth/parallax is a later, `pending hardware` check.
- **Decision gate:** if obstacle #1 or #2 blocks functional access to
  loop/framebuffer/projection, stop and record it here with the revised estimate —
  do **not** advance to the real-world slice or gameplay (plan §6 F2 decision point).

---

## 8. Status of this spike

- [x] Mechanism mapped end-to-end (loop, Idle seam, librw seams, both web sides).
- [x] Architecture chosen (invert loop; JS drives; engine parked) with rationale.
- [x] Bridge contract + librw override + obstacles specified.
- [x] Experiment #1 **built & run**. Self-test passes on real hardware (Chrome,
      WebGL2) with **no game data**.
- [x] **Obstacle #1 (Asyncify re-entrancy) RESOLVED — this was the architecture's
      load-bearing assumption.** Evidence (browser self-test, 2026-11-11):
      - `parked loop: ViceLogicFrame 850→850, ViceIdleCount 0→0 — FROZEN ✓`
        (`xrSetMode(1)` parks the engine's own loop; it stops advancing).
      - `re-entrant xrRenderView: xrViewCount 0→1, glError=0` (an engine export
        called from JS **while `main()` is Asyncify-suspended** runs cleanly).
      - `readback pixel = [15,3,3,255] — C++ drew into the FB ✓` (the C++ GLES3
        draw landed in the JS-bound framebuffer; `[15,3,3]` is the eye-0 clear
        tint `0.06,0.01,0.01`). So **JS can drive the engine's renderer into a
        JS-bound framebuffer, per eye, with the engine loop parked** — the whole
        "invert the loop" plan is validated end-to-end minus the headset.
- [ ] Stereo **in a headset / WebXR emulator** (two distinct images + parallax of
      the grid + cubes). Blocked only by hardware: the run reported `immersive-vr
      not offered` (no PS VR2 adapter yet, no WebXR API Emulator installed). This is
      the `pending hardware` half — the plan always deferred perceptual proof.
- [ ] Obstacle #2 (shared GL context + `makeXRCompatible`): untested until an XR
      session can start (needs emulator/headset).
- [ ] Step 2 of F2 ("paused real-world slice"): needs a Vice City install + the
      real `RenderScene` wired through the librw XR override (§5), not the
      standalone diagnostic program. Not started.

### Obstacle encountered & resolved: booting with no install
The engine will not reach a stable state with an empty game dir — it hard-depends
on a full install at several points, each a separate wall hit in sequence:
1. `ValidateVersion()` (`main.cpp:174`) reads the game version from
   `models/coll/peds.col`; when missing it shows "Invalid version" and spins in
   `while(true)` (froze/`null function`).
2. `CFont::Initialise` (via `CGame::InitialiseRenderWare`) retries
   `MODELS/FONTS.TXD` in a tight no-yield loop → tab "Page Unresponsive".
3. (and `CGame::Initialise` later needs `gta_vc.dat`, models, collision…).

Fix: a **diag-boot halt** gated by the JS global `__viceDiagHalt` (set by the host
before boot). In `Initialise3D` (`main.cpp:534`), right after `RsRwInitialize`
brings up the RW/WebGL2 device and **before** `CGame::InitialiseRenderWare`, the
engine calls `reVCDiagSpin()` — an infinite `reVCFrames++; reVCYieldFrame();` loop
that keeps a live GL context + a parkable Asyncify yield without loading any game
data. `xrDiagReady()` tells the host it reached the spin. The earlier main-loop
halt and `ValidateVersion` skip are kept as backups but are no longer reached.

### Files changed (Experiment #1)
- `engine/wasm-revc/src/CMakeLists.txt` — export `HEAPF32` + the `xr*` symbols
  (`_xrSetMode/_xrIsActive/_xrViewCount/_xrProjPtr/_xrViewPtr/_xrRenderView/_xrDiagReady`).
- `engine/wasm-revc/src/skel/sdl2/sdl2.cpp` — `__viceXrActive` parking branch in
  `reVCYieldFrame`; the `xr*` exports; `reVCDiagSpin()` (diag-boot yield loop).
- `engine/wasm-revc/src/core/main.cpp` — `reVCDiagHaltMain()` flag read;
  `ValidateVersion` skip; `reVCDiagSpin()` call in `Initialise3D` after RW init.
- `engine/wasm-revc/vendor/librw/src/gl/gl3device.cpp` — self-contained GLES3
  `xrDrawDiagnostic` (1 m grid + reference cubes, verbatim XR matrices).
- `web/xr-engine.html`, `web/src/xr-engine/host.js` — our own minimal host (not the
  licensed `@wasm/shell`); `scripts/serve.mjs` — `no-store` + `/__log` dev sink.

## 9. F2 step 2 — real-world stereo (DONE, diagnostic level) — 2026-11-11

The real Vice City world now renders in stereo in-browser, no headset.

- **Data mount:** the legit classic install is junctioned into
  `local-game-data/vice-city` and served by `serve.mjs` under `/vc/` (+ the re3
  overlay `engine/.../gamefiles` under `/vcx/`), with `/vc-manifest`,
  `/vcx-manifest`. `web/xr-engine.html?data=1` fetches the needed subset (models,
  data, anim, TEXT, txd, skins, scripts — audio/mp3/movies skipped; the build is
  NULL-audio) and writes it into MEMFS: **216 files, 459 MB, ~2 s**. The game boots
  to gameplay (third-person).
- **Stereo render path (bridge):** `xrGameAdvance()` = `Idle(nil)` (one sim tick);
  `xrRenderWorld(buildList)` = `ConstructRenderList`/`PreRender` (once) +
  `DoRWStuffStartOfFrame_Horizon` + `RenderScene` + `RenderEffects`, **no 2D/HUD/
  present**. librw stereo override (`gl3device.cpp`): `setFrameBuffer` no-op (host
  owns the FB), `beginUpdate` shifts the view in RW view-space X by ±ipd/2 and sets
  the eye viewport, `clearCamera` scissors to the eye. `web/.../host.js`
  **Preview stereo** parks the engine (`xrSetMode`) and, per rAF, runs one
  `xrGameAdvance` then two `xrStereoEye`+`xrRenderWorld` into the two canvas halves.
- **Verified:** two distinct images of the real world with horizontal parallax,
  one sim tick / two views, no asserts/GL errors once in gameplay. Matches the
  plan's F2 side-by-side diagnostic acceptance.
- **Gotchas found:** (a) the engine will not boot without a full install (version
  gate / fonts / models) — handled by the diag-spin for no-data and by mounting the
  real install here; (b) the preview is only valid in `GS_PLAYING_GAME` (==9) — at
  the frontend `CdStreamRead` asserts (`hImage<=0`) and hangs; the host now guards
  on gameState. `CdStreamRead` is synchronous (reads MEMFS directly), so driving the
  engine re-entrantly from JS during gameplay is safe.

### Still open for full F2
1. ~~Replace the exaggerated fixed eye-offset with the real WebXR view + asymmetric
   projection fed verbatim through librw.~~ **DONE 2026-11-11 — see §11.** The crude
   eye-offset/aspect hack is now the `?proj=crude` fallback; the default feeds the
   real matrices converted via `web/src/xr-engine/xr-rw.js` (proven in
   `tests/xr-rw.test.mjs`).
2. Wire `Enter VR` to drive the same `xrGameAdvance`/`xrRenderWorld` from the WebXR
   rAF (done; needs the WebXR API Emulator or a real headset to view/tune signs).
3. Perceptual depth / 6DoF head tracking: `pending hardware` (PS VR2 adapter).

## 10. State at 2026-11-11 pause + how to resume

### What works now
- Real Vice City renders **in an immersive WebXR session** (verified in the WebXR
  API Emulator, device "Meta Quest 3") and in an on-canvas **Preview stereo** mode.
- **Stereo:** per-eye render, one sim tick / N views; crude fixed eye-offset +
  per-eye aspect correction (not yet the runtime's asymmetric projection).
- **Head-look (rotation):** `xrHeadSet(yaw,pitch)` rotates the view per eye. Proven
  via mouse-drag in the preview; **confirmed correct** after sign tuning
  (`host.js`: `headYaw -= dx*0.005`, `headPitch -= dy*0.005`). In `Enter VR` the
  same `xrHeadSet` is fed from `pose.transform.orientation` (`HEAD_YAW_SIGN`/
  `HEAD_PITCH_SIGN`, both `1`) — **those pose-path signs are NOT yet confirmed**
  (next: rotate the emulator **headset**, not the controllers, and flip signs if off).

### Bridge API (all `EMSCRIPTEN_KEEPALIVE`; `sdl2.cpp` unless noted)
`xrSetMode(on)` park/unpark the engine loop · `xrIsActive/xrViewCount/xrDiagReady`
telemetry · `xrProjPtr/xrViewPtr` float[16] buffers (diagnostic path) ·
`xrRenderView(eye,x,y,w,h)` diagnostic grid+cubes · `xrGameAdvance()` (main.cpp)
one sim tick (`Idle(nil)`) · `xrRenderWorld(buildList)` (main.cpp) real world, no
2D/present · `xrStereoEye(eye,ipd,x,y,w,h)` + `xrStereoDone()` librw stereo
override · `xrHeadSet(yaw,pitch)` view-space head rotation (radians). Diag-boot:
`__viceDiagHalt` → `reVCDiagSpin` (halts after RW init so the engine comes up with
**no** game data; used by the diagnostic page without `?data=1`).

### Files
- Engine patches: `src/CMakeLists.txt` (exports+HEAPF32), `src/skel/sdl2/sdl2.cpp`,
  `src/core/main.cpp`, `vendor/librw/src/gl/gl3device.cpp`.
- Host (ours): `web/xr-engine.html`, `web/src/xr-engine/host.js` (reuses
  `web/src/xr/session.js` `XRSessionManager` + `web/src/gl/math.js`).
- Server: `scripts/serve.mjs` (`no-store`, `/__log` client-log sink, `/vc` + `/vcx`
  game routes + `/vc-manifest` `/vcx-manifest`).
- Data: `local-game-data/vice-city` = **Windows junction** to the user's classic
  install (`C:\Users\jpcos\OneDrive\Documents\GTA Vice City`). Re-create with
  `New-Item -ItemType Junction` if missing. NULL-audio build → audio/mp3/movies are
  not mounted.

### How to run (fresh session)
1. **Docker Desktop running** (only needed to rebuild the engine).
2. Rebuild only if engine source changed:
   `powershell -ExecutionPolicy Bypass -File scripts/build-web-docker.ps1`
   then copy `engine/wasm-revc/web/public/reVC.{js,wasm}` → `web/`.
3. Ensure the junction `local-game-data/vice-city` exists.
4. `node scripts/serve.mjs` (serves `web/` on :8080, COOP/COEP on).
5. Open **http://localhost:8080/xr-engine.html?data=1** in Chrome/Edge (install the
   **WebXR API Emulator** extension for `Enter VR`). The `/__log` sink mirrors the
   browser log to the server stdout — read it to debug.
6. Click the **canvas**, use **↑/↓ + Enter** to start **New Game**, skip the intro
   until controlling Tommy (`GS_PLAYING_GAME == 9`). Then **Preview stereo** (drag to
   look, `[`/`]` tune IPD) or **Enter VR** (rotate the headset in the emulator).

### Next (resume here)
Items 2 & 3 below are now **implemented** (§11): the real per-eye WebXR projection
and view (with 6DoF head pose) are converted to RW convention and pushed verbatim,
replacing the eye-offset + aspect hack. What remains before F2 can be called
`physically validated`:
1. **Emulator/headset pass on the default (real) path.** Boot `?data=1`, reach
   gameplay, `Enter VR`. Verify: upright, not inside-out, head turn/translation go
   the right way, stereo depth reads. If a sign is off, flip the anchor sign in
   `host.js` (`worldHooks.getAnchor`/the delta source) — no rebuild — or reload with
   `?proj=crude` to A/B against the old path. The **Preview stereo** button runs the
   same conversion on-canvas (drag to look) so most of this is checkable without a
   headset.
2. **Anchor the XR origin precisely to the game camera / player.** Today the delta
   rides on the game camera (anchor = identity in XR space). For a stable 6DoF feel
   confirm metres↔game-unit scale and the XR-forward↔heading mapping.
3. **F3: first-person** — anchor the camera at the player's head, hide Tommy's body,
   decouple look/body/aim, keyboard+mouse movement. This is where it becomes the
   intended experience. (See also the `vision-beyond-vc-vr` note for the longer goal.)

## 11. Obstacle #4 resolved — real projection + 6DoF via verbatim matrices — 2026-11-11

The crude stereo (fixed eye-offset + aspect hack + separate `xrHeadSet` rotation,
all on the game camera's own projection) is replaced by feeding the **real per-eye
WebXR projection and view**, converted into exactly librw's convention and pushed
**verbatim**. One coherent path now carries the asymmetric runtime frustum, the
head rotation, the IPD, and 6DoF head translation — the former §10 items 1/2/3 at
once.

### The conversion (proven before any headset)
librw's gl3 vertex shader is a plain column-major `gl_Position = u_proj * u_view *
(u_world * pos)`. RW eye space is left-handed (camera looks down **+Z**, world **X
flipped**); WebXR/GL eye space is right-handed (looks down **−Z**). Both are +Y up,
so the two eye frames differ by the constant involution **`M = diag(-1,1,-1,1)`** (a
180° yaw, `M = M⁻¹`). Therefore:
- **Projection:** `P_rw = P_gl · M` → negate columns 0 and 2 of the WebXR matrix.
  Preserves the real asymmetric frustum; no invented FOV; no aspect hack.
- **View:** reuse the engine's own RW camera view `V_cam` and left-multiply a per-eye
  delta **`Δ = M · view.transform.inverse.matrix · M`**, so
  `final = P_rw · Δ · V_cam ≡ P_gl · viewInv · (M·V_cam)` — the world exactly as the
  real XR eye at the game camera would see it. Winding/culling parity matches the
  desktop path (both are single-flip → front faces stay front; **not** inside-out).

Validated by `tests/xr-rw.test.mjs` (8 invariants, all green): `M·M=I`; `rwProjFromGl`
negates the right columns; `P_rw`(RW point) == `P_gl`(M·point); 1 m-grid frustum
corners → NDC corners; an asymmetric frustum keeps its off-centre projection; the
master identity above; synthetic IPD offset; symmetric parallax between eyes. This is
the plan's "validate with the grid + math.test.mjs **before** trusting a headset".

### What stays `pending hardware`
The **structure** is proven; the **empirical anchoring** is not — which way "XR
forward" should map onto the game heading, and the exact 6DoF translation sign/scale,
need the emulator/headset (the plan always deferred perceptual proof). Fallbacks are
wired: `?proj=crude` restores the old path; the on-canvas Preview runs the real
conversion so signs can be eyeballed without a headset.

### Files changed (§11)
- **New:** `web/src/xr-engine/xr-rw.js` (the conversion: `rwProjFromGl`,
  `rwViewDeltaFromGl`, `syntheticWorldToEye`), `tests/xr-rw.test.mjs` (8 tests).
- **Engine:** `vendor/librw/src/gl/gl3device.cpp` — verbatim-matrix branch in
  `beginUpdate` (`xrStereoSetM`, `gXrVerbatim`, `xrMat4Mul`), crude path kept behind
  the flag. `src/skel/sdl2/sdl2.cpp` — `xrStereoProjPtr`/`xrStereoViewPtr`/
  `xrStereoEyeM` exports + staging buffers. `src/CMakeLists.txt` — export the three
  new symbols. Rebuilt via Docker (256/256), copied to `web/`, exports verified.
- **Host:** `web/src/xr-engine/host.js` — Preview + `Enter VR` stage the converted
  matrices and call `xrStereoEyeM` by default; `?proj=crude` fallback; `xrStereoDone`
  on session end.
