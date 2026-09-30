import { describe, expect, it } from 'vitest'

import { BELVEDERE } from '../belvedere'
import { centreDesChutes, hauteurDesToits, sousLesToits, toitsGlsl } from '../toits'

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

describe('les abris du jardin', () => {
  const { pavillon: P, cote: H, porte: G, roji: J } = BELVEDERE

  it('le pavillon du belvédère abrite qui s’y tient, jusqu’au bout de son débord, pas la terrasse à côté', () => {
    expect(sousLesToits(P.x, H + 1.7, P.z)).toBe(true)
    expect(sousLesToits(P.x + P.cote / 2 + P.debord - 0.1, H + 1.7, P.z)).toBe(true)
    expect(sousLesToits(P.x - P.cote / 2 - P.debord - 0.3, H + 1.7, P.z)).toBe(false)
    // Au faîte, plus haut qu'à l'égout.
    expect(hauteurDesToits(P.x, P.z)).toBeGreaterThan(hauteurDesToits(P.x + P.cote / 2, P.z) + 1)
  })

  it('la porte du roji abrite son passage, pas le roji devant ni derrière', () => {
    expect(sousLesToits(J.x, 1.7, G.z)).toBe(true)
    expect(sousLesToits(J.x, 1.7, G.z - 1.5)).toBe(false)
    expect(sousLesToits(J.x, 1.7, G.z + 1.5)).toBe(false)
  })

  it('sous le pavillon, la pluie reste centrée sur le visiteur : elle tombe tout autour', () => {
    expect(centreDesChutes({ x: P.x, y: H + 1.7, z: P.z }, { x: 0, z: -1 }, 0.45 * BOITE.l, BOITE.h / 2)).toEqual({ x: P.x, y: H + 1.7, z: P.z })
  })

  it('la copie GLSL porte les mêmes cotes', () => {
    const glsl = toitsGlsl('toit')
    for (const v of [P.x, P.z, G.z]) expect(glsl).toContain(v.toFixed(3))
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
