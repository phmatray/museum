/**
 * Les vitrines de la salle d'honneur : les trois meilleurs projets du
 * propriétaire du musée, présentés à la manière du musée Cernuschi — un grand
 * panneau de couleur avec le texte du README, la toile encadrée, une borne.
 *
 * « Meilleurs » : les plus étoilés parmi les dépôts DES PROPRIÉTAIRES du musée
 * (`catalogue.owners`) — un dépôt d'un tiers accroché dans la collection n'est
 * pas « mon projet ». Ils quittent l'accrochage courant : le mur nord de la
 * salle d'honneur leur est réservé.
 *
 * Pur : ni three ni React.
 */
import type { Artwork } from '../domain/types.ts'

export const SALLE_VITRINES = 'honneur'
export const NOMBRE_VITRINES = 3

/** Les meilleurs projets : plus étoilés d'abord, clé en départage. `tools/fetch-github.ts` suit la même règle. */
export function choisirVitrines(artworks: readonly Artwork[], owners: readonly string[], n = NOMBRE_VITRINES): Artwork[] {
  const miens = new Set(owners)
  return artworks
    .filter((a) => miens.has(a.owner) && !a.isFork)
    .sort((a, b) => b.stars - a.stars || a.key.localeCompare(b.key))
    .slice(0, n)
}

/** Le fichier du README d'un dépôt, écrit par `tools/fetch-github.ts`. */
export const cheminReadme = (key: string) => `data/readmes/${key.replace('/', '__')}.md`

export type Bloc = { type: 'titre'; niveau: number; texte: string } | { type: 'para'; texte: string } | { type: 'puce'; texte: string }

/** Enlève du markdown en ligne ce qui ne se lit pas : liens, emphase, code, balises, émojis décoratifs. */
function epurer(texte: string): string {
  return texte
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?\S|\S)\1/g, '$2')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\u{FE0F}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Le README en blocs lisibles : titres, paragraphes, puces. Sans code, images,
 * badges, tableaux ni sommaire. S'arrête à `limite` signes : une borne de
 * musée n'est pas la documentation complète.
 */
export function readmeEnBlocs(md: string, limite = 6000): Bloc[] {
  const sansCode = md.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const blocs: Bloc[] = []
  let para: string[] = []
  let total = 0
  const pousser = (b: Bloc) => {
    if (total >= limite || b.texte.length === 0) return
    blocs.push(b)
    total += b.texte.length
  }
  const finirPara = () => {
    if (para.length) pousser({ type: 'para', texte: epurer(para.join(' ')) })
    para = []
  }
  let dansSommaire = false
  for (const brute of sansCode.split('\n')) {
    const ligne = brute.trim()
    const titre = /^(#{1,6})\s+(.*)$/.exec(ligne)
    if (titre) {
      finirPara()
      const texte = epurer(titre[2])
      dansSommaire = /^(table (of )?contents|sommaire|contents)$/i.test(texte)
      if (!dansSommaire) pousser({ type: 'titre', niveau: titre[1].length, texte })
      continue
    }
    if (dansSommaire) continue
    if (ligne === '' || /^(\||[-=*_]{3,}$)/.test(ligne) || /^\[!\[/.test(ligne) || /^!\[/.test(ligne)) {
      finirPara()
      continue
    }
    const puce = /^([-*+]|\d+\.)\s+(.*)$/.exec(ligne)
    if (puce) {
      finirPara()
      pousser({ type: 'puce', texte: epurer(puce[2]) })
      continue
    }
    para.push(ligne.replace(/^>\s?/, ''))
  }
  finirPara()
  return blocs
}

/** Les premiers paragraphes, pour le panneau mural : la présentation, pas la notice. */
export function chapeau(blocs: readonly Bloc[], signes = 700): string {
  const paras = blocs.filter((b) => b.type === 'para').map((b) => b.texte)
  const out: string[] = []
  let n = 0
  for (const p of paras) {
    if (n + p.length > signes && out.length > 0) break
    out.push(p)
    n += p.length
  }
  return out.join('\n\n')
}
