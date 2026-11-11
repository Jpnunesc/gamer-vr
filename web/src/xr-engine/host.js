// F2 stereo spike (Experiment #1) host.
//
// Minimal loader that boots the real reVC engine with an EMPTY game dir (no
// commercial assets needed — same idea as the engine shell's ?engine=1 smoke
// test) and drives stereo rendering through the new xr* bridge. The engine's
// own blocking loop is parked (xrSetMode(1)); the F1 XR rAF loop
// (XRSessionManager) then pumps one update + N diagnostic view-draws per frame,
// so every C++ GL call lands in the opaque XRWebGLLayer framebuffer while it is
// valid. See docs/STEREO-SPIKE.md.
//
// Deliberately NOT the licensed @wasm/shell: this is our own host in our repo,
// so F2 never has to modify Origami's shell. It reuses only the built reVC.js.

import { XRSessionManager } from '../xr/session.js';
import { identity, invert, perspective, translation } from '../gl/math.js';
import { rwProjFromGl, rwViewDeltaFromGl, syntheticWorldToEye } from './xr-rw.js';
import { keysToMove, stickToMove, mergeMove, pickThumbstick } from './locomotion.js';

// F2 obstacle #4: by default feed the REAL per-eye WebXR projection + view
// (converted to RW convention in xr-rw.js, proven in tests/xr-rw.test.mjs).
// ?proj=crude falls back to the old fixed-eye-offset + aspect-hack path so the
// two can be A/B-compared in the emulator without a rebuild.
const USE_CRUDE = new URLSearchParams(location.search).get('proj') === 'crude';
const PREVIEW_FOVY = (70 * Math.PI) / 180; // preview-only vertical FOV (diagnostic)

// F3 first-person: ?fp=1 renders from the player's head (body hidden) instead of
// the third-person camera; the XR head pose decouples look from body. ?eye=0.6
// sets the initial eye height (metres above the ped origin); tune live with -/=.
const FIRST_PERSON = new URLSearchParams(location.search).has('fp');
const EYE_PARAM = parseFloat(new URLSearchParams(location.search).get('eye'));
let fpEyeHeight = Number.isFinite(EYE_PARAM) ? EYE_PARAM : 0.5;
let fpCullVW = 2.0; // cull frustum half-extent (~127°); widen if the head turns reveal holes
let fpFrame = 0;    // preview frame counter (throttles the [fp] eye readout)
function applyFirstPerson(on) {
  if (!module) return;
  if (module._xrSetFirstPerson) module._xrSetFirstPerson(on ? 1 : 0, fpEyeHeight);
  if (on && module._xrSetCullVW) module._xrSetCullVW(fpCullVW);
  if (!on && module._xrClearMove) module._xrClearMove();
}

// F3 locomotion: WASD (flat screen) and the VR controller's left thumbstick (in a
// session) both resolve to a movement vector pushed into the native pad each tick
// (xrSetMove, consumed inside xrGameAdvance's CPad::UpdatePads). Camera-relative,
// and our FP camera faces the body, so it's body-relative. The input→vector mapping
// (signs, deadzone, merge) lives in ./locomotion.js and is unit-tested. Tracked
// globally so it works in both Preview and Enter VR; only sent while first-person is on.
const moveKeys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') moveKeys.add(k);
});
window.addEventListener('keyup', (e) => { moveKeys.delete(e.key.toLowerCase()); });
// stickAxes: an optional xr-standard gamepad axes array (from the XR path); absent
// in the flat-screen preview, where only the keyboard drives movement.
function sendMove(stickAxes) {
  if (!FIRST_PERSON || !module || !module._xrSetMove) return;
  const keyVec = keysToMove((k) => moveKeys.has(k));
  const stickVec = stickToMove(stickAxes);
  const { fwd, strafe } = mergeMove(keyVec, stickVec);
  module._xrSetMove(fwd, strafe);
}

