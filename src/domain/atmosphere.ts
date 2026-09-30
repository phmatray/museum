/**
 * L'air et l'étalonnage du musée à l'heure qu'il est : ce qui s'en décide
 * sans canvas.
 *
 * Quatre moments de référence, fondus le long du ciel réel (`soleil.ts`) :
 *
 * - l'AUBE, soleil bas à l'est : un air doré, une brume au ras du sol et de
 *   l'eau, les ombres légèrement froides ;
 * - le MIDI, soleil haut : un air bleu pâle, à peine sensible, un étalonnage
 *   neutre ;
 * - le SOIR, soleil bas à l'ouest : un air ambré, plus chargé, une image
 *   chaude ;
 * - la NUIT : un air bleu sombre, une image froide et un peu désaturée.
 *
 * Les poids se déduisent de `jour` (0 la nuit, 1 le jour) et de la hauteur du
 * soleil : rien ne saute, ni au crépuscule ni quand `?heure=` change.
 *
 * Les couleurs sont LINÉAIRES (celles du shader), pas sRGB.
 *
 * Pur : des degrés entrent, des nombres sortent.
 */
import type { Ciel } from './soleil.ts'

export type Rvb = readonly [number, number, number]

export interface Air {
  /** La couleur de l'air au loin (perspective aérienne), linéaire. */
  couleur: Rvb
  /** L'épaisseur de l'air, par mètre de regard. */
  densite: number
  /** La brume au ras du sol : sa densité au niveau 0, par mètre. */
  sol: number
  /** Sa décroissance avec la hauteur, par mètre (0,5 : moitié moins à 1,4 m). */
  decroissance: number
  /** La lueur de l'air face au soleil (diffusion vers l'avant). */
  diffusion: number
  /** La couleur de cette lueur, linéaire. */
  lueur: Rvb
}

export interface Etalonnage {
  /** Relève les noirs (ombres teintées). */
  lift: Rvb
  /** Courbe des tons moyens (> 1 éclaircit). */
  gamma: Rvb
  /** Gain des hautes lumières. */
  gain: Rvb
  saturation: number
  contraste: number
}

export interface Moments {
  aube: number
  midi: number
  soir: number
  nuit: number
}

const lisse = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Les poids des quatre moments, de somme 1. L'or tient jusqu'à ~25°
 * au-dessus de l'horizon ; sous lui, l'heure bleue prend le pas (−5° : la
 * nuit). L'horizon, lui, s'allume dès −12° (`aurore`).
 */
export function moments(ciel: Pick<Ciel, 'elevation' | 'azimut'>): Moments {
  const leve = lisse(-5, 2, ciel.elevation)
  const haut = lisse(3, 26, ciel.elevation)
  const or = leve * (1 - haut)
  const matin = ciel.azimut < 180 ? 1 : 0
  return { aube: or * matin, soir: or * (1 - matin), midi: leve * haut, nuit: 1 - leve }
}

type Poids = Moments
const fondre = (p: Poids, v: Record<keyof Moments, number>) => p.aube * v.aube + p.midi * v.midi + p.soir * v.soir + p.nuit * v.nuit
const fondreRvb = (p: Poids, v: Record<keyof Moments, Rvb>): Rvb =>
  [0, 1, 2].map((i) => fondre(p, { aube: v.aube[i], midi: v.midi[i], soir: v.soir[i], nuit: v.nuit[i] })) as unknown as Rvb

/** sRGB (0–255) vers linéaire, pour écrire les teintes comme on les voit. */
const lin = (r: number, g: number, b: number): Rvb => [r, g, b].map((c) => ((c / 255 + 0.055) / 1.055) ** 2.4) as unknown as Rvb

const AIR: Record<keyof Moments, Air> = {
  aube: { couleur: lin(172, 152, 142), densite: 0.004, sol: 0.045, decroissance: 1.4, diffusion: 0.7, lueur: lin(255, 190, 130) },
  midi: { couleur: lin(170, 190, 212), densite: 0.0035, sol: 0.003, decroissance: 0.5, diffusion: 0.25, lueur: lin(255, 244, 222) },
  soir: { couleur: lin(180, 140, 112), densite: 0.0045, sol: 0.03, decroissance: 1.4, diffusion: 0.9, lueur: lin(255, 165, 90) },
  nuit: { couleur: lin(22, 30, 50), densite: 0.004, sol: 0.03, decroissance: 1.2, diffusion: 0.1, lueur: lin(150, 170, 220) },
}

