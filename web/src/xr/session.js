// immersive-vr session lifecycle + render loop for the F1 diagnostic.
//
// Invariants enforced here (they are the whole point of F1/F2):
//  - Presentation follows XRSession.requestAnimationFrame while in VR. There is
//    exactly one XR loop; the desktop rAF loop is suspended by main.js.
//  - ONE simulation/input update per frame (hooks.update), then N views are
//    DRAWN from that single state. No per-eye state advance.
//  - The runtime's projection matrix and viewport are used verbatim — no
//    invented IPD/FOV. The view matrix is the inverse of the eye pose.
//  - Null viewer pose => clear and skip drawing (tracking lost), counted.
//  - visibilitychange / focus loss neutralizes input but keeps presenting.

import { invert, multiply, identity } from '../gl/math.js';

export class XRSessionManager {
  constructor() {
    this.session = null;
    this.gl = null;
    this.renderer = null;
    this.refSpace = null;
    this.refSpaceType = null;
    this.layer = null;
    this.hooks = null;
    this._raf = null;
    this.telemetry = {
      state: 'idle', refSpaceType: null, viewCount: 0, fps: 0,
      framebuffer: null, nullPoses: 0, frames: 0, visibility: null,
      lastError: null,
    };
    this._frameTimes = [];
    this._worldToXr = identity();
  }

  get active() { return !!this.session; }

  async start(gl, renderer, hooks) {
    if (this.session) return;
    this.gl = gl; this.renderer = renderer; this.hooks = hooks;
    this.telemetry.state = 'requesting';

    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor'],
    });
    this.session = session;

    await gl.makeXRCompatible();
    this.layer = new XRWebGLLayer(session, gl);
    session.updateRenderState({ baseLayer: this.layer });

    // Prefer a floor-relative space; fall back to 'local' with a calibrated
    // eye height applied by the locomotion model. Never double-count height.
    this.refSpace = await requestBestReferenceSpace(session);
    this.refSpaceType = this.refSpace._type;
    this.telemetry.refSpaceType = this.refSpaceType;
    if (this.hooks.onReferenceSpace) this.hooks.onReferenceSpace(this.refSpaceType);

    session.addEventListener('end', () => this._onEnd());
    session.addEventListener('visibilitychange', () => {
      this.telemetry.visibility = session.visibilityState;
      if (session.visibilityState !== 'visible' && this.hooks.onBlur) this.hooks.onBlur();
    });
    session.addEventListener('inputsourceschange', (e) => {
      if (this.hooks.onInputSourcesChange) this.hooks.onInputSourcesChange(session.inputSources, e);
    });
    // select* are the semantic "primary action" events (useful even without
    // reading the gamepad), surfaced for completeness.
    for (const ev of ['selectstart', 'select', 'selectend']) {
      session.addEventListener(ev, (e) => this.hooks.onSelect && this.hooks.onSelect(ev, e));
    }

    this.telemetry.state = 'running';
    this._raf = session.requestAnimationFrame((t, f) => this._frame(t, f));
    return session;
  }

  stop() {
    if (this.session) this.session.end().catch(() => {});
  }

  _onEnd() {
    this.telemetry.state = 'ended';
    const s = this.session;
    this.session = null;
    this.layer = null;
    this.refSpace = null;
    this._frameTimes = [];
    if (this.hooks && this.hooks.onEnd) this.hooks.onEnd(s);
  }

  _frame(t, frame) {
    const session = this.session;
    if (!session) return;
    this._raf = session.requestAnimationFrame((tt, ff) => this._frame(tt, ff));

    // Cadence (XR presentation rate — NOT the canvas fps).
    this._frameTimes.push(t);
    if (this._frameTimes.length > 90) this._frameTimes.shift();
    if (this._frameTimes.length > 1) {
      const span = this._frameTimes[this._frameTimes.length - 1] - this._frameTimes[0];
      this.telemetry.fps = span > 0 ? Math.round((this._frameTimes.length - 1) / (span / 1000)) : 0;
    }
    this.telemetry.frames++;

    const gl = this.gl;
    const glLayer = this.layer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    this.telemetry.framebuffer = `${glLayer.framebufferWidth}x${glLayer.framebufferHeight}`;

    const pose = frame.getViewerPose(this.refSpace);
    if (!pose) {
      // Tracking lost this frame: clear, do not draw, neutralize input.
      this.telemetry.nullPoses++;
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (this.hooks.onBlur) this.hooks.onBlur();
      return;
    }

    // --- Single update for the whole frame (before any view is drawn). ---
    this.hooks.update(frame, this.refSpace, pose);

    // Locomotion anchor: where the XR origin sits in the world this frame.
    const anchor = this.hooks.getAnchor ? this.hooks.getAnchor() : identity();
    invert(anchor, this._worldToXr);
    const scene = this.hooks.getScene ? this.hooks.getScene(anchor) : null;

    this.telemetry.viewCount = pose.views.length;

    // --- Draw N views from that one state. ---
    for (const view of pose.views) {
      const vp = glLayer.getViewport(view);
      // finalView = (XR-space view) * (world -> XR). Locomotion lives in anchor.
      const finalView = multiply(view.transform.inverse.matrix, this._worldToXr);
      this.renderer.renderView(finalView, view.projectionMatrix, vp, scene);
    }
  }
}

async function requestBestReferenceSpace(session) {
  const tryOrder = ['local-floor', 'bounded-floor', 'local'];
  for (const type of tryOrder) {
    try {
      const space = await session.requestReferenceSpace(type);
      space._type = type;        // annotate for telemetry
      return space;
    } catch { /* try next */ }
  }
  const space = await session.requestReferenceSpace('viewer');
  space._type = 'viewer';
  return space;
}
