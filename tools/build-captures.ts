/**
 * Les captures : montrer les projets au public, pas leurs noms.
 *
 *   node tools/build-captures.ts [--force]
 *
 * Pour chaque dépôt du catalogue, par ordre de préférence :
 *   1. `site`   — la page de son site (`Artwork.site`), photographiée à 1280×800 ;
 *   2. `readme` — la première vraie image de son README (badges et pictos écartés) ;
 *   3. `og`     — rien : la toile garde la carte OpenGraph de GitHub.
 *
 * Sorties : public/media/captures/<owner>__<name>.webp (1280×800 au plus)
 *           public/media/captures.json (clé → source, fichier, taille, pushedAt)
 *
 * À lancer AVANT `build-media.ts`, qui en fait les toiles. Cache : un dépôt dont
 * le `pushedAt` et le site n'ont pas bougé n'est pas repris (sauf un site qui
 * avait échoué, retenté à chaque build). Sans navigateur (pas de Chrome sur la
 * machine), on saute les sites et on garde les images de README : jamais d'échec.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { capturesFichier, imagesDuReadme, type EntreeCapture, type IndexCaptures } from '../src/domain/captures.ts'
import type { Artwork, Catalogue } from '../src/domain/types.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MEDIA = resolve(ROOT, 'public/media')
const INDEX = resolve(MEDIA, 'captures.json')
const W = 1280
const H = 800
const SITE_TIMEOUT_MS = 30_000
const HTTP_TIMEOUT_MS = 20_000
const MAX_OCTETS = 15 * 1024 * 1024
/** Au plus tant d'images essayées par README avant de renoncer. */
const ESSAIS_README = 5

// ── Le navigateur ────────────────────────────────────────────────────────

/** `CHROME_PATH`, sinon le Chromium de Playwright en local, sinon le Chrome du système (runner CI). */
function trouverChrome(): string | null {
  const candidats = [
    process.env.CHROME_PATH,
    resolve(homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
  for (const c of candidats) if (c && existsSync(c)) return c
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const chemin = execFileSync('which', [bin], { encoding: 'utf8' }).trim()
      if (chemin) return chemin
    } catch {
      /* suivant */
    }
  }
  return null
}

type Navigateur = import('puppeteer-core').Browser

async function lancer(): Promise<Navigateur | null> {
  const chrome = trouverChrome()
  if (!chrome) return null
  try {
    const puppeteer = await import('puppeteer-core')
    return await puppeteer.default.launch({
      executablePath: chrome,
      headless: true,
      // Les runners Ubuntu récents refusent le bac à sable de Chrome (AppArmor).
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    })
  } catch (e) {
    console.warn(`  ! Chrome introuvable ou non lançable (${e instanceof Error ? e.message : e}) : sites ignorés`)
    return null
  }
}

/** Une page presque unie (écran de chargement, page blanche) ne montre rien. */
async function estVide(png: Buffer): Promise<boolean> {
  const { channels } = await sharp(png).stats()
  return channels.slice(0, 3).every((c) => c.stdev < 6)
}

async function photographier(navigateur: Navigateur, url: string): Promise<Buffer | null> {
  const page = await navigateur.newPage()
  try {
    await page.setViewport({ width: W, height: H })
    const res = await page.goto(url, { waitUntil: 'load', timeout: SITE_TIMEOUT_MS })
    // Un site qui garde une connexion ouverte n'est jamais « au repos » : on
    // l'attend un temps, puis on photographie ce qu'il montre.
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 15_000 }).catch(() => {})
    // Un Pages désactivé, un paquet NuGet disparu : la page d'erreur n'est pas le
    // projet. Mais une SPA sur GitHub Pages se sert par son 404.html : le statut
    // seul ne suffit pas, il faut que la page le DISE.
    const texte = `${await page.title()} ${await page.$eval('body', (b) => (b as { innerText: string }).innerText.slice(0, 400)).catch(() => '')}`
    if (!res || (res.status() >= 400 && /404|not found|introuvable/i.test(texte))) return null
    // Une appli Blazor WebAssembly montre d'abord un écran de chargement uni :
    // on lui laisse jusqu'à ~11 s de plus avant de conclure à une page vide.
    for (let essai = 0; essai < 4; essai++) {
      await new Promise((r) => setTimeout(r, essai === 0 ? 2000 : 3000))
      // Le bandeau d'erreur de Blazor (« Une erreur est survenue. Recharger ») :
      // l'appli a planté, la photo montrerait « Chargement… » au mur.
      const plantee = await page.$eval('#blazor-error-ui', (e) => getComputedStyle(e).display !== 'none').catch(() => false)
      if (plantee) return null
      const png = Buffer.from(await page.screenshot({ type: 'png' }))
      if (!(await estVide(png))) return png
    }
    return null
  } catch {
    return null
  } finally {
    await page.close().catch(() => {})
  }
}

// ── Le README ────────────────────────────────────────────────────────────

async function telecharger(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'virtual-museum-captures' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_OCTETS) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > MAX_OCTETS ? null : buf
  } catch {
    return null
  }
}

