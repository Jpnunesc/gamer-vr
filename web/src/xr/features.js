// Environment / capability probe for the F1 diagnostic.
//
// Everything here is read-only detection. It never requests an XR session
// (that must come from a user gesture — see session.js). The goal is to report,
// honestly, what this browser+runtime actually exposes, and to flag the things
// the production port depends on (cross-origin isolation, WebGL2) without
// claiming headset support from a device name.

export async function probeFeatures() {
  const f = {
    secureContext: !!self.isSecureContext,
    crossOriginIsolated: !!self.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    webgl2: false,
    webgl2XRCompatibleOption: false,
    hasNavigatorXR: 'xr' in navigator,
    immersiveVR: false,
    inlineVR: false,
    pointerLock: 'requestPointerLock' in Element.prototype,
    gamepads: 'getGamepads' in navigator,
    userAgent: navigator.userAgent,
    warnings: [],
    notes: [],
  };

  // WebGL2 (the engine renders with WebGL2 / librw gl3).
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { xrCompatible: true });
    f.webgl2 = !!gl;
    f.webgl2XRCompatibleOption = !!gl;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      f.glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(masked)';
      f.glVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '(masked)';
    }
  } catch (e) {
    f.warnings.push('WebGL2 context creation threw: ' + e.message);
  }

  if (f.hasNavigatorXR) {
    try {
      f.immersiveVR = await navigator.xr.isSessionSupported('immersive-vr');
    } catch (e) {
      f.warnings.push('isSessionSupported(immersive-vr) threw: ' + e.message);
    }
    try {
      f.inlineVR = await navigator.xr.isSessionSupported('inline');
    } catch { /* inline is optional */ }
  } else {
    f.warnings.push('navigator.xr is absent: this browser/runtime exposes no WebXR.');
  }

  if (!f.secureContext) {
    f.warnings.push('Not a secure context: WebXR and pointer lock require HTTPS or localhost.');
  }
  if (!f.crossOriginIsolated) {
    f.notes.push('crossOriginIsolated is false. The diagnostic still runs, but the ' +
      'engine (SharedArrayBuffer threads) needs COOP/COEP. Serve via scripts/serve.mjs.');
  }
  if (f.immersiveVR) {
    f.notes.push('immersive-vr reported supported. This does NOT prove the headset, ' +
      'controllers, depth or latency work — only physical validation does.');
  }
  return f;
}

// Flatten to printable rows for the panel.
export function featureRows(f) {
  return [
    ['Secure context', f.secureContext],
    ['Cross-origin isolated', f.crossOriginIsolated],
    ['SharedArrayBuffer', f.sharedArrayBuffer],
    ['WebGL2', f.webgl2],
    ['GPU', f.glRenderer || '—'],
    ['navigator.xr', f.hasNavigatorXR],
    ['immersive-vr supported', f.immersiveVR],
    ['Pointer Lock API', f.pointerLock],
    ['Gamepad API', f.gamepads],
  ];
}
