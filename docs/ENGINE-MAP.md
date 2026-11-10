# ENGINE-MAP — real integration points for WebXR

Mapped during F0 from the pinned source in `engine/wasm-revc` (commit
`acde392e`, librw `ac6b902b`). Every reference below is a real `file:line:symbol`
in that checkout. This is the input to F2 (the stereo spike): it identifies
*where* simulation, scheduling, camera, render target, input, saves and
streaming actually live, and *what* each XR intervention has to do.

Line numbers are from this pinned revision; re-verify after any re-fetch.

---

## 1. Frame scheduling (who owns the loop)

| What | Where | Note |
|---|---|---|
| Browser frame pacing | `src/skel/sdl2/sdl2.cpp:12-56` (`reVCYieldFrame`, `EM_ASYNC_JS`) | The C++ game loop is **suspended on `requestAnimationFrame`** via Asyncify each frame; the compositor sets the pace. A Web Worker `setInterval(16ms)` keeps a hidden tab alive. |
| Alive counter | `sdl2.cpp:30-31` (`reVCFrames` → `ViceLogicFrame`) | Exported so JS can tell "running" from "actually advancing". |
| Loop → engine dispatch | `sdl2.cpp:1437,2201` (`RsEventHandler(rsIDLE,TRUE)`), `sdl2.cpp:2134` (`rsFRONTENDIDLE`) | These dispatch into `Idle()` / `FrontendIdle()` in `main.cpp`. |

**XR intervention (F2):** during an immersive session, presentation must follow
`XRSession.requestAnimationFrame`, not the Asyncify rAF yield. Exactly one loop
may drive the engine. The XR raf callback must pump **one** engine update then
draw **N** views, and the desktop yield path must be suspended for the duration
and cleanly restored on exit. This is the plan's "transfer scheduling ownership".

## 2. Simulation vs. render split (the critical seam)

`src/core/main.cpp` — `Idle(void *arg)` at **`main.cpp:1575`** is the per-frame
function. Its own comment (`main.cpp:1568`) warns that if the outer loop spins
without `Idle` running you get a static, unlit world — "indistinguishable from a
broken renderer."

| Phase | Calls (file:line) |
|---|---|
| **Simulation** (must run once/frame) | `CTimer::Update()` `:1580`, `CGame::Process()` `:1591`, `DMAudio.Service()` `:1596` |
| Render-list build (once/frame) | `CRenderer::ConstructRenderList()` `:1637`, `CRenderer::PreRender()` `:1641` |
| Frame begin (camera + clear + present-begin) | `DoRWStuffStartOfFrame_Horizon()` `:1652/1655`, `DefinedState()` `:1661` |
| **World draw** (per-eye candidate) | `RenderScene()` `:1669`, `RenderEffects()` `:1677`, `RenderMotionBlur()` `:1690` |
| 2D / HUD / menus / fade | `Render2dStuff()` `:1694`, `RenderMenus()` `:1710`, `DoFade()` `:1719`, `Render2dStuffAfterFade()` `:1723` |
| Frame end (present) | `DoRWStuffEndOfFrame()` `:1733` (defined `:363`, `FlushObrsPrintfs` `:367`) |

Key observations:
- `Idle(arg)` **already early-returns before rendering when `arg == nil`**
  (`main.cpp:1612`). So a **simulation-only tick** (advance physics/AI/audio, no
  draw) is reachable without new engine surgery — useful for the "one update, N
  views" contract.
- `RenderScene()` (`main.cpp:1386`, new path `RenderScene_new` `:1309`) and
  `RenderEffects()` (`:1429`) are the world passes to repeat per eye from the
  **same** simulation state.
- 2D/HUD/menus and `DoFade` assume a single screen — they are F4 (in-XR HUD),
  not F2. For the F2 spike, draw world per eye and skip/defer 2D.

