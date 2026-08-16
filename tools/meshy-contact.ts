/**
 * Planche contact des références Meshy — vingt-neuf images en une seule.
 *
 *     MESHY_API_KEY=… node tools/meshy-contact.ts [--modeles]
 *
 * ── Pourquoi cet outil existe ──
 *
 * La règle de ce dépôt est qu'on ne juge pas une forme au compteur : c'est la
 * leçon des arbres décimés en squelette et de la nervure à 550 triangles, deux
 * fois payée. Il faut donc REGARDER les vingt-neuf références avant de dépenser
 * 580 crédits à les passer en 3D.
 *
 * Les regarder une par une, c'est vingt-neuf allers-retours. Les mettre sur une
 * planche, c'est un seul — et c'est en plus la seule façon de juger ce qui compte
 * vraiment ici : non pas si chaque pièce est belle isolément, mais si les
 * vingt-neuf ont l'air de sortir du même bâtiment. Une dérive de style ne se voit
 * pas sur une image seule ; elle saute aux yeux sur une grille.
 *
 * ── Pourquoi la clé vient de l'environnement, et de nulle part ailleurs ──
 *
 * Le dépôt est public. Une clé écrite dans un fichier versionné y reste après
 * révocation, dans l'historique, pour toujours.
 *
 * ── Ce que cet outil ne fait pas ──
 *
 * Il ne dépense rien. Les tâches sont déjà payées ; il ne fait que relire leur
 * résultat. On peut donc le relancer autant qu'on veut — mais pas indéfiniment :
 * les URL signées de Meshy EXPIRENT (quelques jours). C'est précisément pourquoi
 * il télécharge au lieu de lier, et pourquoi les images retenues finissent
 * versionnées dans `tools/meshy/reference/`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRE = join(RACINE, 'tools', 'meshy', 'tasks.json')

/** 260 px par vignette : assez pour juger une silhouette, pas assez pour peser. */
const VIGNETTE = 260

/** 6 colonnes : 30 pièces tiennent en 5 rangées, et la planche reste lisible. */
const COLONNES = 6

const API = 'https://api.meshy.ai/openapi/v1'

/**
 * Cet ImageMagick n'embarque AUCUNE police par défaut : `-label` échoue sur
 * `unable to read font ''`. On lui en désigne une explicitement.
 *
 * Et si aucune n'est trouvée, on retire l'étiquette PLUTÔT QUE d'échouer : une
 * planche sans nom de pièce reste utile pour juger la cohérence de style, qui
 * est la question principale. Refuser de la produire pour une police manquante
 * serait perdre l'essentiel en défendant l'accessoire.
 */
const POLICES = [
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
]

type Entree = { tier: string; image?: string; modele?: string }

async function json(url: string, cle: string): Promise<Record<string, unknown>> {
  const reponse = await fetch(url, { headers: { Authorization: `Bearer ${cle}` } })
  if (!reponse.ok) throw new Error(`${reponse.status}`)
  return (await reponse.json()) as Record<string, unknown>
}

/**
 * Extrait l'URL d'aperçu d'une tâche, quel que soit son type.
 *
 * Meshy ne rend pas le même champ selon qu'on interroge une image ou un modèle :
 * `image_urls[]` d'un côté, `thumbnail_url` de l'autre. Sonder les deux plutôt
 * que de parier — un parti pris ici sortirait une planche VIDE sans erreur.
 */
function apercu(tache: Record<string, unknown>): string | null {
  const images = tache.image_urls
  if (Array.isArray(images) && typeof images[0] === 'string') return images[0]
  for (const champ of ['thumbnail_url', 'preview_url']) {
    const v = tache[champ]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

async function telecharger(url: string, vers: string): Promise<void> {
  const reponse = await fetch(url)
  if (!reponse.ok) throw new Error(`${reponse.status} au téléchargement`)
  writeFileSync(vers, Buffer.from(await reponse.arrayBuffer()))
}

async function main(): Promise<void> {
  const cle = process.env.MESHY_API_KEY
  if (!cle) {
    console.error('MESHY_API_KEY absente de l’environnement.')
    process.exit(2)
  }

  // `--modeles` regarde les maillages générés plutôt que les images de départ :
  // c'est le SECOND contrôle, celui qui dit si la reconstruction a tenu ce que
  // l'image promettait. Deux planches, deux questions différentes.
  const modeles = process.argv.includes('--modeles')
  const champ = modeles ? 'modele' : 'image'
  const type = modeles ? 'image-to-3d' : 'text-to-image'

  const registre = JSON.parse(readFileSync(REGISTRE, 'utf8')) as { pieces: Record<string, Entree> }
  const dossier = join(RACINE, '.captures', modeles ? 'meshy-mod' : 'meshy-ref')
  mkdirSync(dossier, { recursive: true })

  const retenus: string[] = []
  const manquants: string[] = []

  // Séquentiel : le CDN de Meshy étrangle les rafales, et une image manquante
  // ferait un TROU DANS LA PLANCHE — une pièce absente qu'on croirait simplement
  // mal cadrée.
  for (const [slug, entree] of Object.entries(registre.pieces)) {
    const id = entree[champ as 'image' | 'modele']
    if (!id || id.startsWith('(')) continue
    try {
      const url = apercu(await json(`${API}/${type}/${id}`, cle))
      if (!url) throw new Error('aucune image dans la réponse')
      const chemin = join(dossier, `${slug}.png`)
      await telecharger(url, chemin)
      retenus.push(chemin)
    } catch (erreur) {
      manquants.push(`${slug} (${(erreur as Error).message})`)
    }
  }

  if (manquants.length > 0) {
    // Nommé, jamais escamoté : une planche à qui il manque des pièces sans le
    // dire ressemble exactement à une planche complète.
    console.error(`MESHY_ABSENT ${manquants.length} : ${manquants.join(', ')}`)
  }
  if (retenus.length === 0) process.exit(1)

  const police = POLICES.find((p) => existsSync(p))
  if (!police) console.error('MESHY_POLICE aucune police trouvée — planche sans étiquettes')

  const cible = join(RACINE, '.captures', modeles ? 'meshy-modeles.jpg' : 'meshy-contact.jpg')
  execFileSync(
    'montage',
    [
      ...retenus,
      '-resize',
      `${VIGNETTE}x${VIGNETTE}`,
      '-background',
      '#1b1d20',
      '-fill',
      '#e8e4dc',
      '-pointsize',
      '16',
      // `%t` est le nom de fichier sans extension, donc le slug : l'étiquette est
      // le NOM DE LA PIÈCE et pas un numéro de case, sans quoi juger la planche
      // obligerait à compter les cases pour savoir de quoi on parle.
      ...(police ? ['-font', police, '-label', '%t'] : []),
      '-tile',
      `${COLONNES}x`,
      '-geometry',
      '+6+6',
      cible,
    ],
    { stdio: 'inherit' },
  )

  console.log(`MESHY_PLANCHE ${retenus.length} pièce(s) -> ${cible}`)
}

await main()
