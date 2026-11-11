// F3 locomotion input mapping (pure, testable — no DOM, no WebXR).
//
// Both the keyboard (WASD) and the XR controller thumbstick resolve to the same
// body-relative move vector {fwd, strafe} in [-1, 1], which the host feeds to the
// native pad via xrSetMove (engine: core/Pad.cpp overwrites pad 0's left stick at
// the end of CPad::UpdatePads). Keeping the mapping here lets tests/locomotion.test.mjs
// pin the signs, deadzone, clamping and the keyboard/stick merge WITHOUT a headset —
// same "prove it before hardware" posture as tests/xr-rw.test.mjs.
//
// Conventions (must match Pad.cpp xrSetMove and the FP camera in main.cpp):
//   fwd    = +1 forward  (W / stick up)    -> xrSetMove maps to -LeftStickY
//   strafe = +1 right    (D / stick right) -> xrSetMove maps to +LeftStickX
// Movement is camera-relative in the engine; the first-person camera faces the body
// heading, so this is body-relative and the decoupled XR head-look never steers it.

// Normalise so diagonals aren't faster than cardinals (never scale *up* a short vector).
function clampMag(fwd, strafe) {
  const mag = Math.hypot(fwd, strafe);
  if (mag > 1) return { fwd: fwd / mag, strafe: strafe / mag };
  return { fwd, strafe };
}

// WASD -> move vector. `has(key)` is any predicate over lowercase key names.
export function keysToMove(has) {
  const fwd = (has('w') ? 1 : 0) - (has('s') ? 1 : 0);
  const strafe = (has('d') ? 1 : 0) - (has('a') ? 1 : 0);
  return clampMag(fwd, strafe);
}

// xr-standard gamepad axes = [touchpadX, touchpadY, thumbstickX, thumbstickY].
// Push up (negative thumbstickY) = forward; push right (positive thumbstickX) = strafe
// right. A radial deadzone kills resting drift; past it we rescale [deadzone,1] -> [0,1]
// so speed ramps from zero at the deadzone edge (no snap to a minimum speed).
export function stickToMove(axes, { deadzone = 0.15 } = {}) {
  if (!axes || axes.length < 4) return { fwd: 0, strafe: 0 };
  const x = axes[2] || 0;
  const y = axes[3] || 0;
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || mag === 0) return { fwd: 0, strafe: 0 };
  const scale = Math.min(1, (mag - deadzone) / (1 - deadzone)) / mag;
  return clampMag(-y * scale, x * scale);
}

// One locomotion source at a time: the stick wins while deflected, else the keyboard.
// Mirrors F1's single-active-input arbitration (never sum two sources).
export function mergeMove(keyVec, stickVec) {
  const sMag = Math.hypot(stickVec.fwd, stickVec.strafe);
  return sMag > 0 ? stickVec : keyVec;
}

// Pick a thumbstick from the live XR input sources: prefer the LEFT controller
// (classic locomotion hand), else the first source exposing a 4-axis xr-standard
// gamepad. Returns the axes array or null. Tolerates plain objects (for tests).
export function pickThumbstick(inputSources) {
  if (!inputSources) return null;
  let fallback = null;
  for (const src of inputSources) {
    const g = src && src.gamepad;
    if (!g || !g.axes || g.axes.length < 4) continue;
    if (src.handedness === 'left') return g.axes;
    if (!fallback) fallback = g.axes;
  }
  return fallback;
}
