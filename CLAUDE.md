# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A walkable 3D museum (Babylon.js 9, `@babylonjs/core` 9.31 ESM, tree-shaken, in plain TypeScript with no framework;
WebGPU with a WebGL2 fallback; Vite) that hangs the GitHub
repositories of `museum.config.json` `owners` as paintings, in an Orsay-style station hall with galleries, a Hall
of Honour and a Japanese garden. Deployed to GitHub Pages (`/museum/` base path) by `.github/workflows/deploy.yml`
on every push to `main` and nightly. Code comments, commit messages and UI text are in **French**; the README is English.

## Commands

```bash
npm run dev                  # Vite dev server
npm run lint                 # ESLint (flat config)
npm test                     # vitest run (jsdom); npm run test:watch for watch mode
NODE_OPTIONS=--no-webstorage npx vitest run         # locally on Node 26 (its Web Storage breaks jsdom's)
npx vitest run src/plan/__tests__/walk.test.ts      # one file
npx vitest run -t "gravit une butte"                # one test by name
npm run build                # tsc -b && vite build  (CI sets BASE_PATH=/museum/)

npm run fetch                # GitHub API -> public/data/catalogue.json (needs GITHUB_TOKEN)
npm run ateliers             # flagship repos' .csproj (or npm workspaces) graph -> public/data/ateliers.json (committed; kept if the API fails)
npm run captures             # screenshots of project sites/READMEs (needs Chrome)
npm run media                # catalogue -> painting textures in public/media (gitignored)
npm run accrocher            # hang the collection -> public/data/accrochage.json (committed)
npm run chantier             # docs/journal/index.html -> public/data/chantier.json (committed; also run by build) for the garden's site hut
npm run plan:svg             # redraw docs/plan/niveau-*.svg from the plan
node tools/generer-msdf.ts   # MSDF font atlases (Marcellus, Source Sans 3) -> public/msdf/*.png|json (committed; msdfgen in wasm)
node tools/fetch-assets.ts   # CC0 PBR materials/HDRI/sky (gitignored) + regenerates public/assets/CREDITS.md
npm run bake                 # bake the lightmap atlas in headless Blender (~10 min) -> public/assets/lumiere/atlas.webp
blender --background --python tools/blender/build-<x>.py   # rebuild one committed GLB
node tools/mesurer-rendu.ts [url] [--ombres=0] [--gpu=0] [--p=<repo>] [--lieu=x,z,yaw] [--vr=1] [--captures=dir]
                             # ms per frame, draw calls, triangles over 300 frames (against `npm run dev`)
node tools/comparer-captures.ts [url] [--dossier=dir] [--vues=arrivee,escalier] [--avant=dir]   # same views; --avant prints the before/after gap
node tools/compresser-glb.ts [file.glb]                     # embedded GLB textures -> KTX2 (run after any rebuild of a textured GLB)
```

Node runs the `tools/*.ts` scripts directly (type stripping, Node ≥ 22; CI runs Node 22). The two browser tools drive
Chrome through puppeteer-core (`CHROME_PATH`, default `/usr/bin/chromium`). Tests exclude `.claude/**` (agent
worktrees) and have a global 30 s timeout because a few suites simulate hours of walking.

## Architecture

**The plan is the single source of truth.** `src/plan/musee.ts` is a hand-written architect's plan (levels, rooms,
openings, flights, landings, obstacles). Everything else is *derived* from it by pure functions in `src/plan/`:
`mesh.ts` (`meshLevel` → axis-aligned wall/slab/step/railing boxes), `walk.ts` (collision from wall segments,
guardrails and obstacles — not from meshes), `rules.ts` (architectural validation + `surfaceAt`/`flightElevation`),
`parement.ts` (stone skin, gallery paint, plinths), `facade.ts`, `plafonds.ts`, `projecteurs.ts`, `cimaises.ts`,
`mobilier.ts`, `park.ts`/`relief.ts`/`enceinte.ts` (garden), `visibilite.ts` (room zones), `lumiere.ts` (lightmap
atlas packing). Changing the plan means regenerating `accrochage`, the plan SVGs and, if boxes or furniture moved,
the lightmap (`lumiere.json` keys boxes by position+size; unmatched boxes silently fall back to no lightmap).
The staircase and Hall of Honour GLBs are baked too, through a last "Lumiere" UV layer (`tools/blender/lumiere_uv.py`)
stretched over their own atlas region (`MODELES` in `tools/bake-lumiere.ts`): re-bake after rebuilding either GLB.
Blender cannot import KTX2 textures, so the bake hands it copies without them (`pourBlender`), each textured material
set to its average colour (`TEINTES_MOYENNES`): a new textured building material needs an entry there.