// Stage the converted per-eye matrices for the engine's verbatim stereo override.
// projGl: WebXR/GL projection; worldToEyeXr: view.transform.inverse.matrix (the
// per-eye world→eye, with anchor == identity so the engine composes it onto its
// own game camera view).
function stageStereoMatrices(projGl, worldToEyeXr) {
  module.HEAPF32.set(rwProjFromGl(projGl), module._xrStereoProjPtr() >> 2);
  module.HEAPF32.set(rwViewDeltaFromGl(worldToEyeXr), module._xrStereoViewPtr() >> 2);
}

const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const btnSelf = document.getElementById('selftest');
const btnStart = document.getElementById('startgame');
const btnPreview = document.getElementById('previewstereo');
const btnVR = document.getElementById('entervr');

let module = null;

// ?data=1 → mount the real Vice City install and boot the actual game.
// Default → diag boot (Experiment #1: no data, spin after GL init).
const REAL_DATA = new URLSearchParams(location.search).has('data');

// Diag boot halts the engine before it loads the world; the real-data path must
// NOT set this so the engine initialises the game normally. Set before main().
if (!REAL_DATA) globalThis.__viceDiagHalt = 1;

function log(msg, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  // eslint-disable-next-line no-console
  console.log('[xr-engine]', msg);
  // Mirror to the dev server so the engineer can read the browser log remotely.
  try { fetch('/__log', { method: 'POST', body: (cls ? '[' + cls + '] ' : '') + msg, keepalive: true }).catch(() => {}); } catch { /* ignore */ }
}
window.addEventListener('error', (e) => log('window.onerror: ' + (e.message || e.error), 'err'));
window.addEventListener('unhandledrejection', (e) => log('unhandledrejection: ' + ((e.reason && e.reason.message) || e.reason), 'err'));
const setStatus = (t, cls) => { statusEl.textContent = t; statusEl.className = cls || 'dim'; };
const raf = () => new Promise((r) => requestAnimationFrame(r));

/* ----------------------------------------------------------------- boot --- */
// main() never returns (blocking Asyncify loop), so the factory promise never
// settles — readiness comes from onRuntimeInitialized, then from the loop
// counter actually advancing (which means SDL + WebGL2 + the yield are all up).
const config = {
  canvas,
  print: (s) => log(s, 'dim'),
  printErr: (s) => log(s, 'warn'),
  preRun: [
    (m) => {
      try {
        m.FS.mkdirTree('/gtavc');
        m.FS.chdir('/gtavc');
      } catch (e) { log('preRun error: ' + e.message, 'err'); return; }
      if (!REAL_DATA) { log('preRun: empty /gtavc (no game data).', 'dim'); return; }
      // Block main() until the install + re3 overlay are mounted into MEMFS.
      m.addRunDependency('game-data');
      mountGameData(m)
        .then(() => { m.removeRunDependency('game-data'); })
        .catch((e) => log('game-data mount error: ' + e.message, 'err'));
    },
  ],
  onRuntimeInitialized() { module = this; },
};

/* ---------------------------------------------------- real game data mount --- */
// Mount the junctioned classic install (subset) + the re3 overlay into MEMFS at
// /gtavc. MEMFS keeps file bytes in JS memory (not the WASM heap), so the 316 MB
// gta3.img is fine. Files stream from the dev server (/vc, /vcx) with Range.
async function mountGameData(m) {
  const t0 = performance.now();
  log('fetching game-data manifests…');
  const [vc, vcx] = await Promise.all([
    fetch('/vc-manifest').then((r) => r.json()),
    fetch('/vcx-manifest').then((r) => r.json()),
  ]);
  // re3 overlay written after the install so it wins on any name clash.
  const jobs = [
    ...vc.map((p) => ({ url: '/vc/' + p, dest: '/gtavc/' + p })),
    ...vcx.map((p) => ({ url: '/vcx/' + p, dest: '/gtavc/' + p })),
  ];
  log(`mounting ${jobs.length} files (install + re3 overlay)…`);

  let done = 0, bytes = 0, next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        const buf = new Uint8Array(await (await fetch(j.url)).arrayBuffer());
        const slash = j.dest.lastIndexOf('/');
        m.FS.mkdirTree(j.dest.slice(0, slash));
        m.FS.writeFile(j.dest, buf);
        bytes += buf.length;
      } catch (e) {
        log('mount failed: ' + j.url + ' — ' + e.message, 'err');
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) {
        setStatus(`mounting game data ${done}/${jobs.length} (${(bytes / 1048576) | 0} MB)`);
      }
    }
  }
  // Modest concurrency: fast on localhost without flooding the fetch queue.
  await Promise.all(Array.from({ length: 16 }, worker));
  log(`mounted ${done} files, ${(bytes / 1048576) | 0} MB in ${((performance.now() - t0) / 1000).toFixed(1)}s.`, 'ok');
}

