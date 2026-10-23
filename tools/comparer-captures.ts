/**
 * Les captures du musée à des points de vue fixes (position, regard, heure), une image
 * par vue, pour juger à l'œil qu'un changement ne déplace rien.
 *
 *   node tools/comparer-captures.ts [http://localhost:5173/] [--dossier=<dossier>] [--vues=arrivee,escalier] [--avant=<dossier>] [--q=a=b&c=d]
 *   node tools/comparer-captures.ts [url] --lieu=x,z,y,yaw,pitch[;x,z,y,yaw,pitch…] [--nom=lieu] [--heure=HH:MM] [--q=…] [--taille=LxH] [--dossier=…] [--avant=…]
 *
 * Contre `npm run dev`, lancé à côté (le hook `__BABYLON__` n'existe qu'en DEV). Le visiteur
 * est posé par le plan lui-même (`surfaceAt` puis un `step` immobile pour la cote), importé dans la page.
 * L'adresse garde `&moteur=babylon` : ignoré aujourd'hui, requis avant la bascule (vague 7), ce qui
 * permet de photographier une ancienne version (worktree détaché) avec ce même script.
 * Sortie : `<dossier>/<vue>.png`. Avec `--avant=<dossier>` (un jeu antérieur), l'écart absolu moyen
 * par vue (0-255, tous canaux) s'affiche en fin de course, et `<dossier>/<vue>.avant-apres.png` les met côte à côte.
 * `--lieu` remplace les vues par une seule, `lieu` (ou `--nom`), à cette pose (celle d'un bug signalé par le bouton 🐞,
 * `tools/signalement.ts`) ; `--q` porte alors sa météo. Plusieurs poses séparées par `;` (un trajet) donnent
 * `<nom>-1` … `<nom>-n`, dans l'ordre.
 * ponytail : un outil d'œil, pas un test ; l'écart s'affiche, aucun seuil n'échoue.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

const args = process.argv.slice(2)
const option = (nom: string) => args.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1]
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/'
const dossier = option('dossier') ?? join(tmpdir(), 'comparaison')
mkdirSync(dossier, { recursive: true })

/** Un point de vue : yaw 0 regarde le nord (−z), π/2 l'ouest ; `y` est le plancher cherché. Sans `x`, l'arrivée de l'adresse. */
interface Vue {
  /** `q` : le reste de l'adresse (`meteo=pluie&saison=hiver`) ; sans lui, `meteo=clair`. */
  nom: string; heure: string; q?: string; x?: number; z?: number; y?: number; yaw?: number; pitch?: number; p?: string
  /** Bavette posée en (x, z), tournée vers `yaw`, l'action `anim` figée à 0,4 s (`__BAVETTE__`). */
  bavette?: { x: number; z: number; yaw: number; anim: string }
  /** L'interface (vague 5) : `chargement` capturé tôt, `accueil` sans reprendre, `visite` par le bouton du billet,
   * `reglages` par la roue, `partage` par la touche P devant une toile ; `vr` (vague 6) : le bouton Cardboard du billet
   * (avec `q: 'vr=cardboard'`), après la pose du visiteur, puisque le gréement prend sa place à l'entrée. */
  ui?: 'chargement' | 'accueil' | 'visite' | 'reglages' | 'partage' | 'vr'
  /** Une touche pressée une fois posé (`Enter` : la séance du cinéma), puis 8 s. */
  touche?: 'Enter'
  /** Téléphone : 390×844, tactile. */
  mobile?: boolean
}
const VUES: Vue[] = [
  { nom: 'arrivee', heure: '15:00', x: 24, z: 37, y: 0, yaw: 0, pitch: 0.05 },
  { nom: 'arrivee-nuit', heure: '22:00', x: 24, z: 37, y: 0, yaw: 0, pitch: 0.05 },
  { nom: 'escalier', heure: '15:00', x: 24, z: 27, y: 0, yaw: 0, pitch: 0.1 },
  { nom: 'honneur', heure: '15:00', x: 24, z: 10.5, y: 4.8, yaw: 0, pitch: 0.05 },
  { nom: 'galerie', heure: '15:00', p: 'AspireStrapi' },
  { nom: 'galerie-nuit', heure: '22:00', p: 'AspireStrapi' },
  { nom: 'salle', heure: '15:00', x: 13, z: 25.5, y: 0, yaw: 0.7, pitch: 0.05 },
  { nom: 'salle-nuit', heure: '22:00', x: 13, z: 25.5, y: 0, yaw: 0.7, pitch: 0.05 },
  { nom: 'facade', heure: '15:00', x: 24, z: 58, y: 0, yaw: 0, pitch: 0.15 },
  { nom: 'belvedere', heure: '15:00', x: 72, z: 80, y: 0, yaw: -0.74, pitch: 0.12 },
  { nom: 'batllo', heure: '15:00', x: 24, z: 14.5, y: 2.4, yaw: 0, pitch: 0.4 },
  // Vague 2 : l'intérieur.
  { nom: 'atelier', heure: '15:00', x: 24, z: 6.5, y: 0, yaw: 0, pitch: -0.3 },
  { nom: 'constellation', heure: '23:00', x: 24, z: 30, y: 0, yaw: 0, pitch: 0.55 },
  { nom: 'cloche', heure: '15:00', x: 24, z: 24, y: 0, yaw: 0, pitch: 0.5 },
  { nom: 'chantier', heure: '15:00', x: 7, z: 59.5, y: 0, yaw: 0, pitch: 0 },
  // Vague 3 : le jardin.
  { nom: 'jardin', heure: '15:00', x: 50, z: 65, y: 0, yaw: -0.6, pitch: -0.05 },
  { nom: 'jardin-couchant', heure: '20:30', x: 50, z: 65, y: 0, yaw: -0.6, pitch: -0.05 },
  { nom: 'jardin-facade', heure: '15:00', x: 44, z: 78, y: 0, yaw: 0.45, pitch: 0.12 },
  { nom: 'ruisseau', heure: '15:00', x: 72, z: 20, y: 0, yaw: -0.56, pitch: -0.25 },
  { nom: 'grands-arbres', heure: '15:00', x: 20, z: 66, y: 0, yaw: 1.6, pitch: 0.22 },
  // Vague 4 : le ciel, la météo et le rendu.
  { nom: 'jardin-pluie', heure: '15:00', q: 'meteo=pluie', x: 50, z: 65, y: 0, yaw: -0.6, pitch: -0.05 },
  { nom: 'jardin-neige', heure: '15:00', q: 'saison=hiver&meteo=neige', x: 50, z: 65, y: 0, yaw: -0.6, pitch: -0.05 },
  { nom: 'jardin-brouillard', heure: '15:00', q: 'meteo=brouillard', x: 50, z: 65, y: 0, yaw: -0.6, pitch: -0.05 },
  { nom: 'jardin-nuit', heure: '23:00', x: 50, z: 65, y: 0, yaw: -0.6, pitch: 0.1 },
  { nom: 'vers-facade', heure: '15:00', x: 30, z: 80, y: 0, yaw: 0, pitch: 0.1 },
  // Le ciel lui-même : vers l'est au lever, l'ouest au couchant, le zénith à midi, la nuit, le couvert.
  { nom: 'ciel-aube', heure: '08:30', x: 50, z: 65, y: 0, yaw: -1.57, pitch: 0.2 },
  { nom: 'ciel-midi', heure: '13:00', x: 50, z: 65, y: 0, yaw: 3.14, pitch: 0.5 },
  { nom: 'ciel-couchant', heure: '19:30', x: 50, z: 65, y: 0, yaw: 1.57, pitch: 0.2 },
  { nom: 'ciel-nuit', heure: '22:00', x: 50, z: 65, y: 0, yaw: 1.57, pitch: 0.3 },
  // Le sous-sol : la séance (l'iframe de HtmlMesh, vue par le trou alpha du post-traitement), ni ciel ni brume.
  { nom: 'cinema-seance', heure: '15:00', x: 9.5, z: 11, y: -4.8, yaw: 0, pitch: 0.1, touche: 'Enter' },
  { nom: 'ciel-couvert', heure: '15:00', q: 'meteo=orage', x: 50, z: 65, y: 0, yaw: 1.57, pitch: 0.2 },
  { nom: 'bavette', heure: '15:00', x: 30, z: 63, y: 0, yaw: 0, pitch: -0.35, bavette: { x: 30, z: 60.5, yaw: 1.2, anim: 'Marche' } },
  // Vague 5 : l'interface.
  { nom: 'ui-chargement', heure: '15:00', ui: 'chargement' },
  { nom: 'ui-accueil', heure: '15:00', ui: 'accueil' },
  { nom: 'ui-reglages', heure: '15:00', ui: 'reglages' },
  { nom: 'ui-oeuvre', heure: '15:00', p: 'AspireStrapi' },
  { nom: 'ui-minimap', heure: '15:00', x: 24, z: 37, y: 0, yaw: 0.3, pitch: 0.05 },
  { nom: 'ui-visite', heure: '15:00', ui: 'visite' },
  { nom: 'ui-mobile', heure: '15:00', mobile: true },
  { nom: 'ui-partage', heure: '15:00', p: 'AspireStrapi', ui: 'partage' },
  // Vague 6 : la réalité virtuelle (Cardboard du polyfill, forcé sur le bureau).
  { nom: 'vr-billet', heure: '15:00', q: 'meteo=clair&vr=cardboard', ui: 'accueil' },
  { nom: 'vr-nuit', heure: '22:00', q: 'meteo=clair&vr=cardboard', ui: 'vr', x: 24, z: 37, y: 0, yaw: 0, pitch: 0 },
  { nom: 'vr-hall', heure: '15:00', q: 'meteo=clair&vr=cardboard', ui: 'vr', x: 24, z: 37, y: 0, yaw: 0, pitch: 0 },
  { nom: 'vr-jardin', heure: '15:00', q: 'meteo=clair&vr=cardboard', ui: 'vr', x: 50, z: 65, y: 0, yaw: -0.6, pitch: 0 },
  { nom: 'vr-oeuvre', heure: '15:00', q: 'meteo=clair&vr=cardboard', ui: 'vr', p: 'AspireStrapi' },
]
const choisies = option('vues')?.split(',')
const lieux = option('lieu')?.split(';').map((p) => p.split(',').map(Number))
const nom = option('nom') ?? 'lieu'
/** `--taille=1586x1204` : le cadrage du visiteur (un autre rapport d'aspect montre un autre champ) ; sinon 1280×720. */
const [largeur, hauteur] = option('taille')?.split('x').map(Number) ?? [1280, 720]
/** `--q=ciel=photo` : ajouté à l'adresse de chaque vue. */
const enPlus = args.find((a) => a.startsWith('--q='))?.slice(4)
const avant = option('avant')
const vues: Vue[] = lieux
  ? lieux.map(([x, z, y, yaw, pitch], i) => ({ nom: lieux.length > 1 ? `${nom}-${i + 1}` : nom, heure: option('heure') ?? '15:00', q: enPlus ?? 'meteo=clair', x, z, y, yaw, pitch }))
  : VUES.filter((v) => !choisies || choisies.includes(v.nom))
