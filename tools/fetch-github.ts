/**
 * LOT 1 — Récupération du catalogue depuis l'API GitHub.
 *
 * Exécuté au build (Action) ou à la main. Produit `public/data/catalogue.json`,
 * qui est GÉNÉRÉ et JETABLE : aucun humain ne l'édite, chaque exécution
 * l'écrase. Toute intervention humaine vit dans `curation.json`.
 *
 *   node tools/fetch-github.ts
 *
 * Jeton lu dans GITHUB_TOKEN, sinon `gh auth token`. Sans jeton on retombe
 * sur le quota anonyme (60 req/h), ce qui suffit à peine à un essai.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GRAPHQL = 'https://api.github.com/graphql'

// ── Types (miroir de src/domain/catalogue.ts, dupliqué pour que les outils
//    restent exécutables sans passer par la résolution de modules de Vite) ──

export interface Artwork {
  key: string
  owner: string
  name: string
  title: string
  description: string
  url: string
  homepage: string | null
  topics: string[]
  language: string | null
  languages: Record<string, number>
  stars: number
  forks: number
  openIssues: number
  isFork: boolean
  isArchived: boolean
  isTemplate: boolean
  createdAt: string
  pushedAt: string
  license: string | null
  readmeExcerpt: string
}

export interface Catalogue {
  schemaVersion: 1
  generatedAt: string
  owners: string[]
  artworks: Artwork[]
}

interface MuseumConfigFile {
  owners: string[]
  filters?: {
    excludeForks?: boolean
    excludeArchived?: boolean
    minStars?: number
    excludePatterns?: string[]
  }
}

// ── Jeton ────────────────────────────────────────────────────────────────

function resolveToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

// ── Requête ──────────────────────────────────────────────────────────────

/**
 * Une seule requête couvre utilisateurs ET organisations : `repositoryOwner`
 * est l'interface commune aux deux. Interroger `user` puis `organization`
 * obligerait à connaître le type du propriétaire à l'avance.
 */
const QUERY = `
query($login: String!, $cursor: String, $size: Int!) {
  repositoryOwner(login: $login) {
    __typename
    repositories(first: $size, after: $cursor, orderBy: {field: PUSHED_AT, direction: DESC}, privacy: PUBLIC) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        owner { login }
        description
        url
        homepageUrl
        stargazerCount
        forkCount
        isFork
        isArchived
        isTemplate
        createdAt
        pushedAt
        licenseInfo { spdxId }
        issues(states: OPEN) { totalCount }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name } }
        }
        readme: object(expression: "HEAD:README.md") { ... on Blob { text } }
        readmeLower: object(expression: "HEAD:readme.md") { ... on Blob { text } }
      }
    }
  }
}`

interface GqlRepo {
  name: string
  owner: { login: string }
  description: string | null
  url: string
  homepageUrl: string | null
  stargazerCount: number
  forkCount: number
  isFork: boolean
  isArchived: boolean
  isTemplate: boolean
  createdAt: string
  pushedAt: string
  licenseInfo: { spdxId: string } | null
  issues: { totalCount: number }
  repositoryTopics: { nodes: { topic: { name: string } }[] }
  languages: { edges: { size: number; node: { name: string } }[] }
  readme: { text: string } | null
  readmeLower: { text: string } | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type OwnerPage = {
  repositories: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: GqlRepo[] }
} | null

/**
 * L'API GraphQL de GitHub renvoie des 502 quand la requête dépasse son budget
 * d'exécution — ce qui arrive dès qu'on demande les blobs README d'une centaine
 * de dépôts d'un coup. On réessaie avec une page deux fois plus petite plutôt
 * que d'abandonner : c'est la seule stratégie qui converge, un simple délai
 * d'attente ne change rien à la taille de la requête.
 */
async function graphql(
  token: string | null,
  login: string,
  cursor: string | null,
  size: number
): Promise<{ owner: OwnerPage; size: number }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'virtual-museum-fetch',
  }
  if (token) headers.authorization = `bearer ${token}`

  let attempt = 0
  let current = size
  for (;;) {
    attempt++
    let res: Response
    try {
      res = await fetch(GRAPHQL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: QUERY, variables: { login, cursor, size: current } }),
      })
    } catch (e) {
      if (attempt >= 5) throw e
      await sleep(1000 * attempt)
      continue
    }

    if (res.status === 502 || res.status === 503 || res.status === 504) {
      if (attempt >= 6) throw new Error(`GitHub ${res.status} persistant même à ${current} dépôts par page`)
      current = Math.max(5, Math.floor(current / 2))
      await sleep(800 * attempt)
      continue
    }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0) * 1000
      const wait = reset ? Math.max(0, reset - Date.now()) + 1000 : 60_000
      if (attempt >= 3) throw new Error(`Quota GitHub épuisé, réinitialisation dans ${Math.round(wait / 1000)} s`)
      console.warn(`\n  quota atteint, attente ${Math.round(wait / 1000)} s…`)
      await sleep(wait)
      continue
    }
    if (!res.ok) throw new Error(`GitHub ${res.status} : ${(await res.text()).slice(0, 300)}`)

    const json = (await res.json()) as {
      data?: { repositoryOwner: OwnerPage }
      errors?: { message: string; type?: string }[]
    }
    // Un timeout applicatif remonte en 200 avec un tableau d'erreurs.
    if (json.errors?.length) {
      const timeout = json.errors.some((e) => /timeout|timed out/i.test(e.message))
      if (timeout && attempt < 6) {
        current = Math.max(5, Math.floor(current / 2))
        await sleep(800 * attempt)
        continue
      }
      throw new Error(`GraphQL : ${json.errors.map((e) => e.message).join(' ; ')}`)
    }
    return { owner: json.data?.repositoryOwner ?? null, size: current }
  }
}

