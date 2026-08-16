/**
 * Harnais de capture et de mesure du rendu.
 *
 *   node tools/capture.ts                      # le jeu de vues par défaut
 *   node tools/capture.ts --only entree,coin   # une sélection
 *   node tools/capture.ts --url http://…       # contre un autre serveur
 *
 * ── Pourquoi ce fichier existe ──
 *
 * Les premières captures du musée ont été prises par un serveur MCP branché sur
 * Chrome. Elles ont servi à trancher de vraies questions — « voit-on les coins »,
 * « le mur a-t-il une épaisseur » — mais l'outil qui les a produites ne vivait
 * nulle part : impossible de les refaire, impossible de les faire refaire à
 * quelqu'un d'autre, impossible de les rejouer après un changement. Une mesure
 * dont on garde le résultat mais pas le code est une mesure invérifiable.
 *
 * Celui-ci est versionné, tourne sur le Chrome du poste (aucun téléchargement de
 * navigateur) et sort DEUX choses pour chaque vue : une image et des chiffres.
 * Les chiffres sont là parce que « c'est plus clair » n'est pas une mesure : la
 * part de pixels quasi noirs et le profil de luminance à travers une arête se
 * comparent d'une exécution à l'autre, un jugement à l'œil non.
 *
 * ── Le piège du compteur de draw calls ──
 *
 * `renderer.info` se remet à zéro à chaque appel de `render()`, et
 * l'`EffectComposer` en fait plusieurs par image. Lire `info.render.calls` après
 * coup ne donne donc que la dernière passe plein écran — 1 au lieu de 200. La
 * scène expose `__MUSEUM__.mesure()`, qui coupe la remise à zéro et encadre une
 * image entière ; c'est elle qu'on appelle, jamais `stats()`.
 */
/// <reference types="node" />
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '.captures')

/** Le Chrome du poste. Aucun navigateur n'est téléchargé pour ce harnais. */
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/**
 * Les ports où chercher `npm run dev`, et comment on reconnaît le BON.
 *
 * ⛔ Une URL en dur ne peut pas marcher ici, et pas seulement « parfois ».
 *
 * Vite prend 5173, puis 5174, puis 5175 selon ce qui est déjà occupé. Ce dépôt
 * se travaille en WORKTREES : plusieurs copies du musée, sur plusieurs branches,
 * peuvent servir en même temps. Une constante fige donc le NUMÉRO d'un port sans
 * rien dire de QUI est derrière — et c'est arrivé : `5174` était écrit ici, le
 * serveur de cette session écoutait sur 5173, et l'oracle a rendu onze vues
 * complètes et cohérentes… mesurées sur le musée d'une autre session.
 *
 * Le remède n'est pas une meilleure devinette de port, c'est une PREUVE
 * D'IDENTITÉ : on demande au serveur son `data/museum.json` et on le compare,
 * octet pour octet, à celui du disque. Deux worktrees sur deux branches n'ont
 * pas le même bâtiment ; celui qui répond le nôtre EST le nôtre.
 *
 * Et si aucun ne répond, on échoue en le disant, plutôt que de mesurer le musée
 * du voisin.
 */
const PORTS = [5173, 5174, 5175, 5176, 5177]

/** 1440×900 en DPR 2. Assez grand pour juger, assez petit pour tenir en mémoire. */
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 }

/**
 * Une vue : d'où on regarde, et ce qu'on veut prouver.
 *
 * `survol` téléporte la caméra et la fait viser un point ; c'est l'outil de
 * debug de la scène, pas une manœuvre de joueur. Les vues sont donc
 * REPRODUCTIBLES au centimètre, contrairement à une capture prise en marchant.
 */
interface Vue {
  nom: string
  /** Position de la caméra, puis point visé. */
  de: [number, number, number]
  vers: [number, number, number]
  /** Ce que la vue est censée montrer — sert de légende dans le rapport. */
  preuve: string
  /** Coupe le post-traitement, pour un A/B sur la même caméra. */
  sansPostFx?: boolean
}

