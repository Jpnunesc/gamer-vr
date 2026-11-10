// Diagnostic HUD (flat DOM overlay). This is for the monitor / emulator view.
//
// NOTE (plan): a DOM overlay is NOT visible inside the headset. Menus and HUD
// that must appear in VR have to live in the XR composition (3D panels / a
// rendered texture) — that is F4 work. For F1 the DOM panel is the honest
// inspection surface for desktop + WebXR emulator; in-headset the user sees the
// 3D scene only, plus (later) a minimal in-world status quad.

export class Panel {
  constructor(root) {
    this.root = root;
    this.sections = {};
  }

  section(id, title) {
    let el = this.sections[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'panel-section';
      const h = document.createElement('h3');
      h.textContent = title;
      const body = document.createElement('div');
      body.className = 'panel-body';
      el.append(h, body);
      this.root.appendChild(el);
      this.sections[id] = el;
      el._body = body;
    }
    return el._body;
  }

  rows(id, title, rows) {
    const body = this.section(id, title);
    body.innerHTML = '';
    for (const [k, v] of rows) {
      const r = document.createElement('div');
      r.className = 'row';
      const kk = document.createElement('span');
      kk.className = 'k';
      kk.textContent = k;
      const vv = document.createElement('span');
      vv.className = 'v ' + classify(v);
      vv.textContent = format(v);
      r.append(kk, vv);
      body.appendChild(r);
    }
  }

  list(id, title, items) {
    const body = this.section(id, title);
    body.innerHTML = '';
    if (!items || !items.length) {
      const e = document.createElement('div');
      e.className = 'muted';
      e.textContent = '—';
      body.appendChild(e);
      return;
    }
    for (const it of items) {
      const e = document.createElement('div');
      e.className = 'note';
      e.textContent = it;
      body.appendChild(e);
    }
  }
}

function classify(v) {
  if (v === true) return 'ok';
  if (v === false) return 'bad';
  return '';
}
function format(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}
