// WebXR → RenderWare matrix conversion invariants (F2 obstacle #4).
// Run: npm test   (node --test)
//
// These prove the handedness/projection conversion in web/src/xr-engine/xr-rw.js
// BEFORE a headset ever sees it — the plan's "validate with the grid +
// tests/math.test.mjs" gate. They assert the structural identity the whole
// stereo path rests on; the empirical anchor/sign tuning is a separate
// emulator pass (see host.js SIGN notes).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../web/src/gl/math.js';
import { M_RW_GL, rwProjFromGl, rwViewDeltaFromGl, syntheticWorldToEye } from '../web/src/xr-engine/xr-rw.js';

const near = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~= ${b}`);

// Apply a column-major 4x4 to a point, keeping w (clip space).
function clip(mat, p) {
  const { x, y, z } = p;
  return {
    x: mat[0] * x + mat[4] * y + mat[8] * z + mat[12],
    y: mat[1] * x + mat[5] * y + mat[9] * z + mat[13],
    z: mat[2] * x + mat[6] * y + mat[10] * z + mat[14],
    w: mat[3] * x + mat[7] * y + mat[11] * z + mat[15],
  };
}
const ndc = (c) => ({ x: c.x / c.w, y: c.y / c.w, z: c.z / c.w });
const nearClip = (a, b, eps = 1e-4) => { near(a.x, b.x, eps); near(a.y, b.y, eps); near(a.z, b.z, eps); near(a.w, b.w, eps); };

// Standard GL off-axis frustum (column-major), the shape a WebXR runtime emits.
function glFrustum(l, r, b, t, n, f, out = new Float32Array(16)) {
  out.fill(0);
  out[0] = (2 * n) / (r - l);
  out[5] = (2 * n) / (t - b);
  out[8] = (r + l) / (r - l);
  out[9] = (t + b) / (t - b);
  out[10] = -(f + n) / (f - n);
  out[11] = -1;
  out[14] = -(2 * f * n) / (f - n);
  return out;
}

test('M is its own inverse (basis change is an involution)', () => {
  assert.ok(m.approxEqual(m.multiply(M_RW_GL, M_RW_GL), m.identity()));
});

test('rwProjFromGl negates exactly columns 0 and 2', () => {
  const P = m.perspective(Math.PI / 2, 1.5, 0.1, 100);
  const R = rwProjFromGl(P);
  for (let i = 0; i < 16; i++) {
    const col = (i / 4) | 0;
    const flip = col === 0 || col === 2 ? -1 : 1;
    near(R[i], flip * P[i]);
  }
});

test('P_rw of an RW-eye point == P_gl of the matching GL-eye point', () => {
  // The core claim P_rw = P_gl·M: projecting an RW-eye point (forward +Z)
  // through P_rw equals projecting its GL-eye image M·p through P_gl.
  const P = m.perspective(Math.PI / 2, 1, 0.1, 100);
  const Prw = rwProjFromGl(P);
  for (const p of [{ x: 0, y: 0, z: 5 }, { x: 1.2, y: -0.7, z: 9 }, { x: -3, y: 2, z: 20 }]) {
    const gl = { // GL-eye image of the RW point: M·p
      x: -p.x, y: p.y, z: -p.z,
    };
    nearClip(clip(Prw, p), clip(P, gl));
  }
});

test('grid: forward point centres; right frustum edge → NDC.x = +1', () => {
  // 90° symmetric frustum, aspect 1: half-width at depth d is d. RW forward is
  // +Z, and RW flips X, so the right screen edge is RW-x = -d.
  const P = m.perspective(Math.PI / 2, 1, 0.1, 100);
  const Prw = rwProjFromGl(P);
  near(ndc(clip(Prw, { x: 0, y: 0, z: 5 })).x, 0);        // dead ahead
  near(ndc(clip(Prw, { x: 0, y: 0, z: 5 })).y, 0);
  near(ndc(clip(Prw, { x: -5, y: 0, z: 5 })).x, 1, 1e-4); // right edge (RW flips X)
  near(ndc(clip(Prw, { x: 5, y: 0, z: 5 })).x, -1, 1e-4); // left edge
  near(ndc(clip(Prw, { x: 0, y: 5, z: 5 })).y, 1, 1e-4);  // top edge (RW keeps +Y up)
});

test('asymmetric runtime frustum keeps its off-centre projection', () => {
  // An off-axis frustum (right eye canted): the on-axis ray is NOT at NDC 0.
  const n = 0.1, f = 100;
  const P = glFrustum(-0.2 * n, 0.3 * n, -0.25 * n, 0.25 * n, n, f); // asymmetric in X
  const Prw = rwProjFromGl(P);
  // A point straight ahead in RW eye space (0,0,d) maps through to a NON-zero,
  // left-shifted NDC.x because the frustum is wider on the right.
  const nx = ndc(clip(Prw, { x: 0, y: 0, z: 10 })).x;
  assert.ok(Math.abs(nx) > 1e-3, 'asymmetry must survive (NDC.x != 0 for the on-axis point)');
  // Its sign/magnitude equals what the GL frustum gives for the GL-eye image.
  near(nx, ndc(clip(P, { x: 0, y: 0, z: -10 })).x, 1e-5);
});

test('master identity: P_rw · Δ · V_cam ≡ P_gl · viewInv · (M · V_cam)', () => {
  // The whole stereo path: the engine's RW camera view V_cam, with a WebXR eye
  // delta on top, projects a world point exactly where the real XR eye sees it.
  const P = m.perspective((75 * Math.PI) / 180, 1.3, 0.05, 500);
  const Prw = rwProjFromGl(P);
  // A plausible RW camera view and an XR eye pose (world→eye), both arbitrary.
  const Vcam = m.multiply(m.translation(12, -3, 40), m.rotationY(0.6));
  const eyePose = m.compose({ x: 0.031, y: 0.02, z: -0.1 }, { x: 0.05, y: 0.2, z: 0, w: Math.sqrt(1 - 0.05 * 0.05 - 0.2 * 0.2) });
  const viewInv = m.invert(eyePose); // view.transform.inverse.matrix

  const delta = rwViewDeltaFromGl(viewInv);
  const lhs = m.multiply(Prw, m.multiply(delta, Vcam));
  const rhs = m.multiply(P, m.multiply(viewInv, m.multiply(M_RW_GL, Vcam)));

  for (const p of [{ x: 0, y: 0, z: 0 }, { x: 5, y: 2, z: -3 }, { x: -20, y: 8, z: 15 }]) {
    nearClip(clip(lhs, p), clip(rhs, p), 1e-3);
  }
});

test('syntheticWorldToEye: identity at rest, pure offset for IPD', () => {
  assert.ok(m.approxEqual(syntheticWorldToEye(0, 0, 0), m.identity()));
  const w2e = syntheticWorldToEye(0, 0, 0.031); // right eye 31mm to the right
  // eye is at +0.031 → world→eye translates by -0.031 in x, no rotation.
  near(w2e[12], -0.031); near(w2e[13], 0); near(w2e[14], 0);
  assert.ok(m.approxEqual(w2e.slice(0, 3), new Float32Array([1, 0, 0])));
});

test('stereo parallax is symmetric between the two eyes', () => {
  // Same sim state, two eyes offset ±ipd/2: a forward object projects to
  // mirror-image horizontal NDC (|left.x| == |right.x|, opposite signs),
  // and vertically identical. This is the "two distinct images" proof, math-only.
  const P = m.perspective(Math.PI / 2, 1, 0.05, 100);
  const Prw = rwProjFromGl(P);
  const Vcam = m.identity();
  const target = { x: 0, y: 0, z: 10 }; // 10 units ahead in RW eye space
  const eye = (dx) => {
    const delta = rwViewDeltaFromGl(syntheticWorldToEye(0, 0, dx));
    const full = m.multiply(Prw, m.multiply(delta, Vcam));
    return ndc(clip(full, target));
  };
  const L = eye(-0.033), R = eye(+0.033);
  assert.ok(Math.abs(L.x) > 1e-4, 'parallax must be non-zero');
  near(L.x, -R.x, 1e-6); // symmetric
  near(L.y, R.y, 1e-6);  // no vertical disparity
});