Coordinates: x east, z south, y up, metres. Walls are centred on room edges: interior partitions are ±`INT` (0.15),
façade `-EXT/+INT` (0.45/0.15) — see `svg.ts`. Skins stack on the wall face (hall stone 0.03, gallery paint 0.002).
Most z-fighting bugs so far were two surfaces landing on the same plane (plan boxes vs Blender GLBs, paving vs gravel):
offset one side explicitly.

**Pure logic, thin rendering.** Anything computable without the engine lives in `src/plan/` and `src/domain/`
(sun position `soleil.ts`, weather `meteo.ts`, seasons `saisons.ts`, clustering/hanging, Bavette's promenade, tour,
bell/clock `domain/horloge.ts`, adaptive quality `domain/qualite.ts`, Batlló bay `plan/batllo.ts`) and is unit-tested.
`src/babylon/<layer>.ts` only draw, one file per layer, each exporting `monterX(scene, …)`. Entry: `src/main.ts` →
`demarrer()` in `src/babylon/main.ts`, which wires them in a non-blocking sequence: socle → sun and sky → visitor →
interface → post-processing → reflections → plan boxes and skins → room culling → every other layer as a promise (a
missing GLB logs and the visit goes on; the heavy garden layers wait one drawn frame each). Once all have arrived, the
probes are captured and materials are frozen, except the names in `VIVANTES` (`etat.ts`). `?moteur=babylon` is still
accepted and ignored.

**`src/babylon/`, layer by layer:**
- `socle.ts`: `WebGPUEngine` if a non-fallback adapter answers (SwiftShader is discarded), else WebGL2 without MSAA;
  `useRightHandedSystem = true` before any camera or mesh, so the plan reads as is; KHR PBR Neutral tone mapping,
  exposure 1.15; WebGL2 (xrCompatible) whenever VR is wanted. `visiteur.ts`: a passive camera, `walk.ts` decides the
  feet; start from the plan or `?p=`; keyboard, pointer lock, touch, guided tour (`plan/tour`).
- Materials: `matiere()` (`boites.ts`) makes a `PBRMaterial` with the hex colour converted to linear like
  `THREE.Color` did (`lin()`, `lueurs.ts`); `matieres.ts` holds the ambientCG PBR sets, `pierre.ts` the drawn textures
  (same Park-Miller random as before). `boites.ts`: plan boxes merged into one mesh per kind plus thin instances;
  `chargerAtlas` = lightmap = factor × baked hemispheric irradiance (`LIGHTMAP_SHADOWSONLY`). `parement.ts`: seven
  merged meshes, one per finish, uv in metres, uv2 in the atlas.
- `glb.ts`: `glbOuRien`/`glbPartage`, `configurerDecodeurs` (Draco and Babylon's `KhronosTextureContainer2` for the
  KTX2 GLBs), `fusionnerParMatiere`, `eclairerModele` (the "Lumiere" UV layer mapped onto the model's atlas region,
  `uvDeModele`).
- Shaders: only through `greffer(mat, { nom, attributs, uniforms, lier, code(wgsl) })` (`greffe.ts`), a
  `MaterialPluginBase` written in GLSL **and** WGSL with `dialecte(wgsl)`. `lueurs.ts` (`brancherLueurs`,
  `reglerLueurs`: night glow keyed on the fragment's world position), `intemperies.ts` (`intemperer`/`rider`/
  `ruisseler`, smoothed `METEO`, `enWgsl`), `meteo.ts` (rain, snow, the `Brume` add-on), `usure.ts` (`userFacade`,
  `pietiner`: weathered façade and trodden paths, priority 250 so the weather goes on top). Wear inside is in
  `parement.ts`, the wall's moss in `enceinte.ts`.
- Batches: `lots.ts` (`Pose`/`matrices`/`instancier`: one thin instance per pose, one batch per glTF primitive;
  `cacherAuLoin`); `textes.ts`: one text atlas and one mesh per batch of labels. `msdf.ts`: sharp text through the
  `@babylonjs/addons` MSDF TextRenderer (room names, cartels, cinema/foyer/booth signs): one draw call per batch
  (font + colour), drawn in `onAfterDrawPhaseObservable` into the HDR target (depth-tested, unlit, never culled —
  the always-drawn walls hide it, so each batch costs one call everywhere), atlases from `tools/generer-msdf.ts`,
  no mipmaps, and our own fragment (GLSL + WGSL, screen-pixel range ≥ 1, set through the private `_setShaders`:
  re-check it on each addon upgrade). A sign keeps its plaque as a mesh and puts only its lettering in MSDF.
