/**
 * MARCHER dans le musée, et relever ce qui se passe.
 *
 *   node tools/walk.ts                  # tous les parcours
 *   node tools/walk.ts --only escalier  # un seul
 *
 * ── Pourquoi cet outil existe ──
 *
 * `tools/capture.ts` place une caméra là où JE décide qu'il faut regarder. C'est
 * commode, et c'est un piège : on ne voit que ce qu'on a choisi de cadrer. Un
 * bâtiment peut être irréprochable sur les six vues qu'on a retenues et rester
 * INFRANCHISSABLE — c'est arrivé, l'escalier était ceinturé d'un garde-corps
 * continu et aucune capture ne le disait.
 *
 * Ici on ne cadre rien. On pose le visiteur à son point d'apparition, on tient
 * une touche, et on relève sa position image après image. Ce que ça prouve n'est
 * pas « ça a l'air bien » mais **« on y arrive »** — et quand on n'y arrive pas,
 * la trajectoire dit exactement où l'on s'est arrêté.
 *
 * Le personnage est le VRAI : même contrôleur cinématique, même autostep, mêmes
 * colliders. Aucun raccourci de téléportation dans un parcours.
 */
/// <reference types="node" />
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'
import type { Browser, Page } from 'puppeteer-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '.captures')

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const DEFAULT_URL = 'http://localhost:5174/'
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 }

// ── Le vocabulaire d'un parcours ─────────────────────────────────────────

/**
 * Un ordre donné au visiteur.
 *
 * `cap` est un azimut en degrés, dans la convention de `camera.rotation.y` de
 * three : la direction de marche vaut (−sin θ, 0, −cos θ). Donc **0 = nord
 * (−Z), +90 = ouest (−X), 180 = sud (+Z), −90 = est (+X)**.
 *
 * Écrit à l'envers la première fois, ce qui a envoyé le visiteur à l'est pendant
 * neuf secondes et fait passer un parcours qui n'avait rien franchi. Le cap se
 * lit sur le plan coté, qui a le nord en haut : c'est le seul moyen d'écrire un
 * parcours sans se tromper de sens.
 */
type Ordre =
  | { faire: 'regarder'; cap: number; pitch?: number }
  | { faire: 'avancer'; secondes: number }
  /**
   * Marcher VERS un point, et s'arrêter en y arrivant — ou dès qu'on n'avance
   * plus.
   *
   * C'est la seule forme d'ordre qui distingue « le bâtiment me bloque » de
   * « ma durée était trop courte ». Écrite en durées, la première version de ce
   * fichier a conclu à un escalier inaccessible alors que le visiteur avait
   * simplement cessé de marcher trois mètres trop tôt : les durées avaient été
   * calculées pour 4 m/s, et Chrome en mode headless bride les images à ~2 m/s.
   *
   * Un parcours ne doit jamais dépendre d'un réglage de vitesse ni d'un nombre
   * d'images par seconde.
   */
  | { faire: 'allerA'; x: number; z: number; tolerance?: number; maxSecondes?: number }
  /**
   * Suivre un escalier, du bas vers le haut.
   *
   * Les points de passage sont DÉRIVÉS de `museum.json` — centre, rayon, angle
   * de départ, balayage — au lieu d'être écrits à la main. Ce n'est pas du
   * confort : les écrire à la main, je me suis trompé de moitié de cercle et le
   * parcours envoyait le visiteur dans la volée qui DESCEND en réserve, à
   * l'exact opposé. Un parcours qui invente ses coordonnées finit par tester
   * mes suppositions plutôt que le bâtiment.
   */
  | { faire: 'monter'; rampId: string; tolerance?: number }
  | { faire: 'photo'; nom: string }

interface Parcours {
  nom: string
  /** Ce que le parcours doit PROUVER. Une phrase, vérifiable. */
  preuve: string
  ordres: Ordre[]
  /**
   * Le contrat de fin. `yMin` est l'altitude que le visiteur DOIT avoir
   * atteinte : c'est elle qui distingue « j'ai monté un étage » de « j'ai
   * poussé un garde-corps pendant huit secondes ».
   */
  attendu: { yMin?: number; yMax?: number; distanceMin?: number }
}

