/**
 * La visite en VR, sans three : ce que les mains et le regard demandent à la
 * marche (`plan/walk.ts`), et le confort de celui qui porte le casque.
 *
 * Deux façons d'être là, un seul chemin (WebXR) :
 *
 * - un VRAI CASQUE, deux manettes : le stick gauche fait marcher (vers où l'on
 *   regarde), le droit tourne par crans de 30° — la rotation continue est ce qui
 *   rend malade ; stick gauche enfoncé, on presse le pas ;
 * - un CARDBOARD, un seul bouton (un tapotement sur l'écran) : chaque
 *   « sélection » lance ou arrête la marche, droit devant le regard. On s'arrête
 *   aussi en butant (`walk.ts` fait glisser le long des murs, jamais à travers).
 *
 * Et pendant qu'on avance ou qu'on tourne, le champ se resserre (une vignette de
 * confort) : l'œil voit le mouvement que l'oreille interne ne sent pas, moins de
 * vision périphérique, moins de nausée.
 */

/** Une manette telle que WebXR la décrit (`XRInputSource` + `Gamepad`). */
export interface Manette {
  handedness: 'left' | 'right' | 'none'
  /** `gaze` (Cardboard), `screen` (téléphone), `tracked-pointer` (casque). */
  targetRayMode: string
  axes: readonly number[]
  boutons: readonly boolean[]
}

export interface EtatVR {
  /** La marche au regard (Cardboard) : lancée ou non. */
  marche: boolean
  /** Le cran de rotation est réarmé (le stick est revenu au centre). */
  arme: boolean
  /** La vignette de confort, de 0 à 1. */
  confort: number
}

export const ETAT_VR: EtatVR = { marche: false, arme: true, confort: 0 }

/** Sous ce débattement, le stick est au repos : les sticks usés dérivent. */
export const ZONE_MORTE = 0.18
/** Un cran de rotation, et les seuils qui le déclenchent puis le réarment. */
export const CRAN = Math.PI / 6
const DECLENCHE = 0.7
const REARME = 0.3

export interface EntreeVR {
  /** −1..1, comme le clavier : vers l'avant du regard. */
  avance: number
  cote: number
  hate: boolean
  /** Radians à tourner le visiteur, cette image. */
  tourner: number
}

/** Le stick, sans sa zone morte, remis à l'échelle : la marche démarre en douceur au bord de la zone. */
function stick(v: number): number {
  const a = Math.abs(v)
  return a < ZONE_MORTE ? 0 : (Math.sign(v) * (a - ZONE_MORTE)) / (1 - ZONE_MORTE)
}

/**
 * Les deux axes d'un stick. `xr-standard` met le stick en axes 2 et 3 (0 et 1
 * étant le pavé tactile, souvent absent) ; d'autres manettes n'ont que 0 et 1.
 */
function axesDuStick(m: Manette): [number, number] {
  return m.axes.length >= 4 ? [m.axes[2], m.axes[3]] : [m.axes[0] ?? 0, m.axes[1] ?? 0]
}

/**
 * Ce que demandent les manettes cette image. Le stick gauche (ou le seul, s'il
 * n'y en a qu'un) fait marcher ; le droit tourne par crans. `selections` : le
 * nombre de « select » reçus depuis l'image précédente (un tapotement du
 * Cardboard) — chacun lance ou arrête la marche au regard.
 */
export function lireEntrees(manettes: readonly Manette[], selections: number, etat: EtatVR): { entree: EntreeVR; etat: EtatVR } {
  let [avance, cote, hate, tourner] = [0, 0, false, 0]
  let { marche, arme } = etat
  const avecStick = manettes.filter((m) => m.targetRayMode === 'tracked-pointer' && m.axes.length >= 2)
  const marcheur = avecStick.find((m) => m.handedness === 'left') ?? (avecStick.length === 1 ? avecStick[0] : undefined)
  const tourneur = avecStick.find((m) => m.handedness === 'right' && m !== marcheur)
  if (marcheur) {
    const [x, y] = axesDuStick(marcheur)
    avance = -stick(y)
    cote = stick(x)
    // Le stick enfoncé (bouton 3 de `xr-standard`) : on presse le pas.
    hate = marcheur.boutons[3] === true
  }
  if (tourneur) {
    const [x] = axesDuStick(tourneur)
    if (arme && Math.abs(x) > DECLENCHE) {
      tourner = -Math.sign(x) * CRAN
      arme = false
    } else if (Math.abs(x) < REARME) arme = true
  }
  // Le Cardboard (et un casque sans manette) : chaque sélection bascule la marche au regard.
  if (selections % 2 === 1) marche = !marche
  // Qui prend un stick reprend la main : la marche au regard s'arrête.
  if (avance !== 0 || cote !== 0) marche = false
  if (marche) avance = 1
  return { entree: { avance, cote, hate, tourner }, etat: { ...etat, marche, arme } }
}

/** Le cap d'une direction de regard dans le plan (x, z) : 0 regarde −z, comme le visiteur de `walk.ts`. */
export function capDuRegard(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/**
 * La vignette de confort : elle se ferme vite quand on part ou qu'on tourne,
 * se rouvre plus doucement à l'arrêt. `vitesse` en m/s, `rotation` en rad/s.
 * Le cran de rotation est instantané : il ferme la vignette d'un coup, le temps
 * qu'elle se rouvre.
 */
export function confort(precedent: number, vitesse: number, rotation: number, dt: number): number {
  const cible = Math.min(1, Math.max(vitesse / 3, rotation / 2))
  const taux = cible > precedent ? 8 : 2.5
  return precedent + (cible - precedent) * (1 - Math.exp(-taux * dt))
}