const VUES: Vue[] = [
  {
    nom: 'entree',
    de: [0, 1.7, 10.5],
    vers: [0, 1.7, -6],
    preuve: "vue d'accueil : plus de masse noire, et le plafond n'est plus du parquet",
  },
  {
    nom: 'exterieur',
    de: [22, 14, 22],
    vers: [0, 4, 0],
    preuve: 'silhouette et façade : teinte unique, pas de bandeau de bois par niveau',
  },
  {
    // L'atrium fait 12 m de côté et la trémie est centrée : rester DANS le vide
    // (|x| et |z| < 6) est la seule façon de plonger sur la rampe. À (7 ; 9,5 ; 7)
    // la caméra était derrière le nez de dalle de l'étage 2 et ne cadrait qu'un
    // parquet en gros plan.
    nom: 'atrium-plongee',
    de: [4.2, 8.4, 4.2],
    vers: [-1, 0, -1],
    preuve: 'la rampe vue de haut : garde-corps et sous-face du tablier',
  },
  {
    // LA VUE QUI MANQUAIT, et son absence a coûté cher.
    //
    // Trente-neuf nervures posées sur trois niveaux formaient une palissade à
    // hauteur d'œil : depuis l'entrée comme depuis l'escalier, on ne voyait plus
    // l'atrium, on voyait à travers une claire-voie. Aucun contrôle ne l'a dit.
    // Le plan coté validait le placement — et il avait raison sur ce qu'il
    // mesure : il vérifie qu'on ne se COGNE pas, pas qu'on VOIT quelque chose.
    //
    // Celle-ci est une ligne de vue rasante : à hauteur d'œil, depuis un bord de
    // l'atrium vers le bord opposé. Ce qu'elle prouve n'est pas une jolie image,
    // c'est que la traversée visuelle du bâtiment reste ouverte — et elle
    // rougirait à la première pièce qui la refermerait.
    nom: 'ligne-de-vue',
    de: [-5.4, 1.62, 5.4],
    vers: [5.4, 1.62, -5.4],
    preuve: 'traversée de l’atrium à hauteur d’œil : le vide doit rester un vide',
  },
  {
    // Depuis le rez-de-chaussée, dans le vide de l'atrium, regard vers le haut
    // et vers un angle : c'est le seul cadrage d'où les nervures des trois
    // niveaux se voient ENSEMBLE, en enfilade. La vue `atrium-plongee` est
    // dominée par l'escalier et n'en montre que des bribes ; la vue `plafond`
    // regarde à la verticale et les prend par la tranche.
    nom: 'atrium-nervures',
    de: [3.6, 1.7, 3.6],
    vers: [-5.5, 9.5, -5.5],
    preuve: 'les nervures d’atrium : de la structure sur trois niveaux, pas un bandeau flottant',
  },
  {
    // LA VUE QUI MANQUAIT POUR LA LANTERNE.
    //
    // `plafond` regarde le plafond d'une SALLE — du plâtre à trois mètres — et
    // `atrium-nervures` monte à 45°, où l'oculus n'est qu'un bord de cadre.
    // Aucune des onze ne pouvait donc voir le couronnement du puits de lumière,
    // et j'ai posé vingt-quatre côtes sans qu'un seul contrôle sache dire si
    // elles existaient. Un instrument qui ne sait pas regarder ce qu'on vient de
    // construire ne le garde pas.
    //
    // Plein zénith, depuis le rez-de-chaussée, décalé du centre pour ne pas
    // avoir l'hélice dans l'axe.
    nom: 'lanterne',
    de: [2.6, 1.7, 2.6],
    vers: [0, 18, 0],
    preuve: 'le zénith : la couronne de côtes doit border l’oculus, et le ciel passer entre elles',
  },
  {
    nom: 'coin',
    de: [-8.5, 1.6, -8.5],
    vers: [-11, 1.4, -11],
    preuve: "l'angle de salle : le SSAO doit y creuser un dégradé",
  },
  {
    nom: 'coin-sans-postfx',
    de: [-8.5, 1.6, -8.5],
    vers: [-11, 1.4, -11],
    preuve: 'même caméra, sans post-traitement : le témoin du A/B',
    sansPostFx: true,
  },
  {
    nom: 'escalier',
    de: [6.5, 2.2, 6.5],
    vers: [0, 1.2, 0],
    preuve: "l'escalier hélicoïdal : girons et contremarches, pas un plan incliné",
  },
  {
    // Dans le passage nord de l'étage 1, à 4 m d'un jour, regard vers le parc.
    // Les coordonnées sont DÉRIVÉES du musée réel : centre de l'ouverture,
    // reculé de 4 m le long de la normale rentrante du mur.
    nom: 'fenetre',
    de: [-12.65, 6.3, -11],
    vers: [-12.65, 6.2, -55],
    preuve: 'depuis un passage : la vue sur le parc, et la vitre qui la porte',
  },
  {
    // Le palier du rez-de-chaussée : l'escalier démarre en (−4,8 ; 0), dans la
    // trémie. On se place à 3 m à l'ouest, à hauteur d'œil, et on regarde le
    // départ. Si le garde-corps est continu, l'escalier est inaccessible — c'est
    // ce que cette vue est là pour dire.
    nom: 'palier',
    de: [-8.2, 1.7, 0],
    vers: [-3.5, 0.4, 0],
    preuve: "le palier : le garde-corps doit s'ouvrir devant la première marche",
  },
  {
    nom: 'plafond',
    de: [0, 1.7, -10],
    vers: [0, 6, -10],
    preuve: 'regard vers le haut : la sous-face de dalle doit être du béton clair',
  },
]

