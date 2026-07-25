/**
 * LOT 3 — Pipeline média : une toile pour chaque dépôt, en deux niveaux de détail.
 *
 *   node tools/build-media.ts [--force]
 *
 * Entrées  : public/data/catalogue.json, curation.json (facultatif),
 *            museum.config.json
 * Sorties  : public/media/near/<owner>__<name>.webp   (LOD proche, 1024×512)
 *            public/media/atlas-<n>.webp              (LOD lointain, 16×16 tuiles)
 *            public/media/atlas.json                  (AtlasIndex, seule sortie commitée)
 *
 * Trois invariants gouvernent ce fichier :
 *
 * 1. AUCUN dépôt ne reste sans visuel. Un 404, une coupure réseau ou un fichier
 *    curé introuvable produisent une toile de repli, jamais un trou : un trou
 *    dans l'atlas se verrait accroché au mur.
 * 2. ORDRE DÉTERMINISTE. Les couches sont attribuées par ordre alphabétique de
 *    clé. Un ordre instable renuméroterait les couches à chaque build et
 *    invaliderait tout le cache aval (museum.json porte les index de couche).
 * 3. CACHE PAR EMPREINTE. Une deuxième exécution sans changement de catalogue
 *    ne retélécharge rien et ne recompose aucun atlas.
 *
 * Le retournement vertical des tuiles n'est PAS fait ici : il appartient au
 * chargement navigateur (cf. spike/array-texture.ts), qui doit retourner les
 * lignes parce que DataArrayTexture ignore UNPACK_FLIP_Y_WEBGL. On écrit donc
 * les tuiles dans l'ordre naturel de lecture.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { Artwork, AtlasIndex, Catalogue, Curation, MuseumConfig, RepoKey } from '../src/domain/types.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MEDIA = resolve(ROOT, 'public/media')
const NEAR_DIR = resolve(MEDIA, 'near')
/** Tuiles unitaires conservées entre deux builds : composer un atlas ne doit
 *  pas obliger à retélécharger les 255 dépôts qui n'ont pas bougé. */
const TILES_DIR = resolve(MEDIA, '.tiles')
const CACHE_FILE = resolve(MEDIA, '.cache.json')

// ── Paramètres du pipeline ───────────────────────────────────────────────

const TILE_W = 256
const TILE_H = 128
const COLS = 16
const ROWS = 16
const PER_ATLAS = COLS * ROWS

const NEAR_W = 1024
const NEAR_H = 512
const NEAR_QUALITY = 78
const ATLAS_QUALITY = 80

const CONCURRENCY = 8
const HTTP_TIMEOUT_MS = 20_000
const HTTP_ATTEMPTS = 3
/** Au-delà, on n'attend pas la réinitialisation du quota : on replie et on rend
 *  la main. Un build ne peut pas dormir un quart d'heure. */
const MAX_THROTTLE_WAIT_S = 30

/** Toute modification de ces paramètres doit invalider le cache : elle change
 *  les pixels produits sans changer une ligne du catalogue. */
const PIPELINE_SIG = `v1:${NEAR_W}x${NEAR_H}q${NEAR_QUALITY}:${TILE_W}x${TILE_H}:${COLS}x${ROWS}q${ATLAS_QUALITY}`

// ── Cache sur disque ─────────────────────────────────────────────────────

type Source = 'og' | 'custom' | 'fallback'

interface CacheFile {
  schemaVersion: 1
  pipeline: string
  /**
   * clé → empreinte des entrées, provenance du visuel, et `retry` quand le
   * repli vient d'un incident réseau. Un repli provisoire NE DOIT PAS être
   * gelé dans le cache : sans ce drapeau, un dépôt replié pendant une coupure
   * garderait son aplat jusqu'au prochain changement de son catalogue.
   */
  entries: Record<RepoKey, { fp: string; source: Source; retry?: true }>
  /** index d'atlas → signature de la liste ordonnée de ses tuiles */
  atlases: Record<string, string>
}

const EMPTY_CACHE: CacheFile = { schemaVersion: 1, pipeline: PIPELINE_SIG, entries: {}, atlases: {} }