const PARCOURS: Parcours[] = [
  {
    nom: 'atteindre-escalier',
    preuve:
      "depuis le point d'apparition, rejoindre le palier ouest de l'atrium et monter d'un étage",
    ordres: [
      /*
        Départ en (0 ; 10,5), palier en (−4,8 ; 0), trémie de −6 à 6 sur les deux
        axes. On ne peut donc PAS y aller en ligne droite : il faut contourner le
        vide par l'ouest. Le trajet se lit sur `.captures/plan-rdc.svg`.

        À 4 m/s : 4 s valent 16 m, largement de quoi buter sur la façade — c'est
        voulu, le collider arrête, et une durée trop courte laisserait le
        parcours dépendre du réglage de vitesse.
      */
      { faire: 'photo', nom: 'depart' },
      // On contourne le vide par l'OUEST : à x = −9 on est franchement dehors
      // de la trémie, qui va de −6 à 6.
      { faire: 'allerA', x: -9, z: 10.5 },
      { faire: 'photo', nom: 'ouest-de-la-tremie' },
      // Puis on remonte le long du vide jusqu'à la hauteur du palier (z = 0).
      { faire: 'allerA', x: -9, z: 0 },
      { faire: 'photo', nom: 'devant-le-palier' },
      { faire: 'photo', nom: 'devant-le-palier-2' },
      // L'hélice tourne : on la suit par points de passage tirés de la donnée.
      { faire: 'monter', rampId: 'ramp-rdc-etage-1' },
      { faire: 'photo', nom: 'en-montant' },
    ],
    // Un étage vaut 4,70 m. On exige d'être monté d'au moins 1 m : moins, c'est
    // avoir poussé un garde-corps pendant douze secondes.
    // 3,50 m : les trois quarts d'un étage. On ne se contente pas d'avoir posé
    // le pied sur la première marche.
    attendu: { yMin: 3.5 },
  },
  {
    nom: 'sortir-au-parc',
    preuve: 'depuis le point d’apparition, atteindre une façade sans traverser le sol',
    ordres: [
      { faire: 'allerA', x: 0, z: 14.2, tolerance: 0.5 },
      { faire: 'photo', nom: 'face-sud' },
    ],
    // On ne doit PAS tomber : le filet anti-chute renverrait au spawn, ce qui
    // se lirait comme un retour à y = 0 après un plongeon.
    attendu: { yMin: -0.5, yMax: 0.6, distanceMin: 2.8 },
  },
]

// ── Relevé ───────────────────────────────────────────────────────────────

interface Position {
  x: number
  y: number
  z: number
  yaw: number
}

interface Releve {
  parcours: string
  preuve: string
  depart: Position
  arrivee: Position
  /** Trajectoire échantillonnée, pour la tracer sur le plan. */
  trace: Position[]
  distance: number
  yMin: number
  yMax: number
  /**
   * Plus grande VITESSE VERTICALE apparente de l'œil, en m/s, mesurée d'une
   * image à l'autre.
   *
   * ── Pourquoi une vitesse et non un saut ──
   *
   * La première version relevait le saut brut en millimètres. Elle était
   * ININTERPRÉTABLE : trois exécutions du même parcours ont donné 19, 36 et
   * 56 mm, parce qu'un maximum sur dix mille images attrape le pire À-COUP
   * D'AFFICHAGE, pas le comportement de l'œil. Une image qui dure 60 ms au lieu
   * de 8 laisse légitimement monter de sept fois plus.
   *
   * Divisée par la durée de l'image, la grandeur redevient une propriété du
   * contrôleur : monter l'escalier à 1,8 m/s sur une pente à 31 % produit
   * 0,55 m/s, quelle que soit la cadence. Un giron de 15 cm avalé en une image
   * de 8 ms en produirait 18.
   */
  vitesseVerticaleMax: number
  verdict: 'OK' | 'ÉCHEC'
  pourquoi: string[]
}

