/**
 * L'accrochage du plan : `public/data/catalogue.json` → `public/data/accrochage.json`.
 *
 *   node tools/accrocher.ts        (npm run accrocher)
 *
 * Tout le travail est dans `src/plan/hang.ts`, qui est pur ; ce fichier lit,
 * valide et écrit. Le bâtiment ne change jamais : seuls les thèmes des salles
 * et les toiles sur leurs murs suivent le catalogue.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Le domaine importe sans extension, à la
// manière de Vite, et Node exige l'extension. Imports dynamiques APRÈS le crochet.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
      const candidat = new URL(`${specifier}.ts`, context.parentURL)
      if (candidat.protocol === 'file:' && existsSync(candidat)) return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const { MUSEE } = await import('../src/plan/musee.ts')
const { assignRooms, hangPlan } = await import('../src/plan/hang.ts')
const { filtrerExclus } = await import('../src/plan/curation-filter.ts')
const { parseCatalogue, parseCuration, EMPTY_CURATION } = await import('../src/schema/index.ts')

const CURATION_PATH = resolve(ROOT, 'curation.json')

async function main(): Promise<void> {
  const catalogue = parseCatalogue(JSON.parse(await readFile(resolve(ROOT, 'public/data/catalogue.json'), 'utf8')))
  // `curation.json` est facultatif — même lecture optionnelle que `tools/build-media.ts`.
  const curation = existsSync(CURATION_PATH) ? parseCuration(JSON.parse(await readFile(CURATION_PATH, 'utf8'))) : EMPTY_CURATION
  const artworks = filtrerExclus(catalogue.artworks, curation)
  const accrochage = hangPlan(MUSEE, assignRooms(MUSEE, artworks), catalogue.generatedAt)
  const out = resolve(ROOT, 'public/data/accrochage.json')
  await writeFile(out, `${JSON.stringify(accrochage, null, 2)}\n`)
  const toiles = accrochage.rooms.reduce((n, r) => n + r.placements.length, 0)
  const exclus = catalogue.artworks.length - artworks.length
  console.log(`accrochage : ${toiles} toiles dans ${accrochage.rooms.length} salles (${exclus} exclus par la curation) → ${out}`)
  for (const r of accrochage.rooms) console.log(`  ${r.id.padEnd(8)} ${String(r.placements.length).padStart(3)}  ${r.name}`)
}

main().catch((e: unknown) => {
  console.error(`accrochage impossible : ${(e as Error).message}`)
  process.exit(1)
})
