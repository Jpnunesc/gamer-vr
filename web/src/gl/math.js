// Minimal column-major 4x4 matrix / vector math for the F1 diagnostic.
//
// Column-major, same memory layout as WebGL uniforms and WebXR's
// XRView matrices (Float32Array length 16). Element m[col*4 + row].
//
// This module is deliberately dependency-free and pure so the same code can be
// unit-tested under `node --test` (see tests/math.test.mjs). The matrix tests
// are a risk reducer from the plan: they catch inverted axes, wrong scale and
// doubled height/IPD before anything reaches a headset.

export function identity(out = new Float32Array(16)) {
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}

export function clone(m) {
  return new Float32Array(m);
}

// out = a * b  (apply b first, then a — standard GL composition)
export function multiply(a, b, out = new Float32Array(16)) {
  const r = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      r[c * 4 + row] =
        a[0 * 4 + row] * b[c * 4 + 0] +
        a[1 * 4 + row] * b[c * 4 + 1] +
        a[2 * 4 + row] * b[c * 4 + 2] +
        a[3 * 4 + row] * b[c * 4 + 3];
    }
  }
  if (r !== out) out.set(r);
  return out;
}

export function translation(x, y, z, out = new Float32Array(16)) {
  identity(out);
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function scaling(x, y, z, out = new Float32Array(16)) {
  identity(out);
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function rotationX(rad, out = new Float32Array(16)) {
  const c = Math.cos(rad), s = Math.sin(rad);
  identity(out);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

export function rotationY(rad, out = new Float32Array(16)) {
  const c = Math.cos(rad), s = Math.sin(rad);
  identity(out);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

export function rotationZ(rad, out = new Float32Array(16)) {
  const c = Math.cos(rad), s = Math.sin(rad);
  identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

// Rotation matrix from a unit quaternion {x,y,z,w} (WebXR pose orientation).
export function fromQuaternion(q, out = new Float32Array(16)) {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  identity(out);
  out[0] = 1 - (yy + zz); out[1] = xy + wz;       out[2] = xz - wy;
  out[4] = xy - wz;       out[5] = 1 - (xx + zz); out[6] = yz + wx;
  out[8] = xz + wy;       out[9] = yz - wx;       out[10] = 1 - (xx + yy);
  return out;
}

// Compose a rigid transform from position {x,y,z} and orientation quaternion.
// Matches how WebXR reports XRRigidTransform.matrix.
export function compose(position, orientation, out = new Float32Array(16)) {
  fromQuaternion(orientation, out);
  out[12] = position.x;
  out[13] = position.y;
  out[14] = position.z;
  return out;
}

// Symmetric perspective (fallback only). In real XR we use the runtime's
// projection matrix verbatim — never a hand-rolled FOV/IPD. See xr/session.js.
export function perspective(fovYRad, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

// General 4x4 inverse (used to turn a view-pose matrix into a view matrix).
export function invert(m, out = new Float32Array(16)) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// Transform a point (w=1) by a column-major matrix. Returns {x,y,z}.
export function transformPoint(m, p) {
  const x = p.x, y = p.y, z = p.z;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return {
    x: (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    y: (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    z: (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  };
}

export function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

export function approxEqual(a, b, eps = 1e-5) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}
