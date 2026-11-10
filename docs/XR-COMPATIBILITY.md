# XR-COMPATIBILITY — environments tried and results

F1 deliverable. This is a **fillable record**, not a support claim. WebXR is the
common interface; browser, runtime, controllers, memory and GPU decide what
actually works. A headset brand is not evidence — only physical validation is.

Fill one block per environment tried. The F1 diagnostic
(`web/index.html`, served by `scripts/serve.mjs`) auto-detects most rows; copy
them from its panel.

## How to run the diagnostic

```bash
node scripts/serve.mjs      # http://localhost:8080/  (COOP/COEP on)
```

Open in the target browser. Without a headset, use a WebXR emulator extension
(clearly mark results as emulated). With the PS VR2, use SteamVR/OpenXR.

## Status

- [x] Diagnostic implemented (feature probe, session lifecycle, both input modes)
- [ ] Validated in a desktop browser (no XR) — fill below
- [ ] Validated with the WebXR emulator — fill below (mark as emulated)
- [ ] **Physically validated on PS VR2 + PC + SteamVR** — PENDING HARDWARE
      (adapter expected ~1 week from 2026-11-10)

Emulation/mocks do not prove Sense controllers, perceived depth, or headset
latency. Max status without a headset is "ready for physical validation".

---

## Environment template (copy per environment)

```
### <date> — <browser/version> — <runtime> — <GPU>
- Context: secure=?, crossOriginIsolated=?, SharedArrayBuffer=?
- WebGL2: ?   GPU (unmasked): ?
- navigator.xr: ?   immersive-vr supported: ?
- Reference space granted: local-floor | bounded-floor | local | viewer
- Input profiles seen (handedness / profiles): ?
- Presented FPS (XR, not canvas): ?   Framebuffer: <w>x<h>
- Null-pose events during test: ?
- Mouse: pointer lock acquired in-session? relative movement during VR? ?
- Enter/exit/re-enter x3: ?
- Notes / failures (verbatim): ?
- Emulated or physical: ?
```

## Headset test matrix (physical, PS VR2 — run when hardware arrives)

From PLANO-EXECUCAO.md §8. Each must be checked on the real device:

| Check | Failure it catches |
|---|---|
| Matrices w/ known points & rotations | inverted axis, wrong scale, doubled height/IPD |
| One update + N views | physics/audio/particles advancing per eye |
| Fixed path, different render cadences | game speed tied to headset Hz |
| Per-eye framebuffer/viewport capture | eye wiped, symmetric projection, clip divergence |
| Two controllers, varied profiles, missing pose | wrong mapping, stuck buttons |
| **Headset + keyboard/mouse, no XR controllers** | undue Sense dependency, input lost in session |
| Head turning during WASD + mouse aim | movement redirected, head pose overridden |
| Mouse capture lost, focus regained, key held | accumulated deltas, spurious turns, stuck actions |
| Swap kbd/mouse <-> VR controllers mid-session | duplicated input, inherited fire, session restart |
| Menus/weapon/driving with each source | functions reachable only with VR controllers |
| Enter/exit/re-enter XR x3 | duplicated loops, camera not restored, leaks |
| Cold cache, delayed net, cancelled read | XR freeze, file corruption, use-after-free |
| Save, close, reopen, import | progress loss, confirm-before-flush |
| Desktop route before/after | regression outside VR |

## Performance targets (F6, not yet measured)

- 90 Hz on PS VR2 if the mode is available => 11.1 ms/frame budget (both views).
- 120 Hz => 8.3 ms (not an initial requirement).
- Acceptance: 5-min route, cold/warm cache separated, >=95% of present
  intervals within 1.2x the target period, no app stalls >50 ms during
  stabilized exploration; record p99, resolution, runtime-reported reprojection.
- These are targets, not observed results.
