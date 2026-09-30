/**
 * `npm run bake` — la lumière précalculée du bâtiment, de bout en bout.
 *
 *  1. Décrit la scène en JSON (`.lumiere/scene.json`, non versionné) : les
 *     boîtes du plan et leur rectangle d'atlas (`src/plan/lumiere.ts`), les
 *     obstacles (façade, résille, mobilier), les lanterneaux qui éclairent, et
 *     les modèles Blender du bâtiment — l'escalier et la salle d'honneur cuits
 *     eux aussi, chacun dans sa région (`MODELES`).
 *  2. Lance Blender : `tools/blender/bake-lumiere.py` cuit l'éclairement du ciel
 *     (Cycles, rebonds compris, débruité) dans l'atlas → `.lumiere/atlas.png`.
 *  3. Compresse l'atlas en WebP (`public/assets/lumiere/atlas.webp`) et écrit
 *     les rectangles que la scène relit (`src/plan/lumiere.json`).
 *
 * Les sorties sont versionnées : la CI n'a pas Blender. `--sans-blender` refait
 * seulement l'étape 1 (pour inspecter l'emballage), `--reprendre` saute Blender
 * et ne refait que l'étape 3. `BLENDER` choisit l'exécutable,
 * `ECHANTILLONS` le nombre d’échantillons (128 par défaut, débruités), `DENSITE` la densité visée en texels par mètre (14 : 7 cm).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import draco3d from 'draco3d'
import sharp from 'sharp'

import { boitesDesCimaises } from '../src/plan/cimaises.ts'
import { facade } from '../src/plan/facade.ts'
import { cleDeBoite, emballer, facesVisibles, MARGE, surfacesCuites } from '../src/plan/lumiere.ts'
import { MOBILIER } from '../src/plan/mobilier.ts'
import { MUSEE } from '../src/plan/musee.ts'
import { plafonds } from '../src/plan/plafonds.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TRAVAIL = resolve(ROOT, '.lumiere')
const LARGEUR = 4096
const HAUTEUR_MAX = 4096

const surfaces = surfacesCuites(MUSEE)
const f = facade(MUSEE)
const obstacles = [...f.brique, ...f.pierre, ...f.piliers, ...f.menuiseries]
const visibles = facesVisibles(MUSEE, surfaces, obstacles)

// La densité la plus haute qui tienne dans l'atlas, par pas de 1 texel/m.
let densite = Number(process.env.DENSITE ?? 14)
let atlas = emballer(surfaces, visibles, densite, LARGEUR, HAUTEUR_MAX)
while (atlas === null && densite > 4) atlas = emballer(surfaces, visibles, --densite, LARGEUR, HAUTEUR_MAX)
if (atlas === null) throw new Error('atlas impossible')
// Les modèles Blender cuits eux aussi, chacun sa région (en texels) sur une bande
// au-dessus des étagères : sa couche UV de lumière (`tools/blender/lumiere_uv.py`)
// s'y étire. ~30 texels/m — des marches de 16 cm veulent plus que les murs. Le
// parquet de la salle d'honneur, projeté d'en haut, a la sienne, à ses proportions.
const MODELES: [string, number, number][] = [
  ['escalier', 1024, 1024],
  ['salle-honneur', 1024, 1024],
  ['salle-honneur/Parquet', 512, 384],
]
const modeles: Record<string, number[]> = {}
let xModele = 0
for (const [cle, w, h] of MODELES) {
  modeles[cle] = [xModele + MARGE, atlas.hauteur + MARGE, xModele + MARGE + w, atlas.hauteur + MARGE + h]
  xModele += w + 2 * MARGE
}
const hautModeles = atlas.hauteur + 2 * MARGE + Math.max(...MODELES.map(([, , h]) => h))
// Hauteur arrondie au multiple de 256 : un atlas moins haut que large, pas de texels perdus.
const hauteur = Math.ceil(hautModeles / 256) * 256
const nFaces = visibles.reduce((s, v) => s + v.length, 0)
console.log(`${surfaces.length} boîtes, ${nFaces} faces visibles, ${densite} texels/m, atlas ${LARGEUR}×${hauteur}`)

const lanterneaux = MUSEE.levels.flatMap((l) => plafonds(MUSEE, l.id).verre)
const residus = MUSEE.levels.flatMap((l) => plafonds(MUSEE, l.id).resille)
// Les cimaises modulables (cimaises.ts) font écran comme le mobilier.
const cimaises = MUSEE.levels.flatMap((l) => boitesDesCimaises(MUSEE, l.id).panneaux)

/**
 * La teinte moyenne des cartes KTX2 des modèles, que Blender ne sait pas lire
 * (`KHR_texture_basisu`, requis depuis `compresser-glb.ts`). Pour la cuisson,
 * seule compte la couleur que la lumière emporte en rebondissant.
 */