async function waitForReady(timeoutMs) {
  const t0 = performance.now();
  if (!REAL_DATA) {
    // Diag boot: engine spins WITHOUT loading the game, setting xrDiagReady.
    while (!(module._xrDiagReady && module._xrDiagReady())) {
      if (performance.now() - t0 > timeoutMs) throw new Error('engine diag-spin not reached (see log)');
      await raf();
    }
    return;
  }
  // Real boot: wait for the game loop to iterate past init (frontend rendering).
  // ViceLogicFrame only climbs once the main while-loop is running.
  const start = module._ViceLogicFrame();
  while (module._ViceLogicFrame() < start + 60) {
    if (performance.now() - t0 > timeoutMs) throw new Error('game loop did not start — the engine likely hung/aborted on a missing file (see log)');
    await raf();
  }
}

async function boot() {
  setStatus('loading /reVC.js…');
  let createReVC;
  try {
    ({ default: createReVC } = await import('/reVC.js'));
  } catch (e) {
    setStatus('engine not built', 'err');
    log('Could not import /reVC.js — build the engine and copy reVC.js + reVC.wasm into web/. ' + e.message, 'err');
    return;
  }
  setStatus(REAL_DATA ? 'starting engine (will mount game data)…' : 'starting engine…');
  createReVC(config); // do NOT await: main() never returns
  // Wait for onRuntimeInitialized then the loop to actually spin.
  while (!module) await raf();
  log(REAL_DATA ? 'runtime initialized; mounting data then booting the game…' : 'runtime initialized; waiting for the game loop to spin…', 'dim');
  try {
    await waitForReady(REAL_DATA ? 180000 : 20000);
  } catch (e) {
    setStatus('engine stalled', 'err');
    log(e.message, 'err');
    return;
  }
  log(`engine loop alive (ViceLogicFrame=${module._ViceLogicFrame()}, gameState=${module._ViceGameState?.()}).`, 'ok');

  // Grab the SAME WebGL2 context SDL created on this canvas (getContext returns
  // the existing context). The engine draws through it; XR must layer onto it.
  const gl = canvas.getContext('webgl2');
  if (!gl) { setStatus('no WebGL2 context', 'err'); log('canvas has no webgl2 context', 'err'); return; }

  if (REAL_DATA) {
    setStatus('game booted — the Vice City menu should be on the canvas', 'ok');
    log('Real game booted. Click the canvas, then arrow keys + Enter to start "New Game" and play until you control Tommy. Then click "Preview stereo" to see it per eye (no headset). ("Resume" only unpauses an already-running game.)', 'ok');
    if (btnStart) { btnStart.hidden = false; btnStart.disabled = false; }
    if (btnPreview) { btnPreview.hidden = false; btnPreview.disabled = false; }
  } else {
    btnSelf.disabled = false;
  }
  await reportXRSupport();
}

