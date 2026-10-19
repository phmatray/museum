/**
 * La mesure de rendu : three et Babylon au même point de vue (l'arrivée), même
 * heure, même fenêtre, pour comparer le temps par image, les appels et les triangles.
 *
 *   node tools/mesurer-rendu.ts [http://localhost:5173/] [--ombres=0] [--gpu=0] [--p=<dépôt>] [--captures=<dossier>]
 *
 * Contre `npm run dev`, lancé à côté : les hooks `__PLAN__` et `__BABYLON__` n'existent
 * qu'en DEV. Sortie : un tableau console, un JSON sur stdout et une capture par
 * moteur (`capture-three.png`, `capture-babylon.png`) pour le contrôle visuel.
 * ponytail : une mesure, pas un test ; aucun seuil n'échoue. Garde CI si la tranche devient la v2.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const option = (nom: string) => args.find((a) => a.startsWith(`--${nom}=`))?.split('=')[1]
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/'
const captures = option('captures') ?? tmpdir()
// `--p=<dépôt>` : devant cette toile plutôt qu'à l'arrivée (pour juger les tableaux sur la capture).
const suffixe = (option('ombres') === '0' ? '&ombres=0' : '') + (option('gpu') === '0' ? '&gpu=0' : '') + (option('p') ? `&p=${option('p')}` : '')
const commun = `?qualite=haute&heure=15:00&meteo=clair${suffixe}`
const IMAGES = 300

interface Image { dt: number; appels: number; triangles: number }

const navigateur = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  headless: true,
  // Sans les deux derniers, rAF est plafonné à 16,7 ms et l'on ne mesure que la vsync.
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
})
const lignes: Record<string, string | number>[] = []
try {
  for (const moteur of ['three', 'babylon'] as const) {
    const page = await navigateur.newPage()
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 })
    page.on('pageerror', (e) => console.error(`  ! ${moteur} : ${e instanceof Error ? e.message : e}`))
    await page.goto(base + commun + (moteur === 'babylon' ? '&moteur=babylon' : ''), { waitUntil: 'load' })
    await page.waitForFunction('window.__PLAN__ || window.__BABYLON__', { timeout: 120_000 })
    // three ouvre en pause derrière l'écran de chargement : on reprend la visite sans clic.
    await page.evaluate('window.__PLAN__?.reprendre()')
    // Le hook arrive avant la première image de three (une dizaine de secondes de compilation) :
    // on attend qu'il dessine vraiment, ou que la scène Babylon soit prête, puis 3 s de chauffe.
    await page.waitForFunction('window.__PLAN__ ? window.__PLAN__.gl.info.render.frame > 0 : window.__BABYLON__.scene.isReady()', { timeout: 120_000 })
    await new Promise((r) => setTimeout(r, 3000))

    const { images, gpu } = await page.evaluate((n) => new Promise<{ images: Image[]; gpu: string }>((fin) => {
      // Les outils n'ont pas la lib DOM : `globalThis` est la fenêtre de la page.
      /* eslint-disable @typescript-eslint/no-explicit-any -- les hooks de debug ne sont pas typés */
      const w = globalThis as any
      const images: Image[] = []
      let avant = performance.now()
      let lire: () => { appels: number; triangles: number }
      let gpu = 'webgl2'
      if (w.__BABYLON__) {
        const { engine, scene, instr } = w.__BABYLON__
        gpu = engine.isWebGPU ? 'webgpu' : 'webgl2'
        // Lu juste après le rendu : l'instrumentation remet le compteur à zéro à chaque image.
        let dernier = { appels: 0, triangles: 0 }
        scene.onAfterRenderObservable.add(() => { dernier = { appels: instr.drawCallsCounter.current, triangles: scene.getActiveIndices() / 3 } })
        lire = () => dernier
      } else {
        // Toutes les passes du composeur d'une image : pas de remise à zéro automatique.
        const info = w.__PLAN__.gl.info
        info.autoReset = false
        info.reset()
        lire = () => { const r = { appels: info.render.calls, triangles: info.render.triangles }; info.reset(); return r }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
      const boucle = () => {
        const t = performance.now()
        images.push({ dt: t - avant, ...lire() })
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
      moteur, gpu,
      'ms médian': +quantile(dts, 0.5).toFixed(1),
      'ms p95': +quantile(dts, 0.95).toFixed(1),
      appels: quantile(tri((i) => i.appels), 0.5),
      triangles: Math.round(quantile(tri((i) => i.triangles), 0.5)),
    })
    await page.screenshot({ path: join(captures, `capture-${moteur}.png`) as `${string}.png` })
    await page.close()
  }
} finally {
  await navigateur.close()
}
console.table(lignes)
console.log(JSON.stringify(lignes))
