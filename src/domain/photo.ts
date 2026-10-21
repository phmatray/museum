/**
 * Le mode photo (babylon/photo.ts), en pur : les pellicules et le vol de la caméra.
 *
 * Une pellicule est un étalonnage appliqué sur l'image finie (sRGB) : saturation, contraste
 * autour du gris moyen, teinte multipliée, noirs relevés (le voile d'un tirage), grain et vignette.
 */
export interface Pellicule {
  id: string
  nom: string
  saturation: number
  contraste: number
  teinte: [number, number, number]
  /** Les noirs relevés, 0–1 : le voile d'un tirage fané. */
  releve: number
  grain: number
  vignette: number
}

export const PELLICULES: readonly Pellicule[] = [
  { id: 'naturel', nom: 'Naturel', saturation: 1, contraste: 1, teinte: [1, 1, 1], releve: 0, grain: 0, vignette: 0 },
  { id: 'kodachrome', nom: 'Kodachrome', saturation: 1.35, contraste: 1.15, teinte: [1.05, 1, 0.9], releve: 0, grain: 0.035, vignette: 0.25 },
  { id: 'noir-et-blanc', nom: 'Noir et blanc', saturation: 0, contraste: 1.3, teinte: [1, 1, 1], releve: 0, grain: 0.07, vignette: 0.35 },
  { id: 'sepia', nom: 'Sépia', saturation: 0, contraste: 1.05, teinte: [1.12, 0.95, 0.72], releve: 0.04, grain: 0.05, vignette: 0.4 },
  { id: 'polaroid', nom: 'Polaroid', saturation: 0.85, contraste: 0.85, teinte: [1.05, 1.02, 0.92], releve: 0.07, grain: 0.03, vignette: 0.3 },
  { id: 'nuit-americaine', nom: 'Nuit américaine', saturation: 0.55, contraste: 1.1, teinte: [0.72, 0.86, 1.15], releve: 0, grain: 0.03, vignette: 0.3 },
]

/** La pellicule qui ne change rien : pas de passe du tout. */
export const neutre = (p: Pellicule): boolean => p.saturation === 1 && p.contraste === 1 && p.teinte.every((t) => t === 1) && p.releve === 0 && p.grain === 0 && p.vignette === 0

/** Mètres par seconde, et le facteur de la touche de hâte. */
export const VOL = { vitesse: 2.5, hate: 3 }

/** Ce que demande le pilote : avant/côté/haut dans [−1, 1], `hate` pressée. */
export interface Commande { avant: number; cote: number; haut: number; hate: boolean }

/**
 * Un pas de vol : le long du regard (cap, tangage ; en main droite, cap 0 regarde −z et un tangage
 * positif lève les yeux), de côté à l'horizontale, et à la verticale du monde.
 */
export function voler(p: [number, number, number], cap: number, tangage: number, c: Commande, dt: number): [number, number, number] {
  const v = VOL.vitesse * (c.hate ? VOL.hate : 1) * dt
  const [sc, cc, st, ct] = [Math.sin(cap), Math.cos(cap), Math.sin(tangage), Math.cos(tangage)]
  const avant = [-sc * ct, st, -cc * ct]
  const droite = [cc, 0, -sc]
  return [
    p[0] + v * (c.avant * avant[0] + c.cote * droite[0]),
    p[1] + v * (c.avant * avant[1] + c.haut),
    p[2] + v * (c.avant * avant[2] + c.cote * droite[2]),
  ]
}