const TEINTES_MOYENNES: Record<string, [number, number, number]> = {
  Escalier_Marbre: [0.82, 0.8, 0.77],
  Escalier_Griotte: [0.42, 0.11, 0.09],
}

/**
 * Le chemin d'un modèle que Blender peut importer : lui-même, ou, s'il porte des
 * cartes KTX2, une copie dans `.lumiere/` sans cartes ni Draco, chaque matière
 * texturée ramenée à sa teinte moyenne.
 */
async function pourBlender(chemin: string): Promise<string> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() })
  const doc = await io.read(chemin)
  const racine = doc.getRoot()
  if (!racine.listExtensionsUsed().some((e) => e.extensionName === 'KHR_texture_basisu')) return chemin
  for (const m of racine.listMaterials()) {
    const t = TEINTES_MOYENNES[m.getName()]
    if (m.getBaseColorTexture() && !t) throw new Error(`teinte moyenne inconnue pour ${m.getName()} (TEINTES_MOYENNES)`)
    if (t) m.setBaseColorFactor([...t, m.getBaseColorFactor()[3]])
  }
  for (const t of racine.listTextures()) t.dispose()
  for (const e of racine.listExtensionsUsed()) if (e.extensionName === 'KHR_texture_basisu' || e.extensionName === 'KHR_draco_mesh_compression') e.dispose()
  const copie = resolve(TRAVAIL, basename(chemin))
  await io.write(copie, doc)
  return copie
}

mkdirSync(TRAVAIL, { recursive: true })
writeFileSync(
  resolve(TRAVAIL, 'scene.json'),
  JSON.stringify({
    atlas: { largeur: LARGEUR, hauteur },
    surfaces: surfaces.map((s, i) => ({ boite: s.boite, matiere: s.matiere, rects: atlas.rects[i] })),
    obstacles: [...obstacles, ...residus, ...cimaises],
    lanterneaux,
    mobilier: MOBILIER.filter((m) => m.surface !== 'parc:terrain'),
    modeles,
    glb: await Promise.all(['nef', 'escalier', 'salle-honneur', 'batllo', 'mobilier'].map((n) => pourBlender(resolve(ROOT, `public/assets/architecture/${n}.glb`)))),
    sortie: resolve(TRAVAIL, 'atlas.png'),
    echantillons: Number(process.env.ECHANTILLONS ?? 128),
  }),
)

if (process.argv.includes('--sans-blender')) process.exit(0)

// `--reprendre` : l'atlas de Blender est déjà là, on ne refait que la compression.
if (!process.argv.includes('--reprendre')) execFileSync(process.env.BLENDER ?? 'blender', ['--background', '--factory-startup', '--python', resolve(ROOT, 'tools/blender/bake-lumiere.py'), '--', resolve(TRAVAIL, 'scene.json')], { stdio: 'inherit' })

const sortie = resolve(ROOT, 'public/assets/lumiere')
mkdirSync(sortie, { recursive: true })
const info = await sharp(resolve(TRAVAIL, 'atlas.png')).removeAlpha().webp({ quality: 88, effort: 6 }).toFile(resolve(sortie, 'atlas.webp'))
console.log(`atlas.webp : ${(info.size / 1e6).toFixed(2)} Mo`)

// Les rectangles, par clé de boîte : seules les faces cuites.
const boites: Record<string, (number[] | 0)[]> = {}
surfaces.forEach((s, i) => {
  if (atlas.rects[i].some((r) => r !== null)) boites[cleDeBoite(s.boite)] = atlas.rects[i].map((r) => r ?? 0)
})
writeFileSync(resolve(ROOT, 'src/plan/lumiere.json'), JSON.stringify({ largeur: LARGEUR, hauteur, densite, modeles, boites }) + '\n')
console.log('src/plan/lumiere.json écrit')
