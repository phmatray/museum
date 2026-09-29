/**
 * Les ombres et les reflets du musée, ce qui s'en décide sans canvas.
 *
 * - `sondeDeReflet` : quel environnement le visiteur voit dans le laiton et le
 *   verre — le ciel dehors, la nef sous la verrière, sinon sa salle. Lu sur la
 *   surface du marcheur (`plan/walk.ts`).
 * - `cadrerOmbre` : la carte d'ombre du soleil suit le visiteur, mais ne glisse
 *   que d'un texel entier à la fois ; sans quoi chaque pas ferait scintiller le
 *   bord de toutes les ombres.
 * - `regrouperEmprises` : les pièces d'un même meuble (bois, cuir, laiton…) ne
 *   font qu'une ombre de contact, pas trois superposées.
 *
 * Pur : ni three ni React.
 */

/**
 * La sonde dont le visiteur voit le reflet : `ciel` dehors, `nef` sous la
 * verrière (hall, balcons, paliers, volées), sinon sa salle même (`0:r-o2`,
 * `1:honneur`) — le laiton d'une salle rouge ne reflète pas un mur vert.
 */
export function sondeDeReflet(surface: string | null | undefined): string {
  if (!surface || surface.startsWith('parc:')) return 'ciel'
  const salle = surface.slice(surface.indexOf(':') + 1)
  if (surface.startsWith('palier:') || surface.startsWith('volee:') || salle === 'hall' || salle.startsWith('balcon')) return 'nef'
  return surface
}

type V3 = readonly [number, number, number]

/**
 * Le centre de la boîte d'ombre, recalé sur la grille des texels vue du soleil
 * (`d`, unitaire, du sol vers le soleil). Seule la composante le long du rayon
 * reste libre : elle ne déplace rien sur la carte.
 */
export function cadrerOmbre(c: V3, d: V3, texel: number): [number, number, number] {
  // u ⟂ d dans le plan horizontal ; si le soleil est au zénith, l'axe x.
  let u: V3 = [d[2], 0, -d[0]]
  const lu = Math.hypot(u[0], u[2])
  u = lu < 1e-6 ? [1, 0, 0] : [u[0] / lu, 0, u[2] / lu]
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const [cu, cv, cd] = [Math.round(dot(c, u) / texel) * texel, Math.round(dot(c, v) / texel) * texel, dot(c, d)]
  return [0, 1, 2].map((i) => u[i] * cu + v[i] * cv + d[i] * cd) as [number, number, number]
}

/** Une boîte englobante posée au sol, en coordonnées monde. */
export interface Emprise {
  minX: number
  maxX: number
  minY: number
  minZ: number
  maxZ: number
}

/**
 * Fusionne les emprises qui se chevauchent au sol à la même cote (à `pas`
 * près) : les maillages d'un banc deviennent un seul banc. Quadratique — le
 * musée a quelques centaines de pièces, et c'est fait une fois.
 */
export function regrouperEmprises(emprises: readonly Emprise[], pas = 0.3): Emprise[] {
  const groupes: Emprise[] = []
  for (const e of emprises) {
    let courante: Emprise = { ...e }
    for (let i = groupes.length - 1; i >= 0; i--) {
      const g = groupes[i]
      const touche = g.minX <= courante.maxX && courante.minX <= g.maxX && g.minZ <= courante.maxZ && courante.minZ <= g.maxZ
      if (!touche || Math.abs(g.minY - courante.minY) > pas) continue
      courante = {
        minX: Math.min(g.minX, courante.minX), maxX: Math.max(g.maxX, courante.maxX),
        minY: Math.min(g.minY, courante.minY),
        minZ: Math.min(g.minZ, courante.minZ), maxZ: Math.max(g.maxZ, courante.maxZ),
      }
      groupes.splice(i, 1)
    }
    groupes.push(courante)
  }
  return groupes
}
