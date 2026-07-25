/**
 * LOT 8 — Récupération des assets CC0 (matières PBR, HDRI, végétation).
 *
 * Tout ce que cet outil télécharge est en CC0 (domaine public) : ambientCG pour
 * les matières, Poly Haven pour l'HDRI et les plantes. Aucune attribution n'est
 * légalement requise, mais `public/assets/CREDITS.md` la donne quand même —
 * c'est la moindre des choses et ça documente la provenance.
 *
 *   node tools/fetch-assets.ts
 *
 * Idempotent : un fichier déjà présent n'est pas retéléchargé. Les assets ne
 * sont PAS commités (voir .gitignore) ; la CI les récupère et les met en cache,
 * exactement comme les images OG.
 *
 * Pourquoi un outil plutôt qu'un dépôt d'assets binaires : le dépôt est public
 * et les matières pèsent des dizaines de mégaoctets. Un manifeste versionné plus
 * un téléchargement reproductible vaut mieux qu'un historique git obèse.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/assets')

/**
 * Le manifeste. C'est LA source de vérité de l'habillage du musée : changer une
 * matière ici change le rendu, sans toucher au code.
 *
 * Résolution : 1K partout. Le musée est vu à hauteur d'œil et en mouvement ;
 * du 2K quadruplerait le poids pour un gain invisible à 2 m d'un mur, et le
 * budget de chargement du §9 est déjà serré.
 */
const MATIERES = [
  { id: 'Concrete034', role: 'beton', usage: 'murs extérieurs, dalles, rampes' },
  { id: 'Plaster001', role: 'platre', usage: 'murs de salle, thème classic' },
  { id: 'PaintedPlaster017', role: 'platre-peint', usage: 'murs de salle, thème modern' },
  { id: 'WoodFloor007', role: 'parquet', usage: 'sols des salles' },
  { id: 'Marble012', role: 'marbre', usage: 'sol du rez-de-chaussée et de l’atrium' },
  { id: 'Metal063', role: 'metal', usage: 'garde-corps, mains courantes, cadres' },
] as const

/** HDRI d'intérieur neutre : il sert au spéculaire, pas à l'éclairage direct. */
const HDRI = { id: 'brown_photostudio_02', resolution: '2k' }

/**
 * Végétation. Le musée en a besoin pour deux raisons qui n'ont rien de
 * décoratif : une plante donne une ÉCHELLE humaine à un volume, et sa silhouette
 * organique casse l'orthogonalité qui trahit le procédural au premier coup d'œil.
 */
const PLANTES = [
  'potted_plant_02',
  'potted_plant_04',
  'calathea_orbifolia_01',
  'anthurium_botany_01',
] as const

interface Telechargement {
  url: string
  dest: string
}

async function existe(chemin: string): Promise<boolean> {
  try {
    const s = await stat(chemin)
    return s.size > 0
  } catch {
    return false
  }
}

async function telecharger({ url, dest }: Telechargement): Promise<'cache' | 'ok' | 'echec'> {
  if (await existe(dest)) return 'cache'
  await mkdir(dirname(dest), { recursive: true })
  const res = await fetch(url, { headers: { 'user-agent': 'virtual-museum-assets' } })
  if (!res.ok || !res.body) {
    console.warn(`  ! ${res.status} ${url}`)
    return 'echec'
  }
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(dest))
  return 'ok'
}

// ── Matières ambientCG ───────────────────────────────────────────────────

/**
 * ambientCG livre les matières en archive zip contenant toutes les cartes. On
 * dézippe puis on ne garde QUE les cartes réellement échantillonnées par un
 * MeshStandardMaterial : couleur, normale, rugosité, occlusion ambiante. Les
 * cartes de déplacement et de métallicité pèsent lourd et ne servent pas ici
 * (aucun tessellation, métallicité constante par matière).
 */
const CARTES_UTILES = /_(Color|NormalGL|Roughness|AmbientOcclusion)\.(jpg|png)$/i