- `visibilite.ts`: the zones of `plan/visibilite.ts`, hidden by `layerMask`; immobile thin-instance batches are
  **compacted in place**. `metadata.zone` pins a mesh to a zone (`'ciel'` is never hidden),
  `alwaysSelectAsActiveMesh` keeps it always drawn, `metadata.immobile` lets a park batch be compacted;
  `toutMontrer()`/`retrier()` around off-eye renders (probes). The shadow map chains `getCustomRenderList`.
- `soleil.ts`: one `DirectionalLight` (sun 3.4 in PBR, moon by night), hemispheric /π, a `ShadowGenerator` redrawn on
  demand (`BOUGE` lists the moving casters). `ciel.ts`: the sky dome; by day it samples the sky-view LUT of `@babylonjs/addons`' `Atmosphere` (tables only:
  no compositor, no aerial perspective, its PBR plugin unregistered; LUT redrawn only when the sun or exposure
  moves), with the day photo's clouds on top and the night photo below. `reflets.ts`: one probe per room, specular
  environment only, cross-faded at doorways, captures suspended in VR.
- `postTraitement.ts`: HDR chain SSAO2 → bloom → tone mapping → god rays → grading → vignette → FXAA (creation order is
  chain order). `qualite.ts`: `setHardwareScalingLevel(1/d)` driven by a PerformanceMonitor-like monitor.
- `etat.ts`: zustand/vanilla stores (`reglages`, `partie`, `vivant`: sky/weather/season, `son`, `catalogue`,
  `recherche()`). `chargement.ts` + `ui/ecranChargement.ts`: the loading screen.
- `ui/`: native DOM + CSS (accueil, carteEtape, dom `el`/`svg`/`observer`/`themeName`, ecranChargement, minimap,
  mobile, oeuvre, partage, reglages, visite). Text goes in `textContent`, never catalogue data in `innerHTML` (`dom.ts`).
- NPCs: `plan/pnj.ts` decides where they go (a `Pilote` moves them); `plan/navigation.ts` derives their floor from
  the plan (rooms, landings, flights, park, holed by walls, obstacles, corner plants, park subjects, ropes; service
  doors stay shut) as a triangle soup; `navmesh.ts` bakes it with Recast (`@recast-navigation/*`) in
  `navmesh.worker.ts`; `navigation.ts` loads it into Babylon's `RecastNavigationJSPluginV2` (`@babylonjs/addons`)
  and runs the crowd (one agent per NPC, plus the visitor, teleported each frame). Adding something NPCs must walk
  around = making it a plan obstacle (or an `entraves` entry); `src/babylon/__tests__/navigation.test.ts` simulates
  five minutes of crowd and fails on any NPC inside a wall, obstacle, trunk or rope.
- Visitor's stamp book: pure rules in `domain/succes.ts` (`SUCCES`, `noter`, `tamponner`), wiring in `succes.ts`
  (game state → facts, nothing noted before the ticket is punched, `signaler(geste)` for star/share/tour end,
  localStorage `museum:carnet`), `ui/carnet.ts` (the `<dialog>`, key C, the stamp toast). A new stamp = one `SUCCES`
  entry plus the fact that earns it.
