// Capture une liste de points de vue comme un visiteur (Playwright + Chromium), avec les erreurs
// de la console, les appels de dessin et les triangles de chaque vue, et une planche contact.
//
//   node .claude/skills/world-review/scripts/revue.mjs --url=http://localhost:5173/ --vues=vues.json --sortie=dossier
//        [--largeur=1280] [--hauteur=720] [--params=heure=15:00&meteo=clair]
//
// Une vue : { nom, lieu: {level, surface, x, z, y, yaw, pitch}, url?: "heure=22:00",
//             apres?: [{touche:"Enter"} | {attendre:ms} | {eval:"expression"}], rafale?: [ms, …] }
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? '/home/phmatray/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs'
const { chromium } = await import(PLAYWRIGHT)
const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)))
if (!opt.url || !opt.vues || !opt.sortie) throw new Error('usage : --url=… --vues=vues.json --sortie=dossier')
const vues = JSON.parse(readFileSync(opt.vues, 'utf8'))
mkdirSync(opt.sortie, { recursive: true })
const base = opt.params ?? 'qualite=haute&meteo=clair&heure=15:00'

const navigateur = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/chromium',
  args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
})
const page = await navigateur.newPage({ viewport: { width: +(opt.largeur ?? 1280), height: +(opt.hauteur ?? 720) } })
let journal = []
page.on('pageerror', (e) => journal.push(`page : ${e.message}`))
// Le bruit des iframes tierces (le lecteur YouTube) n'est pas un défaut du musée.
const BRUIT = /Permissions policy violation|youtube|doubleclick|googlevideo/i
page.on('console', (m) => { if (!BRUIT.test(m.text()) && (m.type() === 'error' || /Unable to compile|SHADER ERROR|Offending/.test(m.text()))) journal.push(m.text().slice(0, Number(process.env.LONGUEUR_ERREUR ?? 300))) })

let urlCourante = null
const ouvrir = async (extra) => {
  const url = `${opt.url}?${[base, extra].filter(Boolean).join('&')}`
  if (url === urlCourante) return
  urlCourante = url
  await page.goto(url)
  await page.waitForFunction(() => window.__PRET__ === true, null, { timeout: 240000 })
  await page.evaluate(() => window.__BABYLON__.reprendre())
  await page.waitForTimeout(1500)
}

const rapport = []
const fichiers = []
for (const v of vues) {
  await ouvrir(v.url)
  // Les erreurs du chargement (une matière qui ne compile pas dès le départ) : un rapport à part.
  if (journal.length) rapport.push({ nom: '(chargement)', erreurs: [...new Set(journal)] })
  journal = []
  // Un état propre (pas de séance, pas assis, pas en pause), par les gestes du visiteur : forcer l'état
  // à la main laisse derrière lui ce que le geste aurait défait (le lecteur, la salle éteinte).
  const etat = () => page.evaluate(async () => {
    const { partie } = await import('/src/babylon/etat.ts')
    return partie.getState()
  }).catch(() => ({}))
  if ((await etat()).paused) await page.evaluate(() => window.__BABYLON__.reprendre())
  if ((await etat()).seance) await page.keyboard.press('Enter')
  if ((await etat()).assis) {
    await page.keyboard.down('ArrowUp')
    await page.waitForTimeout(150)
    await page.keyboard.up('ArrowUp')
  }
  await page.evaluate((a) => window.__BABYLON__.camera.placer(a), v.lieu)
  await page.waitForTimeout(v.attendre ?? 1800)
  for (const a of v.apres ?? []) {
    if (a.touche) await page.keyboard.press(a.touche)
    if (a.attendre) await page.waitForTimeout(a.attendre)
    if (a.eval) await page.evaluate(a.eval)
  }
  const delais = v.rafale ?? [0]
  let t = 0
  for (const d of delais) {
    await page.waitForTimeout(Math.max(0, d - t))
    t = d
    const f = join(opt.sortie, delais.length > 1 ? `${v.nom}@${d}ms.png` : `${v.nom}.png`)
    await page.screenshot({ path: f })
    fichiers.push(f)
  }
  const mesure = await page.evaluate(() => {
    const i = window.__BABYLON__.instr
    const s = window.__BABYLON__.scene
    return { appels: i?.drawCallsCounter?.current ?? null, triangles: s.getActiveIndices() / 3 }
  }).catch(() => ({}))
  rapport.push({ nom: v.nom, lieu: v.lieu, ...mesure, erreurs: [...new Set(journal)] })
  console.log(`${v.nom}${journal.length ? `  ⚠ ${new Set(journal).size} erreur(s)` : ''}`)
}
writeFileSync(join(opt.sortie, 'rapport.json'), `${JSON.stringify(rapport, null, 2)}\n`)
await navigateur.close()

try {
  execFileSync('montage', ['-label', '%t', ...fichiers, '-tile', '4x', '-geometry', '640x360+3+3', '-pointsize', '14', join(opt.sortie, 'planche.png')])
} catch {
  console.log('(pas de planche : ImageMagick « montage » absent)')
}
const enErreur = rapport.filter((r) => r.erreurs.length)
console.log(`${rapport.length} vues, ${fichiers.length} captures, ${enErreur.length} vue(s) avec erreurs → ${opt.sortie}`)
