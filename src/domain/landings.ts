/**
 * Les PALIERS : les endroits où un escalier rencontre une dalle.
 *
 * ── Pourquoi ça mérite un module ──
 *
 * L'escalier hélicoïdal vit DANS la trémie de l'atrium, et la trémie est
 * ceinturée d'un garde-corps sur tout son périmètre. Tant que personne ne dit où
 * l'escalier arrive, le garde-corps se ferme devant lui et l'escalier devient
 * inaccessible — mesuré sur le musée réel : première marche en (−4,8 ; 0), vide
 * de −6 à 6, et 1,10 m de garde-corps continu entre les deux. Aucun moyen de
 * monter d'un étage.
 *
 * Aucune pièce n'était fausse : la dalle était juste, le garde-corps était juste,
 * l'escalier était juste. C'est leur RENCONTRE qui ne l'était pas, et elle
 * n'appartenait à personne. Elle appartient maintenant à ce fichier.
 */
import type { Museum, Vec2 } from './types'

/** Un paliers : un point de la dalle où l'on monte sur l'escalier ou l'on en descend. */
export interface Landing {
  /** Position monde du point de contact. */
  position: Vec2
  /** Demi-largeur à dégager, houppier de sécurité compris. */
  rayon: number
  /** L'escalier concerné, pour le diagnostic. */
  rampId: string
  /** `depart` = on y monte, `arrivee` = on en descend. */
  sens: 'depart' | 'arrivee'
}

/**
 * Marge ajoutée à la demi-largeur de l'escalier pour ouvrir le garde-corps.
 *
 * Une ouverture exactement à la largeur de l'emmarchement laisse deux montants
 * pile aux angles des marches, où le personnage accroche. Trente centimètres de
 * part et d'autre, c'est ce qui fait qu'on passe sans viser.
 */
const MARGE_PALIER = 0.3

/** Tolérance d'altitude. Les élévations sont arrondies au micromètre. */
const EPS = 1e-4

/**
 * Les paliers d'un niveau : tout escalier dont un bout affleure son plancher.
 *
 * Un escalier a DEUX bouts, et un niveau intermédiaire en voit deux : celui par
 * lequel on arrive d'en bas et celui par lequel on repart vers le haut. Les deux
 * doivent ouvrir le garde-corps, sans quoi on monte jusqu'au palier pour s'y
 * retrouver enfermé.
 */
export function landingsForFloor(museum: Museum, elevation: number): Landing[] {
  const paliers: Landing[] = []

  for (const ramp of museum.ramps) {
    const bouts: { y: number; angle: number; sens: Landing['sens'] }[] = [
      { y: ramp.baseElevation, angle: ramp.startAngle, sens: 'depart' },
      { y: ramp.baseElevation + ramp.rise, angle: ramp.startAngle + ramp.sweep, sens: 'arrivee' },
    ]
    for (const bout of bouts) {
      if (Math.abs(bout.y - elevation) > EPS) continue
      paliers.push({
        position: {
          x: ramp.centre.x + ramp.radius * Math.cos(bout.angle),
          z: ramp.centre.z + ramp.radius * Math.sin(bout.angle),
        },
        rayon: ramp.width / 2 + MARGE_PALIER,
        rampId: ramp.id,
        sens: bout.sens,
      })
    }
  }

  return paliers
}
