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
interface Vue { nom: string; heure: string; x?: number; z?: number; y?: number; yaw?: number; pitch?: number; p?: string }
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
      await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 })
      page.on('pageerror', (e) => console.error(`  ! ${vue.nom}/${moteur} : ${e instanceof Error ? e.message : e}`))
      page.on('console', (m) => { if (m.type() === 'error') console.error(`  ! ${vue.nom}/${moteur} : ${m.text()}`) })
      const url = `${base}?qualite=haute&meteo=clair&heure=${vue.heure}${vue.p ? `&p=${vue.p}` : ''}${moteur === 'babylon' ? '&moteur=babylon' : ''}`
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForFunction('window.__PLAN__ || window.__BABYLON__', { timeout: 120_000 })
      await page.evaluate('window.__PLAN__?.reprendre()')
      await page.waitForFunction('window.__PLAN__ ? window.__PLAN__.gl.info.render.frame > 0 : window.__BABYLON__.scene.isReady()', { timeout: 120_000 })
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
      // Le temps des GLB, des cartes et des toiles (non bloquants des deux côtés).
      await new Promise((r) => setTimeout(r, 12_000))
      const chemin = join(dossier, `${vue.nom}-${moteur}.png`) as `${string}.png`
      await page.screenshot({ path: chemin })
      console.log(chemin)
      await page.close()
    }
  }
} finally {
  await navigateur.close()
}