- VR: `vr.ts`/`vrEntrees.ts`/`vrRendu.ts` (+ `io/xr.ts`, pure input logic in `domain/vr.ts`): a bare
  `WebXRExperienceHelper` opened in the ticket's gesture, the rig at the walker's feet, `'local-floor'` else
  `'local'`, a per-eye pass attached to the eye cameras (tone mapping, grading, glow, comfort vignette), MSAA 4.
  Headsets and Cardboard share one path (Google's `webxr-polyfill` where there is no immersive-vr); under the
  Cardboard polyfill `engine.wipeCaches(true)` runs every XR frame, since it touches GL state behind Babylon's cache.

**Budget:** ≤ 300 draw calls and ≤ 1.5 M triangles at the arrival point (`tools/mesurer-rendu.ts`; about 151 and
1.04 M today).

**Data pipeline.** `fetch` → `captures` → `media` → `accrocher` → `build`. The building never changes; nightly runs
only re-theme rooms (`domain/clustering.ts`) and re-hang paintings (`plan/hang.ts`), deterministically. Tests run
against the committed `public/data/*.json`, never freshly fetched data.

**Blender assets.** `tools/blender/*.py` are deterministic, modelled directly in plan coordinates (Blender x = x,
y = −z, z = height; glTF export with +Y up). The resulting GLBs are committed because CI has no Blender.
`src/plan/__tests__/maquettes.test.ts` reads the committed GLBs (`@gltf-transform/core` + `draco3d`, helper
`glb.ts` next to it) and checks them against the plan's dimensions: extend it when a new modelled piece must fit the plan.
Textured GLBs (`MODELES` in `tools/compresser-glb.ts`) carry KTX2 textures (`KHR_texture_basisu`, required): after
re-exporting one, run `node tools/compresser-glb.ts <file>`; Babylon reads them once `configurerDecodeurs()`
(`glb.ts`) has pointed `KhronosTextureContainer2` at `public/ktx2/`. Third-party
asset credits are declared in the `tools/fetch-assets.ts` manifest and regenerated into `public/assets/CREDITS.md`.

**Runtime systems worth knowing before touching the scene:**
- Live state in `src/babylon/etat.ts` (zustand/vanilla): `vivant` (real sun/moon `ciel`, `jour` 0–1, `meteo`,
  `saison`), `partie` (pause, tour, `enVR`), `reglages`. A material that must follow the sky uses `auCielMatiere` or a
  greffe's `lier`, since materials are frozen once the scene is ready.
- One directional light with a shadow box following the visitor; the lightmap multiplies ambient diffuse; per-room
  probes are specular only. Night glow of the nave and the outdoor night ambient are keyed on the shaded fragment's
  world position (`lueurs.ts`), never the camera.
- Weather/season effects are greffes (`intemperies.ts`, `meteo.ts`) — chain onto a material's existing greffes, never
  replace one.
- In VR, `postTraitement` steps aside and `vrRendu` renders each eye; offscreen renders (probe captures) are skipped
  while presenting.

## Conventions and gotchas

- No React and no three.js: plain TypeScript, one file per layer in `src/babylon/`, no new dependency outside
  `@babylonjs/*` without need.
- Layer tests use `NullEngine` in `src/babylon/__tests__/` (one test file per module); new pure logic goes in
  `src/plan/` or `src/domain/` with its test.
- Colours through `matiere()`/`lin()`, in linear space. Shaders only through `greffer`, in GLSL **and** WGSL. Each greffe
  has its own `nom` (otherwise its define slips to the next plugin); greffes chain. Pitfalls (`greffe.ts`): no `mod()`
  in WGSL (`x - y * floor(x / y)`); in `lier`, never `ubo.updateUniform`, only `updateFloat*`/`updateMatrix` (WebGPU
  has no per-material UBO); the closing brace after an `#endif` alone on its line.
- A material whose textures or values change after load goes in `VIVANTES` (`etat.ts`) or reads them in a greffe's `lier`.
- Dev-only hooks for headless captures and debugging: `window.__BABYLON__ = { engine, scene, camera, instr, reprendre() }`
  (`main.ts`, `instr` is a `SceneInstrumentation`), `window.__PRET__` (scene ready, `chargement.ts`),
  `window.__BAVETTE__`, `window.__FAUNE__`, `window.__TOUT_VOIR__` (disable culling).
- URL parameters force live state for screenshots: `?heure=HH:MM`, `?meteo=clair|pluie|neige|brouillard|orage`,
  `?saison=printemps|ete|automne|hiver`, `?ombres=0`, `?annonce=1`, `?gpu=0` (force WebGL2, to compare both paths), `?ciel=photo` (the old photo sky instead of the physical one),
  `?vr=cardboard` (the Cardboard polyfill on a desktop, to drive VR headless), `?qualite=haute|basse` (freezes the
  adaptive pixel ratio of `babylon/qualite.ts`; use `haute` for captures on a loaded machine). `?p=<repo>` (or
  `?projet=owner/repo`, `#repo`) opens the museum in front of that painting (`domain/lien.ts`, `plan/arrivee.ts`); the
  build writes `dist/p/<repo>/` share pages with per-project OpenGraph tags (`tools/pages-partage.ts`).
- `docs/journal/index.html` is the illustrated development journal (French), one numbered step per shipped change; the build copies it to `dist/journal/` (live at `/museum/journal/`).