// ── Budget (§9 et §12) ───────────────────────────────────────────────────

/**
 * Les plafonds du §9, et le test de non-régression que le §12 exigeait.
 *
 * Ce contrôle n'existait pas, et c'est très exactement ce qui a laissé le budget
 * passer de 83 à 239 draw calls sans que rien ne s'allume : chaque lot ajoutait
 * sa part, aucun ne voyait le total. Il vit ici plutôt que dans vitest parce
 * qu'un draw call n'existe pas sans contexte WebGL — le compter dans un test
 * unitaire reviendrait à compter des maillages, c'est-à-dire à mesurer ce qu'on
 * croit avoir écrit et non ce que le GPU dessine.
 *
 * `node tools/capture.ts --check` sort en code 1 au moindre dépassement.
 */
const BUDGET = {
  /*
    150 est le plafond du §9, et il est DÉPASSÉ : 259 sur la vue d'entrée.

    Le chiffre n'est pas relevé pour éteindre le voyant. Il est laissé rouge
    parce qu'il dit quelque chose de vrai, et que le levier qui le fermerait est
    connu et non tiré : fusionner les murs d'un plateau en un maillage par
    matière. Il ne l'est pas parce que chaque mur porte ses PROPRES uniformes de
    flaques de lumière (§9.2) — les fusionner demanderait de passer ces flaques
    en attribut de sommet ou en texture, ce qui est un chantier, pas un réglage.

    Ce qui a été ajouté sciemment depuis le relevé à 247 : le garde-corps de
    l'atrium est passé du bandeau d'acier plein au VERRE, ce qui lui donne deux
    matières au lieu d'une — un appel de plus par plateau — et ses panneaux
    entrent dans la passe transparente, qui ne se groupe pas comme l'opaque. Le
    hall y gagne sa profondeur : on voit désormais le niveau de la réserve
    depuis l'entrée. C'est un échange assumé, pas une dérive non vue — et c'est
    exactement la différence que ce compteur existe pour rendre visible.
  */
  calls: 150,
  // Relevé de 500 000 à 1 000 000 au §9.5, sur mesure et non pour éteindre un
  // voyant : le chiffre d'origine datait d'un bâtiment sans végétation, sans
  // parc et sans sol. Le bâtiment seul pèse 16 000 triangles ; tout le reste est
  // de la végétation, déjà ramenée de 6 693 844 à 65 000 de géométrie unique.
  // Les 60 im/s sont tenues en 2880×1800 DPR 2.
  triangles: 1_000_000,
  lights: 12,
  shadowCasters: 2,
} as const

// ── Mesures ──────────────────────────────────────────────────────────────

interface Mesure {
  calls: number
  triangles: number
  programs: number
  lights: number
  shadowCasters: number
}