/* --------------------------------------------------------- XR support --- */
async function reportXRSupport() {
  if (!navigator.xr) { setStatus('ready (no WebXR in this browser)', 'warn'); log('navigator.xr absent — use a WebXR browser or the WebXR API Emulator extension.', 'warn'); return; }
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* ignore */ }
  if (supported) { btnVR.disabled = false; setStatus('ready — immersive-vr available', 'ok'); }
  else { setStatus('ready (immersive-vr not offered)', 'warn'); log('immersive-vr not offered — a headset/runtime or the WebXR emulator is needed to Enter VR. Self-test still works.', 'warn'); }
}

/* ---------------------------------------------------- the XR engine loop --- */
const xr = new XRSessionManager();
let eye = 0;

const hooks = {
  update: () => { /* diagnostic: no sim this experiment */ },
  getAnchor: () => identity(),              // world == XR origin (no locomotion yet)
  getScene: () => { eye = 0; return null; }, // called once/frame before the view loop → reset eye index
  onReferenceSpace: (t) => log('reference space: ' + t, 'dim'),
  onBlur: () => {},
  onEnd: () => { if (module) module._xrSetMode(0); log('XR session ended; engine loop resumed.', 'ok'); btnVR.disabled = false; },
};

const renderer = {
  renderView(finalView, projection, viewport /*, scene */) {
    module.HEAPF32.set(projection, module._xrProjPtr() >> 2);
    module.HEAPF32.set(finalView, module._xrViewPtr() >> 2);
    module._xrRenderView(eye, viewport.x, viewport.y, viewport.width, viewport.height);
    eye++;
  },
};

// Real-world VR hooks/renderer: drive the engine's actual RenderScene per eye from
// the WebXR rAF. The default path feeds the real per-eye WebXR projection + view
// (converted in xr-rw.js) through the engine's verbatim override — correct
// asymmetric frustum + 6DoF head pose, no eye-offset/aspect hack. ?proj=crude
// restores the old fixed-offset path for A/B. The XRSessionManager binds the
// XRWebGLLayer framebuffer before the view loop, so xrRenderWorld draws straight
// into it, and clearCamera scissors each eye.
let xrEye = 0;
// Head-look sign tuning for the CRUDE path only (the real path gets head pose from
// the per-eye view matrix). Flip if the emulator view turns the wrong way.
const HEAD_YAW_SIGN = 1, HEAD_PITCH_SIGN = 1;
const worldHooks = {
  update: (frame, refSpace, pose) => {
    const stick = pickThumbstick(frame && frame.session && frame.session.inputSources);
    sendMove(stick);                                // WASD + VR left thumbstick → native pad (F3 locomotion)
    module._xrGameAdvance();                        // ONE sim tick per frame
    if (!USE_CRUDE) return;                         // real path: head pose is in the per-eye view
    const q = pose && pose.transform && pose.transform.orientation;
    if (q) {
      // yaw about Y, pitch about X, from the head-pose quaternion (crude path only)
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q.w * q.x - q.y * q.z))));
      module._xrHeadSet(yaw * HEAD_YAW_SIGN, pitch * HEAD_PITCH_SIGN);
    }
  },
  getAnchor: () => identity(),                      // anchor == game camera (engine composes the delta)
  getScene: () => { xrEye = 0; return null; },      // reset eye index each frame
  onReferenceSpace: (t) => log('reference space: ' + t, 'dim'),
  onBlur: () => {},
  onEnd: () => { if (module) { applyFirstPerson(false); module._xrStereoDone(); module._xrSetMode(0); } log('XR session ended; engine resumed.', 'ok'); btnVR.disabled = false; },
};
const worldRenderer = {
  renderView(finalView, projection, vp) {
    if (USE_CRUDE) {
      module._xrStereoEye(xrEye, previewIPD, vp.x, vp.y, vp.width, vp.height);
    } else {
      // finalView == view.transform.inverse.matrix (anchor is identity, see getAnchor).
      stageStereoMatrices(projection, finalView);
      module._xrStereoEyeM(vp.x, vp.y, vp.width, vp.height);
    }
    module._xrRenderWorld(xrEye === 0 ? 1 : 0);      // build the render list once (eye 0)
    xrEye++;
  },
};