**XR intervention (F2):** run simulation + render-list build **once**; draw the
world **once per `XRView`**; move present out of per-eye into a single submit of
the XR layer framebuffer. Audit every draw-time function for state it mutates
(e.g. `RenderMotionBlur` `:1690`, `SetMotionBlurAlpha` `:1681`) so a second eye
does not double-advance it.

## 3. Camera

| What | Where |
|---|---|
| Game camera object | `src/core/Camera.h` (`CCamera` / `TheCamera`); per-frame far clip + fog set at `main.cpp:1647-1648` (`RwCameraSetFarClipPlane`, `RwCameraSetFogDistance`) |
| RW camera used to render | `Scene.camera` (passed to `RsCameraBeginUpdate` `main.cpp:1705`) |
| Actual view/proj construction | librw `beginUpdate` (see §4) — derived from the RW camera frame LTM + `viewWindow` |

**XR intervention:** prefer overriding view/projection at the **librw level**
(§4) so the runtime's matrices are used verbatim, rather than fighting
`CCamera`'s first-person/vehicle modes. `CCamera` still owns *where the body/eye
anchor is* in the world; XR owns head pose and projection.

## 4. Render target, viewport, projection (librw GL3 — the override point)

`vendor/librw/src/gl/gl3device.cpp`:

| Function | Line | What it does | XR override |
|---|---|---|---|
| `beginUpdate(Camera*)` | `1296` | Builds `view[16]` from `Matrix::invert(cam LTM)`, **flips X** for a left-handed view space (`1300-1319`); builds `proj[16]` from `cam->viewWindow`/`viewOffset`/near-far (`1324-1356`); pushes via `setViewMatrix` `1321` / `setProjectionMatrix` `1356`; then `setFrameBuffer` `1369` + `setViewport` `1371`. | Replace `view` with the per-eye `XRView.transform.inverse.matrix` (composed with the locomotion anchor) and `proj` with `XRView.projectionMatrix` **verbatim** (asymmetric; no invented FOV/IPD). Mind the X-flip / handedness when converting WebXR (right-handed, metres) to engine space. |
| `setFrameBuffer(Camera*)` | `1207` | Binds the camera FBO `natfb->fbo` (`1218`) + depth attach. | Bind `XRWebGLLayer.framebuffer` instead of the camera FBO; do not treat it as an integer. |
| `getFramebufferRect` / `setViewport` | `1252` / `1282` | Viewport from SDL window size (`1258`) or subraster; caches in `glGlobals.present*` (`1285-1292`). | Use `XRWebGLLayer.getViewport(view)` per eye. Invalidate the `glGlobals.present*` cache on eye switch and on desktop restore. |
| `clearCamera` | `1379` | `glScissor`+`GL_SCISSOR_TEST` only when subrastered (`1389-1393`), then `glClear` (`1406`). | Scissor the clear to each eye's viewport so clearing one eye never wipes the other (plan hazard). |
| Present | `glfwSwapBuffers` `1435` (GLFW path) | Buffer swap. | Under XR do **not** swap/present per draw; the UA submits the layer framebuffer at raf end. |
| Device vtable | `2134-2135` (`gl3::beginUpdate`, `gl3::endUpdate`) | RW plugin seam where these hooks are registered. | Cleanest place to install an XR-aware begin/end without scattering `#ifdef`s. |

State-cache note: `rwStateCache` + `glGlobals.present*` cache matrices/viewport.
XR must sync/invalidate these when switching eyes and when handing the context
back to desktop — the plan's "sincronizar caches de estado".

## 5. Input

| What | Where |
|---|---|
| SDL keyboard events | `sdl2.cpp:1600-1609` (`RsKeyboardEventHandler`), `inputEventHandler()` `:1660` |
| SDL pad events | `sdl2.cpp:~2397+` (`RsPadEventHandler`) |
| Game pad state consumed | `CPad::GetPad(0)->NewState.*` (e.g. `main.cpp:786-806`) |