async function attendreScene(page: Page): Promise<void> {
  await page.waitForFunction('window.__MUSEUM__ !== undefined', { timeout: 60_000 })
  await page.waitForFunction(
    `(() => {
       let t = 0
       window.__MUSEUM__.scene.traverse((o) => {
         if (o.material) for (const m of [].concat(o.material)) if (m && m.map) t++
       })
       return t > 4
     })()`,
    { timeout: 60_000, polling: 500 },
  )
  // L'écran d'accueil bloque le pointeur et met le jeu en pause.
  await page.evaluate(`(() => {
    const o = document.querySelector('[data-museum-overlay="accueil"]')
    if (o) o.style.display = 'none'
    window.__MUSEUM__.demarrer()

    // Échantillonneur par IMAGE. Il tourne dans la page parce que c'est le seul
    // endroit d'où l'on voit chaque image : depuis Node, le meilleur relevé
    // possible est celui d'un aller-retour CDP, soit une dizaine d'images.
    const cam = window.__MUSEUM__.camera
    window.__SAUTS__ = { precedent: cam.position.y, t: performance.now(), max: 0, n: 0 }
    const tic = () => {
      const s = window.__SAUTS__
      const maintenant = performance.now()
      const dt = (maintenant - s.t) / 1000
      const dy = Math.abs(cam.position.y - s.precedent)
      /*
        On écarte trois choses, et la troisième est un défaut de CET
        instrument.

        Le premier relevé, qui suit le recalage initial de la caméra. Les
        téléportations — le filet anti-vide déplace de plusieurs mètres. Et les
        intervalles de moins de 4 ms : aucun affichage ne rend à plus de
        250 im/s, un tel intervalle signifie donc que cet échantillonneur et la
        boucle de rendu se sont croisés — deux relevés encadrant un seul rendu. Mesuré : des pics à 13 m/s sur des intervalles de 1,3 ms,
        c'est-à-dire un mouvement d'image entière divisé par un dixième d'image.
        C'était l'instrument qui mentait, pas le contrôleur.
      */
      if (s.n > 0 && dy < 0.5 && dt > 0.004) {
        const v = dy / dt
        if (v > s.max) {
          s.max = v
          s.ou = { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) }
          s.sens = cam.position.y > s.precedent ? 'montee' : 'descente'
          s.dt = +(dt * 1000).toFixed(1)
          s.dy = +(dy * 1000).toFixed(1)
        }
      }
      s.precedent = cam.position.y
      s.t = maintenant
      s.n++
      requestAnimationFrame(tic)
    }
    requestAnimationFrame(tic)
  })()`)
}

const ou = (page: Page): Promise<Position> =>
  page.evaluate('window.__MUSEUM__.ouSuisJe()') as Promise<Position>

interface RampeLue {
  id: string
  centre: { x: number; z: number }
  radius: number
  startAngle: number
  sweep: number
}

/**
 * Remplace chaque `monter` par la suite de points de passage de son escalier.
 *
 * Un point tous les ~15° : assez serré pour rester sur l'emmarchement — une
 * corde de 15° sur un rayon de 4,8 m s'écarte de 8 cm de l'arc, contre 1,10 m
 * de demi-largeur — et assez espacé pour que le visiteur avance vraiment entre
 * deux corrections de cap.
 */
// Après développement, plus aucun `monter` ne subsiste : le type de sortie le
// dit, ce qui évite d'avoir à le vérifier dans la boucle de jeu.
type OrdreConcret = Exclude<Ordre, { faire: 'monter' }>

function developper(ordres: Ordre[], rampes: RampeLue[]): OrdreConcret[] {
  const sortie: OrdreConcret[] = []
  for (const o of ordres) {
    if (o.faire !== 'monter') {
      sortie.push(o)
      continue
    }
    const r = rampes.find((x) => x.id === o.rampId)
    if (!r) throw new Error(`escalier « ${o.rampId} » absent de museum.json`)
    // 20° au rayon de 4,80 m font 1,68 m entre deux points de passage, pour une
    // tolérance de 0,60 m. La tolérance DOIT rester nettement inférieure à
    // l'espacement : à 1,10 m pour 1,26 m d'écart, le visiteur validait chaque
    // point sans avoir à marcher et le parcours s'arrêtait au deuxième.
    const pas = (20 * Math.PI) / 180
    const n = Math.max(2, Math.ceil(Math.abs(r.sweep) / pas))
    // On part de i = 0, c'est-à-dire du PIED de l'escalier. Commencer au premier
    // point intermédiaire faisait viser le visiteur 20° plus loin : la ligne
    // droite qui l'y menait ratait l'ouverture de 1,44 m du garde-corps, et il
    // longeait la trémie au lieu d'y entrer.
    for (let i = 0; i <= n; i++) {
      const a = r.startAngle + (r.sweep * i) / n
      sortie.push({
        faire: 'allerA',
        x: r.centre.x + r.radius * Math.cos(a),
        z: r.centre.z + r.radius * Math.sin(a),
        tolerance: o.tolerance ?? 0.6,
        maxSecondes: 12,
      })
    }
  }
  return sortie
}

