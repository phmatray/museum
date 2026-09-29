/**
 * « L'atelier en coupe » : l'architecture d'un projet phare, relevée dans son
 * dépôt — pas inventée. `tools/fetch-ateliers.ts` lit l'arbre du dépôt et ses
 * `.csproj` ; ici, de quoi en tirer des couches, des modules et des fils.
 *
 * - un module est un projet `.csproj` ; son poids, ses fichiers source ;
 * - un fil est une `<ProjectReference>`, du projet vers celui dont il dépend ;
 * - les couches suivent le graphe : le socle ne dépend d'aucun projet du dépôt,
 *   chaque bibliothèque monte d'un cran au-dessus de sa plus haute dépendance ;
 *   au-dessus, les démonstrations, puis les tests — qui s'appuient sur tout.
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

type Genre = 'biblio' | 'demo' | 'tests'

interface Projet {
  chemin: string
  dossier: string
  id: string
  genre: Genre
  sdk: string
  sortie: string | null
  paquets: string[]
  refs: string[]
  paquetNuget: boolean
  fichiers: number
  octets: number
}

const baseDe = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dossierDe = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '')

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
  let fichiers = 0
  let octets = 0
  for (const f of arbre) {
    if (f.type === 'blob' && f.path.startsWith(dossier) && SOURCE.test(f.path) && !/\/(bin|obj)\//.test(f.path)) {
      fichiers++
      octets += f.size ?? 0
    }
  }
  return {
    chemin, dossier, id, genre, sdk, sortie, fichiers, octets,
    paquets: attributs(xml, 'PackageReference'),
    refs: attributs(xml, 'ProjectReference').map((r) => resoudre(dossier, r)),
    paquetNuget: /<PackageId>/.test(xml),
  }
}

/** Les paquets qui disent ce que fait un projet — pas l'outillage (SourceLink, documentation, abstractions). */
const PAQUETS_PARLANTS = ['MudBlazor', 'Microsoft.FluentUI.AspNetCore.Components', 'FluentValidation', 'FluentFTP', 'Octokit', 'Spectre.Console', 'Microsoft.AspNetCore.SignalR.Client', 'BenchmarkDotNet', 'bunit', 'Markdig']
const NOM_PAQUET: Record<string, string> = { 'Microsoft.FluentUI.AspNetCore.Components': 'Fluent UI', 'Microsoft.AspNetCore.SignalR.Client': 'SignalR', bunit: 'bUnit' }

function roleDe(p: Projet, parId: Map<string, Projet>, court: (id: string) => string): string {
  const parlants = PAQUETS_PARLANTS.filter((n) => p.paquets.includes(n)).map((n) => NOM_PAQUET[n] ?? n)
  const avec = (s: string, n = 1) => (parlants.length ? `${s} · ${parlants.slice(0, n).join(', ')}` : s)
  if (p.genre === 'tests') {
    if (/TestSupport$/i.test(p.id)) return 'Outils partagés des tests'
    if (/Benchmarks?$/i.test(p.id)) return 'Mesures de performance'
    const cibles = p.refs.map((r) => parId.get(r)).filter((c) => c !== undefined && !/TestSupport$/i.test(c.id))
    if (cibles.length === 0) return 'Tests'
    return cibles.length <= 2 ? `Tests de ${cibles.map((c) => court(c!.id)).join(' et ')}` : `Tests de ${cibles.length} projets`
  }
  if (p.genre === 'demo') {
    if (/BlazorWebAssembly$/.test(p.sdk)) return avec('Démo Blazor WebAssembly')
    if (/\.Web$/.test(p.sdk)) return avec('Application web')
    return avec('Application console')
  }
  if (p.fichiers === 0 && p.refs.length > 0) return 'Méta-paquet : réunit les autres'
  return avec(/\.Razor$/.test(p.sdk) ? 'Composants Razor' : p.paquetNuget ? 'Paquet NuGet' : 'Bibliothèque')
}

/** Le préfixe à points que partagent la plupart des projets (`Atypical.VirtualFileSystem.`). */
function prefixeCommun(ids: string[]): string {
  const compte = new Map<string, number>()
  for (const id of ids) {
    const segs = id.split('.')
    for (let n = 1; n < segs.length; n++) {
      const p = `${segs.slice(0, n).join('.')}.`
      compte.set(p, (compte.get(p) ?? 0) + 1)
    }
  }
  let meilleur = ''
  for (const [p, n] of compte) if (n * 2 > ids.length && p.length > meilleur.length) meilleur = p
  return meilleur
}

const COUCHES_BIBLIO: Record<number, [string, string][]> = {
  1: [['Socle', 'Toute la bibliothèque']],
  2: [
    ['Socle', 'Ne dépend d’aucun autre projet'],
    ['Extensions', 'Bâties sur le socle'],
  ],
  3: [
    ['Socle', 'Ne dépend d’aucun autre projet'],
    ['Extensions', 'Bâties sur le socle'],
    ['Assemblages', 'Réunissent les couches du dessous'],
  ],
}

/**
 * L'atelier d'un dépôt : ses `.csproj` (chemin → contenu), lus avec l'arbre
 * du dépôt. `null` s'il n'y a pas une seule bibliothèque à montrer.
 */
export function deriverAtelier(key: string, commit: string, arbre: readonly FichierArbre[], csprojs: ReadonlyMap<string, string>): Atelier | null {
  let projets = [...csprojs]
    .map(([chemin, xml]) => lireCsproj(chemin, xml, arbre))
    .filter((p): p is Projet => p !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
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

  const couches: Couche[] = COUCHES_BIBLIO[nbNiveaux].map(([nom, role], n) => ({
    id: nom.toLowerCase(), nom, role, modules: trier(biblios.filter((b) => niveau.get(b.chemin) === n)),
  }))
  const demos = projets.filter((p) => p.genre === 'demo')
  if (demos.length) couches.push({ id: 'demonstrations', nom: 'Démonstrations', role: 'La bibliothèque à l’œuvre', modules: trier(demos) })
  const tests = projets.filter((p) => p.genre === 'tests')
  if (tests.length) couches.push({ id: 'tests', nom: 'Tests', role: 'Vérifient et mesurent le reste', modules: trier(tests) })

  const liens = projets.flatMap((p) => p.refs.map((r) => parChemin.get(r)).filter((d) => d !== undefined).map((d) => ({ de: p.id, vers: d.id })))
  liens.sort((a, b) => a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers))
  return { key, commit, couches, liens }
}