async function readme(a: Artwork): Promise<string | null> {
  for (const nom of ['README.md', 'readme.md', 'Readme.md']) {
    const buf = await telecharger(`https://raw.githubusercontent.com/${a.owner}/${a.name}/HEAD/${nom}`)
    if (buf) return buf.toString('utf8')
  }
  return null
}

/** La première image du README qui se décode et fait au moins 200 px de large. GIF : sa première image. */
async function imageDuReadme(a: Artwork): Promise<Buffer | null> {
  const md = await readme(a)
  if (!md) return null
  for (const url of imagesDuReadme(md, a.owner, a.name).slice(0, ESSAIS_README)) {
    const buf = await telecharger(url)
    if (!buf) continue
    try {
      const { width = 0 } = await sharp(buf).metadata()
      if (width >= 200) return buf
    } catch {
      /* pas une image */
    }
  }
  return null
}

// ── Un dépôt ─────────────────────────────────────────────────────────────

async function enregistrer(buf: Buffer, fichier: string): Promise<{ width: number; height: number }> {
  const info = await sharp(buf, { pages: 1 })
    .resize(W, H, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(resolve(MEDIA, fichier))
  return { width: info.width, height: info.height }
}

async function capturer(a: Artwork, navigateur: Navigateur | null): Promise<EntreeCapture> {
  const site = a.site ?? null
  const base = { pushedAt: a.pushedAt, site }
  const file = capturesFichier(a.key)
  let siteFailed = false
  if (site && navigateur) {
    const png = await photographier(navigateur, site)
    if (png) return { ...base, source: 'site', file, ...(await enregistrer(png, file)) }
    siteFailed = true
  }
  const img = await imageDuReadme(a)
  if (img) {
    try {
      return { ...base, source: 'readme', file, ...(await enregistrer(img, file)), ...(siteFailed ? { siteFailed: true as const } : {}) }
    } catch {
      /* image illisible : carte OG */
    }
  }
  return { ...base, source: 'og', ...(siteFailed ? { siteFailed: true as const } : {}) }
}

async function pool<T>(items: T[], limite: number, travail: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) await travail(items[i++])
  }))
}

// ── Point d'entrée ───────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes('--force')
  const catalogue = JSON.parse(await readFile(resolve(ROOT, 'public/data/catalogue.json'), 'utf8')) as Catalogue
  let precedent: IndexCaptures = {}
  try {
    precedent = JSON.parse(await readFile(INDEX, 'utf8')) as IndexCaptures
  } catch {
    /* premier passage */
  }
  await mkdir(resolve(MEDIA, 'captures'), { recursive: true })

  const aFaire = catalogue.artworks.filter((a) => {
    const e = precedent[a.key]
    const aJour = e && e.pushedAt === a.pushedAt && e.site === (a.site ?? null) && !e.siteFailed
    return force || !aJour || (e.file !== undefined && !existsSync(resolve(MEDIA, e.file)))
  })
  const avecSite = aFaire.some((a) => a.site)
  const navigateur = avecSite ? await lancer() : null
  if (avecSite && !navigateur) console.warn('  ! Aucun Chrome : pas de capture de site ce soir, images de README seulement.')

  const index: IndexCaptures = {}
  for (const a of catalogue.artworks) if (precedent[a.key] && !aFaire.includes(a)) index[a.key] = precedent[a.key]
  let fait = 0
  try {
    await pool(aFaire, 4, async (a) => {
      index[a.key] = await capturer(a, navigateur)
      process.stdout.write(`\r  captures ${++fait}/${aFaire.length}`)
    })
  } finally {
    await navigateur?.close()
  }
  process.stdout.write('\n')

  // Sans navigateur, un dépôt à site n'a pas été VRAIMENT essayé : on ne gèle pas ce repli.
  if (!navigateur) for (const a of aFaire) if (a.site) index[a.key] = { ...index[a.key], siteFailed: true }

  const trie = Object.fromEntries(Object.entries(index).sort(([x], [y]) => x.localeCompare(y, 'en')))
  await writeFile(INDEX, JSON.stringify(trie, null, 2) + '\n')

  const garder = new Set(Object.values(trie).flatMap((e) => (e.file ? [e.file.split('/').pop()!] : [])))
  for (const nom of await readdir(resolve(MEDIA, 'captures'))) if (!garder.has(nom)) await rm(resolve(MEDIA, 'captures', nom))

  const compte = (s: EntreeCapture['source']) => Object.values(trie).filter((e) => e.source === s).length
  const rates = Object.entries(trie).filter(([, e]) => e.siteFailed).map(([k, e]) => `${k} (${e.site})`)
  console.log(
    `${Object.keys(trie).length} dépôts — ${aFaire.length} (re)capturés\n` +
      `  site   : ${compte('site')}\n  readme : ${compte('readme')}\n  og     : ${compte('og')}` +
      (rates.length ? `\n  sites non photographiés (retentés au prochain build) :\n    ${rates.join('\n    ')}` : ''),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // Les captures sont un bonus : leur échec ne doit jamais bloquer une publication.
    console.error(`\nCaptures en échec : ${e instanceof Error ? e.message : String(e)}`)
  })
}
