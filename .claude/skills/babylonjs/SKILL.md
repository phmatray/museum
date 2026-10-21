---
name: babylonjs
description: Babylon.js expert for this museum (Babylon.js 9, ES modules, WebGPU with WebGL2 fallback). Researches the official docs, the installed API typings and Playground examples BEFORE writing any Babylon code, then implements with the engine's idioms and verifies in both shader languages. Use this skill whenever a task touches src/babylon, a scene, mesh, material, shader, material plugin, texture, light, shadow, camera, post-process, XR/VR, GUI, glTF/KTX2 loading, instancing, picking, render performance, or any @babylonjs import — even for a "small" tweak, a bug fix in rendering code, or a question like "how would we do X in Babylon?". Also use it when porting a three.js idea to Babylon.
---

# Babylon.js expert

Babylon's API is huge, moves fast between majors, and looks deceptively like three.js. Remembered
APIs are often from an older version or from three, and a wrong guess here is expensive: a
shader that compiles in WebGL2 but not in WGSL, an effect cache that silently shares code between
two materials, a side-effect import that is missing only in production. So the rule of this skill is
simple: **look it up in the sources before you write it, then prove it runs.** The research is
usually a few minutes; skipping it routinely costs hours.

All lookups go through one helper (stdlib Python, cached), run from the repo root:

```bash
B=".claude/skills/babylonjs/scripts/bjs.py"
python3 $B version                  # installed @babylonjs/* versions: the API you target
python3 $B search shadow generator  # doc pages whose URL contains all the words
python3 $B doc <url-or-path>        # that page as markdown (+ the Playground ids it cites)
python3 $B pg P8B91Z#127            # a Playground example's code
python3 $B api ShadowGenerator      # the declaration + TSDoc in node_modules (exact signatures)
python3 $B api MaterialPluginBase --src   # ...and the compiled implementation
python3 $B grep "thinInstanceSetBuffer"   # search the installed .d.ts (--js: the .js)
python3 $B forum webgpu material plugin   # forum topics: known pitfalls and staff answers
python3 $B topic <id|url>           # read one topic
python3 $B code "isFallbackAdapter"       # engine source on GitHub (gh)
python3 $B changes webgpu           # breaking-changes / what's-new paragraphs
```

## Workflow

### 1. Pin the version

Run `version` first. The docs describe the latest release; the code must target what is installed
(9.31 at the time of writing). When a doc page and the installed typings disagree, **the typings
win** — they are the API you will actually call. Check `changes <topic>` when something you
remember no longer exists.

### 2. Research before implementing

Scale the depth to the task, but never skip it. Aim to answer, with a source for each:

- **Which classes and methods** do the job, and the Babylon way to combine them (find the guide:
  `search` then `doc`; most guides link Playground examples — open one with `pg` to see working
  code rather than inferring it).
- **Exact signatures, options and defaults** in the installed version (`api`, `grep`). Read the
  implementation (`api --src`, `grep --js`) whenever behaviour matters more than the signature:
  when something is cached, when it runs per frame, what a flag really toggles.
- **Import paths for ES modules**: the deep path (`@babylonjs/core/Meshes/mesh`) and the
  side-effect imports the feature needs (see below). The `.d.ts` file location gives the path.
- **Known pitfalls**: for anything unusual — WebGPU, WGSL, material plugins, XR, instancing,
  render targets, freezing — check `forum` and [references/gotchas.md](references/gotchas.md).

Stop researching when you can name all four. If the sources leave a real ambiguity, write a tiny
probe (a NullEngine test, or a headless page) instead of guessing.

### 3. Say what you found

Before or alongside the code, give a short research note: the doc pages, examples and typings you
relied on (URLs or `node_modules` paths) and the decision they led to. Two to five lines. It lets
the user check the reasoning and catches stale assumptions early.

### 4. Implement the Babylon way

- **ES modules, tree-shaken.** Import classes from their deep path, never from the package root
  (it pulls the whole engine). Many features register themselves through a side-effect import; when
  something is "not a function" or silently absent, a missing one is the usual cause. Common ones:
  `Meshes/thinInstanceMesh` (thin instances), `Culling/ray` (picking),
  `Lights/Shadows/shadowGeneratorSceneComponent` (shadows),
  `Rendering/depthRendererSceneComponent`, `Rendering/prePassRendererSceneComponent` (SSAO2, SSR),
  `PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent` (pipelines),
  `Materials/Textures/Loaders/ktxTextureLoader` (KTX2), `@babylonjs/loaders/glTF/2.0` (glTF),
  `Engines/Extensions/engine.multiRender` + `Engines/WebGPU/Extensions/engine.multiRender` (MRT).
  An "include not found" shader error means a shader chunk must be imported from both
  `Shaders/ShadersInclude/...` and `ShadersWGSL/ShadersInclude/...`.
- **Both engines, always.** This project runs WebGPU first and WebGL2 as fallback. Any custom
  shader code (ShaderMaterial, material plugin, post-process) ships GLSL **and** WGSL, and both
  paths are exercised before calling it done.
- **Draw calls are the budget** (≤ 300 calls, ≤ 1.5 M triangles at the arrival point and mid-garden):
  prefer thin instances, merged meshes, shared materials, `freeze()` on static materials and
  `freezeWorldMatrix()` on static meshes; avoid per-frame allocations (`...ToRef` math, reused
  vectors) and per-frame `setState`.
- **Lifecycle**: observables (`scene.onBeforeRenderObservable`, `onAfterRenderObservable`) rather
  than ad-hoc loops; dispose what you create; compile up front (`isReady(true)`,
  `whenReadyAsync`) instead of letting the first frame of a walk compile shaders.
- **Follow this repo's conventions** — read [references/museum.md](references/museum.md) for where
  things live and which helpers already exist (materials, plugins, LOD, live state). Reuse them;
  don't re-derive.

### 5. Verify it runs

- `npx tsc -b`, `npm run lint`, and tests (`NODE_OPTIONS=--no-webstorage npx vitest run <file>` on
  Node 26). Scene logic can be unit-tested with `NullEngine`.
- Render it: `npm run dev` then a headless check — `node tools/mesurer-rendu.ts` (frame time,
  draw calls, triangles; `--gpu=0` forces WebGL2) and `node tools/comparer-captures.ts --vues=...`
  for screenshots. Look at the browser console for shader compile errors in **both** engines.
- Report what was verified and what wasn't (e.g. "WGSL path not run on a real GPU").

## Reference files

- [references/gotchas.md](references/gotchas.md) — pitfalls already paid for in this codebase
  (effect cache keyed on defines, UBO updates under WebGPU, read-only instance buffers, view-matrix
  ordering, fallback adapters, XR reference spaces…). Read it before touching shaders, instancing,
  cameras, XR or loading.
- [references/museum.md](references/museum.md) — the project's Babylon architecture: modules,
  shared helpers, live state, measuring tools, budgets.
