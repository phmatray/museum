# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A walkable 3D museum (React 19 + three.js via @react-three/fiber, Vite, TypeScript) that hangs the GitHub
repositories of `museum.config.json` `owners` as paintings, in an Orsay-style station hall with galleries, a Hall
of Honour and a Japanese garden. Deployed to GitHub Pages (`/museum/` base path) by `.github/workflows/deploy.yml`
on every push to `main` and nightly. Code comments, commit messages and UI text are in **French**; the README is English.

## Commands

```bash
npm run dev                  # Vite dev server
npm run lint                 # ESLint (flat config)
npm test                     # vitest run (jsdom); npm run test:watch for watch mode
npx vitest run src/plan/__tests__/walk.test.ts      # one file
npx vitest run -t "gravit une butte"                # one test by name
npm run build                # tsc -b && vite build  (CI sets BASE_PATH=/museum/)

npm run fetch                # GitHub API -> public/data/catalogue.json (needs GITHUB_TOKEN)
npm run ateliers             # flagship repos' .csproj (or npm workspaces) graph -> public/data/ateliers.json (committed; kept if the API fails)
npm run captures             # screenshots of project sites/READMEs (needs Chrome)
npm run media                # catalogue -> painting textures in public/media (gitignored)
npm run accrocher            # hang the collection -> public/data/accrochage.json (committed)
npm run plan:svg             # redraw docs/plan/niveau-*.svg from the plan
node tools/fetch-assets.ts   # CC0 PBR materials/HDRI/sky (gitignored) + regenerates public/assets/CREDITS.md
npm run bake                 # bake the lightmap atlas in headless Blender (~10 min) -> public/assets/lumiere/atlas.webp
blender --background --python tools/blender/build-<x>.py   # rebuild one committed GLB
```

Node runs the `tools/*.ts` scripts directly (type stripping, Node ≥ 22). Tests exclude `.claude/**` (agent
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

Coordinates: x east, z south, y up, metres. Walls are centred on room edges: interior partitions are ±`INT` (0.15),
façade `-EXT/+INT` (0.45/0.15) — see `svg.ts`. Skins stack on the wall face (hall stone 0.03, gallery paint 0.002).
Most z-fighting bugs so far were two surfaces landing on the same plane (plan boxes vs Blender GLBs, paving vs gravel):
offset one side explicitly.

**Pure logic, thin rendering.** Anything computable without three.js lives in `src/plan/` and `src/domain/`
(sun position `soleil.ts`, weather `meteo.ts`, seasons `saisons.ts`, clustering/hanging, Bavette's promenade, tour,
bell/clock `scene/horloge.ts`) and is unit-tested. `src/scene/*Layer.tsx` only draw, mounted from `PlanBuilding.tsx`;
`Musee3D.tsx` holds the lazily loaded Canvas. Draw calls are kept low: plan boxes are one `instancedMesh` per kind
(`Boites`, unit cube scaled per instance via `appliquerEchelleInstance`).

**Data pipeline.** `fetch` → `captures` → `media` → `accrocher` → `build`. The building never changes; nightly runs
only re-theme rooms (`domain/clustering.ts`) and re-hang paintings (`plan/hang.ts`), deterministically. Tests run
against the committed `public/data/*.json`, never freshly fetched data.

**Blender assets.** `tools/blender/*.py` are deterministic, modelled directly in plan coordinates (Blender x = x,
y = −z, z = height; glTF export with +Y up). The resulting GLBs are committed because CI has no Blender. Third-party
asset credits are declared in the `tools/fetch-assets.ts` manifest and regenerated into `public/assets/CREDITS.md`.

**Runtime systems worth knowing before touching the scene:**
- Global state in `src/stores/gameStore.ts` (zustand): `ciel` (real sun/moon, `jour` 0–1), `meteo`, `saison`, tour, etc.
- One directional light (sun by day, moon by night) with a shadow box following the visitor (`OmbresLayer`);
  lightmap multiplies ambient diffuse (`scene/lumiere.ts`); per-room reflection probes (`RefletsLayer`) are
  specular only (the IBL irradiance is patched out of three's shader chunk) and cross-fade by position at doorways. Night glow of the nave and the outdoor night ambient
  are keyed on the shaded fragment's world position (`scene/lueurs.ts`, shared `uLueurs` uniform), never the camera.
- Weather/season effects are `onBeforeCompile` shader add-ons in `scene/intemperies.ts` — chain onto an existing hook,
  never replace it.
- Room-visibility culling (`VisibiliteLayer` + `scene/tri.ts`) hides meshes by `layers.mask` and **compacts instanced
  batches in place**; use `userData.zone` to pin a mesh to a zone, `frustumCulled=false` to opt out, `sansTri()` for
  off-eye renders.

## Conventions and gotchas

- ESLint `react-hooks/immutability`: in-place three.js mutations go inside
  `/* eslint-disable react-hooks/immutability */ … /* eslint-enable */` blocks.
- `instancedMesh` materials are passed as props, never in `args` (a test enforces it).
- In jsdom tests, `@react-three/drei` `Text` is mocked; `PlanBuilding.test.tsx` counts instanced meshes, so a new
  instanced layer usually needs that test updated (or its layer mocked).
- Dev-only hooks for headless captures and debugging: `window.__PLAN__` (walker, camera, `gl`, `scene`),
  `window.__BAVETTE__`, `window.__FAUNE__`, `window.__TOUT_VOIR__` (disable culling).
- URL parameters force live state for screenshots: `?heure=HH:MM`, `?meteo=clair|pluie|neige|brouillard|orage`,
  `?saison=printemps|ete|automne|hiver`, `?ombres=0`, `?annonce=1`. `?p=<repo>` (or `?projet=owner/repo`, `#repo`) opens
  the museum in front of that painting (`domain/lien.ts`, `plan/arrivee.ts`); the build writes `dist/p/<repo>/` share
  pages with per-project OpenGraph tags (`tools/pages-partage.ts`).
- `docs/journal/index.html` is the illustrated development journal (French), one numbered step per shipped change.
