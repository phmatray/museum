/**
 * Mesure les props d'un kit glTF : emprises, triangles, et coût à l'écran.
 *
 *   node tools/measure-props.ts
 *   node tools/measure-props.ts --kit public/assets/props/museum-kit.glb
 *   node tools/measure-props.ts --json
 *
 * ── Pourquoi cet outil existe ──
 *
 * `PROP_METRICS` porte en commentaire « mesuré sur les GLB eux-mêmes, pas
 * estimé ». `glbBounds.ts` a rendu ce commentaire vérifiable ; il ne l'a pas
 * rendu REPRODUCTIBLE. Pour transcrire la table après un changement de kit, il
 * fallait écrire une commande jetable — et `tools/capture.ts` ouvre justement
 * sur l'argument qui condamne cette pratique : « une mesure dont on garde le
 * résultat mais pas le code est une mesure invérifiable ».
 *
 * Celui-ci est versionné, il tourne sans navigateur et sans WebGL, et il sort
 * un bloc `PROP_METRICS` prêt à coller.
 *
 * ── Ce qu'il mesure et que la table ne dit pas ──
 *
 * Le coût À L'ÉCRAN, c'est-à-dire les triangles multipliés par le nombre
 * d'exemplaires réellement posés par `placeProps`. C'est la seule colonne qui
 * compte pour le §9, et c'est celle que personne ne regardait : le projecteur
 * pèse 940 triangles, ce qui est modeste — et 94 000 à l'écran, ce qui est le
 * premier poste du mobilier, devant les quatre espèces de plantes réunies.
 *
 * ── Le sens de l'arrondi ──
 *
 * Le rayon s'arrondit PAR EXCÈS au millimètre, `minY` par défaut, `maxY` par
 * excès. Une borne pessimiste réserve trop de place ; une borne optimiste plante
 * un prop dans un mur, ce qui ne se voit qu'à l'écran, depuis le bon angle, si
 * on passe par là.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { activerResolutionTs } from './ts-resolve.ts'
import type { PropId } from '../src/domain/props.ts'
import type { Museum } from '../src/domain/types.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Le crochet DOIT être posé avant que le domaine ne soit résolu : `park.ts`
// importe `./props` sans extension. D'où les imports dynamiques ci-dessous —
// voir l'en-tête de `ts-resolve.ts` pour le pourquoi de l'ordonnancement.
activerResolutionTs()

const { lireGltf, metriquesDuNoeud, trianglesDuNoeud } = await import(
  '../src/domain/__tests__/glbBounds.ts'
)
const { PROP_IDS, placeProps } = await import('../src/domain/props.ts')
const { planterParc } = await import('../src/domain/park.ts')
// `kits.ts` et non `propAssets.ts` / `parkAssets.ts` : le catalogue est de la
// donnée pure, les chargeurs tirent `three` et `import.meta.env`. Un outil Node
// n'a rien à faire du moteur de rendu — c'est ce que `tsc -b` a rappelé, et il
// avait raison.
const { ESPECES_GLB, ESPECES_PARK_GLB, NOEUDS_DU_KIT } = await import('../src/scene/kits.ts')

const KIT_DEFAUT = 'public/assets/props/museum-kit.glb'
const PLANTS = 'public/assets/plants/plants-lod.glb'
const PARK = 'public/assets/plants/park-lod.glb'
const MUSEE = 'public/data/museum.json'

interface Ligne {
  id: string
  /** Un sujet peut être réparti sur plusieurs nœuds — pot, feuillage, terre. */
  noeuds: readonly string[]
  rayon: number | null
  minY: number | null
  maxY: number | null
  triangles: number
  exemplaires: number
  aLEcran: number
}

/**
 * Somme les triangles d'un sujet réparti sur plusieurs nœuds.
 *
 * `ESPECES_GLB` documente le cas : Poly Haven livre `potted_plant_02` en deux
 * pièces, `potted_plant_04` en trois. Ne compter que le premier nœud
 * sous-estimerait le sujet du tiers — et c'est le sujet qui est instancié.
 */
function trianglesDuSujet(
  gltf: ReturnType<typeof lireGltf>,
  noeuds: readonly string[],
  manquants: string[],
): number {
  let total = 0
  for (const nom of noeuds) {
    const t = trianglesDuNoeud(gltf, nom)
    if (t === null) manquants.push(nom)
    else total += t
  }
  return total
}

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Par excès au millimètre. Voir l'en-tête : le sens de l'erreur est le sujet. */
function plafond(v: number): number {
  return Math.ceil(v * 1000) / 1000
}

function plancher(v: number): number {
  return Math.floor(v * 1000) / 1000
}

