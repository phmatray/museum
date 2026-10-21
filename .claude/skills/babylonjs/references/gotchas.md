# Babylon.js pitfalls already paid for

Each of these cost real debugging time in this codebase (Babylon.js 9.x, WebGPU + WebGL2). Before
touching the area, re-check the claim against the installed typings (`bjs.py api/grep`) — the
engine moves, and a stale "fact" here is as harmful as one remembered wrongly.

## Contents
1. Shaders and material plugins
2. Instancing and meshes
3. Cameras and per-frame reads
4. Engine, loading and assets
5. Materials, colour and lighting
6. XR
7. Performance and compilation

## 1. Shaders and material plugins

- **The effect cache is keyed on defines, not on code.** Two `MaterialPluginBase` instances that
  inject different code but expose the same defines share one compiled effect — the second material
  silently renders with the first one's shader. Give every plugin variant its own class name *and*
  its own define (`greffer({ nom })` in `greffe.ts` does both). If constants are baked into the code
  (per-lot values), the name must differ per lot (`relief.ts`).
- **Always GLSL and WGSL.** `getCustomCode(shaderType, shaderLanguage)` must return both; test the
  WGSL path under WebGPU (WebGL2 alone proves nothing). WGSL has no `mod()` (write
  `x - y * floor(x / y)`), different types/inputs/outputs (`dialecte(wgsl)` in `greffe.ts`).
- **Under WebGPU a material has no UBO of its own**: in `bindForSubMesh` use
  `ubo.updateFloat*` / `updateMatrix` only; `ubo.updateUniform` crashes there.
- **Injection-point formatting**: a closing brace alone on its line right after an `#endif` breaks
  the injected code; keep the brace on the code line.
- **Chain, don't replace.** Several plugins on one material are ordered by `priority`
  (lower runs first); weather (`intemperer`, priority 300) is grafted on top of others.
- **Missing shader include at runtime** ("include not found"): with ES modules some chunks must be
  imported explicitly — from `@babylonjs/core/Shaders/ShadersInclude/...` and
  `@babylonjs/core/ShadersWGSL/ShadersInclude/...`.

## 2. Instancing and meshes

- **Thin instance buffers are static by default.** `thinInstanceSetBuffer(kind, buf, stride,
  staticBuffer = true)`: a static buffer ignores later writes (`thinInstanceBufferUpdated` shows
  nothing) unless `thinInstanceAllowAutomaticStaticBufferRecreation` is set. Pass `false` for
  buffers you rewrite (LOD culling, animation).
- **A thin-instanced mesh with `thinInstanceCount === 0` at load compiles without the instancing
  variant**, which then compiles mid-walk (~200 ms hitch). Before `whenReadyAsync`, set the count to
  1, call `isReady(true)`, set it back to 0 (`main.ts`).
- **Disposing while iterating**: `mesh.dispose()` removes it from `container.meshes` /
  `scene.meshes`; iterate over a copy (`[...list]`) or the next item is skipped.
- **Winding / flipped normals** on imported or generated geometry: set
  `material.sideOrientation` (e.g. `Material.CounterClockWiseSideOrientation`) rather than
  flipping data; right-handed scenes (`scene.useRightHandedSystem = true`, used here) change the
  default winding.
- Merging (`Mesh.MergeMeshes`) loses per-mesh culling; merge per cell/zone, not globally.

## 3. Cameras and per-frame reads

- **`camera.globalPosition` is refreshed by `getViewMatrix()`.** Reading it first in a frame gives
  last frame's position (this emptied the hall for one frame at the door). Call
  `camera.getViewMatrix()` before reading `globalPosition` or derived data.
- `FreeCamera` with `inputs.clear()` is the walker's camera; rotation is set directly
  (`rotation.set(pitch, yaw, 0)`), fov is **vertical** and other code (`postTraitement.ts`,
  `faune.ts`) assumes so — widen it for portrait by computing the vertical fov, not by switching
  `fovMode`.

## 4. Engine, loading and assets

- **WebGPU fallback adapter**: `navigator.gpu.requestAdapter()` can return a software adapter
  (SwiftShader); reject it via `adapter.info?.isFallbackAdapter` and use WebGL2 (`socle.ts`).
- **XR on WebGPU** needs XRGPUBinding/WebXR Layers that headsets and the Cardboard polyfill don't
  have: XR sessions run on WebGL2 (`socle.ts` picks WebGL2 for a headset or `?vr=`).
- **KTX2 and Draco decoders** are served from `public/ktx2/` and `public/draco/` and configured once
  (`configurerDecodeurs` in `glb.ts`); a missing decoder path fails silently into untextured meshes.