// ── Utilitaires ──────────────────────────────────────────────────────────

const sha1 = (s: string | Buffer) => createHash('sha1').update(s).digest('hex')

/**
 * Ordre des clés — et donc des couches. La locale est ÉPINGLÉE : un
 * `localeCompare` sans argument suit la locale du système, ce qui donnerait un
 * atlas différent en CI et en local, et des index de couche décalés entre le
 * museum.json dérivé ici et l'atlas produit là-bas.
 */
const byKey = (a: RepoKey, b: RepoKey) => a.localeCompare(b, 'en')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

/**
 * `owner/name` → `owner__name`. Les caractères hors [A-Za-z0-9._-] sont
 * remplacés : GitHub les autorise dans un nom de dépôt, pas tous les systèmes
 * de fichiers ni toutes les URL.
 */
function slugify(key: RepoKey): string {
  return key.replace('/', '__').replace(/[^A-Za-z0-9._-]/g, '-')
}

/**
 * Pool à concurrence bornée. Les résultats sont rangés par index, donc l'ordre
 * de sortie ne dépend pas de l'ordre d'achèvement — condition du déterminisme.
 */
async function pool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return out
}

// ── Toile de repli ───────────────────────────────────────────────────────

/**
 * Couleurs officielles GitHub pour les langages du corpus. Un langage inconnu
 * reçoit une teinte dérivée de son nom par hachage : arbitraire mais stable,
 * et deux langages différents ne se confondent pas.
 */
const LANGUAGE_COLOURS: Record<string, string> = {
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  CSS: '#563d7c',
  Dart: '#00B4AB',
  Dockerfile: '#384d54',
  Go: '#00ADD8',
  HTML: '#e34c26',
  Java: '#b07219',
  JavaScript: '#f1e05a',
  Kotlin: '#A97BFF',
  Lua: '#000080',
  MQL5: '#4A76B8',
  PHP: '#4F5D95',
  PowerShell: '#012456',
  Python: '#3572A5',
  Ruby: '#701516',
  Rust: '#dea584',
  SCSS: '#c6538c',
  Shell: '#89e051',
  Svelte: '#ff3e00',
  Swift: '#F05138',
  TypeScript: '#3178c6',
  Vue: '#41b883',
}

export function languageColour(language: string | null): string {
  if (language && LANGUAGE_COLOURS[language]) return LANGUAGE_COLOURS[language]
  const hue = parseInt(sha1(language ?? 'sans langage').slice(0, 4), 16) % 360
  return hslToHex(hue, 0.42, 0.34)
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const sector = Math.floor(h / 60) % 6
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`
}

/** Luminance perçue, pour choisir un texte clair ou sombre sur l'aplat. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Découpe gloutonne en lignes d'au plus `max` caractères, 3 lignes maximum. */
function wrap(text: string, max: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= max) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word.length > max ? `${word.slice(0, max - 1)}…` : word
    if (lines.length === maxLines) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines.length ? lines : ['—']
}

/**
 * Repli : aplat de la couleur du langage + nom du dépôt. Volontairement sobre —
 * son rôle est de ne pas laisser un mur vide, pas de rivaliser avec une OG image.
 */
export function fallbackSvg(art: Artwork, title: string): string {
  const base = languageColour(art.language)
  const ink = isLight(base) ? '#101014' : '#ffffff'
  const lines = wrap(title, 22, 3)
  const fontSize = lines.length > 2 ? 92 : 116
  const blockTop = 300 - ((lines.length - 1) * fontSize * 1.15) / 2
  const texts = lines
    .map(
      (l, i) =>
        `<text x="600" y="${blockTop + i * fontSize * 1.15}" font-family="sans-serif" font-size="${fontSize}" font-weight="700" fill="${ink}" text-anchor="middle" dominant-baseline="middle">${escapeXml(l)}</text>`
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
  <rect width="1200" height="600" fill="${base}"/>
  <rect x="0" y="0" width="1200" height="600" fill="${ink}" opacity="0.07"/>
  <rect x="40" y="40" width="1120" height="520" fill="none" stroke="${ink}" stroke-opacity="0.28" stroke-width="4"/>
  ${texts}
  <text x="600" y="512" font-family="sans-serif" font-size="40" fill="${ink}" fill-opacity="0.72" text-anchor="middle" dominant-baseline="middle">${escapeXml(art.owner)}${art.language ? ` · ${escapeXml(art.language)}` : ''}</text>
</svg>`
}