async function recupererMatiere(id: string): Promise<string> {
  const dossier = join(OUT, 'materials', id)
  const temoin = join(dossier, `${id}_1K-JPG_Color.jpg`)
  if (await existe(temoin)) return 'cache'

  const url = `https://ambientcg.com/get?file=${id}_1K-JPG.zip`
  const zip = join(OUT, 'materials', `${id}.zip`)
  const r = await telecharger({ url, dest: zip })
  if (r === 'echec') return 'échec'

  await mkdir(dossier, { recursive: true })
  await execFileAsync('unzip', ['-o', '-q', zip, '-d', dossier])
  await rm(zip, { force: true })

  // Purge des cartes inutiles : sur six matières, ça épargne plusieurs dizaines
  // de mégaoctets que la CI aurait mis en cache et servis pour rien.
  for (const f of await readdir(dossier)) {
    if (!CARTES_UTILES.test(f)) await rm(join(dossier, f), { force: true, recursive: true })
  }
  return 'ok'
}

// ── Poly Haven ───────────────────────────────────────────────────────────

async function recupererHdri(): Promise<string> {
  const dest = join(OUT, 'hdri', `${HDRI.id}_${HDRI.resolution}.hdr`)
  const url = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${HDRI.resolution}/${HDRI.id}_${HDRI.resolution}.hdr`
  return telecharger({ url, dest })
}

async function recupererPlante(id: string): Promise<string> {
  const dest = join(OUT, 'plants', `${id}.gltf`)
  if (await existe(dest)) return 'cache'
  // Poly Haven expose les fichiers réels par asset ; on demande la variante glTF
  // 1K, la plus légère qui garde des textures crédibles de près.
  const meta = await fetch(`https://api.polyhaven.com/files/${id}`)
  if (!meta.ok) return 'échec'
  const files = (await meta.json()) as Record<string, unknown>
  const gltf = (files.gltf as Record<string, Record<string, { url?: string; include?: Record<string, { url: string }> }>>)?.['1k']?.gltf
  if (!gltf?.url) return 'échec'

  await telecharger({ url: gltf.url, dest })
  // Le glTF référence ses textures et ses buffers ; sans eux le modèle charge
  // en géométrie nue, sans matière.
  for (const [rel, info] of Object.entries(gltf.include ?? {})) {
    await telecharger({ url: info.url, dest: join(OUT, 'plants', rel) })
  }
  return 'ok'
}

// ── Point d'entrée ───────────────────────────────────────────────────────

async function main() {
  await mkdir(OUT, { recursive: true })
  const journal: string[] = []

  console.log(`Matières (${MATIERES.length}) — ambientCG, CC0`)
  for (const m of MATIERES) {
    const r = await recupererMatiere(m.id)
    console.log(`  ${r.padEnd(6)} ${m.id.padEnd(20)} ${m.usage}`)
    journal.push(`| ${m.id} | ambientCG | CC0 | ${m.usage} |`)
  }

  console.log(`\nHDRI — Poly Haven, CC0`)
  console.log(`  ${(await recupererHdri()).padEnd(6)} ${HDRI.id} ${HDRI.resolution}`)
  journal.push(`| ${HDRI.id} | Poly Haven | CC0 | carte d'environnement, spéculaire |`)

  console.log(`\nVégétation (${PLANTES.length}) — Poly Haven, CC0`)
  for (const p of PLANTES) {
    const r = await recupererPlante(p)
    console.log(`  ${r.padEnd(6)} ${p}`)
    journal.push(`| ${p} | Poly Haven | CC0 | végétation |`)
  }

  await writeFile(
    join(OUT, 'CREDITS.md'),
    `# Assets\n\nTous en CC0 (domaine public). Aucune attribution n'est requise ; elle est donnée\npar correction et pour documenter la provenance.\n\nRécupérés par \`node tools/fetch-assets.ts\`, non versionnés.\n\n| Asset | Source | Licence | Usage |\n|---|---|---|---|\n${journal.join('\n')}\n`,
  )
  console.log(`\nCREDITS.md écrit.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
