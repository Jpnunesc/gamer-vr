// Host ↔ engine binary contract: every engine export the host calls must exist in
// the shipped glue (web/reVC.js). Run: npm test   (node --test)
//
// This catches the one failure mode a host-only change can introduce without a
// rebuild: calling module._someExport that the committed reVC.js/.wasm doesn't
// provide (e.g. adding a sprint/jump bridge to host.js before rebuilding the
// engine). Emscripten names C exports `_name` and lists them verbatim in the glue,
// so a substring check is sufficient and robust to minification.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('every module._export used by host.js exists in the built reVC.js', () => {
  const host = read('../web/src/xr-engine/host.js');
  const glue = read('../web/reVC.js');

  const used = [...host.matchAll(/module\.(_[A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const unique = [...new Set(used)].sort();
  assert.ok(unique.length > 0, 'expected host.js to reference engine exports');

  const missing = unique.filter((sym) => !glue.includes(sym));
  assert.deepEqual(
    missing, [],
    `host.js calls exports absent from web/reVC.js — rebuild the engine (see engine-patches/README.md): ${missing.join(', ')}`,
  );
});
