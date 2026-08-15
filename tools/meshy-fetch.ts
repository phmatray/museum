/**
 * Rapatrie les sorties Meshy — modèles bruts et images de référence.
 *
 *     MESHY_API_KEY=… node tools/meshy-fetch.ts            # les GLB bruts
 *     MESHY_API_KEY=… node tools/meshy-fetch.ts --images   # les références
 *
 * ── Deux destinations, et elles ne se ressemblent pas ──
 *
 * Les GLB vont dans `assets-src/meshy/`, IGNORÉ par git : 3 Mo la pièce, dont
 * `process-meshy.py` ne garde qu'un pour cent. Trente d'entre eux feraient
 * 90 Mo d'historique dans un dépôt public, pour des fichiers que personne ne
 * relira jamais.
 *
 * Les images vont dans `tools/meshy/reference/`, VERSIONNÉ : c'est la seule
 * chose depuis laquelle un tiers peut refaire un maillage équivalent pour
 * quelques crédits. Sans elles, il faudrait tout redessiner.
 *
 * ⚠️ Et elles sont RÉDUITES avant d'être écrites. Brutes, les vingt-neuf
 * références de Meshy pèsent 28,8 Mo — un mégaoctet la pièce, en PNG 2048 px.
 * Dans un dépôt public, c'est un historique qu'on ne peut plus jamais alléger,
 * pour une résolution dont personne n'a l'usage : ces images ne sont pas des
 * assets, ce sont des ENTRÉES DE GÉNÉRATION, et `image_to_3d` n'en tire pas un
 * maillage plus fin parce qu'elles sont plus grandes. 768 px en JPEG suffisent à
 * décrire une silhouette et à la rejouer.
 *
 * ── Ce que cet outil ne fait pas ──
 *
 * Il ne dépense rien : les tâches sont déjà payées, il ne fait que ramasser leur
 * résultat. Mais on ne peut pas le relancer indéfiniment — les URL signées de
 * Meshy expirent en quelques jours. C'est exactement pourquoi il télécharge au
 * lieu de lier, et pourquoi les images finissent versionnées.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRE = join(RACINE, 'tools', 'meshy', 'tasks.json')
const API = 'https://api.meshy.ai/openapi/v1'

type Entree = { tier: string; image?: string; modele?: string }

async function json(url: string, cle: string): Promise<Record<string, unknown>> {
  const reponse = await fetch(url, { headers: { Authorization: `Bearer ${cle}` } })
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
  return (await reponse.json()) as Record<string, unknown>
}

/** Côté long des références versionnées, en pixels. Voir l'en-tête. */
const REFERENCE_PX = 768

async function telecharger(url: string, vers: string, reduire = false): Promise<number> {
  const reponse = await fetch(url)
  if (!reponse.ok) throw new Error(`HTTP ${reponse.status} au téléchargement`)
  const octets = Buffer.from(await reponse.arrayBuffer())
  if (!reduire) {
    writeFileSync(vers, octets)
    return octets.length
  }
  // `-` en entrée : on ne pose jamais le PNG brut sur le disque, sans quoi un
  // `git add .` malheureux le ramasserait avant qu'on l'ait remplacé.
  execFileSync('magick', ['-', '-resize', `${REFERENCE_PX}x${REFERENCE_PX}>`, '-quality', '82', vers], {
    input: octets,
  })
  return statSync(vers).size
}

/** L'URL du GLB d'une tâche 3D. Meshy la range sous `model_urls.glb`. */
function urlDuModele(tache: Record<string, unknown>): string | null {
  const urls = tache.model_urls as Record<string, string> | undefined
  return typeof urls?.glb === 'string' ? urls.glb : null
}

function urlDeLImage(tache: Record<string, unknown>): string | null {
  const images = tache.image_urls
  return Array.isArray(images) && typeof images[0] === 'string' ? images[0] : null
}

async function main(): Promise<void> {
  const cle = process.env.MESHY_API_KEY
  if (!cle) {
    console.error('MESHY_API_KEY absente de l’environnement.')
    process.exit(2)
  }

  const images = process.argv.includes('--images')
  // `--force` retélécharge ce qui est déjà là. Sans lui on saute les fichiers
  // présents : rejouer l'outil après une coupure ne doit pas tout refaire.
  const force = process.argv.includes('--force')

  const dossier = images
    ? join(RACINE, 'tools', 'meshy', 'reference')
    : join(RACINE, 'assets-src', 'meshy')
  mkdirSync(dossier, { recursive: true })

  const registre = JSON.parse(readFileSync(REGISTRE, 'utf8')) as { pieces: Record<string, Entree> }
  let pris = 0
  let sautes = 0
  let poids = 0
  const manquants: string[] = []

  for (const [slug, entree] of Object.entries(registre.pieces)) {
    const id = images ? entree.image : entree.modele
    if (!id || id.startsWith('(')) continue

    const cible = join(dossier, `${slug}.${images ? 'jpg' : 'glb'}`)
    if (!force && existsSync(cible)) {
      sautes++
      poids += statSync(cible).size
      continue
    }

    try {
      const tache = await json(`${API}/${images ? 'text-to-image' : 'image-to-3d'}/${id}`, cle)
      if (tache.status !== 'SUCCEEDED') throw new Error(`statut ${String(tache.status)}`)
      const url = images ? urlDeLImage(tache) : urlDuModele(tache)
      if (!url) throw new Error('aucune URL dans la réponse')
      poids += await telecharger(url, cible, images)
      pris++
    } catch (erreur) {
      manquants.push(`${slug} (${(erreur as Error).message})`)
    }
  }

  // Nommés, jamais escamotés : une pièce absente ne doit pas se confondre avec
  // une pièce qu'on aurait décidé de ne pas produire.
  if (manquants.length > 0) {
    console.error(`MESHY_ABSENT ${manquants.length} : ${manquants.join(', ')}`)
  }
  console.log(
    `MESHY_FETCH ${pris} pris, ${sautes} déjà là, ${(poids / 1e6).toFixed(1)} Mo -> ${dossier.replace(RACINE + '/', '')}`,
  )
  if (manquants.length > 0) process.exit(1)
}

await main()