async function enterVR() {
  btnVR.disabled = true;
  const gl = canvas.getContext('webgl2');
  const realWorld = REAL_DATA && module._ViceGameState() === GS_PLAYING_GAME;
  log(realWorld
    ? (USE_CRUDE
      ? 'entering VR (REAL WORLD, crude path): fixed eye-offset + aspect hack + head-look from the pose.'
      : 'entering VR (REAL WORLD): real per-eye WebXR projection + view (6DoF head pose) via the engine verbatim override. If it looks wrong, reload with ?proj=crude to compare, and check the anchor signs.')
    : 'entering VR (diagnostic grid+cubes) — get into gameplay (New Game) first to see the real world here.',
    realWorld ? 'ok' : 'warn');
  module._xrSetMode(1);
  if (realWorld && FIRST_PERSON) { applyFirstPerson(true); log(`first-person ON (eye height ${fpEyeHeight.toFixed(2)} m, body hidden).`, 'ok'); }
  try {
    await xr.start(gl, realWorld ? worldRenderer : renderer, realWorld ? worldHooks : hooks);
    log('XR session running (viewCount should be 2).', 'ok');
  } catch (e) {
    module._xrSetMode(0);
    btnVR.disabled = false;
    log('XR start failed: ' + e.message, 'err');
  }
}

