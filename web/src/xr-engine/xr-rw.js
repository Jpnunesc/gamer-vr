// WebXR → RenderWare (librw gl3) matrix conversion. F2 obstacle #4.
//
// The crude F2 stereo path used the game camera's own projection with an
// aspect-ratio fudge and a hand-rolled eye offset. This module replaces that
// with the *real* per-eye WebXR projection + view, converted into exactly the
// convention librw's gl3 backend consumes, so there is no invented FOV/IPD and
// the asymmetric runtime frustum is preserved. See docs/STEREO-SPIKE.md §9–§10.
//
// ---------------------------------------------------------------------------
// Derivation (every step is asserted in tests/xr-rw.test.mjs)
// ---------------------------------------------------------------------------
// librw gl3 vertex shader (shaders/default.vert, im3d.vert, …):
//     gl_Position = u_proj * u_view * (u_world * vec4(pos,1));
// Standard column-major `matrix * column-vector`. So u_proj and u_view are
// ordinary column-major 4x4s, same layout as WebXR's Float32Array(16).
//
// RW eye space (gl3device.cpp beginUpdate) is LEFT-handed: the camera looks
// down +Z ("at"), and world X is flipped. WebXR/GL eye space is RIGHT-handed:
// the camera looks down -Z. Both have +Y up. The two eye frames therefore
// differ by a constant 180° yaw:
//     M = diag(-1, 1, -1, 1)          // RWeye ↔ GLeye  (its own inverse)
// (+Z_rw forward → -Z_gl forward; +X_rw, which is physical-left because RW
//  flips X, → +X_gl physical-right.)
//
// Consequences used below:
//  * A GL projection P_gl composes with an RW-convention view iff we feed
//        P_rw = P_gl · M            → negate columns 0 and 2 of P_gl.
//    Then P_rw·(RW eye point) == P_gl·(M·point) == the physically-correct clip.
//  * To reuse the engine's own RW camera view V_cam (so we do NOT need to
//    export the camera transform) and add the WebXR head/eye pose on top, the
//    per-eye view delta left-multiplied onto V_cam is
//        Δ = M · view.transform.inverse.matrix · M
//    giving  final = P_rw · Δ · V_cam  ≡  P_gl · viewInv · (M·V_cam), i.e. the
//    world as seen by the real XR eye positioned at the game camera. This one
//    delta carries IPD, head rotation AND 6DoF head translation at once.
//
// The *structure* above is proven by the tests. The empirical anchoring (which
// way "XR forward" maps onto the game heading, and the translation sign/scale
// for 6DoF) still needs an emulator/headset pass — see SIGN notes in host.js.

import { multiply } from '../gl/math.js';

// RWeye ↔ GLeye basis change. Column-major; M === inverse(M).
export const M_RW_GL = new Float32Array([
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
]);

// P_rw = P_gl · M. Right-multiplying by diag(-1,1,-1,1) negates columns 0 and 2
// of the column-major matrix (columns are the contiguous 4-float groups).
export function rwProjFromGl(glProj, out = new Float32Array(16)) {
  for (let i = 0; i < 16; i++) out[i] = glProj[i];
  out[0] = -out[0]; out[1] = -out[1]; out[2] = -out[2]; out[3] = -out[3]; // col 0
  out[8] = -out[8]; out[9] = -out[9]; out[10] = -out[10]; out[11] = -out[11]; // col 2
  return out;
}

// Δ = M · worldToEyeXr · M, the per-eye view delta applied on top of the
// engine's RW camera view (V_final = Δ · V_cam). `worldToEyeXr` is
// view.transform.inverse.matrix (XR space → eye), column-major.
export function rwViewDeltaFromGl(worldToEyeXr, out = new Float32Array(16)) {
  const tmp = multiply(M_RW_GL, worldToEyeXr); // M · viewInv
  return multiply(tmp, M_RW_GL, out);          // (M · viewInv) · M
}

// Convenience for the on-canvas preview, which has no WebXR runtime: build a
// synthetic per-eye GL "world→eye" from a head yaw/pitch and an eye offset, so
// the preview exercises the SAME conversion path as Enter VR instead of the old
// crude override. Returns worldToEyeXr suitable for rwViewDeltaFromGl.
//   headYaw/headPitch: radians (look direction, applied to the head)
//   eyeDx: metres, +right (e.g. +ipd/2 for the right eye, -ipd/2 for the left)
export function syntheticWorldToEye(headYaw, headPitch, eyeDx, out = new Float32Array(16)) {
  // eyePose = headRot · translate(eyeDx) in XR space; worldToEye = inverse.
  // Build inverse directly: translate(-eyeDx) · headRot⁻¹.
  const cy = Math.cos(headYaw), sy = Math.sin(headYaw);
  const cp = Math.cos(headPitch), sp = Math.sin(headPitch);
  // headRot = Ry(yaw)·Rx(pitch); its inverse is Rx(-pitch)·Ry(-yaw).
  // Compose R = Rx(-pitch)·Ry(-yaw) (column-major), then prepend translate(-eyeDx).
  // Ry(-yaw):
  const ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1];
  // Rx(-pitch):
  const rx = [1, 0, 0, 0, 0, cp, -sp, 0, 0, sp, cp, 0, 0, 0, 0, 1];
  const r = multiply(new Float32Array(rx), new Float32Array(ry)); // R = Rx(-pitch)·Ry(-yaw) = headRot⁻¹
  // worldToEye = translate(-eyeDx) · R. A left translation puts t directly in the
  // translation column (columns 0–2 stay R's): (T·R)·v = R·v + t.
  out.set(r);
  out[12] = -eyeDx;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;
  return out;
}
