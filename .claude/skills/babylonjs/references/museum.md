# The museum's Babylon architecture

CLAUDE.md is the authority (plan as single source of truth, pure logic in `src/plan` and
`src/domain`, thin rendering in `src/babylon`, French comments/commits/UI). This page is the map
of the Babylon side and of the helpers to reuse before writing new ones.

## Where things are mounted

`src/babylon/main.ts` builds everything in order: engine (`socle.ts`: WebGPU, else WebGL2), the
walker camera (`visiteur.ts`), sun/shadows (`soleil.ts`), sky (`ciel.ts`), the plan's boxes and
lightmap (`boites.ts`), then each layer as a promise in `couches` (tracked by the loading screen via
`suivre`), then `whenReadyAsync`, material freezing, probe capture, and `marquerPret()`. A new layer is
one `monterX(scene, …)` module added to `couches`; return its shadow casters so `ombrer` registers
them.

## Helpers to reuse

| Need | Use |
|---|---|
| A PBR material with this project's settings | `matiere()` (`boites.ts`), `matierePBR()` + KTX2 maps (`matieres.ts`, `cartesChargees`) |
| Inject shader code (GLSL + WGSL) into a material | `greffer(mat, { nom, uniforms, lier, code })` and `dialecte(wgsl)` (`greffe.ts`) |
| Load a GLB (KTX2/Draco) | `chargerGlb`, `glbOuRien`, `glbPartage`, `fusionnerParMatiere` (`glb.ts`) |
| Many copies of a model | `instancier`, `matrices`, `cacherAuLoin` (distance/frustum LOD) (`lots.ts`) |
| Text on surfaces | `atlasDeTextes`, `matiereDeTexte`, `canevasEnMetres` (`textes.ts`) |
| Contact shadows under furniture | `monterContact`, `matiereDeTache` (`contact.ts`) |
| Night glow / outdoor ambient keyed on world position | `brancherLueurs` (`lueurs.ts`) |
| Rain, snow, puddles, fog on a material | `intemperer` (`intemperies.ts`), wear: `userFacade`, `pietiner` (`usure.ts`) |
| Room visibility culling | automatic (`visibilite.ts`); pin with `mesh.metadata.zone`, `metadata.immobile` |
| React to time of day | `auCiel(f)`, `auCielMatiere(m, f)` (`etat.ts`); live state stores: `vivant`, `partie`, `reglages` |
| A material that changes after load | add its name to `VIVANTES` (`etat.ts`) or update through a plugin's bind |
| UI around the scene | native DOM in `src/babylon/ui/` (`el`, `svg`, `observer` in `dom.ts`) |

## Conventions specific to the Babylon side

- `scene.useRightHandedSystem = true`; plan coordinates: x east, z south, y up, metres.
- Sun intensity 3.4; hemispheric light ÷ π; lightmap = factor × hemispheric irradiance
  (`LIGHTMAP_SHADOWSONLY`). HDR post-process in `postTraitement.ts` (Neutral tone mapping at
  exposure 1.15, bloom, SSAO2, grading).
- Reflection probes per room cross-fade by position (`reflets.ts`).
- Dev hooks (DEV only): `window.__BABYLON__ = { engine, scene, camera, instr, reprendre }` with
  `camera.placer(arrivee)` and `camera.walker()`; `window.__PRET__` once loaded.

## Measuring and checking

```bash
npm run dev                                   # then, in another shell:
node tools/mesurer-rendu.ts [--gpu=0] [--ombres=0] [--lieu=x,z,yaw] [--captures=dir]
node tools/comparer-captures.ts --vues=arrivee,jardin --dossier=/tmp/caps
NODE_OPTIONS=--no-webstorage npx vitest run src/babylon/__tests__/<file>.test.ts   # Node 26
```

Budget: ≤ 300 draw calls and ≤ 1.5 M triangles at the arrival point and mid-garden (per eye in
VR). URL switches for reproducible captures: `?heure=HH:MM`, `?meteo=`, `?saison=`, `?ombres=0`,
`?qualite=haute|basse`, `?p=<repo>`, `?vr=cardboard`.