const ecarts: Record<string, number | string>[] = []

const navigateur = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  // Une machine chargée (plusieurs navigateurs à la fois) : une capture peut prendre des minutes.
  protocolTimeout: 600_000,
  // ANGLE sur GL : Chromium sous Linux. Sur macOS, ce drapeau ôte WebGL ; son défaut (Metal) suffit.
  args: ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? [] : ['--use-angle=gl']), '--enable-unsafe-webgpu'],
})
try {
  for (const vue of vues) {
    const page = await navigateur.newPage()
    await page.setViewport(vue.mobile ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { width: largeur, height: hauteur, deviceScaleFactor: 1 })
    if (vue.mobile) await page.emulateMediaFeatures([{ name: 'pointer', value: 'coarse' }]).catch(() => {})
    page.on('pageerror', (e) => console.error(`  ! ${vue.nom} : ${e instanceof Error ? e.message : e}`))
    page.on('console', (m) => { if (m.type() === 'error') console.error(`  ! ${vue.nom} : ${m.text()}`) })
    const url = `${base}?qualite=haute&${vue.q ?? 'meteo=clair'}&heure=${vue.heure}${vue.p ? `&p=${vue.p}` : ''}&moteur=babylon${enPlus ? `&${enPlus}` : ''}`
    await page.goto(url, { waitUntil: 'load' })
    const chemin = join(dossier, `${vue.nom}.png`) as `${string}.png`
    if (vue.ui === 'chargement') {
      await new Promise((r) => setTimeout(r, 1500))
      await page.screenshot({ path: chemin })
      console.log(chemin)
      await page.close()
      await comparer(vue.nom, chemin)
      continue
    }
    await page.waitForFunction('window.__BABYLON__', { timeout: 600_000 })
    const enPause = vue.ui === 'accueil' || vue.ui === 'visite' || vue.ui === 'vr'
    if (!enPause) await page.evaluate('window.__BABYLON__.reprendre()')
    await page.waitForFunction('window.__PRET__ === true', { timeout: 600_000 })
    if (vue.x !== undefined) {
      const erreur = await page.evaluate(async (v, racine) => {
        /* eslint-disable @typescript-eslint/no-explicit-any -- modules et hooks de la page, non typés ici */
        const w = globalThis as any
        const { MUSEE } = await import(`${racine}src/plan/musee.ts`)
        const { flightElevation, surfaceAt } = await import(`${racine}src/plan/rules.ts`)
        const { step } = await import(`${racine}src/plan/walk.ts`)
        // Sur une volée (les poses du bouton 🐞 en viennent souvent) : celle sous le point, à sa hauteur.
        const [x, z, y] = [v.x, v.z, v.y] as number[]
        const volee = MUSEE.flights.find((f: any) => x >= f.x && x <= f.x + f.width && z >= f.z && z <= f.z + f.depth && Math.abs(flightElevation(f, x, z) - y) < 0.05)
        const surface = surfaceAt(MUSEE, v.x, v.z, v.y) ?? (volee && `volee:${volee.id}`)
        if (!surface) return `aucune surface en (${v.x}, ${v.z}, ${v.y})`
        const marcheur = step(MUSEE, { level: 0, surface, x: v.x, z: v.z, y: v.y, yaw: v.yaw }, { forward: 0, strafe: 0, yaw: v.yaw }, 0.01)
        w.__BABYLON__.camera.placer({ ...marcheur, pitch: v.pitch })
        return null
        /* eslint-enable @typescript-eslint/no-explicit-any */
      }, vue, new URL(base).pathname)
      if (erreur) console.error(`  ! ${vue.nom} : ${erreur}`)
    }
    // Quelques secondes avant le geste, comme l'ancienne référence (three refermait la session trop tôt) : mêmes images.
    if (vue.ui === 'vr') {
      await new Promise((r) => setTimeout(r, 3000))
      await page.click('::-p-text(Avec un Cardboard)')
    }
    // Le temps des GLB, des cartes et des toiles (non bloquants).
    await new Promise((r) => setTimeout(r, 12_000))
    if (vue.bavette) {
      await page.waitForFunction('window.__BAVETTE__', { timeout: 30_000 }).catch(() => console.error(`  ! ${vue.nom} : pas de __BAVETTE__`))
      await page.evaluate((b) => {
        const w = globalThis as unknown as { __BAVETTE__?: { placer(x: number, z: number, s?: string, yaw?: number): void; jouer(n: string, t?: number): void } }
        w.__BAVETTE__?.placer(b.x, b.z, undefined, b.yaw)
        w.__BAVETTE__?.jouer(b.anim, 0.4)
      }, vue.bavette)
      await new Promise((r) => setTimeout(r, 1500))
    }
    if (vue.touche) {
      await page.keyboard.press(vue.touche)
      await new Promise((r) => setTimeout(r, 8000))
    }
    if (vue.ui === 'visite') {
      await page.click('.billet-guide')
      await new Promise((r) => setTimeout(r, 6000))
    }
    if (vue.ui === 'reglages') {
      await page.click('[aria-label="Réglages"]')
      await new Promise((r) => setTimeout(r, 800))
    }
    if (vue.ui === 'partage') {
      await page.keyboard.press('KeyP')
      await new Promise((r) => setTimeout(r, 600))
    }
    await page.screenshot({ path: chemin })
    console.log(chemin)
    await page.close()
    await comparer(vue.nom, chemin)
  }
} finally {
  await navigateur.close()
}
if (ecarts.length) console.table(ecarts)

/** L'écart absolu moyen avec la même vue du jeu `--avant`, s'il y en a une. */
async function comparer(nom: string, chemin: string) {
  const reference = avant && join(avant, `${nom}.png`)
  if (!reference || !existsSync(reference)) return
  const [a, b] = await Promise.all([reference, chemin].map((f) => sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true })))
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return void ecarts.push({ vue: nom, écart: 'tailles différentes' })
  let somme = 0
  for (let i = 0; i < a.data.length; i++) somme += Math.abs(a.data[i] - b.data[i])
  ecarts.push({ vue: nom, écart: +(somme / a.data.length).toFixed(2) })
  const { width: l, height: h } = a.info
  await sharp({ create: { width: 2 * l, height: h, channels: 3, background: '#000' } })
    .composite([{ input: reference, left: 0, top: 0 }, { input: chemin, left: l, top: 0 }])
    .png().toFile(join(dossier, `${nom}.avant-apres.png`))
}
