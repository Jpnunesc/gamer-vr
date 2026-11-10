// WebGL2 diagnostic renderer. Own geometry only (no engine, no game data).
//
// Draws a 1-metre reference grid, coloured reference cubes at known positions,
// controller/hand axis gizmos, and an aim ray + reticle. The grid and cubes
// exist to verify scale, axes/handedness and stereo parallax by eye in F2 and
// in the headset — the same checks the matrix tests cover numerically.
//
// renderView() is called once per XRView. It takes the runtime's view and
// projection matrices verbatim; it never invents FOV or IPD.

import * as M from './math.js';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
uniform float uAlpha;
out vec4 outColor;
void main() { outColor = vec4(vColor, uAlpha); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function buildMesh(gl, positions, colors, mode) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const pb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const cb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, count: positions.length / 3, mode };
}

function gridMesh(gl, half = 10, step = 1) {
  const pos = [], col = [];
  for (let i = -half; i <= half; i++) {
    const c = i === 0 ? [0.5, 0.9, 0.5] : [0.25, 0.3, 0.35];
    pos.push(i * step, 0, -half * step, i * step, 0, half * step);
    col.push(...c, ...c);
    pos.push(-half * step, 0, i * step, half * step, 0, i * step);
    col.push(...c, ...c);
  }
  return buildMesh(gl, pos, col, gl.LINES);
}

function cubeMesh(gl, s = 0.5, color = [1, 1, 1]) {
  // 12 triangles, flat colour (shaded slightly per face for depth cue).
  const v = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ];
  const faces = [
    [0, 1, 2, 3, 0.6], [5, 4, 7, 6, 0.6],
    [4, 0, 3, 7, 0.8], [1, 5, 6, 2, 0.8],
    [3, 2, 6, 7, 1.0], [4, 5, 1, 0, 0.4],
  ];
  const pos = [], col = [];
  for (const [a, b, c, d, shade] of faces) {
    const cc = [color[0] * shade, color[1] * shade, color[2] * shade];
    for (const idx of [a, b, c, a, c, d]) {
      pos.push(...v[idx]);
      col.push(...cc);
    }
  }
  return buildMesh(gl, pos, col, gl.TRIANGLES);
}

function axesMesh(gl, len = 0.1) {
  // RGB = XYZ. A gizmo for controller/hand poses.
  const pos = [
    0, 0, 0, len, 0, 0,
    0, 0, 0, 0, len, 0,
    0, 0, 0, 0, 0, len,
  ];
  const col = [
    1, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 1, 0,
    0, 0.4, 1, 0, 0.4, 1,
  ];
  return buildMesh(gl, pos, col, gl.LINES);
}

function rayMesh(gl, len = 5) {
  const pos = [0, 0, 0, 0, 0, -len];
  const col = [1, 1, 0.2, 1, 0.4, 0.1];
  return buildMesh(gl, pos, col, gl.LINES);
}

export function createRenderer(gl) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(prog));
  }
  const loc = {
    proj: gl.getUniformLocation(prog, 'uProj'),
    view: gl.getUniformLocation(prog, 'uView'),
    model: gl.getUniformLocation(prog, 'uModel'),
    alpha: gl.getUniformLocation(prog, 'uAlpha'),
  };

  const grid = gridMesh(gl);
  const axes = axesMesh(gl);
  const ray = rayMesh(gl);
  // Reference cubes at known positions: colour-coded by axis direction.
  const cubes = [
    { mesh: cubeMesh(gl, 0.5, [0.9, 0.3, 0.3]), model: M.translation(2, 0.5, 0) },   // +X red
    { mesh: cubeMesh(gl, 0.5, [0.3, 0.9, 0.3]), model: M.translation(0, 0.5, -2) },  // -Z green (forward)
    { mesh: cubeMesh(gl, 0.5, [0.3, 0.5, 0.9]), model: M.translation(-2, 0.5, 0) },  // -X blue
    { mesh: cubeMesh(gl, 0.3, [0.9, 0.9, 0.3]), model: M.translation(0, 1.2, -1) },  // near, elevated
  ];

  gl.enable(gl.DEPTH_TEST);

  function draw(mesh, model, alpha = 1) {
    gl.uniformMatrix4fv(loc.model, false, model);
    gl.uniform1f(loc.alpha, alpha);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(mesh.mode, 0, mesh.count);
  }

  // scene = { controllers:[{matrix}], aim:{matrix}|null }
  function renderView(viewMatrix, projMatrix, viewport, scene) {
    const { x, y, width, height } = viewport;
    // Scissor so clearing one eye's viewport never wipes the other.
    gl.enable(gl.SCISSOR_TEST);
    gl.viewport(x, y, width, height);
    gl.scissor(x, y, width, height);
    gl.clearColor(0.05, 0.06, 0.08, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.proj, false, projMatrix);
    gl.uniformMatrix4fv(loc.view, false, viewMatrix);

    draw(grid, M.identity());
    for (const c of cubes) draw(c.mesh, c.model);
    if (scene) {
      for (const ctl of scene.controllers || []) {
        draw(axes, ctl.matrix);
        draw(ray, ctl.matrix, 0.9);
      }
      if (scene.aim) draw(ray, scene.aim, 0.9);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  return { renderView, program: prog };
}
