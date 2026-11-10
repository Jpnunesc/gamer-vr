// F1 diagnostic orchestrator.
//
// Wires: feature probe, device selection (display x input, independent),
// WebGL2 renderer, the input arbiter with keyboard/mouse and XR controllers,
// a simple body-relative locomotion model, and the XR session lifecycle.
//
// Exactly one render loop runs at a time: the desktop rAF loop OR the XR loop.
// Entering VR suspends the desktop loop; exiting restores it.

import { createRenderer } from './gl/renderer.js';
import * as M from './gl/math.js';
import { probeFeatures, featureRows } from './xr/features.js';
import { XRSessionManager } from './xr/session.js';
import { XRControllers } from './xr/input-xr.js';
import { InputArbiter, INPUT_SOURCE, consumeEdges } from './input/actions.js';
import { KeyboardMouse } from './input/keyboard-mouse.js';
import { DeviceSelection, DISPLAY } from './input/device-select.js';
import { Panel } from './ui/panel.js';

const SPEED = 3.0;                 // metres/second walking
const SNAP = (30 * Math.PI) / 180; // snap turn increment
const EYE_HEIGHT = 1.6;

const canvas = document.getElementById('gl');
const gl = canvas.getContext('webgl2', { xrCompatible: true, antialias: true });
if (!gl) {
  document.getElementById('fatal').textContent =
    'WebGL2 unavailable — this browser cannot run the engine renderer either.';
}

const panel = new Panel(document.getElementById('panel'));
const renderer = gl && createRenderer(gl);
const selection = new DeviceSelection();
const arbiter = new InputArbiter(selection.inputMode);
const km = new KeyboardMouse(canvas);
const xrpad = new XRControllers({ dominant: 'right' });
const xr = new XRSessionManager();

// Body-relative locomotion state (the "anchor" for the XR origin / desktop cam).
const player = {
  x: 0, z: 0, bodyYaw: 0,
  aimPitch: 0, aimYaw: 0,
  refSpaceType: null,
};

let lastT = 0;
let desktopRAF = null;
let lastViewerPose = null;

// ---- input + locomotion: ONE update per frame, before any view is drawn ----
function updateInput(dtMs, frame, refSpace, viewerPose) {
  const dt = Math.min(dtMs, 100) / 1000; // clamp to avoid huge steps after stalls
  lastViewerPose = viewerPose || null;

  if (selection.inputMode === INPUT_SOURCE.VR_CONTROLLERS && xr.active) {
    xrpad.update(xr.session, frame, refSpace, arbiter);
  } else {
    const patch = km.tick();
    arbiter.reportNeutral(INPUT_SOURCE.KEYBOARD_MOUSE, km.isNeutral());
    arbiter.apply(INPUT_SOURCE.KEYBOARD_MOUSE, patch);
  }

  const a = arbiter.state;
  // Yaw: continuous (mouse) + snap increments. Head pose is NOT touched here.
  player.bodyYaw += a.turnYaw + a.snapTurn * SNAP;
  player.aimPitch = clamp(a.aimPitch, -1.4, 1.4);
  player.aimYaw = a.aimYaw || 0;

  // Move body-relative: forward is -Z in the body frame. Looking around with
  // the head does not change this (locomotion is body-relative by design).
  const cos = Math.cos(player.bodyYaw), sin = Math.sin(player.bodyYaw);
  const mx = a.moveX, mz = -a.moveY;
  player.x += (cos * mx + sin * mz) * SPEED * dt;
  player.z += (-sin * mx + cos * mz) * SPEED * dt;

  consumeEdges(a); // clear per-frame deltas/edges after applying them once
}

function floorOffset() {
  // local-floor / bounded-floor already put the origin on the floor. For a
  // 'local'/'viewer' fallback we lift the origin by one eye height so the user
  // stands on the grid. Applied exactly once (see math test).
  const t = player.refSpaceType || '';
  return t.startsWith('local-floor') || t.startsWith('bounded') ? 0 : EYE_HEIGHT;
}

