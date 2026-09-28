/**
 * La saison du jardin, au jour de l'année, à Bruxelles (hémisphère nord) :
 * quand les érables rougissent, se dénudent et rebourgeonnent, quand les
 * azalées fleurissent, quand la pelouse jaunit ou s'éteint.
 *
 * Pur et continu : chaque grandeur glisse d'un jour à l'autre (des rampes
 * lissées), jamais de saut au changement de mois. Les dates sont celles d'un
 * jardin de la région bruxelloise, à quelques jours près d'une année sur l'autre.
 */

export interface Saison {
  /** Le feuillage tourne : 0 vert, 1 orange et rouge (les pourpres foncent). */
  feuillage: number
  /** La chute : 0 houppier plein, 1 branches nues. */
  chute: number
  /** Les azalées (et quelques érables) en fleur, 0 à 1. */
  floraison: number
  /** Le vert tendre des jeunes feuilles au printemps, 0 à 1. */
  tendre: number
  /** Les feuilles mortes sur la pelouse, 0 à 1. */
  feuillesAuSol: number
  /** La pelouse : `jaune` à la fin de l'été sec, `terne` l'hiver. */
  pelouse: { jaune: number; terne: number }
}

const lisse = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Une bosse : monte de `a` à `b`, tient jusqu'à `c`, redescend à `d` (jours de
 * l'année, `d` peut dépasser 365 pour enjamber le nouvel an).
 */
function bosse(j: number, a: number, b: number, c: number, d: number): number {
  const un = (x: number) => lisse(a, b, x) * (1 - lisse(c, d, x))
  return Math.max(un(j), un(j + 365))
}

/** La saison au jour `j` de l'année (1 = 1er janvier). */
export function saisonDuJour(j: number): Saison {
  return {
    // Dès la mi-septembre, plein fin octobre ; retombe à zéro au débourrement.
    feuillage: bosse(j, 255, 298, 436, 454),
    // Mi-octobre → fin novembre : nu ; les bourgeons rouvrent de mi-mars à fin avril.
    chute: bosse(j, 288, 330, 440, 480),
    // Les azalées : fin avril à mi-juin.
    floraison: bosse(j, 105, 122, 158, 178),
    tendre: bosse(j, 80, 110, 140, 175),
    // Tombées avec la chute, ratissées ou pourries au cœur de l'hiver.
    feuillesAuSol: bosse(j, 280, 305, 345, 380),
    pelouse: { jaune: bosse(j, 190, 225, 245, 275), terne: bosse(j, 320, 345, 420, 455) },
  }
}

export function jourDeLAnnee(date: Date): number {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86400000)
}

/** Le jour représentatif de chaque saison forcée par `?saison=`. */
const JOURS: Record<string, number> = { printemps: 128, ete: 196, automne: 297, hiver: 15 }

/** La saison à une date, ou celle que l'adresse force (`?saison=automne`). */
export function saisonA(date: Date, recherche = ''): Saison {
  return saisonDuJour(JOURS[new URLSearchParams(recherche).get('saison') ?? ''] ?? jourDeLAnnee(date))
}
