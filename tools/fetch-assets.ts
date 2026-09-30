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
import { encoderLesMatieres } from './encode-ktx2.ts'

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
  { id: 'Rock044', role: 'roche', usage: 'dalles irrégulières et pas japonais près de l’eau' },
] as const

/**
 * Le ciel du fond de scène : un « pure sky » (sans sol) de Poly Haven. On prend
 * sa version tonemappée en JPG, pas l'HDR : c'est un fond, pas une lumière, et
 * réduite à 4096 × 2048 elle pèse un mégaoctet quand l'HDR 2k en pèse cinq.
 */
export const CIEL = { id: 'kloofendal_48d_partly_cloudy_puresky', largeur: 4096 }
/** Le ciel de nuit, étoilé, voie lactée comprise : le cycle jour/nuit fond l'un dans l'autre. */
export const CIEL_NUIT = { id: 'rogland_clear_night', largeur: 4096 }

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
 * Le JARDIN JAPONAIS (`tools/blender/build-jardin.py`) : des rochers moussus au
 * bord de l'eau et une fougère sur les berges. Décimés et embarqués dans
 * `jardin/jardin.glb` ; les érables, les boules taillées et l'eau sont
 * modélisés par le script lui-même.
 */
const JARDIN = ['rock_moss_set_01', 'rock_moss_set_02', 'boulder_01', 'fern_02'] as const

/**
 * Pièces en volume. Cet outil ne les RÉCUPÈRE pas — elles ne sont pas en CC0,
 * `tools/blender/build-sculptures.py` et `build-bavette-anime.py` les produisent à la main hors CI et le GLB
 * est commité (voir `public/assets/sculptures/SOURCES.md`). Elles sont
 * déclarées ici uniquement pour que `CREDITS.md` les distingue des assets
 * récupérés : sans cette entrée, le gabarit ci-dessous écrirait « Tous en CC0
 * » sur un fichier qui contient une pièce © tous droits réservés.
 */
const SCULPTURES = [
  {
    id: 'bavette-anime',
    source: "Meshy, d'après une photo de l'auteur ; squelette et animations `tools/blender/build-bavette-anime.py`",
    licence: '© tous droits réservés',
    usage: 'le chat Bavette, qui se promène dans le musée et le jardin',
  },
  {
    id: 'chandelles',
    source:
      'Meshy (généré par IA) : image Nano Banana Pro puis image → 3D (textures PBR), prompt : « Product photograph of a single museum-grade abstract bronze sculpture… clean, smooth, uniformly polished warm golden bronze… no mottling, no streaks, no marbling… Solid, heavy, cast-metal volumes… five candlestick-chart candles standing in a row on one long thick solid rectangular bronze base, each candle a chunky solid bronze column of square cross-section, as deep as it is wide, with a sturdy round rod wick above and below it… set at progressively higher positions from left to right like an upward market trend… slightly staggered in depth » ; `tools/blender/build-sculptures.py`',
    licence: '© tous droits réservés',
    usage: "sculpture de la vitrine TaLibStandard, salle d'honneur",
  },
  {
    id: 'formulaire',
    source:
      'Meshy (généré par IA, texte → 3D, textures PBR), prompt : « Museum-grade abstract bronze sculpture in the style of Naum Gabo and Barbara Hepworth: a graceful vertical composition of thin polished bronze rectangular plates like form input fields, cantilevered around a slender central spine in a gentle rising spiral, with a few small open square frames like checkboxes, one holding a subtle tick mark… » ; `tools/blender/build-sculptures.py`',
    licence: '© tous droits réservés',
    usage: "sculpture de la vitrine FormCraft, salle d'honneur",
  },
  {
    id: 'arborescence',
    source:
      'Meshy (généré par IA) : image Nano Banana Pro puis image → 3D (textures PBR), prompt : « Product photograph of a single museum-grade abstract bronze sculpture… polished warm golden bronze… dark brown-green patina in the recesses… a stylised tree whose trunk branches strictly at right angles into a hierarchy like a file directory tree, each branch ending in a small flat bronze tablet shaped like a closed folder with a tab » ; `tools/blender/build-sculptures.py`',
    licence: '© tous droits réservés',
    usage: "sculpture de la vitrine VirtualFileSystem, salle d'honneur",
  },
] as const