const ETAL: Record<keyof Moments, Etalonnage> = {
  aube: { lift: [0.004, 0.006, 0.014], gamma: [1.03, 1.0, 0.97], gain: [1.06, 1.0, 0.9], saturation: 1.06, contraste: 1.04 },
  midi: { lift: [0.0, 0.001, 0.003], gamma: [1.0, 1.0, 1.0], gain: [1.0, 1.0, 0.99], saturation: 1.04, contraste: 1.04 },
  soir: { lift: [0.006, 0.004, 0.01], gamma: [1.04, 0.99, 0.94], gain: [1.1, 0.97, 0.82], saturation: 1.08, contraste: 1.06 },
  // La nuit bleuit les OMBRES, pas les lumières : les lanternes de la nef et les lampadaires restent chauds.
  nuit: { lift: [0.0, 0.002, 0.006], gamma: [1.0, 1.0, 1.02], gain: [1.03, 1.0, 0.97], saturation: 0.97, contraste: 1.03 },
}

/**
 * L'air de l'heure, et le temps qu'il fait : sous les nuages ou dans le
 * brouillard, l'air prend la couleur de la brume (`brume`, celle de
 * `MeteoLayer`) et ne s'allume plus face au soleil.
 */
export function airDuCiel(ciel: Pick<Ciel, 'jour' | 'elevation' | 'azimut'>, meteo: { nuages: number; brouillard: number }, brume: Rvb): Air {
  const p = moments(ciel)
  const m = (k: keyof Air) => fondre(p, { aube: AIR.aube[k] as number, midi: AIR.midi[k] as number, soir: AIR.soir[k] as number, nuit: AIR.nuit[k] as number })
  const gris = Math.min(1, Math.max(meteo.nuages, meteo.brouillard))
  // Avant le lever et après le coucher, l'horizon côté soleil garde sa lueur dorée.
  const aurore = lisse(-12, -3, ciel.elevation) * (1 - lisse(3, 26, ciel.elevation))
  const or = ciel.azimut < 180 ? AIR.aube : AIR.soir
  // L'air n'est jamais plus clair que la lumière qui l'éclaire : avant le lever,
  // la teinte de l'aube est là, mais sombre.
  const clarte = 0.12 + 0.88 * ciel.jour
  const jourSeul = { ...p, nuit: 0 }
  const clair = fondreRvb(jourSeul, { aube: AIR.aube.couleur, midi: AIR.midi.couleur, soir: AIR.soir.couleur, nuit: AIR.nuit.couleur })
    .map((c, i) => c * clarte + AIR.nuit.couleur[i] * p.nuit) as unknown as Rvb
  return {
    couleur: clair.map((c, i) => c + (brume[i] - c) * gris) as unknown as Rvb,
    densite: m('densite'),
    sol: m('sol'),
    decroissance: m('decroissance'),
    diffusion: Math.max(m('diffusion'), aurore * or.diffusion * 0.6) * (0.35 + 0.65 * ciel.jour) * (1 - gris),
    lueur: fondreRvb(p, { aube: AIR.aube.lueur, midi: AIR.midi.lueur, soir: AIR.soir.lueur, nuit: or.lueur.map((c, i) => c * aurore + AIR.nuit.lueur[i] * (1 - aurore)) as unknown as Rvb }),
  }
}

/**
 * La force des rayons du soleil dans l'air du dehors (à travers les arbres,
 * vus face au soleil), de 0 à 1 : il faut le soleil levé et un ciel dégagé ;
 * plus il est bas, plus l'air qu'il traverse est long et plus ils se voient.
 */
export function forceDesRayonsDehors(ciel: Pick<Ciel, 'elevation'>, meteo: { nuages: number; brouillard: number }): number {
  const leve = lisse(-1, 4, ciel.elevation)
  const bas = 1 - lisse(10, 45, ciel.elevation)
  return leve * (0.45 + 0.55 * bas) * (1 - lisse(0.3, 0.95, meteo.nuages)) * (1 - lisse(0, 0.6, meteo.brouillard))
}

/** L'étalonnage de l'heure : un fondu des quatre moments. */
export function etalonnageDuCiel(ciel: Pick<Ciel, 'jour' | 'elevation' | 'azimut'>): Etalonnage {
  const p = moments(ciel)
  const rvb = (k: 'lift' | 'gamma' | 'gain') => fondreRvb(p, { aube: ETAL.aube[k], midi: ETAL.midi[k], soir: ETAL.soir[k], nuit: ETAL.nuit[k] })
  return {
    lift: rvb('lift'),
    gamma: rvb('gamma'),
    gain: rvb('gain'),
    saturation: fondre(p, { aube: ETAL.aube.saturation, midi: ETAL.midi.saturation, soir: ETAL.soir.saturation, nuit: ETAL.nuit.saturation }),
    contraste: fondre(p, { aube: ETAL.aube.contraste, midi: ETAL.midi.contraste, soir: ETAL.soir.contraste, nuit: ETAL.nuit.contraste }),
  }
}