function getAnchor() {
  // anchor = T(pos) * Ry(bodyYaw), with floor offset folded into Y.
  const T = M.translation(player.x, floorOffset(), player.z);
  const R = M.rotationY(player.bodyYaw);
  return M.multiply(T, R);
}

function getScene(anchor) {
  // Controller gizmos: XR-space poses lifted into world via the anchor.
  const controllers = xr.active
    ? xrpad.poses.map((p) => ({ matrix: M.multiply(anchor, p.matrix) }))
    : [];
  // Keyboard/mouse aim ray: originates at the head, yaws with the body and
  // pitches with the weapon aim — independent of tracked head orientation.
  let aim = null;
  if (selection.inputMode === INPUT_SOURCE.KEYBOARD_MOUSE) {
    const head = headWorldPosition(anchor);
    const m = M.multiply(M.translation(head.x, head.y, head.z), M.rotationY(player.bodyYaw + player.aimYaw));
    aim = M.multiply(m, M.rotationX(player.aimPitch));
  }
  return { controllers, aim };
}

function headWorldPosition(anchor) {
  if (lastViewerPose) {
    const t = lastViewerPose.transform.position;
    return M.transformPoint(anchor, { x: t.x, y: t.y, z: t.z });
  }
  return { x: player.x, y: floorOffset() + EYE_HEIGHT, z: player.z };
}

// ---------------------------- desktop loop ----------------------------------
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

function desktopFrame(t) {
  desktopRAF = requestAnimationFrame(desktopFrame);
  const dt = t - lastT; lastT = t;
  resize();
  updateInput(dt, null, null, null);

  const anchor = getAnchor();
  const scene = getScene(anchor);
  // Conventional desktop camera: body yaw + aim pitch (no head tracking).
  const eye = M.multiply(
    M.translation(player.x, floorOffset() + EYE_HEIGHT, player.z),
    M.multiply(M.rotationY(player.bodyYaw), M.rotationX(player.aimPitch)),
  );
  const view = M.invert(eye);
  const aspect = canvas.width / Math.max(1, canvas.height);
  const proj = M.perspective((70 * Math.PI) / 180, aspect, 0.05, 500);
  renderer.renderView(view, proj, { x: 0, y: 0, width: canvas.width, height: canvas.height }, scene);
}

function startDesktopLoop() {
  if (desktopRAF == null) { lastT = performance.now(); desktopRAF = requestAnimationFrame(desktopFrame); }
}
function stopDesktopLoop() {
  if (desktopRAF != null) { cancelAnimationFrame(desktopRAF); desktopRAF = null; }
}

// ------------------------------ VR control ----------------------------------
let xrLastT = 0;
async function enterVR() {
  if (!renderer || xr.active) return;
  try {
    stopDesktopLoop();                 // exactly one loop
    xrLastT = performance.now();
    await xr.start(gl, renderer, {
      onReferenceSpace: (type) => { player.refSpaceType = type; },
      update: (frame, refSpace, viewerPose) => {
        const now = performance.now();
        const dt = now - xrLastT; xrLastT = now;
        updateInput(dt, frame, refSpace, viewerPose);
      },
      getAnchor,
      getScene,
      onBlur: () => { km.panic(); },   // focus/tracking loss zeroes actions
      onInputSourcesChange: () => {},
      onEnd: () => { selection.setDisplay(DISPLAY.DESKTOP); startDesktopLoop(); },
    });
  } catch (e) {
    xr.telemetry.lastError = e.message;
    startDesktopLoop();
    selection.setDisplay(DISPLAY.DESKTOP);
  }
}
function exitVR() { xr.stop(); }

// ------------------------------ UI wiring -----------------------------------
function setPressed(id, on) {
  const el = document.getElementById(id);
  if (el) el.setAttribute('aria-pressed', on ? 'true' : 'false');
}
function syncButtons() {
  setPressed('display-desktop', selection.displayMode === DISPLAY.DESKTOP);
  setPressed('display-vr', selection.displayMode === DISPLAY.VR);
  setPressed('input-km', selection.inputMode === INPUT_SOURCE.KEYBOARD_MOUSE);
  setPressed('input-vr', selection.inputMode === INPUT_SOURCE.VR_CONTROLLERS);
}

