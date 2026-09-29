/**
 * Les pages de partage : `dist/p/<nom>/index.html`, une par projet exposé.
 *
 *   node tools/pages-partage.ts        (à la fin de `npm run build`)
 *
 * Un site statique n'a qu'un jeu de balises OpenGraph ; un lien `?p=FormCraft`
 * partagé sur un réseau montrerait donc l'aperçu général du musée. Chaque page
 * porte le sien — le nom du projet, sa description, sa capture (`captures.json`),
 * à défaut la carte de GitHub — et renvoie aussitôt au musée, devant la toile (`src/domain/lien.ts`).
 * L'adresse absolue du site vient de l'`og:url` de `index.html`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import config from '../museum.config.json' with { type: 'json' }
import type { IndexCaptures } from '../src/domain/captures.ts'
import { aSaPage, identifiant } from '../src/domain/lien.ts'
import type { Catalogue } from '../src/domain/types.ts'
import type { Accrochage } from '../src/plan/hang.ts'
import { choisirVitrines } from '../src/plan/vitrines.ts'

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const lire = <T>(chemin: string): T => JSON.parse(readFileSync(resolve(DIST, chemin), 'utf8')) as T

const base = /property="og:url" content="([^"]+)"/.exec(readFileSync(resolve(DIST, 'index.html'), 'utf8'))?.[1]
if (!base) throw new Error('index.html sans og:url : pas d’adresse absolue pour les aperçus')
const catalogue = lire<Catalogue>('data/catalogue.json')
const accrochage = lire<Accrochage>('data/accrochage.json')
// Sans captures (build local sans `npm run captures`), l'image générale du musée.
const captures: IndexCaptures = existsSync(resolve(DIST, 'media/captures.json')) ? lire('media/captures.json') : {}

const cles = catalogue.artworks.map((a) => a.key)
const exposees = new Set([...accrochage.rooms.flatMap((r) => r.placements.map((p) => p.key)), ...choisirVitrines(catalogue.artworks, catalogue.owners).map((a) => a.key)])
const html = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

let n = 0
for (const a of catalogue.artworks) {
  const id = identifiant(a.key, cles)
  if (!exposees.has(a.key) || !aSaPage(id)) continue
  const titre = html(`${a.name} — ${config.name}`)
  const texte = html((a.description || `Un projet de ${a.owner}, exposé au ${config.name}.`).replace(/\s+/g, ' ').trim())
  const cap = captures[a.key]
  // Sans capture, la carte OpenGraph de GitHub : elle au moins nomme le projet.
  const [image, l, h] = cap?.file ? [`${base}media/${cap.file}`, cap.width, cap.height] : [`https://opengraph.githubassets.com/1/${a.key}`, 1200, 600]
  const vers = `../../?p=${encodeURIComponent(id)}`
  const page = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>${titre}</title>
    <meta name="description" content="${texte}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${html(config.name)}" />
    <meta property="og:title" content="${titre}" />
    <meta property="og:description" content="${texte}" />
    <meta property="og:url" content="${base}p/${encodeURIComponent(id)}/" />
    <meta property="og:image" content="${image}" />${l && h ? `\n    <meta property="og:image:width" content="${l}" />\n    <meta property="og:image:height" content="${h}" />` : ''}
    <meta property="og:image:alt" content="${html(`Aperçu de ${a.name}`)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${titre}" />
    <meta name="twitter:description" content="${texte}" />
    <meta name="twitter:image" content="${image}" />
    <link rel="icon" href="../../favicon.svg" type="image/svg+xml" />
    <meta http-equiv="refresh" content="0; url=${vers}" />
    <script>location.replace(${JSON.stringify(vers)} + location.hash)</script>
  </head>
  <body style="background:#1c2530;color:#f5eedc;font:16px Georgia,serif;text-align:center;padding-top:30vh">
    <a href="${vers}" style="color:#d1a54a">${html(a.name)} — ${html(config.name)}</a>
  </body>
</html>
`
  await mkdir(resolve(DIST, 'p', id), { recursive: true })
  await writeFile(resolve(DIST, 'p', id, 'index.html'), page)
  n++
}
console.log(`pages de partage : ${n} projets sous dist/p/`)