// ── Normalisation ────────────────────────────────────────────────────────

/**
 * « RSCG_Examples » → « RSCG Examples », « my-cool.app » → « my cool app ».
 * On préserve la casse d'origine : c'est la marque du dépôt, pas un slug.
 */
function humanise(name: string): string {
  return name
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Le README brut est du markdown bruyant (badges, HTML, liens). On en extrait
 * de la prose exploitable pour le clustering et pour le cartel : suppression
 * des blocs de code, images, badges, balises HTML et titres.
 */
function readmeExcerpt(md: string | null | undefined, limit = 1200): string {
  if (!md) return ''
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>|-]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function toArtwork(r: GqlRepo): Artwork {
  const languages: Record<string, number> = {}
  for (const e of r.languages.edges) languages[e.node.name] = e.size

  return {
    key: `${r.owner.login}/${r.name}`,
    owner: r.owner.login,
    name: r.name,
    title: humanise(r.name),
    description: r.description ?? '',
    url: r.url,
    homepage: r.homepageUrl || null,
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    language: r.languages.edges[0]?.node.name ?? null,
    languages,
    stars: r.stargazerCount,
    forks: r.forkCount,
    openIssues: r.issues.totalCount,
    isFork: r.isFork,
    isArchived: r.isArchived,
    isTemplate: r.isTemplate,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt,
    license: r.licenseInfo?.spdxId ?? null,
    readmeExcerpt: readmeExcerpt(r.readme?.text ?? r.readmeLower?.text),
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────

export async function fetchCatalogue(owners: string[], token: string | null): Promise<Catalogue> {
  const artworks: Artwork[] = []
  const seen = new Set<string>()

  for (const login of owners) {
    let cursor: string | null = null
    let page = 0
    let size = 25 // 100 fait systématiquement tomber l'API en 502 avec les READMEs
    for (;;) {
      const { owner, size: used } = await graphql(token, login, cursor, size)
      size = used
      if (!owner) {
        console.warn(`  ! propriétaire introuvable : ${login}`)
        break
      }
      const { nodes, pageInfo } = owner.repositories
      for (const r of nodes) {
        const a = toArtwork(r)
        // Un dépôt peut apparaître deux fois si l'on liste à la fois un
        // utilisateur et une organisation dont il est membre.
        if (seen.has(a.key)) continue
        seen.add(a.key)
        artworks.push(a)
      }
      page++
      process.stdout.write(`\r  ${login} — page ${page}, ${artworks.length} dépôts cumulés`)
      if (!pageInfo.hasNextPage) break
      cursor = pageInfo.endCursor
    }
    process.stdout.write('\n')
  }

  // Ordre stable : le catalogue est comparé d'un build à l'autre pour décider
  // s'il faut retélécharger les médias. Un ordre instable invaliderait le cache.
  artworks.sort((a, b) => a.key.localeCompare(b.key))

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    owners,
    artworks,
  }
}

async function main() {
  const configPath = resolve(ROOT, 'museum.config.json')
  let config: MuseumConfigFile
  try {
    config = JSON.parse(await readFile(configPath, 'utf8')) as MuseumConfigFile
  } catch {
    throw new Error(`museum.config.json introuvable ou invalide (${configPath})`)
  }
  if (!config.owners?.length) throw new Error('museum.config.json : "owners" est vide')

  const token = resolveToken()
  console.log(`Récupération de ${config.owners.join(', ')}${token ? '' : ' (SANS JETON — quota 60 req/h)'}`)

  const catalogue = await fetchCatalogue(config.owners, token)

  const out = resolve(ROOT, 'public/data/catalogue.json')
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, JSON.stringify(catalogue, null, 2) + '\n')

  const kept = catalogue.artworks
  console.log(
    `\n${kept.length} dépôts écrits dans public/data/catalogue.json\n` +
      `  forks     : ${kept.filter((a) => a.isFork).length}\n` +
      `  archivés  : ${kept.filter((a) => a.isArchived).length}\n` +
      `  avec topics : ${kept.filter((a) => a.topics.length > 0).length}\n` +
      `  avec README : ${kept.filter((a) => a.readmeExcerpt.length > 0).length}`
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`\nÉchec : ${e.message}`)
    process.exit(1)
  })
}
