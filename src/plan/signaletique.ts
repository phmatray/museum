/**
 * Les petits blocs verts « Sortie » : au-dessus de l'entrée, côté hall, et au
 * rez-de-chaussée au-dessus de chaque porte d'une galerie vers le hall, côté
 * galerie — le chemin de la sortie, comme dans tout musée recevant du public.
 *
 * Pur : ni three ni React. Tirés des ouvertures du plan.
 */
import { LINTEAU } from './portes.ts'
import { INT } from './svg.ts'
import type { Plan } from './types.ts'

export interface Sortie {
  x: number
  /** Le centre du bloc. */
  y: number
  z: number
  /** Lacet : le bloc regarde +Z, une rotation θ l'envoie vers (sin θ, cos θ). */
  lacet: number
}

/** 36 × 14 cm sur 6 cm, un luminaire de sortie ordinaire, posé sur la peau du mur : la pierre du hall (3 cm), la peinture des galeries. */
export const BLOC_SORTIE = { largeur: 0.36, hauteur: 0.14, epaisseur: 0.06 }
/** Au-dessus du chambranle (architrave et frise) d'une porte, au-dessus des portes vitrées de l'entrée. */
const AU_DESSUS_DES_PORTES = LINTEAU + 0.62
const AU_DESSUS_DE_L_ENTREE = 3.25
const decolle = (peau: number) => INT + peau + BLOC_SORTIE.epaisseur / 2 + 0.003

export function sorties(plan: Plan): Sortie[] {
  const rdc = plan.levels.find((l) => l.elevation === 0)
  if (!rdc) return []
  return rdc.openings.flatMap((o): Sortie[] => {
    const a = rdc.rooms.find((r) => r.id === o.a)!
    const vertical = Math.abs(o.x - a.x) < 1e-6 || Math.abs(o.x - a.x - a.width) < 1e-6
    // De quel côté du mur est la pièce d'où l'on sort : le signe de son centre.
    const cote = (id: string | null) => {
      const r = rdc.rooms.find((s) => s.id === id)
      return r === undefined ? 0 : Math.sign(vertical ? r.x + r.width / 2 - o.x : r.z + r.depth / 2 - o.z)
    }
    const poser = (s: number, y: number, peau: number): Sortie =>
      vertical
        ? { x: o.x + s * decolle(peau), y, z: o.z, lacet: (s * Math.PI) / 2 }
        : { x: o.x, y, z: o.z + s * decolle(peau), lacet: s > 0 ? 0 : Math.PI }
    if (o.kind === 'entrance') return [poser(cote(o.a), AU_DESSUS_DE_L_ENTREE, 0.03)]
    if (o.kind !== 'door') return []
    const galerie = o.a === 'hall' ? o.b : o.b === 'hall' ? o.a : null
    return galerie === null ? [] : [poser(cote(galerie), AU_DESSUS_DES_PORTES, 0.002)]
  })
}
