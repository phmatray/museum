/**
 * « L'atelier en coupe » : l'architecture d'un projet phare, relevée dans son
 * dépôt — pas inventée. `tools/fetch-ateliers.ts` lit l'arbre du dépôt et ses
 * manifestes (`.csproj`, ou les `package.json` des espaces de travail d'un
 * dépôt JavaScript) ; ici, de quoi en tirer des couches, des modules et des fils.
 *
 * - un module est un projet `.csproj` ou un paquet npm ; son poids, ses fichiers source ;
 * - un fil est une `<ProjectReference>` ou une dépendance vers un paquet du même
 *   dépôt, du projet vers celui dont il dépend ;
 * - les couches suivent le graphe : le socle ne dépend d'aucun projet du dépôt,
 *   chaque bibliothèque monte d'un cran au-dessus de sa plus haute dépendance ;
 *   au-dessus, les démonstrations, puis les tests — qui s'appuient sur tout ;
 * - une couche porte le nom de ce qu'elle contient (« MudBlazor · Fluent UI »,
 *   « Tests unitaires ») ; son rôle dans l'édifice (socle, extensions…) va dessous.
 *
 * Pur : ni réseau ni three.
 */

export interface Module {
  /** Le nom du projet, tel que le `.csproj` le nomme. */
  id: string
  /** Le nom court, sans le préfixe commun du dépôt : ce qu'on lit sur le bloc. */
  nom: string
  role: string
  /** Les fichiers source (.cs, .razor, .cshtml) du dossier du projet, et leur poids. */
  fichiers: number
  octets: number
}

export interface Couche {
  id: string
  nom: string
  role: string
  modules: Module[]
}

export interface Atelier {
  key: string
  /** Le commit relevé : qui veut vérifier retrouve exactement ce qu'on a lu. */
  commit: string
  /** Du bas vers le haut. */
  couches: Couche[]
  /** Du projet qui dépend vers sa dépendance. */
  liens: { de: string; vers: string }[]
}

export interface FichierArbre {
  path: string
  type: 'blob' | 'tree' | 'commit'
  size?: number
}

export const MAX_MODULES = 12
/** Au-delà, les bibliothèques des niveaux supérieurs se rejoignent sur la plus haute plaque. */
const MAX_NIVEAUX_BIBLIO = 3
const SOURCE = /\.(cs|razor|cshtml)$/
const SOURCE_JS = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/

type Genre = 'biblio' | 'demo' | 'tests'

interface Projet {
  chemin: string
  dossier: string
  id: string
  genre: Genre
  sdk: string
  sortie: string | null
  paquets: string[]
  /** Chemins des manifestes dont il dépend (pour npm, d'abord des noms de paquets, résolus par `deriverAtelier`). */
  refs: string[]
  /** Publié : `<PackageId>` pour NuGet, pas `private` pour npm. */
  publie: boolean
  fichiers: number
  octets: number
}

const baseDe = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dossierDe = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')
const NPM = 'npm'

/** Les fichiers source d'un dossier et leur poids, sans ce que le build produit. */
function peser(dossier: string, arbre: readonly FichierArbre[], source: RegExp, exclus: RegExp): { fichiers: number; octets: number } {
  let fichiers = 0
  let octets = 0
  for (const f of arbre) {
    if (f.type === 'blob' && f.path.startsWith(dossier) && source.test(f.path) && !exclus.test(f.path.slice(dossier.length))) {
      fichiers++
      octets += f.size ?? 0
    }
  }
  return { fichiers, octets }
}