// ── Acquisition de la source ─────────────────────────────────────────────

function ogUrl(key: RepoKey, owner: string, name: string): string {
  // Le hash est arbitraire côté GitHub : n'importe quelle valeur stable fait
  // l'affaire. On dérive celle de la clé pour que l'URL soit reproductible.
  return `https://opengraph.githubassets.com/${sha1(key)}/${owner}/${name}`
}

/** `transient` distingue « ce dépôt n'a pas d'image » de « le réseau a lâché ». */
interface Fetched {
  buffer: Buffer | null
  transient: boolean
}

/**
 * Le service OG plafonne à 100 rendus par fenêtre puis répond 429 avec un
 * `retry-after` de plusieurs minutes. Une fois le mur atteint, insister ne sert
 * qu'à allonger le build : on bascule tout le reste du lot en repli provisoire,
 * que la prochaine exécution retentera grâce au drapeau `retry` du cache.
 */
const quota = { exhausted: false, retryAfterSec: 0 }

async function download(url: string): Promise<Fetched> {
  if (quota.exhausted) return { buffer: null, transient: true }

  for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'virtual-museum-build-media' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after') ?? 0)
        if (wait > 0 && wait <= MAX_THROTTLE_WAIT_S && attempt < HTTP_ATTEMPTS) {
          await sleep(wait * 1000)
          continue
        }
        quota.exhausted = true
        quota.retryAfterSec = wait
        return { buffer: null, transient: true }
      }
      // 404 et consorts sont définitifs : ce dépôt n'aura jamais d'OG image.
      if (res.status >= 400 && res.status < 500) return { buffer: null, transient: false }
      if (!res.ok) {
        if (attempt === HTTP_ATTEMPTS) return { buffer: null, transient: true }
        await sleep(500 * attempt)
        continue
      }
      return { buffer: Buffer.from(await res.arrayBuffer()), transient: false }
    } catch {
      if (attempt === HTTP_ATTEMPTS) return { buffer: null, transient: true }
      await sleep(500 * attempt)
    }
  }
  return { buffer: null, transient: true }
}

/**
 * Un chemin de curation est décrit comme relatif à `public/custom/`, mais un
 * humain écrira aussi bien `public/custom/x.png` ou un chemin depuis la racine.
 * On accepte les trois plutôt que d'échouer sur une convention.
 */
function customCandidates(image: string): string[] {
  return [resolve(ROOT, 'public/custom', image), resolve(ROOT, image), resolve(ROOT, 'public', image)]
}

async function readCustom(image: string): Promise<Buffer | null> {
  for (const path of customCandidates(image)) {
    try {
      return await readFile(path)
    } catch {
      /* candidat suivant */
    }
  }
  return null
}

// ── Traitement d'un dépôt ────────────────────────────────────────────────

interface Job {
  art: Artwork
  slug: string
  title: string
  image: string | undefined
  /** Empreinte des entrées : tout ce qui change les pixels produits. */
  fp: string
  nearPath: string
  tilePath: string
}

interface Outcome {
  key: RepoKey
  fp: string
  source: Source
  cached: boolean
  /** Repli dû à un incident réseau : à retenter au prochain lancement. */
  retry: boolean
  /** Échec du visuel demandé, signalé en fin d'exécution. */
  warning?: string
}