**XR intervention (F4, prepared in F1):** the new WebXR input bridge feeds a
single normalized action source into `CPad`'s state, and the SDL keyboard/pad
handlers must not **also** apply the same device — the "avoid double input (SDL +
new bridge)" rule. The F1 diagnostic already models this arbitration
(`web/src/input/actions.js` `InputArbiter`).

## 6. Saves & streaming

| What | Where |
|---|---|
| Save flush to IDBFS | `sdl2.cpp:1747` (`ViceSyncSaves`) + loader mounts IDBFS at `/gtavc/userfiles`, runs `syncfs` (from report) |
| Native save slots | re3/reVC `CGenericGameStorage` (engine) |
| Streaming | `CStreaming` (engine) + JS `ArchiveStreamer` (report), on-demand from mounted FS |

**XR intervention:** F5 preserves native slots, stores XR config separately, and
must finish `syncfs`/flush **before** confirming a save. F6 treats cold cache /
delayed / cancelled streaming so a load never blocks the XR raf thread.

## 7. JS<->WASM bridge surface (existing `Vice*` exports)

All `EMSCRIPTEN_KEEPALIVE` in `src/skel/sdl2/sdl2.cpp` unless noted:

- **Telemetry:** `ViceLogicFrame:31`, `ViceScreenWidth:1614`/`Height:1615`,
  `ViceRenderWidth:1618`/`Height:1619`, `ViceRasterW:1620`/`H:1622`,
  `ViceGameState:1712`, `ViceMenuActive:1713`/`Screen:1714`,
  `ViceForeground:1715`, `ViceIconified:1716`, `ViceHeapUsed:1741`,
  `ViceMenuFade:1758`, `ViceFirstStart:1759`, `ViceTimeMs:1760`,
  `ViceLogicalFrames:1761`, `ViceMouseX:1762`/`Y:1794`,
  `ViceDrawnMouseX:1792`/`Y:1793`, `ViceWindowW:1795`/`H:1796`,
  `ViceSkyTop:1777`/`Bottom:1780`/`Ambient:1783`,
  `ViceClockHours:1786`/`Minutes:1789`; plus `ViceIdleCount` (`main.cpp:1571`),
  `ViceFrontendStage` (`main.cpp:1746`).
- **Control:** `ViceSetResolution(w,h):1720`, `ViceStartGame():1768`,
  `ViceSyncSaves():1747`.

**Delta vs production:** the report observed `_ViceViewerCamera`, `_VicePlayerX`,
`_VicePlayerInVehicle`, `_VicePresentedFrames` in the *production* glue. An
initial grep of this public base does **not** find them — only `ViceSetResolution`
and the telemetry set above. So the production port carries bridge code (camera /
player instrumentation) not present in `acde392e`. Our XR bridge contracts (plan
§4: `xrSetMode`, `xrSubmitInput`, `gameAdvance`, `gamePrepareFrame`,
`xrRenderView`, `xrGetAnchor`, `xrGetTelemetry`, `xrResetInput`) are **new** and
will be added here as `EMSCRIPTEN_KEEPALIVE`/Embind exports — they do not exist
yet.

---

## F2 entry checklist (derived from the above)

1. Take over scheduling: suspend `reVCYieldFrame` rAF yield; drive the engine
   from the XR raf loop (`sdl2.cpp:12-56`, `:1437`).
2. Split `Idle()` (`main.cpp:1575`): one `CGame::Process` + render-list build;
   per-eye `RenderScene`/`RenderEffects`; single present.
3. Override at `gl3device.cpp` `beginUpdate:1296` + `setFrameBuffer:1207` +
   `setViewport:1282`: XR framebuffer, per-eye viewport, verbatim XR projection,
   scissored clear (`clearCamera:1379`).
4. First draw diagnostic geometry through the native backend, then a paused real
   world slice; show separate update/view counters (plan F2 acceptance).
