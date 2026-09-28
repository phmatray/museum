/**
 * Le soleil du musée : où il est dans le ciel, à un instant et en un lieu, et
 * ce que ça fait au jour. Formules de l'Almanach nautique (précision de l'ordre
 * du centième de degré, bien au-delà de ce que l'œil lit dans un ciel).
 *
 * Pur : une date et des degrés entrent, des degrés et des fractions sortent.
 */

const RAD = Math.PI / 180

export interface Position {
  /** Hauteur au-dessus de l'horizon, en degrés (négative la nuit). */
  elevation: number
  /** Azimut depuis le nord, dans le sens horaire (90 = est), en degrés. */
  azimut: number
}

export function positionDuSoleil(date: Date, latitude: number, longitude: number): Position {
  // Jours depuis J2000.0 (1er janvier 2000, 12 h TT).
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const epsilon = (23.439 - 0.0000004 * n) * RAD
  const ascension = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda))
  const declinaison = Math.asin(Math.sin(epsilon) * Math.sin(lambda))
  // Temps sidéral local, puis angle horaire.
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24
  const H = ((gmst * 15 + longitude) * RAD - ascension)
  const phi = latitude * RAD
  const sinH = Math.sin(phi) * Math.sin(declinaison) + Math.cos(phi) * Math.cos(declinaison) * Math.cos(H)
  const elevation = Math.asin(sinH)
  const azimut = Math.atan2(-Math.sin(H), Math.tan(declinaison) * Math.cos(phi) - Math.sin(phi) * Math.cos(H))
  return { elevation: elevation / RAD, azimut: ((azimut / RAD) + 360) % 360 }
}

const lisse = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export interface Ciel extends Position {
  /** 1 en plein jour, 0 en pleine nuit : le crépuscule civil (−6° à +6°) fait la transition. */
  jour: number
  /** L'or du lever et du coucher : maximal quand le soleil rase l'horizon. */
  crepuscule: number
}

export function cielA(date: Date, latitude: number, longitude: number): Ciel {
  const p = positionDuSoleil(date, latitude, longitude)
  return {
    ...p,
    jour: lisse(-6, 6, p.elevation),
    crepuscule: Math.max(0, 1 - Math.abs(p.elevation - 1) / 8),
  }
}

/** La direction du soleil dans le repère du plan (x est, y haut, z sud), normée. */
export function directionDuSoleil({ elevation, azimut }: Position): [number, number, number] {
  const [h, a] = [elevation * RAD, azimut * RAD]
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)]
}

/**
 * L'heure forcée par l'adresse (`?heure=22:30`), pour voir la nuit en plein
 * jour : aujourd'hui à cette heure locale. `null` sans paramètre ou s'il est illisible.
 */
export function heureDemandee(recherche: string, maintenant: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(recherche).get('heure') ?? '')
  if (m === null || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  const d = new Date(maintenant)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d
}