- **Texture `onError` can fire twice** for one failed load; count failures with a `Set` keyed by
  URL, not a counter (`ciel.ts`).
- The Vite dev server answers missing files with `index.html` (200): a decode failure, not a 404.

## 5. Materials, colour and lighting

- Work in **linear space with PBR** (`PBRMaterial`, `matiere()` in `boites.ts`). A
  `StandardMaterial` is gamma-space here and looks washed out next to PBR — use PBR.
- **Reflection mip scale**: a `reflectionTexture` with the wrong LOD/mip setting made the GitHub
  carpet a mirror; check `realTimeFiltering`/LOD settings against the doc before shipping a shiny
  surface.
- Hemispheric light intensity is divided by π here to match three's convention; keep the existing
  light helpers rather than new raw lights.
- **Frozen materials** (`material.freeze()`, done for all at the end of loading) ignore property
  changes. A material that changes after load must be listed in `VIVANTES` (etat.ts) or go through
  `auCielMatiere`, or update values via a plugin's bind step (read even when frozen).

## 6. XR

- `WebXRSessionManager.setReferenceSpaceTypeAsync('local-floor')` falls back to `'viewer'` (offset
  by `defaultHeightCompensation`) when the floor is not granted — the head freezes and the world
  follows. Choose `'local-floor'` only if it is in `session.enabledFeatures`, else `'local'`
  (`espaceDeReference` in `vr.ts`).
- Probe captures and other offscreen renders are skipped while presenting.

## 7. Performance and compilation

- Loading time is dominated by **shader program linking** (≈ half of a 23 s load, in
  `bindUniformBlock`), not network. Fewer material variants and compiling up front matter more than
  asset caching.
- Probe/reflection recaptures and shadow-map redraws cost bursts of draw calls; trigger them on
  demand (`resetRefreshCounter`, `refreshRate`) rather than on a timer.
- Measure, don't guess: `node tools/mesurer-rendu.ts` (calls, triangles, median/p95 ms), and
  Chrome's profiler for CPU time.

## 8. Paid for in the cinema (Babylon 9.31)

- **Clustered lighting + sheen does not compile**: `pbrClusteredLightingFunctions` calls
  `computeSheenLighting(preInfo,normalW,…)` where its parameter is `N`. Any PBR with `sheen` that
  takes the `ClusteredLightContainer` (i.e. whose `maxSimultaneousLights` reaches the cluster's slot)
  fails to compile and **silently disappears** (velvet walls rendered as nothing). Patched once in
  `eclairage.ts` (`corrigerVeloursDesGrappes`, GLSL and WGSL). Lesson: read the console at every
  viewpoint — a missing material looks like a design flaw in a screenshot, not like an error.
- **Lights cross slabs and walls.** A light with no `includedOnlyMeshes` lights everything in range,
  including rooms underneath; it also takes one of the material's `maxSimultaneousLights` slots and
  can push the light you care about out. Rooms with their own lighting (cinema, foyer) exclude every
  foreign light (`scene.lights` + `onNewLightAddedObservable`), and their own lights use
  `includedOnlyMeshes`.
- **IBL lights a room regardless of its lamps.** Dimming lamps alone barely changes a probe-lit room:
  scale `environmentIntensity` with them (and list those materials in `VIVANTES`).
- **`flatMap` does not flatten typed arrays.** `Matrix.asArray()` is a `Float32Array`; returning it from
  a `flatMap` callback nests it, the thin-instance buffer comes out short, and the load dies with
  "offset is out of bounds". Spread it: `[...m.asArray()]`.
- **Never patch `ShaderStore` at import time, and never split the bundle with Rolldown's
  `includeDependenciesRecursively: false`.** Together they shipped a museum that crashed at load in
  production only (`Cannot read properties of undefined (reading 'IncludesShadersStoreWGSL')` from a
  shader chunk): that option drops the execution-order guarantee, and shader chunks our code imports
  directly read `ShaderStore` before its chunk initialised. Patch shaders at startup (`main.ts`),
  through `remplacer` (warns instead of throwing), and load the production bundle before publishing
  (`world-review/scripts/production.mjs`).

## 9. `push(...grosTableau)` casse Safari

JavaScriptCore plafonne les arguments d'un appel à ~65 000 (V8 en accepte bien plus) : `a.push(...positions)` sur une
géométrie lève « Maximum call stack size exceeded » sur iPhone seulement (les allées du parc, 2026-10). Pour un
tableau de sommets, une boucle `for (const v of g) a.push(v)` ; le spread reste bon pour une poignée d'éléments.