/**
 * Police des cartels et noms de salle (#52). Comme les sculptures ci-dessus,
 * cet outil ne la RÉCUPÈRE pas : elle est commitée directement sous
 * `public/assets/fonts/`, pas dans le pipeline CC0 de récupération. Déclarée
 * ici uniquement pour que `CREDITS.md` la crédite malgré ça.
 */
const POLICES = [
  {
    id: 'PT Sans',
    source: 'Google Fonts (ParaType)',
    licence: 'SIL OFL 1.1',
    usage: 'cartels et noms de salle (<Text> troika/drei)',
  },
  {
    id: 'PT Serif',
    source: 'Google Fonts (ParaType), sous-ensemble latin',
    licence: 'SIL OFL 1.1',
    usage: "titres des vitrines de la salle d'honneur et de leur borne",
  },
] as const

/**
 * Architecture modélisée par le dépôt (`tools/blender/build-nef.py`), commitée
 * comme le kit de props. Déclarée ici pour que `CREDITS.md` la crédite.
 */
const ARCHITECTURE = [
  {
    id: 'nef',
    source: "`tools/blender/build-nef.py`, d'après le musée d'Orsay",
    licence: 'œuvre originale du dépôt',
    usage: 'voûte, verrière, horloge et lanternes du hall',
  },
  {
    id: 'batllo',
    source: "`tools/blender/build-batllo.py`, d'après la Casa Batlló de Gaudí",
    licence: 'œuvre originale du dépôt',
    usage: "baie de la salle d'honneur : colonnes en os, chêne ondulé, vitrail de cives",
  },
  {
    id: 'escalier',
    source: "`tools/blender/build-escalier.py`, d'après le Grand Escalier de l'Opéra Garnier",
    licence: 'œuvre originale du dépôt',
    usage: "l'escalier impérial de marbre : volées, bulbes du départ, limons et palier",
  },
  {
    id: 'chambranle',
    source: "`tools/blender/build-chambranle.py`, d'après les portes des salles d'Orsay et du Louvre",
    licence: 'œuvre originale du dépôt',
    usage: 'chambranles moulurés, plinthes et entablements de pierre des portes',
  },
  {
    id: 'jardin',
    source: "`tools/blender/build-jardin.py`, d'après le jardin japonais de Hasselt",
    licence: 'œuvre originale du dépôt',
    usage: 'étang, ruisseau, pont, lanterne, rochers moussus, fougères et pétales tombés du jardin',
  },
  {
    id: 'ruisseau',
    source:
      'Meshy (généré par IA) : images Nano Banana Pro puis image → 3D (textures PBR) ; prompts : ' +
      '« A single isolated old willow tree stump torn from a riverbank, photographed for a 3D scan: a short broad trunk base about 1.4 metres wide and 60 cm tall, its top broken and rotted into a jagged hollow, thick gnarled exposed roots spreading out and down like fingers gripping a clump of dark earth, the whole stump densely covered in thick vivid green cushion moss, patches of pale grey-green and yellow crustose lichen on the bark… » et ' +
      '« Seven separate smooth rounded river stones laid out apart from each other in a loose row… a speckled grey granite egg-shaped cobble, a white-and-grey quartz pebble with veins, a flat dark slate-blue schist pebble with fine layers, a rusty ochre sandstone round stone, a near-black basalt oval, a pale beige limestone pebble, a greenish grey banded pebble. All worn smooth by water, slightly glossy damp surfaces… ». ' +
      'Mis à l’échelle, séparés, couchés et allégés par `tools/blender/build-ruisseau.py`, qui modèle aussi la branche morte',
    licence: 'généré pour le dépôt (conditions de Meshy)',
    usage: 'la vieille souche moussue des berges du ruisseau, la branche tombée en travers du courant, les galets de rivière du lit et du bord de l’étang',
  },
  {
    id: 'vegetation',
    source:
      'Feuillage : cartes découpées à l’alpha dans des planches botaniques Nano Banana 2 (Meshy, généré par IA, fond retiré) ; prompts, chacun suivi de « photographed perfectly flat from directly above, orthographic top-down botanical scan, even soft diffuse studio lighting, no cast shadows, sharp focus, true natural colours, isolated on a pure white background » : ' +
      '« A single real fresh branch spray of Japanese maple (Acer palmatum), a thin forked reddish-brown twig carrying about twenty deeply cut seven-lobed palmate leaves of different sizes, bright fresh green with lighter veins… » ; ' +
      '« A single real branch spray of red Japanese maple (Acer palmatum ‘Bloodgood’)… deep burgundy purple-red with darker veins… » ; ' +
      '« A dense round cluster of real boxwood sprigs (Buxus sempervirens)… small glossy oval leaves, mixed dark green and fresh lighter green new growth » ; ' +
      '« A real sprig cluster of Japanese evergreen azalea (Rhododendron ‘Satsuki’)… small glossy elliptic dark green leaves and five open bright pink funnel-shaped flowers » ; ' +
      '« A real trailing stem of English ivy (Hedera helix)… glossy dark green three-to-five lobed leaves with pale green veins ». ' +
      'Érables (tronc, charpentières, branches, rameaux, brindilles), touffes, lierre, roseaux et herbe du Japon modelés par `tools/blender/build-vegetation.py`',
    licence: 'généré pour le dépôt (conditions de Meshy)',
    usage: 'érables du Japon rouges et verts (et leur version lointaine), buis et azalées, lierre du mur d’enceinte, roseaux et herbes des berges',
  },
  {
    id: 'salle-honneur',
    source: "`tools/blender/build-salle-honneur.py`, d'après l'étage noble de la Casa Batlló de Gaudí",
    licence: 'œuvre originale du dépôt',
    usage: "salle d'honneur : voûte en tourbillon, lampe-soleil, pilastres en os, lambris et portes de chêne, parquet",
  },
  {
    id: 'vitrines',
    source: "`tools/blender/build-vitrines.py`, d'après les panneaux du musée Cernuschi",
    licence: 'œuvre originale du dépôt',
    usage: "vitrines de la salle d'honneur : panneau bordeaux, cadre doré sculpté, borne interactive",
  },
  {
    id: 'mobilier',
    source: "`tools/blender/build-mobilier.py`, d'après les banquettes du Louvre, la nef d'Orsay et le banc double de la Casa Batlló de Gaudí",
    licence: 'œuvre originale du dépôt',
    usage: "banquettes capitonnées des galeries, bancs de la nef, banque d'accueil, bancs Batlló de la salle d'honneur, bancs de granit et de cèdre du jardin",
  },
  {
    id: 'lampadaire',
    source: "`tools/blender/build-lampadaire.py`, d'après le lampadaire Lindby « Daphne » (2,20 m, fonte d'aluminium noire, crosse et cloche)",
    licence: 'œuvre originale du dépôt',
    usage: 'lampadaires du parc, le long de la ceinture, des accès et de l’axe de l’entrée',
  },
  {
    id: 'chantier',
    source: '`tools/blender/build-chantier.py` : charpente de fer à fermes Polonceau et verrière, lambris, enseigne (police PT Serif, OFL), table, plans et baladeuse',
    licence: 'œuvre originale du dépôt',
    usage: 'la baraque du chantier du musée, sur la pelouse sud-ouest, où s’accroche le journal de chantier',
  },
  {
    id: 'belvedere',
    source: '`tools/blender/build-belvedere.py` : pavillon de thé (azumaya) à toit en pavillon, palissade de bambou kenninji-gaki et porte couverte du roji',
    licence: 'œuvre originale du dépôt',
    usage: 'le belvédère au fond du jardin et le chemin de thé qui y mène',
  },
  {
    id: 'accessoires',
    source:
      'Meshy (généré par IA, texte → 3D, texture PBR), mis à l’échelle et allégé par `tools/blender/build-accessoires.py` ; prompts : ' +
      '« a single museum stanchion post, polished brass, round weighted base, 95 cm tall » ; ' +
      '« a classic museum gallery attendant’s chair, dark stained oak frame, upholstered seat in deep burgundy fabric » ; ' +
      'image Nano Banana puis image → 3D : « a museum bookshop display table, walnut wood with turned legs and a lower shelf, stacks of colourful art books and exhibition catalogues » ; ' +
      '« a red fire extinguisher, 6 kg, black handle and hose, pressure gauge » ; ' +
      '« a freestanding museum information sign, blank dark green enamel panel between two black cast iron posts » ; ' +
      '« a classic European city bicycle, dark green frame, mudguards, rear rack » (cadre repeint en noir par le script) ; ' +
      'images Nano Banana puis image → 3D : « a classic red steel road bike, slim horizontal top tube, drop handlebars wrapped in bar tape, thin 700c wheels » et ' +
      '« a Dutch ladies’ city bike, low step-through frame painted pastel light blue, wicker basket on the front, brown sprung leather saddle, full chain guard » ; ' +
      '« a classical French garden fountain, round low limestone basin, central pedestal holding an upper bowl » ; ' +
      'Modelés par le script : la caisse de Versailles et son buis (texture de feuilles calculée), l’abri à vélos, ses arceaux et les antivols',
    licence: 'généré pour le dépôt (conditions de Meshy)',
    usage: "cordon de velours des vitrines, chaise du gardien, table de livres, extincteurs, abri à vélos et ses trois vélos, panneau des horaires, fontaine, caisses de Versailles",
  },
  {
    id: 'herisson',
    source:
      'Meshy (généré par IA) : image Nano Banana Pro puis image → 3D, d’après une photo et une vidéo de Philippe ; prompt : « Studio photograph of a single young European hedgehog (Erinaceus europaeus), baby about 15 cm long, walking, seen from a three-quarter side view… dense spines on the back and flanks: each spine dark brown-black with a distinct cream-white tip… grey-brown soft furry face and belly, a fringe of fur skirt hiding the short legs… long pointed dark snout with a wet black nose, small shiny black eyes » ; mis à l’échelle, pattes tassées et allégé (visage intact) par `tools/blender/build-herisson.py`',
    licence: 'généré pour le dépôt (conditions de Meshy)',
    usage: 'le bébé hérisson du jardin japonais',
  },
  {
    id: 'plantes',
    source:
      'Jardinières : Meshy (généré par IA), image Nano Banana 2 puis image → 3D (textures PBR) ; prompts : ' +
      '« A large heavy round museum planter in cast bronze with a dark brown-green antique patina and slightly worn golden highlights on the rim, classical Beaux-Arts style, wide rolled rim, gently tapered bowl on a short round foot… filled to the rim with dark soil » et ' +
      '« A large tall cylindrical museum planter carved in pale warm limestone, Beaux-Arts station hall style, simple moulded rim and plinth band at the base, subtle vertical fluting… filled to the rim with dark soil ». ' +
      'Feuillage : cartes découpées à l’alpha dans des planches botaniques Nano Banana 2 (fond retiré), prompts : ' +
      '« A single real kentia palm frond (Howea forsteriana)… photographed perfectly flat from directly above, orthographic top-down botanical scan… » ; ' +
      '« A single real fiddle-leaf fig leaf (Ficus lyrata)… » ; « A single real olive tree twig (Olea europaea) with about thirty narrow silvery grey-green lanceolate leaves… ». ' +
      'Kentia, figuier lyre et olivier modelés, mis à l’échelle et allégés par `tools/blender/build-plantes.py`',
    licence: 'généré pour le dépôt (conditions de Meshy)',
    usage: 'kentias de la nef, figuiers lyres de la salle d’honneur, figuiers lyres et oliviers des angles des galeries',
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

async function recupererCiel(ciel: { id: string; largeur: number } = CIEL): Promise<string> {
  const dest = join(OUT, 'ciel', `${ciel.id}.jpg`)
  if (await existe(dest)) return 'cache'
  const brut = `${dest}.source`
  const r = await telecharger({ url: `https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/${ciel.id}.jpg`, dest: brut })
  if (r === 'echec') return r
  const { default: sharp } = await import('sharp')
  await sharp(brut, { limitInputPixels: false }).resize(ciel.largeur, ciel.largeur / 2).jpeg({ quality: 82, mozjpeg: true }).toFile(dest)
  await rm(brut, { force: true })
  return 'ok'
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

  // Les mêmes cartes, compressées pour le GPU (encode-ktx2.ts) ; le site retombe sur les JPG sans elles.
  console.log(`\nMatières en KTX2 — Basis Universal`)
  const ktx2 = await encoderLesMatieres()
  console.log(`  ${ktx2.faits} encodées, ${ktx2.ignores} à jour, ${ktx2.echecs} en échec`)

  console.log(`\nHDRI — Poly Haven, CC0`)
  console.log(`  ${(await recupererHdri()).padEnd(6)} ${HDRI.id} ${HDRI.resolution}`)
  journal.push(`| ${HDRI.id} | Poly Haven | CC0 | carte d'environnement, spéculaire |`)
  console.log(`  ${(await recupererCiel()).padEnd(6)} ${CIEL.id} ${CIEL.largeur} px`)
  journal.push(`| ${CIEL.id} | Poly Haven | CC0 | ciel du fond de scène, réduit en JPG |`)
  console.log(`  ${(await recupererCiel(CIEL_NUIT)).padEnd(6)} ${CIEL_NUIT.id} ${CIEL_NUIT.largeur} px`)
  journal.push(`| ${CIEL_NUIT.id} | Poly Haven | CC0 | ciel de nuit, réduit en JPG |`)

  const vegetation = [...PLANTES, ...ARBRES, ...ARBUSTES, ...JARDIN]
  for (const p of vegetation) {
    const usage = (JARDIN as readonly string[]).includes(p) ? 'jardin japonais, décimé dans jardin.glb' : 'végétation, décimée dans les LOD'
    journal.push(`| ${p} | Poly Haven | CC0 | ${usage} |`)
  }

  console.log(`\nPièces en volume (${SCULPTURES.length}) — commitées, hors pipeline CC0`)
  for (const s of SCULPTURES) {
    console.log(`  ${'ok'.padEnd(6)} ${s.id.padEnd(20)} ${s.usage}`)
    journal.push(`| ${s.id} | ${s.source} | ${s.licence} | ${s.usage} |`)
  }

  console.log(`\nPolices (${POLICES.length}) — commitées, hors pipeline CC0`)
  for (const p of POLICES) {
    console.log(`  ${'ok'.padEnd(6)} ${p.id.padEnd(20)} ${p.usage}`)
    journal.push(`| ${p.id} | ${p.source} | ${p.licence} | ${p.usage} |`)
  }

  console.log(`\nArchitecture (${ARCHITECTURE.length}) — commitée, hors pipeline CC0`)
  for (const a of ARCHITECTURE) {
    console.log(`  ${'ok'.padEnd(6)} ${a.id.padEnd(20)} ${a.usage}`)
    journal.push(`| ${a.id} | ${a.source} | ${a.licence} | ${a.usage} |`)
  }

  if (SOURCES_VEGETATION) {
    console.log(`\nSources de végétation (${vegetation.length}) — Poly Haven, CC0 — 330 Mo`)
    for (const p of vegetation) {
      const r = await recupererPlante(p)
      console.log(`  ${r.padEnd(6)} ${p}`)
    }
    console.log(`\n  Décimation : blender --background --python tools/blender/decimate-plants.py`)
    console.log(`  Jardin     : blender --background --python tools/blender/build-jardin.py`)
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
végétation, le kit de props, la nef, le jardin et les pièces en volume, qui exigent
Blender et sont donc commités.

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
