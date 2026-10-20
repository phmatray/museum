/**
 * La mesure de rendu : le musée à un point de vue fixe (l'arrivée), heure et fenêtre
 * fixes, pour suivre le temps par image, les appels et les triangles. Budget à
 * l'arrivée : ≤ 300 appels et ≤ 1,5 M triangles.
 *
 *   node tools/mesurer-rendu.ts [http://localhost:5173/] [--ombres=0] [--gpu=0] [--p=<dépôt>] [--lieu=x,z,yaw] [--vr=1] [--captures=<dossier>]
 *
 * `--vr=1` : dans le Cardboard du polyfill (`?vr=cardboard`, bouton du billet), les deux yeux comptés ensemble.
 *
 * `--lieu=50,65,-0.6` : le visiteur posé au sol en (x, z), tourné vers `yaw` (0 = nord),
 * (au milieu du jardin, par exemple), comme comparer-captures.ts.
 *
 * Contre `npm run dev`, lancé à côté : le hook `__BABYLON__` n'existe qu'en DEV. L'adresse
 * garde `&moteur=babylon` (ignoré aujourd'hui, requis avant la bascule) pour mesurer une
 * ancienne version avec ce même script. Sortie : un tableau console, un JSON sur stdout
 * et `capture.png` pour le contrôle visuel.
 * ponytail : une mesure, pas un test ; aucun seuil n'échoue. Garde CI quand on la voudra bloquante.
 */
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const option = (nom: string) => args.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1]
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/'
const captures = option('captures') ?? tmpdir()
mkdirSync(captures, { recursive: true })
// `--p=<dépôt>` : devant cette toile plutôt qu'à l'arrivée (pour juger les tableaux sur la capture).
const suffixe = (option('ombres') === '0' ? '&ombres=0' : '') + (option('gpu') === '0' ? '&gpu=0' : '') + (option('p') ? `&p=${option('p')}` : '') + (option('vr') === '1' ? '&vr=cardboard' : '')
const commun = `?qualite=haute&heure=15:00&meteo=clair${suffixe}`
const IMAGES = 300
const lieu = option('lieu')?.split(',').map(Number)

interface Image { dt: number; appels: number; triangles: number }

const navigateur = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  // Sans les deux derniers, rAF est plafonné à 16,7 ms et l'on ne mesure que la vsync.
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
})
const lignes: Record<string, string | number>[] = []
try {
  const page = await navigateur.newPage()
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error(`  ! mesure : ${e instanceof Error ? e.message : e}`))
  await page.goto(base + commun + '&moteur=babylon', { waitUntil: 'load' })
  await page.waitForFunction('window.__BABYLON__', { timeout: 120_000 })
  // Le musée ouvre en pause derrière le billet : on reprend la visite sans clic.
  // En VR, le billet reste : c'est son bouton qui ouvre la session.
  if (option('vr') !== '1') await page.evaluate('window.__BABYLON__.reprendre()')
  // On attend que la scène soit prête, puis 3 s de chauffe.
  await page.waitForFunction('window.__PRET__ === true', { timeout: 120_000 })
  if (lieu) {
    await page.evaluate(async ([x, z, yaw], racine) => {
      /* eslint-disable @typescript-eslint/no-explicit-any -- modules et hooks de la page, non typés ici */
      const w = globalThis as any
      const { MUSEE } = await import(`${racine}src/plan/musee.ts`)
      const { surfaceAt } = await import(`${racine}src/plan/rules.ts`)
      const { step } = await import(`${racine}src/plan/walk.ts`)
      const marcheur = step(MUSEE, { level: 0, surface: surfaceAt(MUSEE, x, z, 0), x, z, y: 0, yaw }, { forward: 0, strafe: 0, yaw }, 0.01)
      w.__BABYLON__.camera.placer({ ...marcheur, pitch: 0 })
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }, lieu, new URL(base).pathname)
    // Le temps des GLB du jardin et d'une carte d'ombre recalée.
    await new Promise((r) => setTimeout(r, 12_000))
  }
  await new Promise((r) => setTimeout(r, 3000))
  if (option('vr') === '1') {
    await page.click('::-p-text(Avec un Cardboard)')
    await new Promise((r) => setTimeout(r, 6000))
  }

  const { images, gpu } = await page.evaluate((n) => new Promise<{ images: Image[]; gpu: string }>((fin) => {
    // Les outils n'ont pas la lib DOM : `globalThis` est la fenêtre de la page.
    /* eslint-disable @typescript-eslint/no-explicit-any -- les hooks de debug ne sont pas typés */
    const w = globalThis as any
    const images: Image[] = []
    let avant = performance.now()
    const { engine, scene, instr } = w.__BABYLON__
    const gpu = engine.isWebGPU ? 'webgpu' : 'webgl2'
    // Lu juste après le rendu : l'instrumentation remet le compteur à zéro à chaque image.
    let dernier = { appels: 0, triangles: 0 }
    scene.onAfterRenderObservable.add(() => { dernier = { appels: instr.drawCallsCounter.current, triangles: scene.getActiveIndices() / 3 } })
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const boucle = () => {
      const t = performance.now()
      images.push({ dt: t - avant, ...dernier })
      avant = t
      if (images.length < n + 1) w.requestAnimationFrame(boucle)
      else fin({ images: images.slice(1), gpu })
    }
    w.requestAnimationFrame(boucle)
  }), IMAGES)

  const tri = (f: (i: Image) => number) => images.map(f).sort((a, b) => a - b)
  const quantile = (v: number[], q: number) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
  const dts = tri((i) => i.dt)
  lignes.push({
    gpu,
    'ms médian': +quantile(dts, 0.5).toFixed(1),
    'ms p95': +quantile(dts, 0.95).toFixed(1),
    appels: quantile(tri((i) => i.appels), 0.5),
    triangles: Math.round(quantile(tri((i) => i.triangles), 0.5)),
  })
  await page.screenshot({ path: join(captures, 'capture.png') as `${string}.png` })
  await page.close()
} finally {
  await navigateur.close()
}
console.table(lignes)
console.log(JSON.stringify(lignes))
