// Charge le paquet de PRODUCTION (vite build + vite preview, ou le site publié) dans Chromium et
// dit s'il démarre : un canevas, le billet, aucune erreur. `npm run build` qui passe ne prouve pas
// que le paquet s'exécute (découpage en morceaux, ordre d'évaluation).
//
//   npm run build && npx vite preview --port 5190 &
//   node .claude/skills/world-review/scripts/production.mjs http://localhost:5190/
import { chromium } from '/home/phmatray/.local/share/mise/installs/npm-playwright/latest/node_modules/playwright/index.mjs'
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
const err = []
p.on('pageerror', (e) => err.push(e.message))
p.on('console', (m) => m.type() === 'error' && err.push(m.text().slice(0, 160)))
await p.goto('' + (process.argv[2] ?? 'https://phmatray.github.io/museum/') + '')
await p.waitForTimeout(25000)
const canevas = await p.evaluate(() => !!document.querySelector('canvas'))
const billet = await p.evaluate(() => !!document.querySelector('.billet'))
console.log('canvas', canevas, 'billet', billet)
await p.screenshot({ path: process.argv[3] ?? '/tmp/production.png' })
console.log('erreurs', err.length, err.slice(0, 5).join('\n'))
process.exitCode = err.length || !canevas || !billet ? 1 : 0
await b.close()
