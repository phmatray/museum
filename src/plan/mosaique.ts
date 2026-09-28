/**
 * La mosaïque des contributions : le graphe du profil GitHub, une tesselle par
 * jour, incrusté dans le dallage de l'allée centrale de la nef.
 *
 * Le graphe se lit d'ordinaire de gauche à droite ; ici on le parcourt en
 * marchant. La plus vieille semaine est au pied, côté entrée ; la plus récente
 * au bout, vers l'escalier. Les jours vont du dimanche (ouest) au samedi (est) :
 * c'est le graphe de GitHub tourné d'un quart de tour, tel qu'on le verrait en
 * le posant à plat devant soi. Pur : des semaines entrent, des positions sortent.
 */

export interface JourDeContribution {
  date: string
  count: number
  /** 0 à 4 : les quartiles de GitHub, 0 pour un jour sans contribution. */
  level: number
}

export interface Contributions {
  login: string
  generatedAt: string
  total: number
  weeks: JourDeContribution[][]
}

export interface Tesselle extends JourDeContribution {
  x: number
  z: number
}

/** Le pas des tesselles et leur côté : 3 cm de joint entre deux. */
export const PAS = 0.25
export const COTE = 0.22
/** L'axe de l'allée, et le bord sud des tesselles : 1,75 m devant le seuil. */
const AXE = 24
const SUD = 35.25
/** La bande de granit autour des tesselles : les initiales des mois à l'ouest, les jours au sud, l'année au nord. */
const MARGE = 0.4

/** Le jour de la semaine d'une date « AAAA-MM-JJ », 0 pour dimanche, sans fuseau. */
function jourDeSemaine(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

/**
 * Le niveau d'une tesselle, sur une échelle LOGARITHMIQUE du nombre de
 * contributions, bornée par le plus gros jour de l'année. Les quartiles de
 * GitHub mettaient 285 jours sur 367 au niveau 1 : quelques jours à plusieurs
 * centaines écrasaient l'échelle, et la mosaïque était d'un or uniforme.
 */
export function niveauLog(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((4 * Math.log1p(count)) / Math.log1p(max))))
}

/** Une tesselle par jour du calendrier, semaine après semaine en remontant l'allée. */
export function tesselles(weeks: JourDeContribution[][]): Tesselle[] {
  const max = Math.max(0, ...weeks.flat().map((j) => j.count))
  return weeks.flatMap((semaine, w) =>
    semaine.map((j) => ({ ...j, level: niveauLog(j.count, max), x: AXE + (jourDeSemaine(j.date) - 3) * PAS, z: SUD - (w + 0.5) * PAS })),
  )
}

/** Le panneau de granit qui porte la mosaïque, cadre de laiton compris. */
export function panneau(nSemaines: number): { x0: number; x1: number; z0: number; z1: number } {
  return { x0: AXE - 3.5 * PAS - MARGE, x1: AXE + 3.5 * PAS + MARGE, z0: SUD - nSemaines * PAS - MARGE, z1: SUD + MARGE }
}

const INITIALES = 'JFMAMJJASOND'

/**
 * L'initiale de chaque mois, en face de la première semaine qui en contient le
 * 1er — comme les étiquettes au-dessus du graphe de GitHub. Un mois dont le 1er
 * tombe dans la toute première semaine partielle n'a pas la place : on l'omet.
 */
export function moisDeLaMosaique(weeks: JourDeContribution[][]): { lettre: string; z: number }[] {
  const out: { lettre: string; z: number }[] = []
  weeks.forEach((semaine, w) => {
    const premier = semaine.find((j) => j.date.endsWith('-01'))
    if (premier === undefined || (w === 0 && semaine[0] !== premier)) return
    out.push({ lettre: INITIALES[Number(premier.date.slice(5, 7)) - 1], z: SUD - (w + 0.5) * PAS })
  })
  return out
}

/** La date locale du visiteur, au format du calendrier. */
export function dateDuJour(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** La tesselle d'aujourd'hui, ou la plus récente si le calendrier date d'hier. */
export function indexDuJour(t: Tesselle[], aujourdhui: string): number {
  const i = t.findIndex((j) => j.date === aujourdhui)
  return i >= 0 ? i : t.length - 1
}

/** « 1 234 contributions cette année », en chiffres groupés à la française. */
export function texteDePlaque(total: number): string {
  return `${total.toLocaleString('fr-FR').replace(/\s/g, ' ')} contribution${total > 1 ? 's' : ''} cette année`
}
