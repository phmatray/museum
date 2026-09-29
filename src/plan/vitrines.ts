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
import type { Accrochage } from './hang.ts'
import { INT } from './svg.ts'
import type { Rect } from './types.ts'
import type { Walker } from './walk.ts'

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
  /** La puce en cours : une ligne indentée qui la suit la continue. */
  let puceOuverte: Bloc | null = null
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
      puceOuverte = null
      continue
    }
    const puce = /^([-*+]|\d+\.)\s+(.*)$/.exec(ligne)
    if (puce) {
      finirPara()
      const b: Bloc = { type: 'puce', texte: epurer(puce[2]) }
      pousser(b)
      puceOuverte = blocs[blocs.length - 1] === b ? b : null
      continue
    }
    if (puceOuverte && /^\s/.test(brute)) {
      puceOuverte.texte = `${puceOuverte.texte} ${epurer(ligne)}`
      continue
    }
    puceOuverte = null
    para.push(ligne.replace(/^>\s?/, ''))
  }
  finirPara()
  return blocs
}

/**
 * Un paragraphe qui se lit seul : une vraie phrase, finie. Pas « Expected
 * output: » (le code qu'il annonçait est parti), ni une rangée de liens.
 */
const phrase = (p: string) => p.length >= 40 && /[.!?…]$/.test(p)

/** Les premiers paragraphes, pour le panneau mural : la présentation, pas la notice. */
export function chapeau(blocs: readonly Bloc[], signes = 700): string {
  const paras = blocs.filter((b) => b.type === 'para').map((b) => b.texte).filter(phrase)
  const out: string[] = []
  let n = 0
  for (const p of paras) {
    if (n + p.length > signes && out.length > 0) break
    out.push(p)
    n += p.length
  }
  return out.join('\n\n')
}

// ── Le mur des vitrines ────────────────────────────────────────────────────

/**
 * La salle d'honneur, en nombres : `musee.ts` importe les obstacles des bornes,
 * ce module ne peut donc pas importer le plan (un test vérifie la concordance).
 */
export const SALLE = { x0: 16, x1: 32, z0: 0, z1: 12, sol: 4.8 }
/** Le panneau de MDF peint, comme au musée Cernuschi (`tools/blender/build-vitrines.py`). */
export const PANNEAU = { largeur: 4.2, hauteur: 3.6, epaisseur: 0.04, recul: 0.047 }
/** D'un panneau à l'autre : 30 cm de mur entre deux, où monte une colonne en os. */
const PAS = 4.5
/** La toile dans son cadre doré, à droite du texte : l'image OpenGraph (2 : 1), et le profil du cadre. */
export const TOILE = { u: 1.1, v: 2.0, largeur: 1.36, hauteur: 0.68, profil: 0.16 }
/** La borne, devant la toile : son pied au sol, son écran incliné vers le visiteur. */
export const BORNE = { u: 1.1, recul: 1.95, largeur: 0.6, profondeur: 0.5 }

export interface Vitrine {
  rang: number
  /** Le pied du panneau, au milieu, sur la face du mur ; il regarde le sud (+z), décollé de `PANNEAU.recul` (le lambris). */
  x: number
  y: number
  z: number
  borne: { x: number; z: number }
  /** Le centre de la toile encadrée. */
  toile: { x: number; y: number; z: number }
}

/** Les vitrines, de gauche à droite pour qui regarde le mur : la mieux classée à gauche. */
export const VITRINES: Vitrine[] = Array.from({ length: NOMBRE_VITRINES }, (_, rang) => {
  const x = (SALLE.x0 + SALLE.x1) / 2 + (rang - (NOMBRE_VITRINES - 1) / 2) * PAS
  const z = SALLE.z0 + INT
  return {
    rang, x, y: SALLE.sol, z,
    borne: { x: x + BORNE.u, z: z + BORNE.recul },
    toile: { x: x + TOILE.u, y: SALLE.sol + TOILE.v, z: z + PANNEAU.recul + PANNEAU.epaisseur + 0.012 },
  }
})

/** Les bornes au sol : la marche les contourne. */
export const OBSTACLES_BORNES: Rect[] = VITRINES.map(({ borne }) => ({
  x: borne.x - BORNE.largeur / 2, z: borne.z - BORNE.profondeur / 2, width: BORNE.largeur, depth: BORNE.profondeur,
}))

/**
 * Le socle de la sculpture d'une vitrine (`sculptures.ts`) : à sa gauche, entre
 * deux panneaux, devant le pilastre en os — la borne tient la droite. Ni le
 * texte, ni la toile, ni la borne n'est masqué, et on ne passe pas là : contre
 * le mur, entre deux lecteurs. `largeur` × `profondeur` borne l'emprise de
 * tout socle déclaré.
 */
