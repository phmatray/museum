/**
 * Le programme du cinéma : la dernière vidéo de la chaîne (`CHAINE`, domain/cinema.ts),
 * Shorts exclus, relevée dans son flux RSS public (sans clé). Écrit
 * `public/data/cinema.json`, VERSIONNÉ : si YouTube ne répond pas, la séance de
 * la veille reste à l'affiche.
 *
 * Usage : node tools/fetch-cinema.ts
 */
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHAINE, lireFlux, titreDeShort, type Seance } from '../src/domain/cinema.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SORTIE = resolve(ROOT, 'public/data/cinema.json')

/** Un Short : son adresse /shorts/ répond sans rediriger vers /watch. */
async function estUnShort(video: string): Promise<boolean> {
  const r = await fetch(`https://www.youtube.com/shorts/${video}`, { method: 'HEAD', redirect: 'manual' })
  return r.status === 200
}

const flux = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHAINE.id}`)).text()
const entrees = lireFlux(flux)
let choisie = null
for (const e of entrees) {
  if (titreDeShort(e.titre) || (await estUnShort(e.video))) continue
  choisie = e
  break
}
if (!choisie) throw new Error(`aucune vidéo (hors Shorts) dans le flux de ${CHAINE.nom} (${entrees.length} entrées)`)
const seance: Seance = { schemaVersion: 1, generatedAt: new Date().toISOString(), chaine: CHAINE.nom, ...choisie }
await writeFile(SORTIE, `${JSON.stringify(seance, null, 2)}\n`)
console.log(`cinéma : « ${seance.titre} » (${seance.video}, ${seance.publie.slice(0, 10)})`)
