/**
 * Les captures : ce que le public VOIT d'un projet — la page de son site, ou à
 * défaut la première vraie image de son README — plutôt que la carte OpenGraph
 * blanche de GitHub, qui ne montre qu'un nom.
 *
 * Logique pure, partagée par `tools/build-captures.ts` (qui les produit),
 * `tools/build-media.ts` (qui en fait les toiles) et l'interface (qui les montre).
 * Aucun import d'exécution : les outils la chargent telle quelle sous Node.
 */

/** D'où vient le visuel. `og` : rien de mieux, la toile garde la carte GitHub. */
export type SourceCapture = 'site' | 'readme' | 'og'

export interface EntreeCapture {
  source: SourceCapture
  /** `captures/<owner>__<name>.webp`, relatif à `public/media/` ; absent pour `og`. */
  file?: string
  width?: number
  height?: number
  /** Le `pushedAt` du dépôt au moment de la capture : la clé du cache. */
  pushedAt: string
  site: string | null
  /** Le site existait mais n'a pas pu être photographié : à retenter au prochain build. */
  siteFailed?: true
}

export type IndexCaptures = Record<string, EntreeCapture>

export const CAPTURES_DIR = 'captures'
export const capturesFichier = (key: string) => `${CAPTURES_DIR}/${key.replace('/', '__').replace(/[^A-Za-z0-9._/-]/g, '-')}.webp`

// ── Le site ──────────────────────────────────────────────────────────────

/**
 * Hôtes qui ne sont pas « le site du projet » : GitHub lui-même (on y est déjà),
 * et LinkedIn, qui ne montre qu'un mur de connexion à qui n'est pas inscrit.
 */
const PAS_UN_SITE = /(^|\.)(github\.com|linkedin\.com)$/i

/** Le champ `homepage` s'il désigne un vrai site, sinon l'URL GitHub Pages, sinon rien. */
export function siteDuDepot(homepage: string | null | undefined, pages: string | null | undefined): string | null {
  for (const candidat of [homepage, pages]) {
    if (!candidat) continue
    try {
      const url = new URL(candidat.trim())
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !PAS_UN_SITE.test(url.hostname)) return url.href
    } catch {
      /* « HomePage », un chemin nu… : pas une URL */
    }
  }
  return null
}

// ── Le README ────────────────────────────────────────────────────────────

/** Badges et pictos : jamais une image du projet. */
const BADGE =
  /shields\.io|badge|travis-ci|codecov|coveralls|github\.com\/[^/]+\/[^/]+\/(actions\/)?workflows|circleci|appveyor|sonarcloud|codefactor|snyk\.io|fossa|gitter|licen[cs]e|buymeacoffee|ko-fi|paypal|opencollective|star-history|contrib\.rocks|readme-typing|komarev|visitor|hits\.|app\.netlify\.com|vercel\.com\/button/i

export const estBadge = (url: string) => BADGE.test(url)

/**
 * Un chemin d'image du README vers une URL téléchargeable. Relatif : contre la
 * branche par défaut sur raw.githubusercontent. `github.com/…/blob/…` : sa
 * version brute. `null` pour ce qui ne se télécharge pas (ancre, data:, mailto).
 */
export function resoudreImage(src: string, owner: string, repo: string): string | null {
  const brut = src.trim().replace(/^<|>$/g, '').split(/\s+/)[0]
  if (!brut || brut.startsWith('#') || /^(data|mailto):/i.test(brut)) return null
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/`
  let url: URL
  try {
    url = new URL(brut.startsWith('/') ? brut.slice(1) : brut, base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const blob = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname)
  if (url.hostname === 'github.com' && blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`
  return url.href
}

/** Ce qui ressemble à une capture passe devant ; bannière, logo ou icône derrière. */
const CAPTURE = /screen|shot|demo|preview|capture|gif$/i
const VITRINE = /banner|logo|icon|header|social/i
const rang = (url: string) => (CAPTURE.test(url) ? 0 : VITRINE.test(url) ? 2 : 1)

/**
 * Les images d'un README, badges écartés, URL résolues, sans doublon, les
 * captures d'abord puis dans l'ordre d'apparition — beaucoup de README ouvrent
 * sur une bannière au nom du projet, et c'est la capture plus bas qu'on veut.
 * Markdown `![](…)` et HTML `<img src>` ; une largeur déclarée sous 200 px
 * (`width="64"`) est un picto, on l'écarte d'emblée.
 */
export function imagesDuReadme(md: string, owner: string, repo: string): string[] {
  const sansCode = md.replace(/```[\s\S]*?```/g, '')
  const trouvees: { at: number; src: string }[] = []
  for (const m of sansCode.matchAll(/!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)/g)) trouvees.push({ at: m.index, src: m[1] })
  for (const m of sansCode.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(m[0])?.[1]
    const largeur = /\bwidth\s*=\s*["']?(\d+)(?!\s*%)/i.exec(m[0])?.[1]
    if (src && !(largeur && Number(largeur) < 200)) trouvees.push({ at: m.index, src })
  }
  const vues = new Set<string>()
  const out: string[] = []
  for (const { src } of trouvees.sort((a, b) => a.at - b.at)) {
    const url = resoudreImage(src, owner, repo)
    if (url === null || estBadge(url) || vues.has(url)) continue
    vues.add(url)
    out.push(url)
  }
  return out.sort((a, b) => rang(a) - rang(b))
}

// ── Le cadrage sur la toile ──────────────────────────────────────────────

export type Cadrage =
  | { mode: 'recadrer'; left: number; top: number; width: number; height: number }
  | { mode: 'encadrer' }

/**
 * Comment poser une image de `w`×`h` sur une toile de rapport `aspect` (2:1).
 *
 * Proche du format : on RECADRE, ancré en haut pour une page web (l'en-tête et
 * le titre sont en haut, le pied de page ne manque à personne), centré sinon.
 * Trop loin du format (un logo carré, une capture de téléphone) : recadrer
 * amputerait l'essentiel, on ENCADRE — l'image entière, sur un fond.
 */
export function cadrer(w: number, h: number, aspect: number, ancre: 'haut' | 'centre'): Cadrage {
  const rapport = w / h / aspect
  if (rapport < 0.7 || rapport > 1.4) return { mode: 'encadrer' }
  if (rapport >= 1) {
    const width = Math.round(h * aspect)
    return { mode: 'recadrer', left: Math.round((w - width) / 2), top: 0, width, height: h }
  }
  const height = Math.round(w / aspect)
  return { mode: 'recadrer', left: 0, top: ancre === 'haut' ? 0 : Math.round((h - height) / 2), width: w, height }
}
