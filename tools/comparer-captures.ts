/**
 * Les captures comparées : three et Babylon au MÊME point de vue (position,
 * regard, heure), une paire d'images par vue, pour juger le portage à l'œil.
 *
 *   node tools/comparer-captures.ts [http://localhost:5173/] [--dossier=<dossier>] [--vues=arrivee,escalier]
 *
 * Contre `npm run dev`, lancé à côté (les hooks `__PLAN__` et `__BABYLON__` n'existent
 * qu'en DEV). Le visiteur est posé par le plan lui-même (`surfaceAt` puis un `step`
 * immobile pour la cote), importé dans la page : les deux moteurs reçoivent le même marcheur.
 * Sortie : `<dossier>/<vue>-three.png` et `<vue>-babylon.png`.
 * ponytail : un outil d'œil, pas un test ; aucune différence d'image n'est calculée.
 */
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

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
  /** Téléphone : 390×844, tactile. */
  mobile?: boolean
}
const VUES: Vue[] = [
  { nom: 'arrivee', heure: '15:00', x: 24, z: 37, y: 0, yaw: 0, pitch: 0.05 },
  { nom: 'arrivee-nuit', heure: '22:00', x: 24, z: 37, y: 0, yaw: 0, pitch: 0.05 },
  { nom: 'escalier', heure: '15:00', x: 24, z: 27, y: 0, yaw: 0, pitch: 0.1 },
  { nom: 'honneur', heure: '15:00', x: 24, z: 10.5, y: 4.8, yaw: 0, pitch: 0.05 },
  { nom: 'galerie', heure: '15:00', p: 'AspireStrapi' },
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

const navigateur = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--enable-unsafe-webgpu'],
})
try {
  for (const vue of VUES.filter((v) => !choisies || choisies.includes(v.nom))) {
    for (const moteur of ['three', 'babylon'] as const) {
      const page = await navigateur.newPage()
      await page.setViewport(vue.mobile ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { width: 1280, height: 720, deviceScaleFactor: 1 })
      if (vue.mobile) await page.emulateMediaFeatures([{ name: 'pointer', value: 'coarse' }]).catch(() => {})
      page.on('pageerror', (e) => console.error(`  ! ${vue.nom}/${moteur} : ${e instanceof Error ? e.message : e}`))
      page.on('console', (m) => { if (m.type() === 'error') console.error(`  ! ${vue.nom}/${moteur} : ${m.text()}`) })
      const url = `${base}?qualite=haute&${vue.q ?? 'meteo=clair'}&heure=${vue.heure}${vue.p ? `&p=${vue.p}` : ''}${moteur === 'babylon' ? '&moteur=babylon' : ''}`
      await page.goto(url, { waitUntil: 'load' })
      const chemin = join(dossier, `${vue.nom}-${moteur}.png`) as `${string}.png`
      if (vue.ui === 'chargement') {
        await new Promise((r) => setTimeout(r, 1500))
        await page.screenshot({ path: chemin })
        console.log(chemin)
        await page.close()
        continue
      }
      await page.waitForFunction('window.__PLAN__ || window.__BABYLON__', { timeout: 120_000 })
      const enPause = vue.ui === 'accueil' || vue.ui === 'visite' || vue.ui === 'vr'
      if (!enPause) await page.evaluate('(window.__PLAN__ ?? window.__BABYLON__)?.reprendre?.()')
      await page.waitForFunction('window.__PLAN__ ? window.__PLAN__.gl.info.render.frame > 0 : window.__PRET__ === true', { timeout: 120_000 })
      if (vue.x !== undefined) {
        const erreur = await page.evaluate(async (v, racine) => {
          /* eslint-disable @typescript-eslint/no-explicit-any -- modules et hooks de la page, non typés ici */
          const w = globalThis as any
          const { MUSEE } = await import(`${racine}src/plan/musee.ts`)
          const { surfaceAt } = await import(`${racine}src/plan/rules.ts`)
          const { step } = await import(`${racine}src/plan/walk.ts`)
          const surface = surfaceAt(MUSEE, v.x, v.z, v.y)
          if (!surface) return `aucune surface en (${v.x}, ${v.z}, ${v.y})`
          const marcheur = step(MUSEE, { level: 0, surface, x: v.x, z: v.z, y: v.y, yaw: v.yaw }, { forward: 0, strafe: 0, yaw: v.yaw }, 0.01)
          if (w.__BABYLON__) w.__BABYLON__.camera.placer({ ...marcheur, pitch: v.pitch })
          else {
            Object.assign(w.__PLAN__.walker(), marcheur)
            w.__PLAN__.camera.rotation.order = 'YXZ'
            w.__PLAN__.camera.rotation.set(v.pitch, v.yaw, 0)
          }
          return null
          /* eslint-enable @typescript-eslint/no-explicit-any */
        }, vue, new URL(base).pathname)
        if (erreur) console.error(`  ! ${vue.nom} : ${erreur}`)
      }
      // three referme la session tant que sa VRLayer n'est pas branchée : quelques secondes avant le geste.
      if (vue.ui === 'vr') {
        await new Promise((r) => setTimeout(r, 3000))
        await page.click('::-p-text(Avec un Cardboard)')
      }
      // Le temps des GLB, des cartes et des toiles (non bloquants des deux côtés).
      await new Promise((r) => setTimeout(r, 12_000))
      if (vue.bavette) {
        await page.waitForFunction('window.__BAVETTE__', { timeout: 30_000 }).catch(() => console.error(`  ! ${vue.nom}/${moteur} : pas de __BAVETTE__`))
        await page.evaluate((b) => {
          const w = globalThis as unknown as { __BAVETTE__?: { placer(x: number, z: number, s?: string, yaw?: number): void; jouer(n: string, t?: number): void } }
          w.__BAVETTE__?.placer(b.x, b.z, undefined, b.yaw)
          w.__BAVETTE__?.jouer(b.anim, 0.4)
        }, vue.bavette)
        await new Promise((r) => setTimeout(r, 1500))
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
    }
  }
} finally {
  await navigateur.close()
}
