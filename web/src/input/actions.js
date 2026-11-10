// Normalized gameplay action state — the single source of truth the engine
// bridge will eventually consume. Keyboard/mouse and XR controllers both write
// into ONE ActionState; the engine reads one source of gameplay actions at a
// time. This is where the plan's "avoid double input (SDL + new bridge)" and
// "safe source switching" rules are enforced.
//
// Head pose is deliberately NOT an action. It is always driven by the XR
// viewer pose while a session exists, independent of the input source, so a
// controller disconnect never freezes the view and the mouse never overrides
// tracked head pitch/roll.

export const INPUT_SOURCE = Object.freeze({
  KEYBOARD_MOUSE: 'keyboard-mouse',
  VR_CONTROLLERS: 'vr-controllers',
});

export function createActionState() {
  return {
    // Continuous
    moveX: 0,          // strafe, [-1,1] body-relative
    moveY: 0,          // forward/back, [-1,1]
    turnYaw: 0,        // continuous yaw delta this frame (radians), body
    aimYaw: 0,         // weapon aim yaw relative to body (radians)
    aimPitch: 0,       // weapon aim pitch (radians) — never applied to head
    throttle: 0,       // vehicle accel [-1,1]
    steer: 0,          // vehicle steer [-1,1]
    // Momentary (edge-triggered; cleared by consumeEdges)
    snapTurn: 0,       // -1 / +1 for a single snap increment
    fire: false,
    aiming: false,
    interact: false,   // enter/exit vehicle, use
    reload: false,
    weaponNext: 0,     // -1 / +1
    handbrake: false,
    pause: false,
    recenter: false,
    menu: 0,           // menu nav: -1 up, +1 down (edge)
    menuSelect: false,
    menuBack: false,
  };
}

const EDGE_KEYS = [
  'snapTurn', 'interact', 'reload', 'weaponNext', 'pause', 'recenter',
  'menu', 'menuSelect', 'menuBack',
];

// Clear per-frame edge/delta fields after they have been consumed by a tick.
export function consumeEdges(a) {
  a.turnYaw = 0;
  for (const k of EDGE_KEYS) a[k] = (typeof a[k] === 'number') ? 0 : false;
}

export function neutralize(a) {
  for (const k of Object.keys(a)) {
    a[k] = (typeof a[k] === 'number') ? 0 : false;
  }
}

// Manages which input source is authoritative and enforces the plan's
// source-switch contract: switching neutralizes the old source, discards
// accumulated deltas, and requires the NEW source to present a neutral state
// before its actions are accepted (no inherited fire / stuck analog).
export class InputArbiter {
  constructor(initialSource = INPUT_SOURCE.KEYBOARD_MOUSE) {
    this.state = createActionState();
    this.active = initialSource;
    this._armed = true;          // accepting input from active source?
    this._listeners = new Set();
  }

  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit() { for (const cb of this._listeners) cb(this.active, this._armed); }

  get activeSource() { return this.active; }
  get armed() { return this._armed; }

  // Switch WITHOUT ending the XR session or restarting play.
  switchTo(source) {
    if (source === this.active) return;
    neutralize(this.state);      // drop the old source's actions + deltas
    this.active = source;
    this._armed = false;         // require neutral from the new source first
    this._emit();
  }

  // A source reports whether it is currently neutral (no pressed buttons, no
  // significant analog deflection). Used to re-arm after a switch and to avoid
  // auto-switching on analog noise or small mouse jitter.
  reportNeutral(source, isNeutral) {
    if (source !== this.active) return;
    if (!this._armed && isNeutral) {
      this._armed = true;
      this._emit();
    }
  }

  // A source pushes a partial update. Ignored unless it is the active, armed
  // source. Returns true if applied.
  apply(source, patch) {
    if (source !== this.active || !this._armed) return false;
    Object.assign(this.state, patch);
    return true;
  }
}