interface Rapport {
  vue: string
  preuve: string
  /** Part de pixels quasi noirs. C'est la métrique du défaut « on ne voit rien ». */
  pctSous25: number
  pctSous10: number
  /**
   * Part de pixels quasi blancs — le SYMÉTRIQUE des deux précédentes.
   *
   * Elles n'existaient pas, et leur absence n'était pas visible tant que le
   * bâtiment était gris. Les trois métriques d'origine attrapent toutes le même
   * défaut, le NOIR, parce que c'est celui que le lot 2 avait produit (§9.4).
   * Un instrument qui ne sait mesurer qu'un côté d'une erreur laisse passer
   * l'autre sans un mot.
   *
   * `pctSur250` compte les pixels réellement écrêtés : là, de l'information est
   * PERDUE, pas seulement claire. `pctSur230` attrape l'image qui part en voile
   * avant d'écrêter.
   */
  pctSur230: number
  pctSur250: number
  /** Luminance moyenne, pour repérer une image qui vire globalement. */
  luminanceMoyenne: number
  /**
   * Écart-type de la luminance. La métrique du défaut « c'est PLAT ».
   *
   * C'est la seule des six qui attrape les DEUX échecs à la fois : un aplat noir
   * et un aplat blanc ont tous deux un écart-type effondré, alors qu'ils sont aux
   * antipodes sur la moyenne. C'est elle qu'il aurait fallu au lot 2 — « le rendu
   * s'est révélé plat et sombre » sont deux constats distincts, et un seul des
   * deux était mesuré.
   *
   * Elle ne se compare pas à un seuil absolu mais au relevé de référence : une
   * vue de plafond n'a pas le contraste d'une vue de façade, et c'est normal.
   */
  ecartType: number
  mesure: Mesure | null
}

/**
 * Compte les pixels sombres, les pixels brûlés, la luminance moyenne et sa
 * dispersion — dans la page.
 *
 * Fait côté navigateur sur un canvas 2D plutôt que sur le PNG rapatrié : le
 * transfert d'une image de 8 Mo par vue coûterait plus que la mesure elle-même,
 * et le résultat serait identique.
 */
const SCRIPT_LUMINANCE = `(() => {
  const canvas = document.querySelector('canvas')
  const w = 480, h = 300
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')
  g.drawImage(canvas, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  let sous25 = 0, sous10 = 0, sur230 = 0, sur250 = 0, somme = 0, somme2 = 0
  for (let i = 0; i < d.length; i += 4) {
    // Luminance perceptuelle (Rec. 601) : le vert pèse plus que le bleu, donc
    // un bleu sombre ne doit pas compter comme « aussi noir » qu'un gris sombre.
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    somme += l
    somme2 += l * l
    if (l < 25) sous25++
    if (l < 10) sous10++
    if (l > 230) sur230++
    if (l > 250) sur250++
  }
  const n = d.length / 4
  const moyenne = somme / n
  // Variance par la somme des carrés : une seule passe, et sur des octets la
  // perte de précision de cette forme est sans objet.
  const variance = Math.max(0, somme2 / n - moyenne * moyenne)
  return {
    pctSous25: +(100 * sous25 / n).toFixed(2),
    pctSous10: +(100 * sous10 / n).toFixed(2),
    pctSur230: +(100 * sur230 / n).toFixed(2),
    pctSur250: +(100 * sur250 / n).toFixed(2),
    luminanceMoyenne: +(moyenne).toFixed(1),
    ecartType: +(Math.sqrt(variance)).toFixed(1),
  }
})()`

async function attendreScene(page: Page): Promise<void> {
  await page.waitForFunction('window.__MUSEUM__ !== undefined', { timeout: 60_000 })
  // L'écran d'accueil couvre tout le cadre et fausserait chaque mesure de
  // luminance. On le retire par l'état du jeu plutôt qu'en cliquant : un clic
  // demanderait le verrouillage du pointeur, que Chrome headless refuse.
  await page.evaluate(`(() => {
    const o = document.querySelector('[data-museum-overlay="accueil"]')
    if (o) o.style.display = 'none'
  })()`)
  // Le premier rendu ne suffit pas : les matières, le kit de props et les
  // plantes arrivent en asynchrone. Sans cette attente on photographie un musée
  // en aplat et on conclut que les textures ne marchent pas.
  await page.waitForFunction(
    `(() => {
       let textures = 0
       window.__MUSEUM__.scene.traverse((o) => {
         if (o.material) for (const m of [].concat(o.material)) if (m && m.map) textures++
       })
       return textures > 4
     })()`,
    { timeout: 60_000, polling: 500 },
  )
}

