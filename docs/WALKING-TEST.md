# WALKING-TEST — F3 first-person walking (plan §6 F3 deliverable)

Started 2026-11-11. F3 turns the F2 stereo proof (third-person camera + XR head
pose) into the intended **first-person** experience: the camera sits at the
player's head, the body is hidden, look is decoupled from body, and movement goes
through the engine's native collision/physics. This doc tracks the increments and
the on-headset acceptance route (plan §6 F3: "dez minutos de percurso ... sem
teleportes involuntários, input preso ou alteração indevida da simulação").

This is a design + progress record, not a validated result. Cite real `file:line`
in the pinned base; re-verify after any re-fetch/rebuild.

## Plan §6 F3 items (scope)
1. **Anchor the camera at the player** with configurable height, decoupled
   orientation, body parts hidden.
2. **Forward movement to native collision/physics**; WASD/mouse first, then VR
   sticks, using the same gameplay actions. Snap-turn + comfort without overriding
   the head pose.
3. **Positional audio** tied to head position/orientation when the backend allows
   (not per-eye).
4. **Stairs, walls, interiors, pause, loading, respawn**; adapt the audio listener
   and any needed visual effects.

Delivery: a short VR walk + this doc. Approval: ten minutes of a defined route in
each input mode, in the headset, no involuntary teleports / stuck input / sim-rate
change; looking sideways keeps WASD body-relative on the default profile.

## Increment 1 — first-person anchor + body hide — 2026-11-11 (item 1, partial)

**What it does.** `?fp=1` makes the XR render come from the player's head instead
of the third-person camera, and hides the player model. The XR head pose still
rides on top via the F2 verbatim view delta (`gl3device.cpp`), so **look is
decoupled from body**: turning the head looks around; the body faces its own
heading. Stereo + real projection are unchanged from F2.

**Mechanism (engine, `src/core/main.cpp`).** A new `EMSCRIPTEN_KEEPALIVE`
`xrSetFirstPerson(on, eyeHeight)` sets a flag. While set:
- `xrRenderWorld` calls `xrPoseFirstPersonCamera()` **every eye**: it re-poses
  `Scene.camera`'s RW frame to `FindPlayerCoors() + (0,0,eyeHeight)`, looking along
  `FindPlayerHeading()` (`fwd=(-sin h, cos h, 0)`, world up `+Z`, `right=up×fwd`),
  mirroring how `CCamera` poses the RW frame (`Camera.cpp:579-609`). `beginUpdate`
  then builds the view from this frame; `DoRWStuffStartOfFrame_Horizon`'s
  `CameraSize`/`SetRenderWareCamera` do **not** move the frame, so the pose survives
  to the draw.
- On the eye that builds the render list, `xrHidePlayerForRender()` sets
  `FindPlayerPed()->bIsVisible = false` **before** `ConstructRenderList`, so the
  player isn't added. `xrGameAdvance` restores it on the next sim tick (player stays
  visible to AI/shadows during the sim, hidden only for the draw).

**Host (`web/src/xr-engine/host.js`).** `?fp=1` enables it in **Preview** and
**Enter VR**; `?eye=0.6` sets the initial eye height (default `0.5` m above the ped
origin); `-`/`=` tune it live. Disabled on preview-stop / session-end.

**State.** ✅ **Confirmed in-game (2026-11-11):** first-person renders from the head,
body hidden, look decoupled. Anchor verified correct by the live readout
(`eye z=11.0`, ground 9.4 → 1.6 m eye height); position sane in the world.

