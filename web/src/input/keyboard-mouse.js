// Keyboard + mouse input source. This is the obligatory "headset + kbd/mouse"
// path as well as the desktop path: the SAME code feeds the normalized actions
// whether or not an XR session is active.
//
// Rules from the plan:
//  - WASD moves, body-relative. Looking sideways with the head does NOT
//    redirect WASD movement (locomotion is body-relative, not head-relative).
//  - Mouse X turns the virtual body yaw. Mouse Y raises/lowers the WEAPON aim
//    pitch only. Neither ever overrides the tracked head pitch/roll.
//  - Relative movement comes from Pointer Lock (movementX/Y). We request lock
//    on an explicit gesture and handle loss/denial with a visible instruction.
//  - No Sense controllers are required; this source works with none connected.

import { INPUT_SOURCE } from './actions.js';

const DEFAULTS = {
  moveKeys: { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right' },
  lookSensitivity: 0.0022,   // radians per pixel
  snapKeys: { KeyQ: -1, KeyE: 1 },
  context: 'walking',        // or 'vehicle'
};

export class KeyboardMouse {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opt = { ...DEFAULTS, ...opts };
    this.keys = new Set();
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._wheel = 0;
    this._buttons = new Set();
    this._edges = { interact: false, reload: false, pause: false, recenter: false,
                    snap: 0, weaponNext: 0, menu: 0, menuSelect: false, menuBack: false };
    this.locked = false;
    this.onLockChange = null;   // (locked:boolean) => void
    this._install();
  }

  get context() { return this.opt.context; }
  set context(c) { this.opt.context = c; }

  requestLock() {
    // Must be called from a user gesture handler.
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  _install() {
    const kd = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code in this.opt.snapKeys) this._edges.snap = this.opt.snapKeys[e.code];
      switch (e.code) {
        case 'KeyF': this._edges.interact = true; break;
        case 'KeyR': this._edges.reload = true; break;
        case 'KeyP': this._edges.pause = true; break;
        case 'KeyC': this._edges.recenter = true; break;
        case 'ArrowUp': this._edges.menu = -1; break;
        case 'ArrowDown': this._edges.menu = 1; break;
        case 'Enter': this._edges.menuSelect = true; break;
        case 'Backspace': this._edges.menuBack = true; break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
          this._selectWeapon = Number(e.code.slice(5)); break;
      }
    };
    const ku = (e) => this.keys.delete(e.code);
    const mm = (e) => {
      if (!this.locked) return;              // only relative movement counts
      this._mouseDX += e.movementX || 0;
      this._mouseDY += e.movementY || 0;
    };
    const md = (e) => this._buttons.add(e.button);
    const mu = (e) => this._buttons.delete(e.button);
    const wheel = (e) => { this._wheel += Math.sign(e.deltaY); e.preventDefault(); };
    const lc = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this._mouseDX = this._mouseDY = 0; } // drop stale deltas
      if (this.onLockChange) this.onLockChange(this.locked);
    };
    const le = () => { this.locked = false; if (this.onLockChange) this.onLockChange(false); };

    addEventListener('keydown', kd);
    addEventListener('keyup', ku);
    addEventListener('mousemove', mm);
    addEventListener('mousedown', md);
    addEventListener('mouseup', mu);
    this.canvas.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('pointerlockchange', lc);
    document.addEventListener('pointerlockerror', le);
    // Blur / focus loss must zero everything (plan: focus loss zeroes actions).
    addEventListener('blur', () => this.panic());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.panic(); });

    this._detach = () => {
      removeEventListener('keydown', kd); removeEventListener('keyup', ku);
      removeEventListener('mousemove', mm); removeEventListener('mousedown', md);
      removeEventListener('mouseup', mu);
      this.canvas.removeEventListener('wheel', wheel);
      document.removeEventListener('pointerlockchange', lc);
      document.removeEventListener('pointerlockerror', le);
    };
  }

  panic() {
    this.keys.clear();
    this._buttons.clear();
    this._mouseDX = this._mouseDY = this._wheel = 0;
    this._edges = { interact: false, reload: false, pause: false, recenter: false,
                    snap: 0, weaponNext: 0, menu: 0, menuSelect: false, menuBack: false };
    this._selectWeapon = 0;
  }

  isNeutral() {
    return this.keys.size === 0 && this._buttons.size === 0 &&
           Math.abs(this._mouseDX) < 1 && Math.abs(this._mouseDY) < 1;
  }

  // Produce a normalized action patch for this frame and clear accumulators.
  tick() {
    const k = (code) => this.keys.has(code);
    const moveY = (k('KeyW') ? 1 : 0) + (k('KeyS') ? -1 : 0);
    const moveX = (k('KeyD') ? 1 : 0) + (k('KeyA') ? -1 : 0);

    const yaw = this._mouseDX * this.opt.lookSensitivity;     // body yaw
    const aimPitch = -this._mouseDY * this.opt.lookSensitivity; // weapon pitch only

    const patch = this.context === 'vehicle'
      ? {
          // In a vehicle the mouse must NOT steer or rotate the seated origin.
          steer: moveX,
          throttle: moveY,
          handbrake: this.keys.has('Space'),
          turnYaw: 0, aimPitch: 0, moveX: 0, moveY: 0,
          fire: false, aiming: false,
        }
      : {
          moveX, moveY,
          turnYaw: yaw,
          aimYaw: 0,                  // weapon yaw follows body for kbd/mouse
          aimPitch: clamp(aimPitch, -1.4, 1.4),
          fire: this._buttons.has(0),
          aiming: this._buttons.has(2),
          handbrake: false,
        };

    // Edges
    patch.snapTurn = this._edges.snap;
    patch.interact = this._edges.interact;
    patch.reload = this._edges.reload;
    patch.pause = this._edges.pause;
    patch.recenter = this._edges.recenter;
    patch.weaponNext = this._wheel ? Math.sign(this._wheel) : 0;
    patch.menu = this._edges.menu;
    patch.menuSelect = this._edges.menuSelect;
    patch.menuBack = this._edges.menuBack;

    // reset per-frame accumulators
    this._mouseDX = this._mouseDY = this._wheel = 0;
    this._edges = { interact: false, reload: false, pause: false, recenter: false,
                    snap: 0, weaponNext: 0, menu: 0, menuSelect: false, menuBack: false };

    return patch;
  }

  get source() { return INPUT_SOURCE.KEYBOARD_MOUSE; }
  destroy() { this._detach && this._detach(); }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
