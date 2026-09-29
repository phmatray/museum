/**
 * Relève l'architecture des projets phares (les vitrines de la salle
 * d'honneur, `choisirVitrines`) dans leurs dépôts : l'arbre, puis chaque
 * `.csproj` — ou, pour un dépôt JavaScript, le `package.json` de chaque paquet
 * de ses espaces de travail. Écrit `public/data/ateliers.json`, VERSIONNÉ : si l'API tombe, le
 * fichier de la veille reste, et le musée avec.
 *
 * Après `npm run fetch` (il lui faut le catalogue), avant `build`.
 * Usage : node tools/fetch-ateliers.ts   (GITHUB_TOKEN, sinon `gh auth token`)
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deriverAtelier, manifestesNpm, type Atelier, type FichierArbre } from '../src/domain/atelier.ts'
import type { Catalogue } from '../src/domain/types.ts'
import { choisirVitrines } from '../src/plan/vitrines.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SORTIE = resolve(ROOT, 'public/data/ateliers.json')

export interface Ateliers {
  schemaVersion: 1
  generatedAt: string
  ateliers: Atelier[]
}

function jeton(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

/** Le relevé d'un dépôt : `api` lit une URL de l'API REST, en JSON ou en texte brut. */
export async function releverAtelier(key: string, api: (chemin: string, brut?: boolean) => Promise<string>): Promise<Atelier | null> {
  const commit = (JSON.parse(await api(`repos/${key}/commits/HEAD`)) as { sha: string }).sha
  const arbre = JSON.parse(await api(`repos/${key}/git/trees/${commit}?recursive=1`)) as { tree: FichierArbre[]; truncated: boolean }
  if (arbre.truncated) console.warn(`  ! ${key} : arbre tronqué par l'API, les tailles sont des minima`)
  const lire = (chemin: string) => api(`repos/${key}/contents/${chemin}?ref=${commit}`, true)
  const existe = (chemin: string) => arbre.tree.some((f) => f.type === 'blob' && f.path === chemin)
  let chemins = arbre.tree.filter((f) => f.type === 'blob' && f.path.endsWith('.csproj')).map((f) => f.path)
  // Pas de .NET : les paquets JavaScript, si le dépôt en a.
  if (chemins.length === 0 && existe('package.json')) {
    chemins = manifestesNpm(await lire('package.json'), existe('pnpm-workspace.yaml') ? await lire('pnpm-workspace.yaml') : null, arbre.tree)
  }
  const manifestes = new Map<string, string>()
  for (const c of chemins) manifestes.set(c, await lire(c))
  return deriverAtelier(key, commit, arbre.tree, manifestes)
}

async function main() {
  const catalogue = JSON.parse(await readFile(resolve(ROOT, 'public/data/catalogue.json'), 'utf8')) as Catalogue
  const t = jeton()
  const api = async (chemin: string, brut = false) => {
    const r = await fetch(`https://api.github.com/${chemin}`, {
      headers: { accept: brut ? 'application/vnd.github.raw' : 'application/vnd.github+json', ...(t ? { authorization: `Bearer ${t}` } : {}) },
    })
    if (!r.ok) throw new Error(`${chemin} : HTTP ${r.status}`)
    return r.text()
  }
  const ateliers: Atelier[] = []
  for (const a of choisirVitrines(catalogue.artworks, catalogue.owners)) {
    const atelier = await releverAtelier(a.key, api)
    if (atelier === null) console.warn(`  ! ${a.key} : ni .csproj ni paquet npm de bibliothèque, pas d'atelier`)
    else {
      ateliers.push(atelier)
      console.log(`${a.key} : ${atelier.couches.length} couches, ${atelier.couches.flatMap((c) => c.modules).length} modules, ${atelier.liens.length} liens`)
    }
  }
  const sortie: Ateliers = { schemaVersion: 1, generatedAt: new Date().toISOString(), ateliers }
  await writeFile(SORTIE, JSON.stringify(sortie, null, 2) + '\n')
  console.log(`${ateliers.length} ateliers écrits dans public/data/ateliers.json`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: Error) => {
    // Le filet : le fichier versionné n'est pas touché, le build continue avec.
    console.warn(`Relevé des ateliers en échec, on garde public/data/ateliers.json : ${e.message}`)
  })
}
