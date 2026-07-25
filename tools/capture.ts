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
import { mkdir, writeFile } from 'node:fs/promises'
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

/** Le port de `npm run dev`. Vite en prend un autre s'il est occupé : `--url`. */
const DEFAULT_URL = 'http://localhost:5174/'

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
  /** Luminance moyenne, pour repérer une image qui vire globalement. */
  luminanceMoyenne: number
  mesure: Mesure | null
}

/**
 * Compte les pixels sombres et la luminance moyenne, dans la page.
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
  let sous25 = 0, sous10 = 0, somme = 0
  for (let i = 0; i < d.length; i += 4) {
    // Luminance perceptuelle (Rec. 601) : le vert pèse plus que le bleu, donc
    // un bleu sombre ne doit pas compter comme « aussi noir » qu'un gris sombre.
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    somme += l
    if (l < 25) sous25++
    if (l < 10) sous10++
  }
  const n = d.length / 4
  return {
    pctSous25: +(100 * sous25 / n).toFixed(2),
    pctSous10: +(100 * sous10 / n).toFixed(2),
    luminanceMoyenne: +(somme / n).toFixed(1),
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

async function main() {
  const url = argument('url') ?? DEFAULT_URL
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

    const erreurs: string[] = []
    page.on('pageerror', (e) => erreurs.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') erreurs.push(m.text())
    })

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
    await attendreScene(page)

    const rapports: Rapport[] = []
    for (const vue of vues) rapports.push(await capturer(page, vue))

    console.log(`\n${'vue'.padEnd(20)} ${'noir<25'.padStart(8)} ${'noir<10'.padStart(8)} ${'lum'.padStart(6)} ${'calls'.padStart(6)} ${'tris'.padStart(9)}`)
    for (const r of rapports) {
      console.log(
        `${r.vue.padEnd(20)} ${`${r.pctSous25} %`.padStart(8)} ${`${r.pctSous10} %`.padStart(8)} ` +
          `${String(r.luminanceMoyenne).padStart(6)} ${String(r.mesure?.calls ?? '—').padStart(6)} ` +
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