/** `..\src\A\A.csproj` vu depuis `tests/B/` : `src/A/A.csproj`. */
export function resoudre(dossier: string, relatif: string): string {
  const parts = dossier.split('/').filter(Boolean)
  for (const seg of relatif.replace(/\\/g, '/').split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

const attributs = (xml: string, balise: string) =>
  [...xml.matchAll(new RegExp(`<${balise}\\s+Include="([^"]+)"`, 'g'))].map((m) => m[1])

function genreDe(id: string, chemin: string, sortie: string | null, sdk: string): Genre | null {
  // L'outillage du build (Nuke, `_build`) n'est pas l'architecture du produit.
  if (id.startsWith('_') || /^build\//.test(chemin)) return null
  if (/(Tests?|UnitTests|Benchmarks?|TestSupport)$/i.test(id) || /^(tests?|benchmarks?)\//.test(chemin)) return 'tests'
  if (/(Demo|Samples?)/i.test(id) || /^(samples?|demos?)\//.test(chemin)) return 'demo'
  if (sortie === 'Exe' || /\.(Web|BlazorWebAssembly)$/.test(sdk)) return 'demo'
  return 'biblio'
}

/** Lit un `.csproj` : son SDK, sa sortie, ses paquets et ses références de projet. */
export function lireCsproj(chemin: string, xml: string, arbre: readonly FichierArbre[]): Projet | null {
  const id = baseDe(chemin).replace(/\.csproj$/, '')
  const sdk = /<Project\s+Sdk="([^"]+)"/.exec(xml)?.[1] ?? 'Microsoft.NET.Sdk'
  const sortie = /<OutputType>\s*(\w+)\s*<\/OutputType>/.exec(xml)?.[1] ?? null
  const genre = genreDe(id, chemin, sortie, sdk)
  if (genre === null) return null
  const dossier = dossierDe(chemin)
  return {
    chemin, dossier, id, genre, sdk, sortie,
    ...peser(dossier, arbre, SOURCE, /(^|\/)(bin|obj)\//),
    paquets: attributs(xml, 'PackageReference'),
    refs: attributs(xml, 'ProjectReference').map((r) => resoudre(dossier, r)),
    publie: /<PackageId>/.test(xml),
  }
}

/**
 * Lit le `package.json` d'un paquet d'un espace de travail. Le genre se lit dans
 * le dossier : `apps/`, `examples/`… sont des démonstrations, `e2e/`, `bench/`…
 * des tests, le reste (`packages/*`) des bibliothèques. Les dépendances restent
 * des noms : seules celles qui nomment un autre paquet du dépôt feront des fils.
 */
export function lirePackageJson(chemin: string, texte: string, arbre: readonly FichierArbre[]): Projet | null {
  let pkg: { name?: string; private?: boolean; dependencies?: object; devDependencies?: object; peerDependencies?: object }
  try {
    pkg = JSON.parse(texte)
  } catch {
    return null
  }
  const dossier = dossierDe(chemin)
  const id = pkg.name ?? dossier.split('/').filter(Boolean).pop() ?? 'racine'
  const genre: Genre =
    /(^|\/)(tests?|e2e|benchmarks?|bench)\//.test(dossier) || /[-/](tests?|e2e|bench(marks?)?)$/.test(id) ? 'tests'
    : /^(apps?|examples?|demos?|samples?|playgrounds?|sites?|docs|website)\//.test(dossier) ? 'demo'
    : 'biblio'
  const paquets = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })
  return {
    chemin, dossier, id, genre, sdk: NPM, sortie: null,
    ...peser(dossier, arbre, SOURCE_JS, /(^|\/)(node_modules|dist|build|coverage)\//),
    paquets, refs: paquets, publie: pkg.private !== true,
  }
}

/**
 * Les `package.json` des paquets d'un dépôt JavaScript : ceux que désignent les
 * `workspaces` du `package.json` racine (ou de `pnpm-workspace.yaml`), à défaut
 * `packages/*` et `apps/*` ; sans espace de travail, le paquet racine seul.
 * `*` vaut un segment de chemin, `**` autant qu'on veut.
 */
export function manifestesNpm(racine: string | null, pnpm: string | null, arbre: readonly FichierArbre[]): string[] {
  let motifs: string[] = []
  try {
    const w = racine ? (JSON.parse(racine) as { workspaces?: string[] | { packages?: string[] } }).workspaces : undefined
    motifs = Array.isArray(w) ? w : (w?.packages ?? [])
  } catch { /* un package.json illisible : on se rabat sur les motifs usuels */ }
  if (motifs.length === 0 && pnpm) motifs = [...pnpm.matchAll(/^\s*-\s*['"]?([^'"\s#]+)/gm)].map((m) => m[1])
  if (motifs.length === 0) motifs = ['packages/*', 'apps/*']
  const exprs = motifs.filter((m) => !m.startsWith('!')).map((m) =>
    new RegExp(`^${m.replace(/\/+$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]+').replace(/§/g, '.*')}/package\\.json$`))
  const trouves = arbre.filter((f) => f.type === 'blob' && !f.path.includes('node_modules/') && exprs.some((e) => e.test(f.path))).map((f) => f.path)
  return trouves.length ? trouves.sort() : racine ? ['package.json'] : []
}

/** Les paquets qui disent ce que fait un projet — pas l'outillage (SourceLink, documentation, abstractions). */
const PAQUETS_PARLANTS = [
  'MudBlazor', 'Microsoft.FluentUI.AspNetCore.Components', 'FluentValidation', 'FluentFTP', 'Octokit', 'Spectre.Console', 'Microsoft.AspNetCore.SignalR.Client', 'BenchmarkDotNet', 'bunit', 'Markdig',
  'react', 'vue', 'svelte', '@angular/core', 'next', 'three', 'express',
]
const NOM_PAQUET: Record<string, string> = {
  'Microsoft.FluentUI.AspNetCore.Components': 'Fluent UI', 'Microsoft.AspNetCore.SignalR.Client': 'SignalR', bunit: 'bUnit',
  react: 'React', vue: 'Vue', svelte: 'Svelte', '@angular/core': 'Angular', next: 'Next.js', three: 'three.js', express: 'Express',
}
/** Ceux qui disent de quoi une démonstration est faite. */
const INTERFACES = new Set(['MudBlazor', 'Fluent UI', 'Spectre.Console', 'React', 'Vue', 'Svelte', 'Angular', 'Next.js', 'three.js'])

const parlantsDe = (p: Projet) => PAQUETS_PARLANTS.filter((n) => p.paquets.includes(n)).map((n) => NOM_PAQUET[n] ?? n)

function roleDe(p: Projet, parId: Map<string, Projet>, court: (id: string) => string): string {
  const parlants = parlantsDe(p)
  const avec = (s: string, n = 1) => (parlants.length ? `${s} · ${parlants.slice(0, n).join(', ')}` : s)
  if (p.genre === 'tests') {
    if (/TestSupport$/i.test(p.id)) return 'Outils partagés des tests'
    if (/Benchmarks?$/i.test(p.id)) return 'Mesures de performance'
    const cibles = p.refs.map((r) => parId.get(r)).filter((c) => c !== undefined && !/TestSupport$/i.test(c.id))
    if (cibles.length === 0) return 'Tests'
    return cibles.length <= 2 ? `Tests de ${cibles.map((c) => court(c!.id)).join(' et ')}` : `Tests de ${cibles.length} projets`
  }
  if (p.genre === 'demo') {
    if (p.sdk === NPM) return avec('Application')
    if (/BlazorWebAssembly$/.test(p.sdk)) return avec('Démo Blazor WebAssembly')
    if (/\.Web$/.test(p.sdk)) return avec('Application web')
    return avec('Application console')
  }
  if (p.fichiers === 0 && p.refs.length > 0) return 'Méta-paquet : réunit les autres'
  return avec(/\.Razor$/.test(p.sdk) ? 'Composants Razor' : p.publie ? (p.sdk === NPM ? 'Paquet npm' : 'Paquet NuGet') : 'Bibliothèque')
}

/** Le préfixe que partagent la plupart des projets (`Atypical.VirtualFileSystem.`, `@acme/`), coupé à un séparateur. */
function prefixeCommun(ids: string[]): string {
  const compte = new Map<string, number>()
  for (const id of ids) {
    const segs = id.split(/(?<=[./-])/)
    for (let n = 1; n < segs.length; n++) {
      const p = segs.slice(0, n).join('')
      compte.set(p, (compte.get(p) ?? 0) + 1)
    }
  }
  let meilleur = ''
  for (const [p, n] of compte) if (n * 2 > ids.length && p.length > meilleur.length) meilleur = p
  return meilleur
}

/** La place de chaque couche de bibliothèques dans l'édifice : son id (la teinte), et son rôle, lu sous son nom. */
const COUCHES_BIBLIO: Record<number, [string, string][]> = {
  1: [['socle', 'Socle · toute la bibliothèque']],
  2: [
    ['socle', 'Socle · ne dépend d’aucun autre projet'],
    ['extensions', 'Extensions · bâties sur le socle'],
  ],
  3: [
    ['socle', 'Socle · ne dépend d’aucun autre projet'],
    ['extensions', 'Extensions · bâties sur le socle'],
    ['assemblages', 'Assemblages · réunissent le dessous'],
  ],
}

/** Deux ou trois noms au plus, sans doublon : au-delà, on les compte. */
function enumerer(noms: string[], max = 2): string {
  const u = [...new Set(noms)]
  return u.length <= max ? u.join(' · ') : `${u.slice(0, max).join(' · ')} +${u.length - max}`
}

const cle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Ce qu'une bibliothèque apporte : le paquet qu'elle habille s'il est dans son nom (`ForMudBlazor` → MudBlazor), sinon son nom court. */
function apport(p: Projet, court: (id: string) => string): string {
  const nom = court(p.id)
  return parlantsDe(p).find((n) => cle(nom).includes(cle(n))) ?? nom
}

/** De quoi une démonstration est faite : son interface (MudBlazor, React…), à défaut son genre d'application. */
function facture(p: Projet): string {
  const ui = parlantsDe(p).find((n) => INTERFACES.has(n))
  if (ui) return ui
  if (p.sdk === NPM) return 'web'
  return /BlazorWebAssembly$/.test(p.sdk) || /Blazor/.test(p.id) ? 'Blazor' : /\.Web$/.test(p.sdk) ? 'web' : 'console'
}

/** « Tests unitaires · Benchmarks » : ce que font les projets de tests, pas qu'ils sont des tests. */
function nomDesTests(tests: Projet[]): string {
  const ids = tests.map((t) => t.id)
  const noms = [
    ids.some((id) => /UnitTests?$|[-.]unit$/i.test(id)) && 'Tests unitaires',
    ids.some((id) => /Integration\.?Tests?$|[-.]integration$/i.test(id)) && 'Tests d’intégration',
    ids.some((id) => /e2e/i.test(id)) && 'Tests de bout en bout',
    ids.some((id) => /Benchmarks?$|bench$/i.test(id)) && 'Benchmarks',
  ].filter((n): n is string => n !== false)
  return noms.length ? enumerer(noms) : 'Tests'
}

/**
 * L'atelier d'un dépôt : ses manifestes (chemin → contenu : `.csproj` ou
 * `package.json`), lus avec l'arbre du dépôt. `null` s'il n'y a pas une seule
 * bibliothèque à montrer.
 */
export function deriverAtelier(key: string, commit: string, arbre: readonly FichierArbre[], manifestes: ReadonlyMap<string, string>): Atelier | null {
  let projets = [...manifestes]
    .map(([chemin, texte]) => (chemin.endsWith('.csproj') ? lireCsproj(chemin, texte, arbre) : lirePackageJson(chemin, texte, arbre)))
    .filter((p): p is Projet => p !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
  // npm dépend par nom : on ne garde que les paquets du dépôt, en chemins, comme msbuild.
  const parNom = new Map(projets.filter((p) => p.sdk === NPM).map((p) => [p.id, p.chemin]))
  for (const p of projets) if (p.sdk === NPM) p.refs = p.refs.flatMap((n) => parNom.get(n) ?? [])
  // Douze au plus : les plus petits tests d'abord, puis les plus petites démos, cèdent la place.
  for (const genre of ['tests', 'demo'] as const) {
    while (projets.length > MAX_MODULES) {
      const candidats = projets.filter((p) => p.genre === genre)
      if (candidats.length === 0) break
      const moindre = candidats.reduce((a, b) => (b.octets < a.octets ? b : a))
      projets = projets.filter((p) => p !== moindre)
    }
  }
  projets = projets.slice(0, MAX_MODULES)
  const parChemin = new Map(projets.map((p) => [p.chemin, p]))
  const biblios = projets.filter((p) => p.genre === 'biblio')
  if (biblios.length === 0) return null

  // Le niveau d'une bibliothèque : un cran au-dessus de sa plus haute dépendance.
  const niveau = new Map<string, number>()
  const niveauDe = (p: Projet, pile: Set<string>): number => {
    const connu = niveau.get(p.chemin)
    if (connu !== undefined) return connu
    if (pile.has(p.chemin)) return 0 // un cycle : msbuild le refuserait, on ne boucle pas
    pile.add(p.chemin)
    const deps = p.refs.map((r) => parChemin.get(r)).filter((d): d is Projet => d?.genre === 'biblio')
    const n = Math.min(MAX_NIVEAUX_BIBLIO - 1, deps.reduce((m, d) => Math.max(m, niveauDe(d, pile) + 1), 0))
    niveau.set(p.chemin, n)
    return n
  }
  for (const b of biblios) niveauDe(b, new Set())
  const nbNiveaux = Math.max(...biblios.map((b) => niveau.get(b.chemin)!)) + 1

  const prefixe = prefixeCommun(projets.map((p) => p.id))
  const court = (id: string) => (id.startsWith(prefixe) && id.length > prefixe.length ? id.slice(prefixe.length) : id)
  const parId = new Map(projets.map((p) => [p.chemin, p]))
  const module = (p: Projet): Module => ({ id: p.id, nom: court(p.id), role: roleDe(p, parId, court), fichiers: p.fichiers, octets: p.octets })
  const trier = (ps: Projet[]) => ps.sort((a, b) => b.octets - a.octets || a.id.localeCompare(b.id)).map(module)

  const couches: Couche[] = COUCHES_BIBLIO[nbNiveaux].map(([id, role], n) => {
    const ps = biblios.filter((b) => niveau.get(b.chemin) === n)
    const modules = trier(ps)
    // Le nom suit l'ordre des blocs, du plus lourd au plus léger.
    return { id, nom: enumerer(modules.map((m) => apport(ps.find((p) => p.id === m.id)!, court))), role, modules }
  })
  const demos = projets.filter((p) => p.genre === 'demo')
  if (demos.length) {
    const modules = trier(demos) // trie aussi `demos`, du plus lourd au plus léger
    couches.push({ id: 'demonstrations', nom: `Démos ${enumerer(demos.map(facture), 3)}`, role: 'Démonstrations · la bibliothèque à l’œuvre', modules })
  }
  const tests = projets.filter((p) => p.genre === 'tests')
  if (tests.length) couches.push({ id: 'tests', nom: nomDesTests(tests), role: 'Vérifient et mesurent le reste', modules: trier(tests) })

  const liens = projets.flatMap((p) => p.refs.map((r) => parChemin.get(r)).filter((d) => d !== undefined).map((d) => ({ de: p.id, vers: d.id })))
  liens.sort((a, b) => a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers))
  return { key, commit, couches, liens }
}