**Culling (fixed for position/orientation + FOV; head-turn margin tunable).**
`CRenderer::ScanWorld` culls to `TheCamera.m_pRwCamera`'s frame and view window.
Because `TheCamera.m_pRwCamera == Scene.camera` (Game.cpp:416), re-posing the frame
for first-person already moves the cull frustum's **position + orientation** to the
head. The remaining issue was **FOV width**: ScanWorld used the game's narrow view
window while we render a wider per-eye FOV (and the head turns via the delta), so the
periphery was culled → "seeing between the walls" (reported 2026-11-11). Fix: in FP
mode `xrRenderWorld` **widens the cull view window** (`gXrCullVW`, default 2.0 ≈ 127°)
around `ConstructRenderList`, then restores it. The verbatim render ignores the view
window (it uses the staged projection), so widening only **adds** geometry to the list
— it can't harm the render. `xrSetCullVW(vw)` tunes it live (host keys `,`/`.`); widen
if large head turns still reveal holes (cost: more draw calls). A fully
direction-independent cull (scan a box of sectors, or rotate the cull frame with the
head) is a later refinement. Note `ms_vecCameraPosition` (distance/LOD) still uses the
third-person position — a few metres off, so minor LOD bias only.
- **Empirical values.** The heading→forward sign and the eye height are guesses —
  if the body faces backward, flip `fwd` in `xrPoseFirstPersonCamera`; tune eye
  height with `-`/`=`. (Same "signs pending a real run" posture as F2 obstacle #4.)
- **Body hide is all-or-nothing** via `bIsVisible`. Fine for a proof; later we may
  want to keep arms/weapon (F4) while hiding only the head/torso.
- **Not yet done (F3 items 2–4):** WASD→ped locomotion inside the parked XR loop
  (input routing), snap-turn/comfort, positional audio listener at the head, and
  stairs/interiors/pause/loading/respawn handling.

## Increment 2 — WASD locomotion through native physics — 2026-11-11 (item 2, partial)

**What it does.** WASD walks Tommy using the engine's own player-control / collision
/ physics — no custom movement code. The host pushes a movement vector into pad 0's
left stick; the native control path does the rest (so stairs, walls, slopes just
work).

**Mechanism.** `CGame::Process` calls `CPad::UpdatePads()` every sim tick (Game.cpp:846),
which runs inside our parked-loop `xrGameAdvance`. New exports `xrSetMove(fwd, strafe)`
/ `xrClearMove()` (Pad.cpp) stash a vector; at the **end of `UpdatePads`** — after the
real input is read — pad 0's `NewState.LeftStickX/Y` is overwritten with it, so the
player-control functions (`PlayerControl*`, all read `GetPedWalkLeftRight/UpDown`) move
Tommy. Movement is **camera-relative** (`PlayerPed.cpp:858` offsets by
`TheCamera.Orientation`); since the first-person camera faces the body heading, WASD is
**body-relative** and the decoupled XR head-look does **not** change the walk direction
— which is exactly the plan's default-profile requirement.

**Host.** `moveKeys` tracks W/A/S/D; `sendMove()` runs each tick **before**
`xrGameAdvance` (so the value is set before `UpdatePads` reads it) in both Preview and
Enter VR, but only while `?fp=1`. Diagonal is normalized. Cleared on preview-stop /
session-end.

**State.** ✅ **Confirmed working in-game (2026-11-11, mono preview):** WASD walks Tommy,
signs correct as-shipped (forward = `-LeftStickY`, right = `+LeftStickX`), native
collision applies. No sprint/jump yet (walk only); VR stick locomotion, snap-turn and
comfort options are later.

**Flat-screen viewing.** The side-by-side stereo preview looks "broken" on a flat
monitor by design (two eyes with exaggerated separation — only fuses in a headset). The
preview now defaults to **MONO** (one full-canvas first-person image; press `m` for the
stereo split) so the world + locomotion are easy to see/test without a headset. The
stereo/Enter-VR path is unchanged and is the real target.

## Increment 3 — VR controller thumbstick locomotion — 2026-11-11 (item 2, VR sticks)

**What it does.** Inside an immersive session, the **left controller's thumbstick**
now walks Tommy through the exact same native path as WASD — no new movement code,
no engine rebuild. It reuses the confirmed `xrSetMove` export; only the host changed.

**Mechanism (host only).** The input→vector mapping moved into a pure, unit-tested
module `web/src/xr-engine/locomotion.js`:
- `keysToMove(has)` — WASD → `{fwd, strafe}` (diagonals normalised); replaces the old
  inline logic in `host.js`.
- `stickToMove(axes)` — xr-standard gamepad `axes[2]/axes[3]` (thumbstick X/Y) →
  `{fwd, strafe}`, with a radial deadzone (0.15) and a rescale so speed ramps from 0 at
  the deadzone edge. Up = forward, right = strafe right (signs matched to `xrSetMove`).
- `mergeMove(key, stick)` — stick wins while deflected, else keyboard (one source at a
  time, like F1's input arbitration).
- `pickThumbstick(inputSources)` — prefers the **left** controller, else any source with
  a 4-axis gamepad.

In `worldHooks.update` the host reads `frame.session.inputSources`, picks the thumbstick,
and passes its axes to `sendMove(axes)`; the flat-screen preview still calls `sendMove()`
with no stick (keyboard only), so that confirmed path is byte-for-byte unchanged.

**State.** ⏳ **Code complete, `pending hardware`.** The mapping is proven by
`tests/locomotion.test.mjs` (12 invariants: signs, deadzone, ramp, clamp, merge,
left-hand preference — all green via `npm test`), but the actual stick-in-session walk is
only exercised in the emulator/headset, which is still pending. Right-stick **snap-turn**
is intentionally not here: with a decoupled head + body-relative strafe, turning the body
needs an engine-side heading input (a bridge export + rebuild), so it's deferred with
sprint/jump to the next engine build. No regression risk to the confirmed WASD/FP path.

## How to test (increment 1)
1. `node scripts/serve.mjs`; open `http://localhost:8080/xr-engine.html?data=1&fp=1`.
2. Reach gameplay (New Game → control Tommy, state 9).
3. **Preview stereo** (no headset): you should be at eye level, body hidden, able to
   drag-look. Tune `-`/`=` (eye height), `[`/`]` (IPD).
4. **Enter VR** (emulator/headset): same, with the real head pose.
5. Report: upright? body hidden? eye height sane? looking around decoupled from the
   body? Anything culled/popping when you turn? → feeds the next increment.