/**
 * D'OÙ viennent les draw calls, groupe par groupe.
 *
 * ── Pourquoi cette ventilation manquait ──
 *
 * Le compteur du §9 dit « 269 pour un plafond de 150 » et s'arrête là. On sait
 * donc qu'on dépasse, jamais de combien chaque poste y contribue — et une
 * optimisation choisie sans ce relevé est une intuition qu'on paie en heures.
 * Le plan nomme un levier (« fusionner les murs par matière, −65 appels ») :
 * ce chiffre-là est une PRÉVISION, et rien ne l'a jamais vérifiée.
 *
 * On compte les objets rendables VISIBLES, groupés par le nœud nommé le plus
 * proche. Ce n'est pas exactement le compte du pilote — le post-traitement
 * ajoute ses passes plein écran, et le culling par frustum en retire — mais
 * c'est la seule décomposition que la scène puisse donner, et elle suffit
 * amplement à dire OÙ chercher.
 */
const SCRIPT_APPELS = `(() => {
  const parGroupe = {}
  const compter = (o) => {
    if (!o.visible) return
    const rendable = o.isMesh || o.isInstancedMesh || o.isLine || o.isPoints
    if (rendable) {
      let n = o
      let nom = '(sans nom)'
      while (n) { if (n.name) { nom = n.name; break } n = n.parent }
      const groupes = o.geometry && o.geometry.groups ? o.geometry.groups.length : 0
      parGroupe[nom] = (parGroupe[nom] || 0) + Math.max(1, groupes)
    }
    for (const e of o.children) compter(e)
  }
  compter(window.__MUSEUM__.scene)
  return parGroupe
})()`