function wireUI(features) {
  document.getElementById('display-desktop').onclick = () => selection.setDisplay(DISPLAY.DESKTOP);
  document.getElementById('display-vr').onclick = () => selection.setDisplay(DISPLAY.VR);
  document.getElementById('input-km').onclick = () => selection.setInput(INPUT_SOURCE.KEYBOARD_MOUSE);
  document.getElementById('input-vr').onclick = () => selection.setInput(INPUT_SOURCE.VR_CONTROLLERS);

  // Pointer lock for relative mouse must come from a gesture.
  canvas.addEventListener('click', () => {
    if (selection.inputMode === INPUT_SOURCE.KEYBOARD_MOUSE) km.requestLock();
  });
  km.onLockChange = (locked) => {
    document.getElementById('lock-hint').textContent = locked
      ? 'Mouse captured — Esc to release. Mouse X turns the body; Mouse Y aims (not the head).'
      : 'Click the view to capture the mouse (relative look). Works in headset + keyboard/mouse too.';
  };

  // Switching INPUT must not end the session or restart play: the arbiter
  // neutralizes the old source and re-arms only when the new one is neutral.
  selection.onChange((what) => {
    syncButtons();
    if (what === 'input') {
      arbiter.switchTo(selection.inputMode);
      km.panic();
    } else if (what === 'display') {
      if (selection.displayMode === DISPLAY.VR) enterVR();
      else if (xr.active) exitVR();
    }
  });

  const vrBtn = document.getElementById('display-vr');
  if (!features.immersiveVR) {
    vrBtn.disabled = true;
    vrBtn.title = 'immersive-vr not supported in this browser/runtime';
  }
  syncButtons();
}

// ------------------------------ telemetry -----------------------------------
function refreshPanel(features) {
  panel.rows('env', 'Environment', featureRows(features));
  panel.rows('session', 'XR session', [
    ['State', xr.telemetry.state],
    ['Reference space', xr.telemetry.refSpaceType || '—'],
    ['Views', xr.telemetry.viewCount],
    ['Framebuffer', xr.telemetry.framebuffer || '—'],
    ['Presented FPS', xr.telemetry.fps],
    ['Null poses', xr.telemetry.nullPoses],
    ['Visibility', xr.telemetry.visibility || '—'],
    ['Last error', xr.telemetry.lastError || '—'],
  ]);
  panel.rows('input', 'Input', [
    ['Display mode', selection.displayMode],
    ['Input mode', selection.inputMode],
    ['Active source', arbiter.activeSource],
    ['Armed', arbiter.armed],
    ['Mouse locked', km.locked],
    ['XR controllers', xrpad.connectedCount],
    ['moveX/moveY', `${fmt(arbiter.state.moveX)}, ${fmt(arbiter.state.moveY)}`],
    ['bodyYaw (deg)', Math.round((player.bodyYaw * 180 / Math.PI) % 360)],
    ['aimPitch (deg)', Math.round(player.aimPitch * 180 / Math.PI)],
    ['fire / aim', `${arbiter.state.fire} / ${arbiter.state.aiming}`],
  ]);
  const w = [...features.warnings];
  if (!features.immersiveVR) w.push('No immersive-vr: use the WebXR emulator extension or a headset runtime.');
  panel.list('warn', 'Warnings', w);
  panel.list('notes', 'Notes', features.notes);
}

// --------------------------------- boot -------------------------------------
(async function boot() {
  const features = await probeFeatures();
  if (!renderer) { refreshPanel(features); return; }
  wireUI(features);
  refreshPanel(features);
  setInterval(() => refreshPanel(features), 250);
  startDesktopLoop();
  if (selection.displayMode === DISPLAY.VR && features.immersiveVR) enterVR();
})();

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function fmt(v) { return (typeof v === 'number' ? v : 0).toFixed(2); }
