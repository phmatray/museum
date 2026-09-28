/**
 * La constellation de la verrière : chaque dépôt accroché est une étoile dorée
 * sous le verre, chaque salle une constellation qui porte son nom, ses étoiles
 * reliées par un filet d'or — le ciel doré de Grand Central, sous la nef d'Orsay.
 *
 * On travaille sur la verrière DÉROULÉE : `u` court le long de la nef (en z),
 * `v` le long de l'arc (en mètres de voûte). Les salles s'y rangent en grille,
 * les étoiles s'y placent par hachage de leur clé, puis tout est enroulé sur le
 * cylindre, un peu sous le verre.
 *
 * Pur : ni three ni React. Déterministe : même accrochage, même ciel.
 */
import type { Accrochage } from './hang.ts'

/** La nef de `tools/blender/build-nef.py` : axe, naissance, rayon, pignons, verrière. */
const NEF = { cx: 24, naissance: 12.6, rayon: 8, z0: 12, z1: 40, travee: 3.5, arc: 0.7 }
const VERRIERE = { t0: (52 * Math.PI) / 180, t1: (128 * Math.PI) / 180 }
/** Sous la résille (rayon 7,92) et en retrait des arcs doubleaux. */
const RAYON = 7.7
const COLONNES = 7
const MARGE = 0.5

export interface Etoile {
  key: string
  salle: string
  x: number
  y: number
  z: number
  /** Le rayon de l'étoile, en mètres : elle grandit avec le logarithme de ses étoiles GitHub. */
  taille: number
}

export interface Constellation {
  salle: string
  nom: string
  etoiles: Etoile[]
  /** Les filets d'or : un arbre couvrant minimal, indices dans `etoiles`. */
  filets: [number, number][]
  /** Où poser le nom : sous la constellation. */
  etiquette: { x: number; y: number; z: number }
}

/** FNV-1a : un hachage stable d'une chaîne, dans [0, 1). */
function hache(texte: string, sel: string): number {
  let h = 0x811c9dc5
  for (const c of `${sel}:${texte}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return (h >>> 0) / 4294967296
}

/** Enroule (u, v) sur le cylindre de rayon `r`, `v` en mètres d'arc depuis le début de la verrière. */
export function enrouler(u: number, v: number, r = RAYON): { x: number; y: number; z: number } {
  const t = VERRIERE.t0 + v / NEF.rayon
  return { x: NEF.cx - r * Math.cos(t), y: NEF.naissance + r * Math.sin(t), z: u }
}

/** Écarte `u` des arcs doubleaux : une étoile derrière un arc serait perdue. */
function horsDesArcs(u: number): number {
  const k = Math.round((u - NEF.z0) / NEF.travee)
  const arc = NEF.z0 + k * NEF.travee
  const garde = NEF.arc / 2 + 0.15
  if (Math.abs(u - arc) >= garde) return u
  return u < arc ? arc - garde : arc + garde
}

function arbreCouvrant(pts: { u: number; v: number }[]): [number, number][] {
  if (pts.length < 2) return []
  const dans = new Set([0])
  const out: [number, number][] = []
  while (dans.size < pts.length) {
    let meilleur: [number, number] | null = null
    let dmin = Infinity
    for (const i of dans)
      for (let j = 0; j < pts.length; j++) {
        if (dans.has(j)) continue
        const d = Math.hypot(pts[i].u - pts[j].u, pts[i].v - pts[j].v)
        if (d < dmin) [dmin, meilleur] = [d, [i, j]]
      }
    out.push(meilleur!)
    dans.add(meilleur![1])
  }
  return out
}

export function constellations(accrochage: Accrochage, etoilesGithub: ReadonlyMap<string, number>): Constellation[] {
  const salles = accrochage.rooms.filter((r) => r.placements.length > 0)
  const rangs = Math.ceil(salles.length / COLONNES)
  const [longueur, hauteur] = [NEF.z1 - NEF.z0, NEF.rayon * (VERRIERE.t1 - VERRIERE.t0)]
  const [du, dv] = [longueur / COLONNES, hauteur / rangs]
  return salles.map((salle, i) => {
    const [cu, cv] = [NEF.z0 + (i % COLONNES) * du, Math.floor(i / COLONNES) * dv]
    const pts = salle.placements.map((p) => ({
      key: p.key,
      u: horsDesArcs(cu + MARGE + hache(p.key, 'u') * (du - 2 * MARGE)),
      v: cv + MARGE + hache(p.key, 'v') * (dv - 2 * MARGE - 0.6),
    }))
    const etoiles = pts.map(({ key, u, v }) => ({
      key,
      salle: salle.id,
      ...enrouler(u, v),
      taille: Math.min(0.34, 0.09 + 0.04 * Math.log2(1 + (etoilesGithub.get(key) ?? 0))),
    }))
    return {
      salle: salle.id,
      nom: salle.name,
      etoiles,
      filets: arbreCouvrant(pts),
      etiquette: enrouler(cu + du / 2, cv + dv - 0.35, RAYON - 0.02),
    }
  })
}

/** Le point de l'axe de la nef en face d'une position : ce vers quoi regarde une étiquette. */
export const versLAxe = (z: number): [number, number, number] => [NEF.cx, NEF.naissance, z]
