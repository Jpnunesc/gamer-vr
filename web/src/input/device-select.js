// Display mode and input mode are INDEPENDENT choices, persisted across
// sessions. Choosing VR must never force VR controllers. With no controllers
// connected the user can still start and continue on keyboard/mouse.

import { INPUT_SOURCE } from './actions.js';

export const DISPLAY = Object.freeze({ DESKTOP: 'desktop', VR: 'vr' });

const KEY = 'vrvc.prefs.v1';

export class DeviceSelection {
  constructor() {
    const saved = load();
    this.displayMode = saved.displayMode || DISPLAY.DESKTOP;
    this.inputMode = saved.inputMode || INPUT_SOURCE.KEYBOARD_MOUSE;
    this._listeners = new Set();
  }

  onChange(cb) { this._listeners.add(cb); return () => this._listeners.delete(cb); }
  _emit(what) { for (const cb of this._listeners) cb(what, this); save(this); }

  setDisplay(mode) {
    if (mode !== DISPLAY.DESKTOP && mode !== DISPLAY.VR) return;
    if (this.displayMode === mode) return;
    this.displayMode = mode;           // does NOT touch inputMode
    this._emit('display');
  }

  setInput(mode) {
    if (mode !== INPUT_SOURCE.KEYBOARD_MOUSE && mode !== INPUT_SOURCE.VR_CONTROLLERS) return;
    if (this.inputMode === mode) return;
    this.inputMode = mode;             // does NOT touch displayMode
    this._emit('input');
  }
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}
function save(sel) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      displayMode: sel.displayMode, inputMode: sel.inputMode,
    }));
  } catch { /* storage may be unavailable; non-fatal */ }
}