async function buildJob(art: Artwork, curation: Curation): Promise<Job> {
  const override = curation.repos[art.key] ?? {}
  const title = override.title ?? art.title
  const image = override.image
  // L'empreinte du fichier curé passe par son contenu, pas par sa date : le
  // cache reste valable après un git clone, qui réécrit toutes les mtimes.
  let customFp = ''
  if (image) {
    const buf = await readCustom(image)
    customFp = buf ? sha1(buf) : 'introuvable'
  }
  const fp = sha1(
    JSON.stringify([
      PIPELINE_SIG,
      art.key,
      art.owner,
      art.name,
      title,
      art.description,
      art.language,
      art.stars,
      image ?? null,
      customFp,
    ])
  )
  return {
    art,
    slug: slugify(art.key),
    title,
    image,
    fp,
    nearPath: resolve(NEAR_DIR, `${slugify(art.key)}.webp`),
    tilePath: resolve(TILES_DIR, `${slugify(art.key)}.png`),
  }
}

async function processJob(job: Job, cache: CacheFile, force: boolean): Promise<Outcome> {
  const previous = cache.entries[job.art.key]
  if (
    !force &&
    previous &&
    previous.fp === job.fp &&
    !previous.retry &&
    (await exists(job.nearPath)) &&
    (await exists(job.tilePath))
  ) {
    return { key: job.art.key, fp: job.fp, source: previous.source, cached: true, retry: false }
  }

  let buffer: Buffer | null = null
  let source: Source = 'fallback'
  let retry = false
  let warning: string | undefined

  if (job.image) {
    buffer = await readCustom(job.image)
    if (buffer) source = 'custom'
    else warning = `${job.art.key} : image curée introuvable (${job.image}), repli généré`
  } else {
    const fetched = await download(ogUrl(job.art.key, job.art.owner, job.art.name))
    buffer = fetched.buffer
    if (buffer) source = 'og'
    else {
      retry = fetched.transient
      warning = fetched.transient
        ? `${job.art.key} : OG image inaccessible (quota ou réseau), repli PROVISOIRE`
        : `${job.art.key} : pas d'OG image (404), repli définitif`
    }
  }

  if (!buffer) buffer = Buffer.from(fallbackSvg(job.art, job.title))

  // Une source corrompue (page d'erreur servie en 200, PNG tronqué) ne se
  // détecte qu'au décodage. On la rattrape sur l'écriture elle-même, et pas sur
  // un contrôle préalable : seule l'écriture prouve que le visuel existe, et
  // l'invariant « aucun dépôt sans toile » ne tolère pas d'exception qui remonte.
  try {
    await writeOutputs(buffer, job)
  } catch {
    source = 'fallback'
    retry = false
    warning = `${job.art.key} : source illisible, repli généré`
    await writeOutputs(Buffer.from(fallbackSvg(job.art, job.title)), job)
  }

  return { key: job.art.key, fp: job.fp, source, cached: false, retry, warning }
}