function main(): void {
  const kit = resolve(ROOT, argument('kit') ?? KIT_DEFAUT)
  const gltf = lireGltf(kit)
  const musee = JSON.parse(readFileSync(resolve(ROOT, MUSEE), 'utf8')) as Museum

  // Le compte d'exemplaires vient du placeur RÉEL, pas d'une estimation : c'est
  // lui qui décide combien de bancs tiennent dans le bâtiment courant.
  const poses = new Map<PropId, number>()
  for (const p of placeProps(musee)) poses.set(p.id, (poses.get(p.id) ?? 0) + 1)

  const parId = new Map<PropId, string>()
  for (const [noeud, id] of Object.entries(NOEUDS_DU_KIT)) parId.set(id, noeud)

  const lignes: Ligne[] = []
  const absents: string[] = []

  // ── Le mobilier, dans museum-kit.glb ──
  for (const id of PROP_IDS) {
    const noeud = parId.get(id)
    if (noeud === undefined) continue // une plante : traitée plus bas

    const m = metriquesDuNoeud(gltf, noeud)
    const t = trianglesDuNoeud(gltf, noeud)
    if (m === null || t === null) {
      absents.push(noeud)
      continue
    }
    const exemplaires = poses.get(id) ?? 0
    lignes.push({
      id,
      noeuds: [noeud],
      rayon: plafond(m.rayon),
      minY: plancher(m.minY),
      maxY: plafond(m.maxY),
      triangles: t,
      exemplaires,
      aLEcran: t * exemplaires,
    })
  }

  // ── La végétation d'intérieur, dans plants-lod.glb ──
  const flore = lireGltf(resolve(ROOT, PLANTS))
  for (const { id, noeuds } of ESPECES_GLB) {
    const t = trianglesDuSujet(flore, noeuds, absents)
    const exemplaires = poses.get(id as PropId) ?? 0
    lignes.push({
      id,
      noeuds,
      rayon: null,
      minY: null,
      maxY: null,
      triangles: t,
      exemplaires,
      aLEcran: t * exemplaires,
    })
  }

  // ── Le parc, dans park-lod.glb ──
  //
  // Les effectifs viennent de `planterParc`, pas d'une estimation : c'est la
  // grille jitterée réelle, percée des allées et de l'emprise du bâtiment.
  const parc = planterParc(musee.floors[0].footprint)
  const semis = new Map<string, number>()
  for (const p of parc.plantations) semis.set(p.espece, (semis.get(p.espece) ?? 0) + 1)

  const bois = lireGltf(resolve(ROOT, PARK))
  for (const { id, noeuds } of ESPECES_PARK_GLB) {
    const t = trianglesDuSujet(bois, noeuds, absents)
    const exemplaires = semis.get(id) ?? 0
    lignes.push({
      id,
      noeuds,
      rayon: null,
      minY: null,
      maxY: null,
      triangles: t,
      exemplaires,
      aLEcran: t * exemplaires,
    })
  }

  if (absents.length > 0) {
    // Nommer ce qui manque plutôt que de le laisser disparaître du relevé : un
    // nœud absent est une désynchronisation entre Blender et la table TS, et
    // c'est exactement le genre d'écart qu'un `continue` silencieux enterre.
    console.error(`\n⚠ nœud introuvable : ${absents.join(', ')}`)
  }

  if (argument('json') !== undefined || process.argv.includes('--json')) {
    console.log(JSON.stringify(lignes, null, 2))
    return
  }

  console.log(`\nkit : ${kit}`)
  console.log(`musée : ${musee.stats.roomCount} salles, ${musee.stats.artworkCount} œuvres\n`)
  const col = (v: number | null): string => (v === null ? '—'.padStart(7) : v.toFixed(3).padStart(7))
  console.log(
    `${'sujet'.padEnd(14)} ${'rayon'.padStart(7)} ${'minY'.padStart(7)} ${'maxY'.padStart(7)} ` +
      `${'tris'.padStart(7)} ${'×'.padStart(5)} ${'à l’écran'.padStart(10)}`,
  )
  let total = 0
  for (const l of lignes) {
    total += l.aLEcran
    console.log(
      `${l.id.padEnd(14)} ${col(l.rayon)} ${col(l.minY)} ${col(l.maxY)} ` +
        `${String(l.triangles).padStart(7)} ` +
        `${String(l.exemplaires).padStart(5)} ${String(l.aLEcran).padStart(10)}`,
    )
  }
  console.log(`${' '.repeat(45)} ${'total'.padStart(5)} ${String(total).padStart(10)}`)

  // La ventilation par famille : c'est elle qui dit OÙ dépenser et où récupérer.
  // Un total seul ne l'aurait jamais montré — le parc pèse plus que tout le
  // reste réuni, et le bâtiment nu n'est pas le sujet.
  const famille = (id: string): string =>
    id.startsWith('arbre') || id.startsWith('arbuste')
      ? 'parc'
      : id.startsWith('plante')
        ? 'plantes'
        : 'mobilier'
  const parFamille = new Map<string, number>()
  for (const l of lignes) parFamille.set(famille(l.id), (parFamille.get(famille(l.id)) ?? 0) + l.aLEcran)
  console.log('\n── ventilation ──')
  for (const [f, n] of [...parFamille].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(10)} ${String(n).padStart(9)}  ${((100 * n) / total).toFixed(1)} %`)
  }

  console.log('\n── à coller dans PROP_METRICS ──\n')
  for (const l of lignes) {
    if (l.rayon === null) continue
    console.log(
      `  ${l.id}: { radius: ${l.rayon}, minY: ${l.minY}, maxY: ${l.maxY} },` +
        `  // ${l.triangles} tri × ${l.exemplaires} = ${l.aLEcran}`,
    )
  }
  console.log()
}

main()