/* --------------------------------------- self-test: re-entrancy, no XR --- */
// Validates obstacle #1 (call exports while main() is Asyncify-parked) WITHOUT a
// headset: park the loop, confirm it freezes, then have C++ draw the diagnostic
// into the default framebuffer and read a pixel back.
async function selfTest() {
  if (!module) { log('engine not ready', 'err'); return; }
  btnSelf.disabled = true;
  const gl = canvas.getContext('webgl2');
  log('— self-test —');
  log('parking engine loop (xrSetMode 1)…');
  module._xrSetMode(1);
  for (let i = 0; i < 3; i++) await raf();
  const f1 = module._ViceLogicFrame(), i1 = module._ViceIdleCount?.() ?? -1;
  for (let i = 0; i < 6; i++) await raf();
  const f2 = module._ViceLogicFrame(), i2 = module._ViceIdleCount?.() ?? -1;
  const frozen = f1 === f2;
  log(`parked loop: ViceLogicFrame ${f1}→${f2}, ViceIdleCount ${i1}→${i2}` + (frozen ? ' — FROZEN ✓' : ' — still advancing ✗'), frozen ? 'ok' : 'err');

  // C++ draws the diagnostic into the DEFAULT framebuffer while main() is parked.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const W = canvas.width | 0, H = canvas.height | 0;
  const proj = perspective((60 * Math.PI) / 180, W / H, 0.1, 100);
  const view = invert(translation(0, 1.6, 0)); // eye 1.6 m up, looking toward -Z
  module.HEAPF32.set(proj, module._xrProjPtr() >> 2);
  module.HEAPF32.set(view, module._xrViewPtr() >> 2);
  const vc0 = module._xrViewCount();
  module._xrRenderView(0, 0, 0, W, H);
  const err = gl.getError();
  const px = new Uint8Array(4);
  gl.readPixels(W >> 1, Math.floor(H * 0.72), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const drew = px[0] + px[1] + px[2] > 0;
  log(`re-entrant xrRenderView: xrViewCount ${vc0}→${module._xrViewCount()}, glError=${err}`, err ? 'err' : 'dim');
  log(`readback pixel (lower-centre) = [${px.join(', ')}]` + (drew ? ' — C++ drew into the FB ✓' : ' — black ✗'), drew ? 'ok' : 'err');
  module._xrSetMode(0);
  log('engine resumed (xrSetMode 0). self-test done.', 'ok');
  btnSelf.disabled = false;
}

/* ----------------------------- on-canvas stereo preview (no XR, no headset) --- */
// Park the engine, then each rAF: one sim tick, then render the real world per eye
// into the two halves of the canvas via the librw stereo override. The IPD is
// exaggerated so the parallax is obvious. This is the "side-by-side is diagnostic"
// proof from the plan — it validates the real-world render path before XR matrices.
let previewing = false;
let previewIPD = 0.3; // metres-ish; exaggerated so parallax is visible. [ and ] tune it.
// Flat-screen preview defaults to MONO (one full-canvas first-person image) so the
// world + locomotion are easy to see/test. The side-by-side stereo split only looks
// right inside a headset (Enter VR); press 'm' to toggle it on a flat screen.
let previewMono = true;
let headYaw = 0, headPitch = 0; // mouse-look in the preview (drag the canvas) → xrHeadSet
window.addEventListener('keydown', (e) => {
  if (!previewing) return;
  if (e.key === 'm') { previewMono = !previewMono; log('preview = ' + (previewMono ? 'MONO (full screen)' : 'STEREO side-by-side (for headset)')); }
  else if (e.key === '[') { previewIPD = Math.max(0, previewIPD - 0.05); log('IPD = ' + previewIPD.toFixed(2)); }
  else if (e.key === ']') { previewIPD += 0.05; log('IPD = ' + previewIPD.toFixed(2)); }
  // First-person eye height (only meaningful with ?fp=1).
  else if (FIRST_PERSON && (e.key === '-' || e.key === '=' || e.key === '+')) {
    fpEyeHeight = Math.max(0, fpEyeHeight + (e.key === '-' ? -0.05 : 0.05));
    applyFirstPerson(true);
    log('eye height = ' + fpEyeHeight.toFixed(2) + ' m');
  }
  // First-person cull-frustum width — widen if turning the head reveals holes.
  else if (FIRST_PERSON && (e.key === ',' || e.key === '.')) {
    fpCullVW = Math.max(0.5, fpCullVW + (e.key === ',' ? -0.25 : 0.25));
    if (module._xrSetCullVW) module._xrSetCullVW(fpCullVW);
    log('cull width = ' + fpCullVW.toFixed(2) + ' (≈' + Math.round(2 * Math.atan(fpCullVW) * 180 / Math.PI) + '° FOV)');
  }
  // Time of day: 't' jumps to noon (bright daylight), 'y' to night.
  else if (e.key === 't' || e.key === 'y') {
    const hh = e.key === 't' ? 12 : 0;
    if (module._xrSetTime) { module._xrSetTime(hh, 0); log('time set to ' + String(hh).padStart(2, '0') + ':00'); }
  }
});
// Drag the canvas during the preview to "turn the head" (simulates the headset
// pose without the emulator/headset). Feeds xrHeadSet; tune the signs below.
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => { if (previewing) { dragging = true; lastX = e.clientX; lastY = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } } });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || !previewing) return;
  headYaw -= (e.clientX - lastX) * 0.005; // drag right → look right
  headPitch = Math.max(-1.2, Math.min(1.2, headPitch - (e.clientY - lastY) * 0.005)); // drag down → look down
  lastX = e.clientX; lastY = e.clientY;
});
const GS_PLAYING_GAME = 9;
async function previewStereo() {
  if (!REAL_DATA || !module) { log('preview needs ?data=1 (a booted game)', 'warn'); return; }
  // Only valid in actual gameplay: at the frontend the streaming system is closed,
  // so driving a sim tick asserts in CdStreamRead (hImage <= 0) and hangs the tab.
  if (!previewing && module._ViceGameState() !== GS_PLAYING_GAME) {
    log('Not in gameplay yet (state ' + module._ViceGameState() + '; 9 = playing). Click the canvas, use the arrow keys + Enter to start "New Game", play through the intro until you control Tommy — then click Preview stereo.', 'warn');
    return;
  }
  const gl = canvas.getContext('webgl2');
  if (previewing) {
    previewing = false;
    btnPreview.textContent = 'Preview stereo (no XR)';
    applyFirstPerson(false);
    module._xrSetMode(0);
    log('stereo preview off; engine resumed.', 'ok');
    return;
  }
  previewing = true;
  btnPreview.textContent = 'Stop preview';
  module._xrSetMode(1); // park the engine loop; we drive sim + render
  if (FIRST_PERSON) applyFirstPerson(true);
  log('preview ON (MONO full-screen — press "m" for side-by-side stereo). DRAG to look.' + (FIRST_PERSON ? ` First-person: WASD to walk, "t" = daylight, -/= eye height.` : ''), 'ok');

  const W = canvas.width | 0, H = canvas.height | 0, half = (W / 2) | 0;
  const aspect = half / H;
  function frame() {
    if (!previewing) return;
    try {
      sendMove();                                    // WASD → native pad (F3 locomotion)
      module._xrGameAdvance();                       // ONE sim tick for both eyes
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);       // draw straight to the canvas
      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (previewMono && !USE_CRUDE) {
        // MONO: one full-canvas first-person image (no stereo split) — clean to look
        // at and to test walking on a flat screen. Same real conversion, IPD = 0.
        const projGl = perspective(PREVIEW_FOVY, W / H, 0.1, 2000);
        stageStereoMatrices(projGl, syntheticWorldToEye(headYaw, headPitch, 0));
        module._xrStereoEyeM(0, 0, W, H);
        module._xrRenderWorld(1);
      } else if (USE_CRUDE) {
        module._xrHeadSet(headYaw, headPitch);         // mouse-look (drag the canvas)
        module._xrStereoEye(0, previewIPD, 0, 0, half, H);     module._xrRenderWorld(1); // left (build list)
        module._xrStereoEye(1, previewIPD, half, 0, half, H);  module._xrRenderWorld(0); // right (reuse list)
      } else {
        // STEREO side-by-side (for headset viewing): synthesize each eye's GL
        // projection + world→eye, then run the SAME conversion the headset uses.
        const projGl = perspective(PREVIEW_FOVY, aspect, 0.1, 2000);
        stageStereoMatrices(projGl, syntheticWorldToEye(headYaw, headPitch, -previewIPD / 2));
        module._xrStereoEyeM(0, 0, half, H);     module._xrRenderWorld(1);   // left (build list)
        stageStereoMatrices(projGl, syntheticWorldToEye(headYaw, headPitch, +previewIPD / 2));
        module._xrStereoEyeM(half, 0, half, H);  module._xrRenderWorld(0);   // right (reuse list)
      }
      module._xrStereoDone();
      // Diagnostic: once a second, report where the first-person eye actually is.
      if (FIRST_PERSON && module._xrEyeInfoPtr && (fpFrame++ % 60 === 0)) {
        const e = new Float32Array(module.HEAPF32.buffer, module._xrEyeInfoPtr(), 8);
        log(`[fp] eye=(${e[0].toFixed(1)}, ${e[1].toFixed(1)}, ${e[2].toFixed(1)}) ` +
            `coors=(${e[3].toFixed(1)}, ${e[4].toFixed(1)}, ${e[5].toFixed(1)}) ` +
            `ground=${e[7].toFixed(1)} head=${e[6].toFixed(2)} eyeH=${fpEyeHeight.toFixed(2)} cullVW=${fpCullVW.toFixed(2)}`, 'ok');
      }
    } catch (e) {
      log('preview error: ' + e.message, 'err');
      previewing = false; module._xrSetMode(0); btnPreview.textContent = 'Preview stereo (no XR)';
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

btnSelf.addEventListener('click', () => void selfTest());
if (btnStart) btnStart.addEventListener('click', () => {
  log('Start Game (ViceStartGame) — loading the world…');
  if (module && module._ViceStartGame) module._ViceStartGame();
  else log('ViceStartGame not available', 'err');
});
if (btnPreview) btnPreview.addEventListener('click', () => void previewStereo());
btnVR.addEventListener('click', () => void enterVR());

boot();