export const SOCLE = { u: -PAS / 2, recul: 1.0, largeur: 0.8, profondeur: 0.6 }

/**
 * Chaque emplacement est un obstacle, qu'une pièce y soit exposée ou non : le
 * plan est figé, les projets des vitrines ne se connaissent qu'au chargement du
 * catalogue. ponytail: un emplacement vide reste un bloc invisible de 80 × 60 cm
 * contre le mur ; des obstacles dynamiques de la marche s'il gêne un jour.
 */
export const OBSTACLES_SOCLES: Rect[] = VITRINES.map((v) => ({
  x: v.x + SOCLE.u - SOCLE.largeur / 2, z: v.z + SOCLE.recul - SOCLE.profondeur / 2, width: SOCLE.largeur, depth: SOCLE.profondeur,
}))

/** On consulte une borne à moins de 2,50 m, devant son écran, en la regardant (40° de part et d'autre). */
const PORTEE_BORNE = 2.5
const CONE_BORNE = Math.cos((40 * Math.PI) / 180)

/** Le rang de la borne que le visiteur consulte, ou `null`. La plus proche l'emporte. */
export function borneRegardee(w: Pick<Walker, 'x' | 'y' | 'z' | 'yaw'>): number | null {
  if (Math.abs(w.y - SALLE.sol) > 1) return null
  const [vx, vz] = [-Math.sin(w.yaw), -Math.cos(w.yaw)]
  let meilleure: number | null = null
  let d2min = PORTEE_BORNE * PORTEE_BORNE
  for (const v of VITRINES) {
    const [dx, dz] = [v.borne.x - w.x, v.borne.z - w.z]
    const d2 = dx * dx + dz * dz
    // Devant l'écran, qui regarde le sud : le visiteur est au sud de la borne.
    if (d2 > d2min || dz > -0.1) continue
    if ((dx * vx + dz * vz) / Math.sqrt(d2) < CONE_BORNE) continue
    meilleure = v.rang
    d2min = d2
  }
  return meilleure
}

/**
 * Le texte du panneau en deux colonnes : des mots rangés en lignes d'au plus
 * `parLigne` signes, `lignes` lignes par colonne, un blanc entre deux
 * paragraphes. Ce qui ne tient pas est coupé au dernier mot, suivi de « … ».
 * Une estimation — troika fait sa propre césure — d'où une marge chez l'appelant.
 */
export function enColonnes(texte: string, parLigne: number, lignes: number): [string, string] {
  const rangees: string[] = []
  for (const para of texte.split(/\n\n+/)) {
    if (rangees.length) rangees.push('')
    let ligne = ''
    for (const mot of para.split(/\s+/).filter(Boolean)) {
      if (ligne && ligne.length + 1 + mot.length > parLigne) {
        rangees.push(ligne)
        ligne = mot
      } else ligne = ligne ? `${ligne} ${mot}` : mot
    }
    if (ligne) rangees.push(ligne)
  }
  const deborde = rangees.length > 2 * lignes
  const gardees = rangees.slice(0, 2 * lignes)
  if (deborde) {
    // Couper au dernier mot : la dernière ligne perd de quoi porter « … ».
    const der = gardees.length - 1
    const mots = gardees[der].split(' ')
    while (mots.length > 1 && mots.join(' ').length + 1 > parLigne) mots.pop()
    gardees[der] = `${mots.join(' ').replace(/[,;:.—–-]+$/, '')}…`
  }
  // Une colonne ne commence pas par un blanc.
  let coupe = Math.min(lignes, gardees.length)
  while (coupe < gardees.length && gardees[coupe] === '') coupe++
  // Les lignes d'un même paragraphe se rejoignent : troika recoupe à sa largeur.
  const recoller = (rs: string[]) => rs.join('\n').trim().split(/\n\n+/).map((p) => p.replace(/\n/g, ' ')).join('\n\n')
  return [recoller(gardees.slice(0, coupe)), recoller(gardees.slice(coupe))]
}

/**
 * L'accrochage, plus les trois toiles des vitrines en salle d'honneur : pour
 * que `projecteurs.ts` leur pende aussi un rail et un projecteur chacune.
 */
export function avecVitrines(accrochage: Accrochage): Accrochage {
  const toiles = VITRINES.map((v) => ({
    key: `vitrine-${v.rang}`, x: v.toile.x, y: v.toile.y, z: v.toile.z, normal: [0, 1] as [number, number],
    width: TOILE.largeur + 2 * TOILE.profil,
  }))
  return {
    ...accrochage,
    rooms: accrochage.rooms.map((r) => (r.id === SALLE_VITRINES ? { ...r, placements: [...r.placements, ...toiles] } : r)),
  }
}
