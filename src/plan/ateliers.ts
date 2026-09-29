/**
 * « L'atelier en coupe » : dans la galerie du nord du rez-de-chaussée, à
 * l'aplomb des trois vitrines de la salle d'honneur (`vitrines.ts`), la coupe
 * de chacun des mêmes projets — ses couches en plaques de verre superposées,
 * ses projets en blocs, ses références en fils (`domain/atelier.ts`).
 *
 * Pourquoi là : la salle d'honneur montre le projet fini, l'atelier juste
 * dessous montre comment il est bâti. La galerie est traversée d'ouest en est
 * par l'axe des portes (z = 6) : on passe devant sans détour, et la banquette
 * au sud de l'axe les regarde déjà. Les trois socles prennent la bande nord
 * qu'occupait la cimaise, plus basse et transparente qu'elle.
 *
 * Pur : ni three ni React. `musee.ts` importe les obstacles.
 */
import type { Atelier } from '../domain/atelier.ts'
import type { Rect } from './types.ts'
import { VITRINES } from './vitrines.ts'

export const SALLE_ATELIERS = 'r-n'

/** Le socle de bois et son cadre de laiton ; les plaques de verre ; leur pas vertical. */
export const SOCLE_ATELIER = { largeur: 1.3, profondeur: 0.9, hauteur: 0.5 }
export const PLAQUE = { largeur: 1.16, profondeur: 0.6, epaisseur: 0.012 }
/** De la première plaque au-dessus du socle, puis d'une plaque à l'autre. */
export const PAS_PLAQUES = { premiere: 0.13, pas: 0.26 }
/** Les plaques reculent un peu : devant, le rebord du socle porte le cartel. */
export const RECUL_PLAQUES = -0.08

/** Au nord de l'axe des portes (z 5–7) : 2,85 m libres jusqu'au mur nord, 1,2 m jusqu'à l'axe. */
const Z = 3.4

export interface PlaceAtelier {
  rang: number
  x: number
  z: number
}

/** Un atelier sous chaque vitrine, face au sud. */
export const ATELIERS: PlaceAtelier[] = VITRINES.map((v) => ({ rang: v.rang, x: v.x, z: Z }))

/** La colonne des légendes, à gauche des plaques, déborde du socle : la marche la contourne aussi, des deux côtés. */
export const LEGENDE = { debord: 0.22 }

export const OBSTACLES_ATELIERS: Rect[] = ATELIERS.map(({ x, z }) => ({
  x: x - SOCLE_ATELIER.largeur / 2 - LEGENDE.debord, z: z - SOCLE_ATELIER.profondeur / 2,
  width: SOCLE_ATELIER.largeur + 2 * LEGENDE.debord, depth: SOCLE_ATELIER.profondeur,
}))

// ── La coupe, en coordonnées locales : origine au pied du socle, face vers +z ──

export interface PlaqueDisposee {
  couche: number
  y: number
  nom: string
  role: string
}

export interface BlocDispose {
  id: string
  couche: number
  /** Le centre du bloc. */
  x: number
  y: number
  z: number
  cote: number
  hauteur: number
  nom: string
  legende: string
  /** Où se tient le nom : debout sur la plaque devant le bloc (première rangée), ou posé sur lui (seconde, que la première cacherait). */
  etiquette: [number, number, number]
  /** La largeur que le nom peut prendre sans mordre sur ses voisins. */
  largeurEtiquette: number
}

export interface Fil {
  /** Les quatre points d'une courbe de Bézier cubique, de la dépendance vers le projet qui en dépend. */
  points: [number, number, number][]
}

export interface Coupe {
  plaques: PlaqueDisposee[]
  blocs: BlocDispose[]
  fils: Fil[]
  /** Le haut du cadre de laiton, un peu au-dessus de la dernière plaque. */
  hauteur: number
}

const BLOC = { min: 0.07, max: 0.2, hauteur: 0.035, bonus: 0.03 }

