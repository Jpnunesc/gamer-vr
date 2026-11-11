# engine-patches — reproducible engine modifications (F2/F3 bridge)

The pinned engine checkout lives under `engine/` and is **gitignored** (fetched by
`scripts/fetch-engine.*`, never vendored into our history). All of our F2/F3 work,
however, required source edits inside that checkout to add the `xr*`/`Vice*` bridge
exports and the librw stereo override. Those edits only exist in the engine working
tree — if it is ever cleaned or re-fetched, the bridge (and the ability to rebuild
`web/reVC.wasm`) is lost.

These patch files capture those edits so the exact binary can be reproduced.

## Pinned base commits (see `docs/SOURCES.md`)

- `wasm-revc` @ **acde392e** ("Correct the hemisphere handling in compressed
  keyframe interpolation")
- `vendor/librw` @ **ac6b902b** ("fix: Atomic::RenderCB returns Atomic*, matching
  RenderWare")

## Patches

- `wasm-revc-src.patch` — edits under `engine/wasm-revc/src/`:
  - `CMakeLists.txt` — export/keepalive wiring for the new bridge symbols.
  - `core/main.cpp` — F2 parked-loop + stereo driver and F3 first-person camera
    pose/body-hide/cull-width/time bridge (`xrGameAdvance`, `xrRenderWorld`,
    `xrStereo*`, `xrSetFirstPerson`, `xrSetCullVW`, `xrSetTime`, `xrEyeInfoPtr`,
    diagnostics, and the `Vice*` status accessors).
  - `core/Pad.cpp` — F3 locomotion input injection (`xrSetMove`/`xrClearMove`
    overwrite pad 0's left stick at the end of `CPad::UpdatePads`).
  - `skel/sdl2/sdl2.cpp` — Asyncify loop ownership (park/resume) during an XR
    session.
- `librw-gl3device.patch` — `vendor/librw/src/gl/gl3device.cpp`: the verbatim
  per-eye projection + view override and scissored per-eye clear (F2 obstacle #4).

The authoritative, prose description of every export and the mechanism is in
`docs/STEREO-SPIKE.md` (§9–§11) and `docs/WALKING-TEST.md`; `docs/ENGINE-MAP.md`
maps each hook to the real `file:line` in the pinned base.

## Apply (after a fresh fetch)

```sh
scripts/fetch-engine.ps1            # or .sh — fetches the pinned base
git -C engine/wasm-revc apply ../../engine-patches/wasm-revc-src.patch
git -C engine/wasm-revc/vendor/librw apply ../../../../engine-patches/librw-gl3device.patch
powershell -ExecutionPolicy Bypass -File scripts/build-web-docker.ps1   # rebuild
```

The committed `web/reVC.js` + `web/reVC.wasm` are the **confirmed** F2/F3 binary;
rebuilding should reproduce them (pinned base + these patches). Note the build
image is `emscripten/emsdk:latest` — pin it to a digest before relying on
bit-reproducibility.

## Regenerate (after changing engine source)

```sh
git -C engine/wasm-revc diff -- src/ > engine-patches/wasm-revc-src.patch
git -C engine/wasm-revc/vendor/librw diff -- src/gl/gl3device.cpp > engine-patches/librw-gl3device.patch
```