/** Les deux LOD, écrits depuis la même source. */
async function writeOutputs(buffer: Buffer, job: Job): Promise<void> {
  // `cover` garantit le format 2:1 attendu par le domaine, quelle que soit la
  // source — une image curée peut arriver dans n'importe quel rapport.
  await sharp(buffer)
    .resize(NEAR_W, NEAR_H, { fit: 'cover', position: 'centre' })
    .webp({ quality: NEAR_QUALITY })
    .toFile(job.nearPath)

  await sharp(buffer)
    .resize(TILE_W, TILE_H, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toFile(job.tilePath)
}

// ── Composition des atlas ────────────────────────────────────────────────

async function composeAtlas(jobs: Job[], path: string): Promise<void> {
  const composites = await Promise.all(
    jobs.map(async (job, layer) => ({
      input: await readFile(job.tilePath),
      left: (layer % COLS) * TILE_W,
      top: Math.floor(layer / COLS) * TILE_H,
    }))
  )
  await sharp({
    create: {
      width: COLS * TILE_W,
      height: ROWS * TILE_H,
      channels: 3,
      // Les couches inoccupées du dernier atlas ne sont jamais échantillonnées ;
      // un gris neutre compresse mieux que du bruit et se voit si un bug survient.
      background: { r: 18, g: 18, b: 22 },
    },
  })
    .composite(composites)
    .webp({ quality: ATLAS_QUALITY })
    .toFile(path)
}

// ── Ménage ───────────────────────────────────────────────────────────────

/** Supprime les sorties de dépôts disparus : sinon `public/media` enfle sans fin. */
async function prune(dir: string, keep: Set<string>): Promise<number> {
  let removed = 0
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  for (const name of names.sort()) {
    if (keep.has(name)) continue
    await rm(resolve(dir, name), { force: true, recursive: true })
    removed++
  }
  return removed
}

// ── Point d'entrée ───────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes('--force')

  const config = await readJson<MuseumConfig>(resolve(ROOT, 'museum.config.json'))
  if (!config) throw new Error('museum.config.json introuvable ou invalide')

  const catalogue = await readJson<Catalogue>(resolve(ROOT, 'public/data/catalogue.json'))
  if (!catalogue?.artworks?.length) {
    throw new Error('public/data/catalogue.json introuvable ou vide — lancer d’abord tools/fetch-github.ts')
  }

  const curation =
    (await readJson<Curation>(resolve(ROOT, 'curation.json'))) ??
    ({ schemaVersion: 1, repos: {}, rooms: {}, excluded: [] } satisfies Curation)
  curation.repos ??= {}
  curation.excluded ??= []

  const excluded = new Set(curation.excluded)
  // Tri par clé : c'est lui qui fixe les numéros de couche. Tout le reste du
  // pipeline en dépend, y compris les museum.json déjà générés.
  const artworks = catalogue.artworks.filter((a) => !excluded.has(a.key)).sort((a, b) => byKey(a.key, b.key))

  await mkdir(NEAR_DIR, { recursive: true })
  await mkdir(TILES_DIR, { recursive: true })

  const stored = await readJson<CacheFile>(CACHE_FILE)
  const cache: CacheFile = stored?.pipeline === PIPELINE_SIG ? stored : structuredClone(EMPTY_CACHE)
  if (stored && stored.pipeline !== PIPELINE_SIG) {
    console.log('Paramètres du pipeline modifiés — cache ignoré, régénération complète.')
  }

  console.log(
    `${config.name} — ${artworks.length} dépôts (${catalogue.artworks.length - artworks.length} exclus par la curation)`
  )

  const jobs = await Promise.all(artworks.map((a) => buildJob(a, curation)))

  let done = 0
  const outcomes = await pool(jobs, CONCURRENCY, async (job) => {
    const outcome = await processJob(job, cache, force)
    done++
    process.stdout.write(`\r  toiles ${done}/${jobs.length}`)
    return outcome
  })
  process.stdout.write('\n')

  // ── Atlas ──────────────────────────────────────────────────────────────
  const atlasCount = Math.ceil(jobs.length / PER_ATLAS)
  const atlasNames: string[] = []
  const nextAtlasCache: Record<string, string> = {}
  let composed = 0

  for (let n = 0; n < atlasCount; n++) {
    const slice = jobs.slice(n * PER_ATLAS, (n + 1) * PER_ATLAS)
    const name = `atlas-${n}.webp`
    const path = resolve(MEDIA, name)
    // La signature couvre la liste ORDONNÉE des tuiles : insérer un dépôt au
    // milieu décale les couches suivantes et doit recomposer l'atlas. Elle
    // inclut la provenance, car un repli provisoire remplacé par la vraie OG
    // image change les pixels sans changer l'empreinte du catalogue.
    const signature = sha1(
      outcomes
        .slice(n * PER_ATLAS, (n + 1) * PER_ATLAS)
        .map((o) => `${o.key}:${o.fp}:${o.source}${o.retry ? ':provisoire' : ''}`)
        .join('\n')
    )
    nextAtlasCache[String(n)] = signature
    atlasNames.push(name)

    if (!force && cache.atlases[String(n)] === signature && (await exists(path))) continue
    process.stdout.write(`\r  atlas ${n + 1}/${atlasCount}`)
    await composeAtlas(slice, path)
    composed++
  }
  if (composed > 0) process.stdout.write('\n')

  // ── Index ──────────────────────────────────────────────────────────────
  const entries: AtlasIndex['entries'] = {}
  jobs.forEach((job, i) => {
    entries[job.art.key] = { atlas: Math.floor(i / PER_ATLAS), layer: i % PER_ATLAS }
  })

  const index: AtlasIndex = {
    schemaVersion: 1,
    tileWidth: TILE_W,
    tileHeight: TILE_H,
    cols: COLS,
    rows: ROWS,
    // Chemins relatifs à la racine publique : utilisables tels quels avec
    // `import.meta.env.BASE_URL`, quel que soit le sous-répertoire de déploiement.
    atlases: atlasNames.map((n) => `media/${n}`),
    entries,
  }
  await writeFile(resolve(MEDIA, 'atlas.json'), JSON.stringify(index, null, 2) + '\n')

  // ── Ménage et cache ────────────────────────────────────────────────────
  const prunedNear = await prune(NEAR_DIR, new Set(jobs.map((j) => `${j.slug}.webp`)))
  const prunedTiles = await prune(TILES_DIR, new Set(jobs.map((j) => `${j.slug}.png`)))
  const prunedAtlas = await prune(MEDIA, new Set([...atlasNames, 'atlas.json', '.cache.json', 'near', '.tiles']))

  const nextEntries: CacheFile['entries'] = {}
  for (const o of [...outcomes].sort((a, b) => byKey(a.key, b.key))) {
    nextEntries[o.key] = o.retry ? { fp: o.fp, source: o.source, retry: true } : { fp: o.fp, source: o.source }
  }
  await writeFile(
    CACHE_FILE,
    JSON.stringify({ schemaVersion: 1, pipeline: PIPELINE_SIG, entries: nextEntries, atlases: nextAtlasCache }, null, 2) +
      '\n'
  )

  // ── Résumé ─────────────────────────────────────────────────────────────
  const warnings = outcomes.map((o) => o.warning).filter((w): w is string => Boolean(w))
  const count = (s: Source) => outcomes.filter((o) => o.source === s).length
  const fromCache = outcomes.filter((o) => o.cached).length
  const provisional = outcomes.filter((o) => o.retry).length

  let nearBytes = 0
  for (const job of jobs) nearBytes += await fileSize(job.nearPath)
  let atlasBytes = 0
  const atlasSizes: string[] = []
  for (const name of atlasNames) {
    const size = await fileSize(resolve(MEDIA, name))
    atlasBytes += size
    atlasSizes.push(`${name} ${human(size)}`)
  }
  const indexBytes = await fileSize(resolve(MEDIA, 'atlas.json'))

  if (warnings.length) {
    console.log(`\n${warnings.length} repli(s) :`)
    for (const w of warnings.sort()) console.log(`  ! ${w}`)
  }
  if (quota.exhausted) {
    console.log(
      `\nQuota du service OG épuisé (100 rendus par fenêtre, réinitialisation dans ` +
        `${Math.round(quota.retryAfterSec / 60)} min).\n` +
        `Les replis provisoires sont marqués dans le cache : relancer plus tard ne retentera QUE ceux-là.`
    )
  }

  console.log(
    `\n${jobs.length} dépôts traités, aucun sans visuel\n` +
      `  téléchargés (OG) : ${count('og')}\n` +
      `  images curées    : ${count('custom')}\n` +
      `  toiles de repli  : ${count('fallback')} (dont ${provisional} provisoire(s), à retenter)\n` +
      `  servis par cache : ${fromCache}${force ? ' (--force : cache ignoré)' : ''}\n` +
      `  atlas            : ${atlasCount} (${composed} recomposé(s)) — ${atlasSizes.join(', ')}\n` +
      `  LOD proche       : ${human(nearBytes)} pour ${jobs.length} fichiers (~${human(Math.round(nearBytes / jobs.length))} pièce)\n` +
      `  atlas.json       : ${human(indexBytes)}\n` +
      `  poids total      : ${human(nearBytes + atlasBytes + indexBytes)}` +
      (prunedNear + prunedTiles + prunedAtlas > 0
        ? `\n  obsolètes purgés : ${prunedNear + prunedTiles + prunedAtlas}`
        : '')
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}
