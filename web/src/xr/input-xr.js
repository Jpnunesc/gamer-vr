// XR controller input source. Reads session.inputSources — handedness,
// gripSpace, targetRaySpace and gamepad — NOT navigator.getGamepads().
//
// Rules from the plan:
//  - Left stick moves; right stick snap-turns in 30 deg increments WITH
//    hysteresis; dominant hand aims and fires.
//  - Validate array lengths and the xr-standard mapping; never assume Xbox
//    indices. Missing features degrade gracefully.
//  - Controller poses drive the on-screen gizmos/rays; head pose is separate.

import { INPUT_SOURCE } from '../input/actions.js';

const SNAP_RAD = (30 * Math.PI) / 180;
const SNAP_ON = 0.7;    // push past this to trigger a snap
const SNAP_OFF = 0.3;   // must fall back below this before another snap
const MOVE_DEADZONE = 0.15;

export class XRControllers {
  constructor(opts = {}) {
    this.dominant = opts.dominant || 'right';
    this._snapLatch = false;
    this._poses = [];       // [{handedness, matrix}]
    this._connected = 0;
    this._neutral = true;
  }

  get source() { return INPUT_SOURCE.VR_CONTROLLERS; }
  get connectedCount() { return this._connected; }
  get poses() { return this._poses; }
  isNeutral() { return this._neutral; }

  // Read a thumbstick from an xr-standard gamepad, tolerating short arrays.
  _stick(gp) {
    if (!gp || !gp.axes) return { x: 0, y: 0 };
    const ax = gp.axes;
    // xr-standard: [touchpadX, touchpadY, stickX, stickY]. Fall back to 0/1.
    const x = ax.length >= 4 ? ax[2] : (ax.length >= 2 ? ax[0] : 0);
    const y = ax.length >= 4 ? ax[3] : (ax.length >= 2 ? ax[1] : 0);
    return { x: dz(x), y: dz(y) };
  }

  _button(gp, i) {
    return gp && gp.buttons && gp.buttons.length > i && gp.buttons[i].pressed;
  }

  // frame/refSpace from the XR raf loop. arbiter may be null (just want poses).
  update(session, frame, refSpace, arbiter) {
    this._poses = [];
    let connected = 0;
    let left = null, right = null;

    for (const src of session.inputSources) {
      connected++;
      if (src.handedness === 'left') left = src;
      else if (src.handedness === 'right') right = src;

      const space = src.gripSpace || src.targetRaySpace;
      if (space && frame && refSpace) {
        const pose = frame.getPose(space, refSpace);
        if (pose) this._poses.push({ handedness: src.handedness, matrix: pose.transform.matrix });
      }
    }
    this._connected = connected;

    const dom = this.dominant === 'left' ? left : right;
    const off = this.dominant === 'left' ? right : left;

    const moveStick = this._stick(off && off.gamepad);     // off hand = locomotion
    const turnStick = this._stick(dom && dom.gamepad);      // dominant = snap turn
    const domGp = dom && dom.gamepad;

    // Snap turn with hysteresis.
    let snap = 0;
    if (!this._snapLatch && Math.abs(turnStick.x) > SNAP_ON) {
      snap = Math.sign(turnStick.x);
      this._snapLatch = true;
    } else if (Math.abs(turnStick.x) < SNAP_OFF) {
      this._snapLatch = false;
    }

    const fire = this._button(domGp, 0);         // trigger
    const aiming = this._button(domGp, 1);        // squeeze
    const interact = this._button(off && off.gamepad, 1) || this._button(domGp, 4); // A/X
    const reload = this._button(domGp, 5);        // B/Y
    const pause = this._button(off && off.gamepad, 4);

    this._neutral =
      Math.abs(moveStick.x) < MOVE_DEADZONE && Math.abs(moveStick.y) < MOVE_DEADZONE &&
      Math.abs(turnStick.x) < SNAP_OFF && !fire && !aiming && !interact && !reload && !pause;

    if (arbiter) {
      // Report neutral so the arbiter can re-arm after a source switch.
      arbiter.reportNeutral(this.source, this._neutral);
      arbiter.apply(this.source, {
        moveX: moveStick.x,
        moveY: -moveStick.y,         // stick up = forward
        snapTurn: snap * 1,          // single increment; arbiter edge-consumed
        turnYaw: 0,
        fire, aiming, interact, reload,
        pause,
      });
    }

    return { snapIncrementRad: SNAP_RAD, connected };
  }
}

function dz(v) { return Math.abs(v) < MOVE_DEADZONE ? 0 : v; }