async function ventiler(page: Page, vue: Vue): Promise<void> {
  await page.evaluate(`window.__MUSEUM__.survol(${vue.de.join(',')}, ${vue.vers.join(',')})`)
  await new Promise((r) => setTimeout(r, 350))
  const parGroupe = (await page.evaluate(SCRIPT_APPELS)) as Record<string, number>
  // ⚠️ Regroupé par PRÉFIXE (`wall:rdc-nord` → `wall`). Sans ça, chaque mur
  // portant son propre nom, les soixante-et-onze murs du bâtiment sortaient en
  // soixante-et-onze lignes à 1 — c'est-à-dire invisibles sous n'importe quel
  // filtre, alors qu'ils sont le premier poste du compteur. Une ventilation qui
  // éparpille son plus gros poste ne ventile rien.
  const parFamille: Record<string, number> = {}
  for (const [nom, n] of Object.entries(parGroupe)) {
    // Les couches nomment leurs nœuds `famille:instance` ; les MURS, eux, portent
    // leur rôle en suffixe (`etage-2-north-galerie-0-outer`). Sans cette seconde
    // règle, les soixante-et-onze murs sortaient en soixante-et-onze lignes à 1,
    // c'est-à-dire noyés — alors qu'ils sont à eux seuls la moitié du compteur.
    const mur = /-(outer|inner|side-[ab]|enclosure)$/.exec(nom)
    const famille = mur ? `mur:${mur[1].replace(/-[ab]$/, '')}` : nom.split(':')[0]
    parFamille[famille] = (parFamille[famille] ?? 0) + n
  }
  const lignes = Object.entries(parFamille).sort((a, b) => b[1] - a[1])
  const total = lignes.reduce((s, [, n]) => s + n, 0)
  console.log(`\nventilation des maillages visibles \u2014 vue \u00ab ${vue.nom} \u00bb\n`)
  for (const [nom, n] of lignes) {
    console.log(`  ${nom.padEnd(28)} ${String(n).padStart(4)}  ${((100 * n) / total).toFixed(1)} %`)
  }
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(total).padStart(4)}`)
}

async function capturer(page: Page, vue: Vue): Promise<Rapport> {
  await page.evaluate(
    `window.__MUSEUM__.setPostFx(${vue.sansPostFx ? 'false' : 'true'})`,
  )
  await page.evaluate(
    `window.__MUSEUM__.survol(${vue.de.join(',')}, ${vue.vers.join(',')})`,
  )
  // Deux images de battement : la première applique la caméra, la seconde la
  // rend avec un historique de post-traitement propre (le SMAA et le SSAO
  // réutilisent l'image précédente).
  await new Promise((r) => setTimeout(r, 350))

  await page.screenshot({ path: resolve(OUT, `${vue.nom}.png`) })

  const lum = (await page.evaluate(SCRIPT_LUMINANCE)) as Omit<Rapport, 'vue' | 'preuve' | 'mesure'>
  const mesure = (await page.evaluate(
    `typeof window.__MUSEUM__.mesure === 'function' ? window.__MUSEUM__.mesure() : null`,
  )) as Mesure | null

  return { vue: vue.nom, preuve: vue.preuve, ...lum, mesure }
}

// ── Point d'entrée ───────────────────────────────────────────────────────

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/**
 * Trouve le serveur qui sert CE musée-ci. Voir `PORTS` pour le pourquoi.
 *
 * La preuve d'identité est le `museum.json` : il est dérivé du dépôt GitHub et
 * de la branche, donc deux worktrees en ont deux versions différentes dès que
 * l'un des deux a touché à `derive-museum.ts`. Comparer sa longueur suffit —
 * c'est un fichier de plusieurs dizaines de kilo-octets, une collision de taille
 * entre deux bâtiments différents n'arrive pas par hasard.
 */
async function trouverLeServeur(): Promise<string> {
  const local = await readFile(resolve(ROOT, 'public', 'data', 'museum.json'))
  const echecs: string[] = []

  for (const port of PORTS) {
    const base = `http://localhost:${port}/`
    try {
      const reponse = await fetch(`${base}data/museum.json`, {
        signal: AbortSignal.timeout(1500),
      })
      if (!reponse.ok) {
        echecs.push(`${port}: HTTP ${reponse.status}`)
        continue
      }
      const servi = Buffer.from(await reponse.arrayBuffer())
      if (servi.equals(local)) return base
      echecs.push(`${port}: un AUTRE musée (${servi.length} o. contre ${local.length})`)
    } catch {
      echecs.push(`${port}: fermé`)
    }
  }

  throw new Error(
    `Aucun serveur ne sert CE musée.\n  ${echecs.join('\n  ')}\n` +
      'Lancer `npm run dev` dans ce worktree, ou passer --url explicitement.',
  )
}

