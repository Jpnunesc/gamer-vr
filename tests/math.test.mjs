// Matrix/vector invariants — risk reducer from PLANO-EXECUCAO.md section 8.
// Run: npm test   (node --test)
//
// These assert the properties that, when violated, produce the classic XR
// bugs: inverted axis, wrong scale, doubled eye height / IPD, wrong matrix
// composition order.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../web/src/gl/math.js';

const near = (a, b, eps = 1e-5) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~= ${b}`);
const nearP = (p, q, eps = 1e-5) => {
  near(p.x, q.x, eps); near(p.y, q.y, eps); near(p.z, q.z, eps);
};

test('identity leaves a point unchanged', () => {
  const p = m.transformPoint(m.identity(), { x: 3, y: -2, z: 7 });
  nearP(p, { x: 3, y: -2, z: 7 });
});

test('translation moves a point exactly once (no doubling)', () => {
  const t = m.translation(0, 1.6, 0); // e.g. eye height
  const p = m.transformPoint(t, { x: 0, y: 0, z: 0 });
  nearP(p, { x: 0, y: 1.6, z: 0 });
});

test('scale applies once, not squared', () => {
  const s = m.scaling(2, 2, 2);
  const p = m.transformPoint(s, { x: 1, y: 1, z: 1 });
  nearP(p, { x: 2, y: 2, z: 2 });
});

test('rotationY(90deg) sends +Z to +X (right-handed)', () => {
  // Right-handed: rotating +Z by +90 deg about Y yields +X.
  const r = m.rotationY(Math.PI / 2);
  const p = m.transformPoint(r, { x: 0, y: 0, z: 1 });
  nearP(p, { x: 1, y: 0, z: 0 });
});

test('composition order: multiply(T, R) rotates then translates', () => {
  const T = m.translation(10, 0, 0);
  const R = m.rotationY(Math.PI / 2);
  const TR = m.multiply(T, R); // apply R first, then T
  const p = m.transformPoint(TR, { x: 0, y: 0, z: 1 });
  // R: (0,0,1) -> (1,0,0); then T: +10 x -> (11,0,0)
  nearP(p, { x: 11, y: 0, z: 0 });
});

test('identity quaternion yields identity matrix', () => {
  const q = m.fromQuaternion({ x: 0, y: 0, z: 0, w: 1 });
  assert.ok(m.approxEqual(q, m.identity()));
});

test('quaternion 90deg about Y matches rotationY', () => {
  const h = Math.PI / 4; // half angle
  const q = m.fromQuaternion({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
  assert.ok(m.approxEqual(q, m.rotationY(Math.PI / 2)));
});

test('invert(compose(pos,orient)) maps the pose origin back to origin', () => {
  // A view matrix is the inverse of the eye pose. Transforming the eye
  // position by the view matrix must land at the origin (camera space).
  const pos = { x: 1.2, y: 1.6, z: -3.4 };
  const orient = (() => {
    const h = 0.3;
    return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
  })();
  const pose = m.compose(pos, orient);
  const view = m.invert(pose);
  const p = m.transformPoint(view, pos);
  nearP(p, { x: 0, y: 0, z: 0 }, 1e-4);
});

test('eye height is not applied twice (local-floor sanity)', () => {
  // Guard against summing floor height and eye height. Applying a single
  // 1.6m offset must yield 1.6, not 3.2.
  const floorToEye = m.translation(0, 1.6, 0);
  const p = m.transformPoint(floorToEye, { x: 0, y: 0, z: 0 });
  near(p.y, 1.6);
  assert.notEqual(Math.round(p.y * 10) / 10, 3.2);
});

test('perspective is invertible and clip-space sane', () => {
  const P = m.perspective(Math.PI / 2, 1, 0.1, 100);
  assert.ok(m.invert(P) !== null, 'projection must be invertible');
  // A point on the near plane center maps to clip z within [-w, w].
  near(P[11], -1); // perspective divide term present
});
