/**
 * Les cartels du plan : un par toile de `accrochage.json`, à droite du cadre.
 *
 * Dérivés de l'accrochage tel quel — pas de nouveau format. Le mur est celui de
 * la toile : même normale, décollé de quelques millimètres. La droite est celle
 * du visiteur qui regarde le mur, comme dans une salle de musée.
 *
 * `hangPlan` espace les toiles d'au moins 1,40 m de mur libre et laisse un
 * mètre dans chaque angle : un cartel de 30 cm à côté du cadre tient toujours.
 */
import type { Artwork } from '../domain/types.ts'
import type { Accrochage } from './hang.ts'

export const CARTEL_LARGEUR = 0.3
/** Le cadre (6 cm) et 10 cm de blanc avant le cartel. */
const ECART = 0.16
/** Sous l'axe de la toile, à hauteur de lecture. */
const SOUS_AXE = 0.35
const DECOLLEMENT = 0.005
/** Au-delà, le titre passerait sur trois lignes d'un cartel de 30 cm. */
const TITRE_MAX = 40

export interface CartelPlacement {
  key: string
  x: number
  y: number
  z: number
  /** Lacet qui tourne la face +Z du cartel selon la normale du mur. */
  rotation: number
}

export function cartelPlacements(accrochage: Accrochage): CartelPlacement[] {
  return accrochage.rooms.flatMap((r) =>
    r.placements.map((p) => {
      const [nx, nz] = p.normal
      // La droite du visiteur face au mur : haut × normale.
      const d = p.width / 2 + ECART + CARTEL_LARGEUR / 2
      return {
        key: p.key,
        x: p.x + nz * d + nx * DECOLLEMENT,
        y: p.y - SOUS_AXE,
        z: p.z - nx * d + nz * DECOLLEMENT,
        rotation: Math.atan2(nx, nz),
      }
    }))
}

/** Coupe sans casser un mot quand c'est possible, jamais plus long que l'entrée. */
function couper(texte: string, limite: number): string {
  const propre = texte.trim().replace(/\s+/g, ' ')
  if (propre.length <= limite) return propre
  const coupe = propre.slice(0, limite)
  const espace = coupe.lastIndexOf(' ')
  return `${(espace > limite * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`
}

/** Trois lignes dans un seul bloc : un bloc de texte, un appel de dessin. */
export function cartelTexte(a: Pick<Artwork, 'title' | 'owner' | 'language' | 'stars' | 'createdAt'>): string {
  const annee = a.createdAt.slice(0, 4)
  return [
    couper(a.title, TITRE_MAX),
    [a.owner, a.language].filter(Boolean).join(' · '),
    [a.stars > 0 ? `★ ${a.stars.toLocaleString('fr-FR')}` : null, annee || null].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n')
}
