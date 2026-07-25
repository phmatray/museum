/**
 * LOT 1 — Dérivation du musée (spec §5, §11).
 *
 *   node tools/derive-museum.ts          écrit public/data/museum.json
 *   node tools/derive-museum.ts --plan   n'écrit RIEN, imprime le plan
 *
 * Entrées  : museum.config.json          (requis)
 *            public/data/catalogue.json  (requis, généré par tools/fetch-github.ts)
 *            curation.json               (facultatif — absent = curation vide)
 *            public/media/atlas.json     (facultatif — absent = couches à 0)
 * Sortie   : public/data/museum.json
 *
 * Tout le travail est fait par `derive()`, qui est pure. Ce fichier ne fait que
 * lire, valider et écrire : c'est ce qui permet à l'éditeur de rejouer
 * exactement la même dérivation en mémoire, sans toucher au disque.
 *
 * `--plan` est le critère de fin du lot 1 : il rend visible ce que le clustering
 * et la disposition ont décidé, avant qu'une seule ligne de 3D n'existe.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AtlasIndex } from '../src/domain/types.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `src/` est écrit pour Vite, qui résout `./clustering` sans extension ; le
 * résolveur ESM de Node, lui, exige l'extension. Plutôt que d'imposer un
 * `.ts` partout dans le domaine — ce qui alourdirait des modules dont Node
 * n'est pas le premier client — on rétablit ici la convention du bundler, et
 * seulement pour les chemins relatifs dont le `.ts` existe vraiment.
 *
 * Les modules du domaine sont donc importés dynamiquement, APRÈS l'installation
 * du crochet : un `import` statique serait résolu avant que le corps du fichier
 * ne s'exécute.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const candidat = new URL(`${specifier}.ts`, context.parentURL)
      if (candidat.protocol === 'file:' && existsSync(candidat)) {
        return nextResolve(`${specifier}.ts`, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

const { derive, formatPlan } = await import('../src/domain/derive.ts')
const { EMPTY_CURATION, parseAtlasIndex, parseCatalogue, parseCuration, parseMuseumConfig } =
  await import('../src/schema/index.ts')

/**
 * Atlas de repli quand le pipeline média n'a pas encore tourné. Les tuiles
 * gardent la géométrie du vrai atlas (spec §5) : c'est elle qui donne le rapport
 * largeur/hauteur des cadres, et un musée dérivé sans médias doit tout de même
 * accrocher des œuvres de la bonne forme.
 */
const ATLAS_VIDE: AtlasIndex = {
  schemaVersion: 1,
  tileWidth: 256,
  tileHeight: 128,
  cols: 16,
  rows: 16,
  atlases: [],
  entries: {},
}

/** Lecture facultative : un fichier absent n'est pas une erreur, un fichier illisible si. */
async function lireSiPresent(chemin: string): Promise<unknown | null> {
  let brut: string
  try {
    brut = await readFile(chemin, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(brut) as unknown
  } catch (e) {
    throw new Error(`${chemin} : JSON invalide — ${(e as Error).message}`)
  }
}

async function lireObligatoire(chemin: string): Promise<unknown> {
  const contenu = await lireSiPresent(chemin)
  if (contenu === null) throw new Error(`fichier requis introuvable : ${chemin}`)
  return contenu
}

async function main(): Promise<void> {
  const planSeulement = process.argv.slice(2).includes('--plan')

  const config = parseMuseumConfig(await lireObligatoire(resolve(ROOT, 'museum.config.json')))
  const catalogue = parseCatalogue(await lireObligatoire(resolve(ROOT, 'public/data/catalogue.json')))

  const curationBrute = await lireSiPresent(resolve(ROOT, 'curation.json'))
  const curation = curationBrute === null ? EMPTY_CURATION : parseCuration(curationBrute)

  const atlasBrut = await lireSiPresent(resolve(ROOT, 'public/media/atlas.json'))
  const atlas = atlasBrut === null ? ATLAS_VIDE : parseAtlasIndex(atlasBrut)

  const musee = derive({ catalogue, curation, config, atlas })
  // Les avertissements de lecture précèdent ceux de la dérivation : ils en sont
  // souvent la cause (pas d'atlas → toutes les couches à 0).
  const enTete: string[] = []
  if (curationBrute === null) enTete.push('curation.json absent — aucune curation appliquée')
  if (atlasBrut === null) {
    enTete.push(
      'public/media/atlas.json absent — toutes les couches à 0, lance `npm run media` avant le rendu',
    )
  }
  musee.warnings.unshift(...enTete)

  if (planSeulement) {
    console.log(formatPlan(musee))
    return
  }

  const sortie = resolve(ROOT, 'public/data/museum.json')
  await mkdir(dirname(sortie), { recursive: true })
  await writeFile(sortie, `${JSON.stringify(musee, null, 2)}\n`)

  console.log(
    `${musee.stats.artworkCount} œuvres dans ${musee.stats.roomCount} salles sur ` +
      `${musee.stats.floorCount} niveaux → public/data/museum.json`,
  )
  for (const avertissement of musee.warnings) console.warn(`  ! ${avertissement}`)
}

main().catch((e: Error) => {
  console.error(`\nÉchec : ${e.message}`)
  process.exit(1)
})
