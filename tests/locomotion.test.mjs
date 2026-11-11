// F3 locomotion input-mapping invariants (keyboard + VR thumbstick → move vector).
// Run: npm test   (node --test)
//
// Pins the signs, deadzone, clamping and keyboard/stick merge of
// web/src/xr-engine/locomotion.js BEFORE a headset ever sees it — the same
// "prove it before hardware" gate as tests/xr-rw.test.mjs. The signs here MUST
// stay consistent with Pad.cpp's xrSetMove (fwd → -LeftStickY, strafe → +LeftStickX)
// and the first-person camera in main.cpp.

import test from 'node:test';
import assert from 'node:assert/strict';
import { keysToMove, stickToMove, mergeMove, pickThumbstick } from '../web/src/xr-engine/locomotion.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~= ${b}`);
const mag = (v) => Math.hypot(v.fwd, v.strafe);
const keysOf = (...ks) => { const s = new Set(ks); return (k) => s.has(k); };

test('keysToMove: W is forward, S back, D right, A left', () => {
  assert.deepEqual(keysToMove(keysOf('w')), { fwd: 1, strafe: 0 });
  assert.deepEqual(keysToMove(keysOf('s')), { fwd: -1, strafe: 0 });
  assert.deepEqual(keysToMove(keysOf('d')), { fwd: 0, strafe: 1 });
  assert.deepEqual(keysToMove(keysOf('a')), { fwd: 0, strafe: -1 });
});

test('keysToMove: opposing keys cancel, none = still', () => {
  assert.deepEqual(keysToMove(keysOf('w', 's')), { fwd: 0, strafe: 0 });
  assert.deepEqual(keysToMove(keysOf('a', 'd')), { fwd: 0, strafe: 0 });
  assert.deepEqual(keysToMove(keysOf()), { fwd: 0, strafe: 0 });
});

test('keysToMove: diagonal is normalised (not faster than cardinal)', () => {
  const d = keysToMove(keysOf('w', 'd'));
  near(mag(d), 1);
  near(d.fwd, Math.SQRT1_2);
  near(d.strafe, Math.SQRT1_2);
});

test('stickToMove: resting / inside deadzone produces no movement', () => {
  assert.deepEqual(stickToMove([0, 0, 0, 0]), { fwd: 0, strafe: 0 });
  assert.deepEqual(stickToMove([0, 0, 0.1, -0.1]), { fwd: 0, strafe: 0 }); // |.14| < .15
});

test('stickToMove: push up = forward, push right = strafe right', () => {
  const up = stickToMove([0, 0, 0, -1]);      // thumbstickY = -1 (up)
  assert.ok(up.fwd > 0 && Math.abs(up.strafe) < 1e-9);
  const right = stickToMove([0, 0, 1, 0]);    // thumbstickX = +1 (right)
  assert.ok(right.strafe > 0 && Math.abs(right.fwd) < 1e-9);
});

test('stickToMove: full deflection ≈ 1, magnitude never exceeds 1', () => {
  near(stickToMove([0, 0, 0, -1]).fwd, 1, 1e-9);
  // A hypothetical over-range diagonal still clamps to the unit disc.
  assert.ok(mag(stickToMove([0, 0, 1, -1])) <= 1 + 1e-9);
});

test('stickToMove: speed ramps from 0 at the deadzone edge (no snap)', () => {
  const dz = 0.15;
  const justInside = stickToMove([0, 0, 0, -(dz + 1e-4)]);
  near(justInside.fwd, 0, 2e-3); // essentially zero right at the edge
  const half = stickToMove([0, 0, 0, -(dz + (1 - dz) / 2)]);
  assert.ok(half.fwd > 0.4 && half.fwd < 0.6); // mid-throw ≈ half speed
});

test('stickToMove: missing or short axes → no movement', () => {
  assert.deepEqual(stickToMove(undefined), { fwd: 0, strafe: 0 });
  assert.deepEqual(stickToMove([0.9, 0.9]), { fwd: 0, strafe: 0 }); // touchpad-only, no thumbstick
});

test('mergeMove: stick wins when deflected, keyboard otherwise', () => {
  const key = { fwd: 1, strafe: 0 };
  const stick = { fwd: 0, strafe: 0.8 };
  assert.deepEqual(mergeMove(key, stick), stick);
  assert.deepEqual(mergeMove(key, { fwd: 0, strafe: 0 }), key);
});

test('pickThumbstick: prefers the left controller', () => {
  const sources = [
    { handedness: 'right', gamepad: { axes: [0, 0, 0.2, 0.2] } },
    { handedness: 'left', gamepad: { axes: [0, 0, 0.5, 0.6] } },
  ];
  assert.deepEqual(pickThumbstick(sources), [0, 0, 0.5, 0.6]);
});

test('pickThumbstick: falls back to any 4-axis gamepad, skips invalid', () => {
  const sources = [
    { handedness: 'none', gamepad: null },
    { handedness: 'right', gamepad: { axes: [0, 0] } },     // too few axes
    { handedness: 'right', gamepad: { axes: [0, 0, 0.3, 0.4] } },
  ];
  assert.deepEqual(pickThumbstick(sources), [0, 0, 0.3, 0.4]);
  assert.equal(pickThumbstick(null), null);
  assert.equal(pickThumbstick([]), null);
});
