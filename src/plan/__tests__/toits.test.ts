import { describe, expect, it } from 'vitest'

import { centreDesChutes, hauteurDesToits, sousLesToits } from '../toits'

/** La boîte de pluie de `MeteoLayer` : 26 × 16 × 26 m, poussée de 0,45 × 26 m devant le regard. */
const BOITE = { l: 26, h: 16 }
/** Une goutte en (x, y, z) est-elle dans la boîte centrée en c, et pas fondue sur son bord (60 % du rayon) ? */
const visible = (c: { x: number; y: number; z: number }, x: number, y: number, z: number) =>
  Math.hypot(x - c.x, z - c.z) < 0.6 * (BOITE.l / 2) && Math.abs(y - c.y) < BOITE.h / 2

describe('les toits du musée', () => {
  it('abritent les salles, la nef jusque sous la verrière, pas le jardin', () => {
    expect(sousLesToits(8, 2, 20)).toBe(true)
    expect(sousLesToits(24, 1.7, 30)).toBe(true)
    // Sous la verrière, à 15 m : encore dedans (l'ancien seuil de 11,5 m y faisait pleuvoir).
    expect(sousLesToits(24, 15, 26)).toBe(true)
    expect(sousLesToits(24, 22, 26)).toBe(false)
    expect(sousLesToits(24, 1, 46)).toBe(false)
    expect(hauteurDesToits(-5, 20)).toBe(-Infinity)
  })

  it('abritent aussi la baraque du chantier, sous sa verrière à deux pentes', () => {
    // Au milieu, sous le faîtage ; près du long pan sud, sous l'égout ; à côté, il pleut.
    expect(sousLesToits(7, 4.5, 59.5)).toBe(true)
    expect(sousLesToits(7, 3.4, 62.8)).toBe(true)
    expect(sousLesToits(7, 1.7, 64)).toBe(false)
    expect(hauteurDesToits(7, 59.5)).toBeGreaterThan(hauteurDesToits(7, 62.8))
  })

  it('la voûte de la nef culmine au faîte et retombe vers les murs', () => {
    expect(hauteurDesToits(24, 26)).toBeGreaterThan(20)
    expect(hauteurDesToits(16.5, 26)).toBeLessThan(hauteurDesToits(24, 26))
  })
})

describe('centreDesChutes', () => {
  it('dehors, la pluie tombe autour du visiteur', () => {
    expect(centreDesChutes({ x: 24, y: 1.7, z: 50 }, { x: 0, z: -1 }, 0.45 * BOITE.l, BOITE.h / 2)).toEqual({ x: 24, y: 1.7, z: 50 })
  })

  // Le bug : dedans, la pluie était éteinte, et la boîte, centrée sur le
  // visiteur, ne tombait de toute façon que dans la nef, où elle est effacée.
  it("de la nef, face aux portes, l'averse tombe sur le parvis qu'on voit", () => {
    const c = centreDesChutes({ x: 24, y: 1.7, z: 28 }, { x: 0, z: 1 }, 0.45 * BOITE.l, BOITE.h / 2)
    expect(visible(c, 24, 1, 44)).toBe(true)
    expect(sousLesToits(24, 1, 44)).toBe(false)
  })

  it("d'une galerie de l'ouest, face à la porte du hall, elle ne tombe pas derrière le visiteur", () => {
    const c = centreDesChutes({ x: 8, y: 1.7, z: 24 }, { x: 1, z: 0 }, 0.45 * BOITE.l, BOITE.h / 2)
    expect(c.x).toBeGreaterThan(8)
    // Et la boîte, relevée du sol, monte jusqu'aux terrasses.
    expect(c.y + BOITE.h / 2).toBeGreaterThan(11.5)
  })
})
