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
  /*
    Terrazzo005 et non Marble012.

    `Marble012` n'est pas un marbre : c'est une pierre grise MATE et craquelée,
    d'albédo bleuté. Étalée sur les 2 m de sa maille, elle donnait au sol du
    hall — la plus grande surface du musée, celle qu'on voit en premier et
    presque toujours en rasant — l'aspect d'un lit de gravier. Aucun réglage de
    gain ne rattrape le motif d'une matière qui n'est pas la bonne.

    Un terrazzo est ce qu'on met réellement au sol d'un musée : fond clair et
    chaud, éclats sombres qui donnent l'échelle au pas, et surtout un motif SANS
    DIRECTION — c'est ce qui lui permet de se répéter sur trente mètres sans que
    la maille se lise, là où le veinage horizontal d'un travertin trahirait la
    tuile au premier regard.
  */
  { id: 'Terrazzo005', role: 'marbre', usage: 'sol du rez-de-chaussée et de l’atrium' },
  /*
    Metal032 et non Metal063.

    `Metal063` est un acier ROUILLÉ. Sur les vingt mètres de la main courante de
    l'atrium et sur toute l'hélice de l'escalier, ses traînées d'oxyde
    s'étiraient en un dégradé bleu-orange : le hall entier lisait « corten ».
    Personne ne pose du corten autour d'un vide intérieur — c'est un acier fait
    pour rouiller dehors.

    Metal032 est un acier brossé propre, sans piqûre ni coulure : à l'échelle
    d'un profilé de 8 cm il ne montre rien d'autre que sa valeur, ce qui est
    exactement le métier d'une main courante.
  */
  { id: 'Metal032', role: 'metal', usage: 'mains courantes, cadres' },
  { id: 'Grass004', role: 'herbe', usage: 'pelouse du parc' },
  { id: 'Gravel023', role: 'gravier', usage: 'allées et parvis du parc' },
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

/**
 * Le PARC. Un musée posé sur une dalle nue se lit comme une maquette : ce qui
 * lui donne son échelle et son sol, c'est ce qui pousse autour.
 *
 * Trois arbres et deux arbustes, pas davantage. Un parc ne se fait pas avec la
 * variété d'un catalogue mais avec la répétition d'un petit nombre d'essences —
 * c'est ce que fait un vrai dessin de parc, et c'est aussi ce qui permet de
 * l'instancier. Le coût d'une espèce de plus est un lot d'instances de plus.
 */
const ARBRES = ['island_tree_01', 'island_tree_02', 'jacaranda_tree'] as const
const ARBUSTES = ['shrub_01', 'shrub_03'] as const

/**
 * Pièces en volume. Cet outil ne les RÉCUPÈRE pas — elles ne sont pas en CC0,
 * `tools/blender/build-sculptures.py` les produit à la main hors CI et le GLB
 * est commité (voir `public/assets/sculptures/SOURCES.md`). Elles sont
 * déclarées ici uniquement pour que `CREDITS.md` les distingue des assets
 * récupérés : sans cette entrée, le gabarit ci-dessous écrirait « Tous en CC0
 * » sur un fichier qui contient une pièce © tous droits réservés.
 */
const SCULPTURES = [
  {
    id: 'bavette',
    source: "Meshy, d'après une photo de l'auteur",
    licence: '© tous droits réservés',
    usage: "pièce en volume, salle d'honneur",
  },
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

/*
  Les SOURCES de végétation sont désormais optionnelles.

  Les modèles bruts de Poly Haven pèsent 330 Mo — `jacaranda_tree.bin` fait à
  lui seul 208 Mo — et le musée n'en charge AUCUN : il ne lit que
  `plants-lod.glb` et `park-lod.glb`, deux fichiers de 4,3 Mo produits par
  `tools/blender/decimate-plants.py`. Ces deux-là sont maintenant versionnés,
  parce que les régénérer demande Blender et que la CI n'en a pas.

  Les télécharger par défaut coûtait donc 330 Mo à chaque publication, et
  autant dans `dist/` — Vite recopie tout `public/` — pour un site dont le
  besoin réel est de 33 Mo. On ne les prend plus que sur demande explicite,
  c'est-à-dire quand on veut refaire la décimation.

      node tools/fetch-assets.ts                        # matières + HDRI
      node tools/fetch-assets.ts --sources-vegetation   # + les 330 Mo bruts
*/
const SOURCES_VEGETATION = process.argv.includes('--sources-vegetation')

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

  const vegetation = [...PLANTES, ...ARBRES, ...ARBUSTES]
  for (const p of vegetation) {
    journal.push(`| ${p} | Poly Haven | CC0 | végétation, décimée dans les LOD |`)
  }

  console.log(`\nPièces en volume (${SCULPTURES.length}) — commitées, hors pipeline CC0`)
  for (const s of SCULPTURES) {
    console.log(`  ${'ok'.padEnd(6)} ${s.id.padEnd(20)} ${s.usage}`)
    journal.push(`| ${s.id} | ${s.source} | ${s.licence} | ${s.usage} |`)
  }

  if (SOURCES_VEGETATION) {
    console.log(`\nSources de végétation (${vegetation.length}) — Poly Haven, CC0 — 330 Mo`)
    for (const p of vegetation) {
      const r = await recupererPlante(p)
      console.log(`  ${r.padEnd(6)} ${p}`)
    }
    console.log(`\n  Décimation : blender --background --python tools/blender/decimate-plants.py`)
  } else {
    console.log(`\nSources de végétation : IGNORÉES (--sources-vegetation pour les prendre).`)
    console.log(`  Le musée lit les LOD versionnés, pas les sources.`)
  }

  await writeFile(
    join(OUT, 'CREDITS.md'),
    `# Assets

Les assets **récupérés** — matières, HDRI, végétation — sont tous en CC0
(domaine public). Aucune attribution n'est requise ; elle est donnée par
correction et pour documenter la provenance.

Les **pièces en volume** de \`sculptures/\` n'en font pas partie : ce sont des
œuvres de l'auteur du musée, tous droits réservés. Leur provenance et leur
licence sont dans \`sculptures/SOURCES.md\`.

Récupérés par \`node tools/fetch-assets.ts\`, non versionnés — sauf les LOD de
végétation, le kit de props et les pièces en volume, qui exigent Blender et
sont donc commités.

| Asset | Source | Licence | Usage |
|---|---|---|---|
${journal.join('\n')}
`,
  )
  console.log(`\nCREDITS.md écrit.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