/**
 * Les blocs sur leurs plaques, leur taille selon le poids du code (racine :
 * un projet dix fois plus lourd n'écrase pas les autres), et les fils.
 * Jusqu'à quatre blocs, une rangée ; au-delà, deux, la seconde en quinconce
 * derrière la première pour que chaque nom se lise.
 */
export function disposerCoupe(atelier: Atelier): Coupe {
  const lourd = Math.max(1, ...atelier.couches.flatMap((c) => c.modules.map((m) => m.octets)))
  const plaques: PlaqueDisposee[] = []
  const blocs: BlocDispose[] = []
  atelier.couches.forEach((couche, i) => {
    const y = SOCLE_ATELIER.hauteur + PAS_PLAQUES.premiere + i * PAS_PLAQUES.pas
    plaques.push({ couche: i, y, nom: couche.nom, role: couche.role })
    const n = couche.modules.length
    const devant = n <= 4 ? n : Math.ceil(n / 2)
    const fente = PLAQUE.largeur / Math.max(devant, 1)
    couche.modules.forEach((m, j) => {
      const rangee = j < devant ? 0 : 1
      const k = rangee === 0 ? j : j - devant
      // Derrière, en quinconce : entre deux blocs de devant.
      const x = -PLAQUE.largeur / 2 + fente * (k + 0.5 + rangee * 0.5)
      const poids = Math.sqrt(m.octets / lourd)
      const cote = BLOC.min + (Math.min(BLOC.max, fente * 0.6) - BLOC.min) * poids
      const hauteur = BLOC.hauteur + BLOC.bonus * poids
      const z = RECUL_PLAQUES + (n <= 4 ? 0.02 : rangee === 0 ? 0.12 : -0.12)
      const y0 = y + PLAQUE.epaisseur / 2
      blocs.push({
        id: m.id, couche: i, x, y: y0 + hauteur / 2, z, cote, hauteur,
        nom: m.nom, legende: m.fichiers ? `${m.fichiers} fichier${m.fichiers > 1 ? 's' : ''}` : 'aucun code',
        etiquette: rangee === 0 ? [x, y0 + 0.003, z + cote / 2 + 0.02] : [x, y0 + hauteur + 0.006, z],
        largeurEtiquette: Math.min(0.27, fente * 0.92),
      })
    })
  })
  const parId = new Map(blocs.map((b) => [b.id, b]))
  const fils: Fil[] = []
  for (const { de, vers } of atelier.liens) {
    const a = parId.get(vers)
    const b = parId.get(de)
    if (!a || !b) continue
    // Du dessus de la dépendance au dessous du projet qui s'en sert, par l'arrière des blocs
    // et en s'arrondissant vers le fond : les noms, debout devant les blocs, restent dégagés.
    const p0: [number, number, number] = [a.x, a.y + a.hauteur / 2, a.z - a.cote / 4]
    const p3: [number, number, number] = [b.x, b.y - b.hauteur / 2 - PLAQUE.epaisseur, b.z - b.cote / 4]
    const meme = a.couche === b.couche
    const dy = meme ? 0.12 : Math.max(0.06, (p3[1] - p0[1]) * 0.35)
    // Les longs fils s'arrondissent plus loin : ils ne se couchent pas sur les courts. Jamais hors du cadre.
    const fond = RECUL_PLAQUES - PLAQUE.profondeur / 2 + 0.03
    const recul = (z: number) => Math.max(fond, z - (0.04 + 0.1 * Math.abs(p3[1] - p0[1])))
    const haut: [number, number, number] = [b.x, b.y + b.hauteur / 2, b.z - b.cote / 4]
    fils.push({
      points: meme
        ? [p0, [p0[0], p0[1] + dy, recul(p0[2])], [haut[0], haut[1] + dy, recul(haut[2])], haut]
        : [p0, [p0[0], p0[1] + dy, recul(p0[2])], [p3[0], p3[1] - dy, recul(p3[2])], p3],
    })
  }
  const hauteur = SOCLE_ATELIER.hauteur + PAS_PLAQUES.premiere + (atelier.couches.length - 1) * PAS_PLAQUES.pas + 0.2
  return { plaques, blocs, fils, hauteur }
}
