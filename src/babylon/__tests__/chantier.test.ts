import { describe, expect, it } from 'vitest'

import journal from '../../../public/data/chantier.json'
import { accrocherChantier } from '../../plan/chantier'
import { atlasDe, moulure, quadDeCase } from '../chantier'

describe('chantier', () => {
  it('les atlas : petits en carré de 2048 au plus, grands en cases de 768, trois par rang', () => {
    expect(atlasDe(105, false)).toEqual({ cols: 11, cote: 186, l: 2046, h: 1860 })
    expect(atlasDe(5, true)).toEqual({ cols: 3, cote: 768, l: 2304, h: 1536 })
    expect(atlasDe(1, true)).toEqual({ cols: 1, cote: 768, l: 768, h: 768 })
  })

  it('une case regarde la salle, 4 mm devant le cadre, ses UV sur sa case (haut du canevas en v = 1)', () => {
    const cadres = accrocherChantier(journal.etapes.length)
    const c = cadres.find((x) => !x.grand && x.normal[1] === -1)!
    const f = atlasDe(cadres.filter((x) => !x.grand).length, false)
    const q = quadDeCase(c, 0.022, 0, f)
    // droite × haut = normale du mur.
    const n = [q.droite[1] * q.haut[2] - q.droite[2] * q.haut[1], q.droite[2] * q.haut[0] - q.droite[0] * q.haut[2], q.droite[0] * q.haut[1] - q.droite[1] * q.haut[0]]
    ;[0, 0, -1].forEach((v, i) => expect(n[i]).toBeCloseTo(v))
    expect(q.centre[2]).toBeCloseTo(c.z - 0.004)
    expect(q.l).toBeCloseTo(c.cote - 0.044)
    expect(q.uv).toEqual([0, 1 - f.cote / f.h, f.cote / f.l, 1])
  })

  it('quatre baguettes par cadre, saillantes de 3,5 cm sur un mur nord-sud', () => {
    const c = { etape: 0, x: 0, y: 1, z: 0, normal: [1, 0] as [number, number], cote: 1.3, grand: true, case: 0 }
    const b = moulure(c, 0.07)
    expect(b).toHaveLength(4)
    expect(b[0]).toMatchObject({ w: 0.035, h: 0.07, kind: 'wall' })
    expect(b[0].d).toBeCloseTo(1.3)
    expect(b[0].x).toBeCloseTo(-0.0025)
    expect(b[2].d).toBeCloseTo(0.07)
  })
})