async function main() {
  const url = argument('url') ?? (await trouverLeServeur())
  console.log(`serveur : ${url}`)
  const only = argument('only')?.split(',').map((s) => s.trim())
  const vues = only ? VUES.filter((v) => only.includes(v.nom)) : VUES
  if (vues.length === 0) {
    throw new Error(`Aucune vue ne correspond à « ${only?.join(', ')} »`)
  }

  await mkdir(OUT, { recursive: true })

  let browser: Browser | undefined
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      // Le musée est en WebGL2 : sans ces deux drapeaux, le Chrome headless
      // tombe sur SwiftShader et rend en quelques images par minute.
      args: ['--enable-gpu', '--use-angle=metal', '--hide-scrollbars'],
      defaultViewport: VIEWPORT,
    })
    const page = await browser.newPage()

    /*
      ⛔ CACHE COUPÉ, et ce n'est pas une précaution de confort.

      Mesuré le 2026-08-16 : après avoir régénéré `park-lod.glb` — 135 200
      triangles de moins, fichier neuf sur le disque, servi neuf par Vite — les
      ONZE vues ont rendu EXACTEMENT les mêmes chiffres qu'au passage précédent,
      au triangle près. Le navigateur relisait sa copie.

      Un oracle qui mesure un cache est pire qu'un oracle absent : il rend un
      relevé complet, cohérent, plausible, et FAUX. Il aurait fait conclure que
      la reprise sur le parc n'avait rien donné, et le budget des vingt-neuf
      pièces d'architecture aurait été taillé sur ce constat.

      C'est la même famille que le premier oracle pris sans assets et que le
      board qui servait un JSON de six jours : un instrument doit dire ce qui EST
      là, jamais ce qu'il a vu la dernière fois.
    */
    await page.setCacheEnabled(false)

    const erreurs: string[] = []
    page.on('pageerror', (e) => erreurs.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') erreurs.push(m.text())
    })

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
    await attendreScene(page)

    if (process.argv.includes('--appels')) {
      await ventiler(page, vues[0])
      return
    }

    const rapports: Rapport[] = []
    for (const vue of vues) rapports.push(await capturer(page, vue))

    console.log(
      `\n${'vue'.padEnd(20)} ${'noir<25'.padStart(8)} ${'noir<10'.padStart(8)} ` +
        `${'blanc>230'.padStart(9)} ${'blanc>250'.padStart(9)} ` +
        `${'lum'.padStart(6)} ${'σ'.padStart(6)} ${'calls'.padStart(6)} ${'tris'.padStart(9)}`,
    )
    for (const r of rapports) {
      console.log(
        `${r.vue.padEnd(20)} ${`${r.pctSous25} %`.padStart(8)} ${`${r.pctSous10} %`.padStart(8)} ` +
          `${`${r.pctSur230} %`.padStart(9)} ${`${r.pctSur250} %`.padStart(9)} ` +
          `${String(r.luminanceMoyenne).padStart(6)} ${String(r.ecartType).padStart(6)} ` +
          `${String(r.mesure?.calls ?? '—').padStart(6)} ` +
          `${String(r.mesure?.triangles ?? '—').padStart(9)}`,
      )
      console.log(`${' '.repeat(20)} ${r.preuve}`)
    }

    await writeFile(
      resolve(OUT, 'rapport.json'),
      `${JSON.stringify({ url, viewport: VIEWPORT, budget: BUDGET, rapports, erreurs }, null, 2)}\n`,
    )
    console.log(`\n${vues.length} captures + rapport.json → .captures/`)
    if (erreurs.length > 0) {
      console.log(`\n${erreurs.length} erreur(s) console :`)
      for (const e of erreurs.slice(0, 10)) console.log(`  ${e}`)
    }

    // Le budget se juge sur la vue la PLUS CHÈRE, jamais sur la moyenne : c'est
    // celle-là que le visiteur paie en images par seconde.
    // `?? 0` serait un piège : une clé absente du relevé passerait pour zéro et
    // afficherait un vert sur un plafond jamais mesuré. C'est arrivé une fois,
    // sur `lights` et `shadowCasters`. Une mesure manquante devient donc
    // `Infinity` — elle échoue bruyamment au lieu de rassurer à tort.
    const pire = (k: keyof Mesure): number =>
      Math.max(
        ...rapports.map((r) => {
          const v = r.mesure?.[k]
          return typeof v === 'number' ? v : Infinity
        }),
      )
    const pires: Record<keyof typeof BUDGET, number> = {
      calls: pire('calls'),
      triangles: pire('triangles'),
      lights: pire('lights'),
      shadowCasters: pire('shadowCasters'),
    }
    const depassements = (Object.keys(BUDGET) as (keyof typeof BUDGET)[])
      .filter((k) => pires[k] > BUDGET[k])
      .map((k) => `  ${k.padEnd(14)} ${pires[k]} > ${BUDGET[k]}`)

    console.log('\nbudget §9, sur la vue la plus chère :')
    for (const k of Object.keys(BUDGET) as (keyof typeof BUDGET)[]) {
      const ok = pires[k] <= BUDGET[k]
      console.log(`  ${ok ? '✓' : '✗'} ${k.padEnd(14)} ${String(pires[k]).padStart(7)} / ${BUDGET[k]}`)
    }

    if (depassements.length > 0 && process.argv.includes('--check')) {
      console.error(`\n${depassements.length} dépassement(s) :\n${depassements.join('\n')}`)
      process.exitCode = 1
    }
  } finally {
    await browser?.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
