# SOURCES — origins, pinned revisions, toolchain, licensing

Recorded during F0 on 2026-11-10. Everything here was observed directly from
the fetched repository and the build container. Where a claim comes from the
planning report rather than direct observation, it is marked as such.

## Engine base (pinned)

Fetched by `scripts/fetch-engine.*` into `engine/` (git-ignored — reproduced
from source, not vendored into our history).

| Component | Origin | Pinned commit |
|---|---|---|
| wasm-revc (engine + browser port) | https://github.com/origami-ltd/wasm-revc | `acde392e0ba582156fcf516dbaeb73b73adebb3e` |
| vendor/librw (renderer) | https://github.com/origami-ltd/librw (branch `emscripten`) | `ac6b902bc0a16950a7ac63ca7b2702e13b598af9` |
| vendor/ogg | https://github.com/xiph/ogg | `684c73773e7e2683245ffd6aa75f04115b51123a` |
| vendor/opus | https://github.com/xiph/opus | `6bae366f9fef25191fc812c430e8abd40a13a233` |
| vendor/opusfile | https://github.com/xiph/opusfile | `6452e838e68e8f4fc0b3599523c760ac6276ce89` |

- `wasm-revc` HEAD and `librw` match the two commits named in the technical
  report exactly. The `acde392e` tip commit message is *"Correct the hemisphere
  handling in compressed keyframe interpolation"*.
- **Delta vs the report:** the report named only `librw`. The superproject also
  pins three audio submodules (`ogg`, `opus`, `opusfile`). These are additional
  to what the report documented.
- SDL2 is **not** a submodule: the Emscripten build fetches it as a port
  (`release-2.32.10`) at configure time. Recorded here as a build-time dep.

## Reference mirror (not built, not vendored)

Supplied by the user on 2026-11-11 as a reference for the upstream game source.
**Not** an engine-base change — `wasm-revc` above remains the build base. Recorded
here only so cross-references in `ENGINE-MAP.md` have a citable, pinned upstream.

| Purpose | Origin | Pinned commit |
|---|---|---|
| reVC (Vice City) upstream reference | https://github.com/hottabxp/re3 (branch `miami`) | `a16fcd8d6a79e433c1c6e73d540f1bbe27e14164` (2021-09-02, "Fixes from master") |

- `hottabxp/re3` is a live mirror of the DMCA-removed `GTAmodding/re3`. Branch
  `master` = GTA III (re3); branch `miami` = Vice City (reVC). It is the **native**
  source (D3D/OpenGL); it has **no** Emscripten/WASM/WebGL web build, so it cannot
  be a WebXR base.
- **It is not the Rabisco private port** (plan §2 preference #1). It is a generic
  re3/reVC mirror.
- **Redundancy note:** our build base `engine/wasm-revc/src/` already contains the
  complete reVC game source (all systems: `control`, `core`, `renderer`, `peds`,
  `vehicles`, `weapons`, `save`, …) — that is what F0 compiled. So this mirror adds
  no game systems we lack; its value is as a second, well-organized upstream for
  diffing/understanding when needed. **Version caveat:** the `miami` tip is a 2021
  snapshot and may diverge from the exact reVC revision `wasm-revc` ports; do not
  assume line-for-line identity.

## Published production identity (from the report — NOT recomputed)

```
commit:      ef5fc7ea9beed863101518e3edbae0e9a558d818
buildSha256: 9f07155145386fd02fe106aa5de77c24f944ced78c36c3474f143a9f0db4f0eb
```

This is the production site's build manifest. **Our base is the public
`acde392e`, which is a different commit.** We do not claim the public base
reproduces the production build. Treat the production port as having private
patches not present here (see the bridge-symbol delta in `ENGINE-MAP.md`:
production glue exposed `_ViceViewerCamera`, `_VicePlayerX`,
`_VicePlayerInVehicle`, `_VicePresentedFrames`; an initial grep of the public
base finds `ViceSetResolution` and many telemetry exports but not those).

## Toolchain (pinned via container)

Build runs in the official Emscripten image (host lacks emcc/cmake/ninja). WSL
Ubuntu is present but bare (no build tools) and has no passwordless sudo, so the
container is the reproducible path. Observed in `emscripten/emsdk:latest` on
2026-11-10:

| Tool | Version |
|---|---|
| emcc | 7.0.0 (`777e6e5db7b4990bcaeb1b9998ed642cc84e6629`) |
| cmake | 3.28.3 |
| ninja | 1.11.1 (installed into the container; not bundled in the image) |
| node | 24.19.0 |
| python | 3.12.3 |
| SDL2 port | release-2.32.10 |

> To fully pin the toolchain, replace the `:latest` tag in
> `scripts/build-web-docker.ps1` with the digest of the image that produced emcc
> 7.0.0. `:latest` was used for the first build and the exact version captured
> here.

## Licensing — READ BEFORE REDISTRIBUTING

The engine repo is **not** uniformly MIT. From `engine/wasm-revc/LICENSE.md`:

1. **The browser port** (Emscripten build, platform backends, `web/` page) is
   the author's, under **MIT-PoU** = MIT + a *proof-of-usage* condition.
   Copyright (c) 2026 Erasmo Bellumat / Origami.
2. **The game logic** is **reVC** (https://github.com/mrxenginner/reVC). Its
   authors explicitly decline to license it: *"The code should only be used for
   educational, documentation and modding purposes. We do not encourage piracy
   or commercial use. Please keep derivate work open source and give proper
   credit."* No MIT grant extends to this part.
3. **Vendored deps** under `vendor/` keep their own licenses. No game assets are
   included or distributed by the repo.

### The MIT-PoU "automated/AI systems" condition

MIT-PoU adds a condition addressed to automated systems that read/ingest the
repo: **record the usage** (open a PR to `PROOF_OF_USAGE.md` or POST to a
provenance endpoint `https://revc.wasm.ltd/api/proof-of-usage`, or
`npx proof-of-usage record`) and **credit** the repo + a provenance hash in any
resulting product.

**Status / decision:** No such recording or external contact has been performed.
This is consistent with the plan: *"Nenhum registro externo, contato ou
publicação foi realizado"* and *"uma futura publicação da plataforma precisa
resolver separadamente os termos de distribuição."* We do **not** use the
Rabisco site as a CDN and do **not** redistribute its assets. Whether to satisfy
the proof-of-usage condition (and how) is deferred to the project owner as part
of any future distribution decision. The provenance-hash input format, for the
record, is `SystemName:OperatorName:ISODate:TargetRepositoryURL` (SHA-256,
lowercase hex).

## Game data policy

- Game files come from a legally obtained classic install **supplied by the
  user**, placed in `local-game-data/`.
- `local-game-data/` is git-ignored; game data is **never committed** and
  **never redistributed**.
- The Rabisco site is not used as a CDN or asset source.
