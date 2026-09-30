import { describe, expect, it } from 'vitest'

import { airDuCiel, etalonnageDuCiel, forceDesRayonsDehors, moments } from '../atmosphere'
import { cielA } from '../soleil'

const BRUXELLES = [50.85, 4.35] as const
const ciel = (h: string) => cielA(new Date(`2026-09-30T${h}:00+02:00`), ...BRUXELLES)
const CLAIR = { nuages: 0, brouillard: 0 }
const GRIS: [number, number, number] = [0.3, 0.3, 0.3]

describe("l'air et l'étalonnage à l'heure qu'il est", () => {
  it('les quatre moments font toujours un tout', () => {
    for (let m = 0; m < 24 * 60; m += 17) {
      const h = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const p = moments(ciel(h))
      expect(p.aube + p.midi + p.soir + p.nuit).toBeCloseTo(1, 6)
    }
  })

  it("chaque heure prend le moment qu'elle est", () => {
    expect(moments(ciel('13:30')).midi).toBeGreaterThan(0.9)
    expect(moments(ciel('02:00')).nuit).toBe(1)
    const matin = moments(ciel('08:15'))
    expect(matin.aube).toBeGreaterThan(0.5)
    expect(matin.soir).toBe(0)
    const soir = moments(ciel('18:45'))
    expect(soir.soir).toBeGreaterThan(0.5)
    expect(soir.aube).toBe(0)
  })

  it("l'air est bleu à midi, doré au soir, sombre la nuit", () => {
    const [r1, , b1] = airDuCiel(ciel('13:30'), CLAIR, GRIS).couleur
    expect(b1).toBeGreaterThan(r1)
    const [r2, , b2] = airDuCiel(ciel('18:45'), CLAIR, GRIS).couleur
    expect(r2).toBeGreaterThan(b2)
    expect(Math.max(...airDuCiel(ciel('02:00'), CLAIR, GRIS).couleur)).toBeLessThan(0.05)
  })

  it("au soleil bas, l'air est un gris doré, jamais rose", () => {
    for (const h of ['08:05', '08:30', '18:30', '18:45']) {
      const [r, g, b] = airDuCiel(ciel(h), CLAIR, GRIS).couleur
      expect(r).toBeGreaterThanOrEqual(g)
      // Rose : le vert tombe vers le bleu. Doré : le vert reste près du rouge.
      expect(g - b).toBeGreaterThan(r - g)
    }
  })

  it('la brume au sol est une affaire du matin et du soir', () => {
    expect(airDuCiel(ciel('08:15'), CLAIR, GRIS).sol).toBeGreaterThan(5 * airDuCiel(ciel('13:30'), CLAIR, GRIS).sol)
  })

  it('rien ne saute au fil des minutes', () => {
    let avant = etalonnageDuCiel(ciel('00:00'))
    for (let m = 1; m < 24 * 60; m++) {
      const h = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const e = etalonnageDuCiel(ciel(h))
      for (let i = 0; i < 3; i++) expect(Math.abs(e.gain[i] - avant.gain[i])).toBeLessThan(0.01)
      expect(Math.abs(e.saturation - avant.saturation)).toBeLessThan(0.01)
      avant = e
    }
  })

  it("sous un ciel couvert, l'air prend la couleur de la brume et ne s'allume plus", () => {
    const a = airDuCiel(ciel('18:45'), { nuages: 1, brouillard: 0.6 }, GRIS)
    expect(a.diffusion).toBe(0)
    for (const c of a.couleur) expect(c).toBeCloseTo(0.3, 6)
  })

  it('les rayons dehors : au soleil bas plus qu’à midi, jamais la nuit ni sous les nuages', () => {
    expect(forceDesRayonsDehors(ciel('02:00'), CLAIR)).toBe(0)
    expect(forceDesRayonsDehors(ciel('08:30'), CLAIR)).toBeGreaterThan(forceDesRayonsDehors(ciel('13:30'), CLAIR))
    expect(forceDesRayonsDehors(ciel('13:30'), { nuages: 1, brouillard: 0 })).toBe(0)
  })
})
