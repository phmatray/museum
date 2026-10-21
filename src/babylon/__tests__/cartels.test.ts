import { describe, expect, it } from 'vitest'

import accrochage from '../../../public/data/accrochage.json'
import { cartelPlacements } from '../../plan/cartels'
import type { Accrochage } from '../../plan/hang'
import { poserCartels } from '../cartels'

describe('cartels', () => {
  it('pose plaques, QR et texte dans le repère du cartel', () => {
    // Mur de normale +x (lacet π/2) : droite = (0, 0, −1).
    const p = { key: 'a', x: 2, y: 1.5, z: 3, rotation: Math.PI / 2, surPanneau: false }
    const { plaques, quadsQr, quadsTexte } = poserCartels([p])
    const m = [...plaques]
    // Cartel : axes R × 0,30, U × 0,16, N × 0,01, centre 5 mm devant le point.
    ;[0, 0, -0.3, 0, 0, 0.16, 0, 0, 0.01, 0, 0, 0, 2.005, 1.5, 3, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v))
    // Plaque du QR : 26 cm, 2 cm à gauche, 27 cm plus haut.
    ;[0, 0, -0.26, 0, 0, 0.26].forEach((v, i) => expect(m[16 + i]).toBeCloseTo(v))
    ;[2.005, 1.77, 3.02].forEach((v, i) => expect(m[28 + i]).toBeCloseTo(v))
    ;[2.0105, 1.77, 3.02].forEach((v, i) => expect(quadsQr[0].centre[i]).toBeCloseTo(v))
    expect(quadsQr[0].l).toBeCloseTo(0.24)
    // Texte : colonne de 26 cm centrée sur le cartel, 1 mm devant la plaque.
    ;[2.011, 1.5, 3].forEach((v, i) => expect(quadsTexte[0].centre[i]).toBeCloseTo(v))
    ;[0, 0, -1].forEach((v, i) => expect(quadsTexte[0].droite[i]).toBeCloseTo(v))
  })

  it('un cartel par toile de l’accrochage commité, deux plaques chacun', () => {
    const ps = cartelPlacements(accrochage as unknown as Accrochage)
    const { plaques, quadsQr } = poserCartels(ps)
    expect(ps.length).toBeGreaterThan(0)
    expect(plaques.length).toBe(32 * ps.length)
    expect(quadsQr.length).toBe(ps.length)
  })
})