async function jouer(page: Page, p: Parcours, rampes: RampeLue[]): Promise<Releve> {
  const trace: Position[] = []
  const depart = await ou(page)
  trace.push(depart)
  // Remise à zéro APRÈS la mise en place : le recalage initial de la caméra est
  // une téléportation, pas un pas.
  await page.evaluate(
    '(() => { const s = window.__SAUTS__; s.max = 0; s.n = 0; s.t = performance.now() })()',
  )

  for (const ordre of developper(p.ordres, rampes)) {
    if (ordre.faire === 'regarder') {
      await page.evaluate(
        `window.__MUSEUM__.regarder(${(ordre.cap * Math.PI) / 180}, ${((ordre.pitch ?? 0) * Math.PI) / 180})`,
      )
      continue
    }
    if (ordre.faire === 'photo') {
      await page.screenshot({ path: resolve(OUT, `marche-${p.nom}-${ordre.nom}.png`) })
      continue
    }
    if (ordre.faire === 'avancer') {
      // On tient la touche et on échantillonne : c'est la trajectoire qui dit
      // où l'on s'est arrêté, pas la position finale.
      await page.keyboard.down('KeyW')
      const fin = Date.now() + ordre.secondes * 1000
      while (Date.now() < fin) {
        await new Promise((r) => setTimeout(r, 120))
        trace.push(await ou(page))
      }
      await page.keyboard.up('KeyW')
      await new Promise((r) => setTimeout(r, 150))
      trace.push(await ou(page))
      continue
    }

    // ── allerA : marcher vers un point, en corrigeant le cap ──
    const tolerance = ordre.tolerance ?? 0.5
    const limite = Date.now() + (ordre.maxSecondes ?? 25) * 1000
    /*
      « Bloqué » se mesure sur une FENÊTRE DE TEMPS, jamais sur un compte
      d'échantillons.

      Première version : trois relevés consécutifs sous 3 cm. Chrome en mode
      headless bride les images et en saute franchement ; trois relevés de
      120 ms pouvaient donc tomber dans un trou sans qu'aucun mur n'existe. Les
      deux parcours s'arrêtaient un mètre avant leur cible et le rapport
      annonçait « bloqué » — sur un bâtiment parfaitement franchissable.

      Une seconde entière sans avancer de 10 cm, en tenant la touche, ne
      s'explique plus par une image sautée.
    */
    const FENETRE_BLOCAGE = 1200
    const PROGRES_MIN = 0.1
    // Le progrès se mesure sur la DISTANCE À LA CIBLE, pas sur le déplacement.
    // Près d'un point de passage le cap recalculé oscille et le visiteur orbite :
    // il se déplace beaucoup et n'approche de rien. Mesuré en déplacement, le
    // parcours concluait « bloqué » sur un escalier parfaitement montable.
    let meilleure = Infinity
    let meilleureA = Date.now()

    await page.keyboard.down('KeyW')
    for (;;) {
      const p0 = await ou(page)
      trace.push(p0)
      const reste = Math.hypot(ordre.x - p0.x, ordre.z - p0.z)
      if (reste <= tolerance || Date.now() > limite) break

      // Le cap est RECALCULÉ à chaque pas : la direction (−sin θ, 0, −cos θ)
      // s'inverse en θ = atan2(−Δx, −Δz).
      const cap = Math.atan2(-(ordre.x - p0.x), -(ordre.z - p0.z))
      await page.evaluate(`window.__MUSEUM__.regarder(${cap})`)

      if (reste < meilleure - PROGRES_MIN) {
        meilleure = reste
        meilleureA = Date.now()
      } else if (Date.now() - meilleureA > FENETRE_BLOCAGE) {
        break
      }

      await new Promise((r) => setTimeout(r, 120))
    }
    await page.keyboard.up('KeyW')
    await new Promise((r) => setTimeout(r, 150))
    trace.push(await ou(page))
  }

  const arrivee = trace[trace.length - 1]
  const distance = Math.hypot(arrivee.x - depart.x, arrivee.z - depart.z)
  const yMin = Math.min(...trace.map((t) => t.y))
  const yMax = Math.max(...trace.map((t) => t.y))

  const pourquoi: string[] = []
  if (p.attendu.yMin !== undefined && yMax < p.attendu.yMin) {
    pourquoi.push(`monté à ${yMax.toFixed(2)} m au mieux, il en fallait ${p.attendu.yMin}`)
  }
  if (p.attendu.yMax !== undefined && yMax > p.attendu.yMax) {
    pourquoi.push(`monté à ${yMax.toFixed(2)} m, au-delà des ${p.attendu.yMax} attendus`)
  }
  if (p.attendu.distanceMin !== undefined && distance < p.attendu.distanceMin) {
    pourquoi.push(
      `parcouru ${distance.toFixed(2)} m, il en fallait ${p.attendu.distanceMin} — bloqué`,
    )
  }

  const vitesseVerticaleMax = (await page.evaluate(
    '(() => window.__SAUTS__.max)()',
  )) as number
  if (process.env.MUSEUM_DEBUG_SAUT) {
    console.log('  pic vertical :', await page.evaluate('(() => JSON.stringify(window.__SAUTS__))()'))
  }

  /*
    Le confort de montée est RAPPORTÉ, pas érigé en critère — et c'est une
    décision prise sur les chiffres, pas par prudence.

    Le témoin a été joué : `VITESSE_OEIL_MAX` portée à 999 m/s, c'est-à-dire
    l'œil collé au corps comme avant.

        avec limite (4 tirs)   1,95 · 2,25 · 2,30 · 2,83 m/s
        sans limite (3 tirs)   2,21 · 3,45 · 3,91 m/s

    L'écrêtage est donc réel — le pire cas tombe d'un quart — mais les deux
    distributions SE CHEVAUCHENT. Un seuil placé entre elles échouerait au
    hasard sur une machine chargée, et un harnais qui échoue au hasard finit par
    ne plus être lu. On imprime la valeur, et c'est la SÉRIE qui se compare, pas
    un tir isolé.

    Ce chiffre dément au passage la prédiction de départ. L'escalier hélicoïdal
    ne produisait PAS de saut d'un giron entier : ses colliders de marche se
    recouvrent assez pour que Rapier étale la montée. Le lissage corrige des
    à-coups de deux à trois centimètres, pas de quinze.
  */

  return {
    parcours: p.nom,
    preuve: p.preuve,
    depart,
    arrivee,
    trace,
    distance,
    yMin,
    yMax,
    vitesseVerticaleMax,
    verdict: pourquoi.length === 0 ? 'OK' : 'ÉCHEC',
    pourquoi,
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────

function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const url = argument('url') ?? DEFAULT_URL
  const only = argument('only')?.split(',').map((s) => s.trim())
  const parcours = only ? PARCOURS.filter((p) => only.includes(p.nom)) : PARCOURS

  await mkdir(OUT, { recursive: true })
  let browser: Browser | undefined
  const releves: Releve[] = []

  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--enable-gpu', '--use-angle=metal', '--hide-scrollbars'],
      defaultViewport: VIEWPORT,
    })

    // Les escaliers sont lus dans le musée SERVI, pas dans le fichier du
    // disque : c'est bien le bâtiment qu'on parcourt qui doit fournir ses
    // propres coordonnées.
    const sonde = await browser.newPage()
    await sonde.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
    await sonde.waitForFunction('window.__MUSEUM__ !== undefined', { timeout: 60_000 })
    const rampes = (await sonde.evaluate(
      `fetch('data/museum.json').then((r) => r.json()).then((m) => m.ramps.map((r) => ({
         id: r.id, centre: r.centre, radius: r.radius, startAngle: r.startAngle, sweep: r.sweep,
       })))`,
    )) as RampeLue[]
    await sonde.close()

    for (const p of parcours) {
      // Une page NEUVE par parcours : sinon le second partirait de là où le
      // premier s'est arrêté, et ne prouverait plus rien sur le point de départ.
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 })
      await attendreScene(page)
      await new Promise((r) => setTimeout(r, 800))
      releves.push(await jouer(page, p, rampes))
      await page.close()
    }
  } finally {
    await browser?.close()
  }

  await writeFile(resolve(OUT, 'marche.json'), `${JSON.stringify(releves, null, 2)}\n`)

  console.log()
  for (const r of releves) {
    const marque = r.verdict === 'OK' ? '✓' : '✗'
    console.log(`${marque} ${r.parcours}`)
    console.log(`   ${r.preuve}`)
    console.log(
      `   de (${r.depart.x.toFixed(1)}, ${r.depart.y.toFixed(2)}, ${r.depart.z.toFixed(1)})` +
        ` à (${r.arrivee.x.toFixed(1)}, ${r.arrivee.y.toFixed(2)}, ${r.arrivee.z.toFixed(1)})` +
        ` · ${r.distance.toFixed(1)} m parcourus · y de ${r.yMin.toFixed(2)} à ${r.yMax.toFixed(2)}`,
    )
    console.log(
      `   vitesse verticale max de l'œil : ${r.vitesseVerticaleMax.toFixed(2)} m/s`,
    )
    for (const raison of r.pourquoi) console.log(`   ⚠ ${raison}`)
  }

  const echecs = releves.filter((r) => r.verdict === 'ÉCHEC')
  console.log(`\n${releves.length - echecs.length}/${releves.length} parcours franchis`)
  if (echecs.length > 0) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
