import { describe, expect, it } from 'vitest'

import { facade } from '../facade'
import { MUSEE } from '../musee'
import { parkPlacements } from '../park'
import { EXT } from '../svg'
import { SALISSURE, TEXEL_PASSAGE, carteDesPassages, carteDesSalissures, faceDeFacade, passagesDuHall } from '../usure'

const carte = carteDesSalissures(MUSEE)
/** Le texel (R, G, B) de la face `face` à (u, y). */
const lire = (face: number, u: number, y: number) => {
  const i = Math.floor((u - SALISSURE.u0) * SALISSURE.ppm)
  const j = Math.floor(y * SALISSURE.ppm)
  const k = ((face * carte.nv + j) * carte.nu + i) * 4
  return [carte.data[k], carte.data[k + 1], carte.data[k + 2]]
}

describe('usure — la façade', () => {
  it('reconnaît la face qui regarde un point, et rien dedans', () => {
    expect(faceDeFacade(MUSEE, 10, -1)).toEqual({ face: 0, u: 10 })
    expect(faceDeFacade(MUSEE, 10, MUSEE.depth + 1)).toEqual({ face: 1, u: 10 })
    expect(faceDeFacade(MUSEE, -1, 12)).toEqual({ face: 2, u: 12 })
    expect(faceDeFacade(MUSEE, MUSEE.width + 1, 12)).toEqual({ face: 3, u: 12 })
    expect(faceDeFacade(MUSEE, 20, 20)).toBeNull()
  })

  it('fait couler chaque appui : fort sous ses bouts, et la coulure s’éteint en descendant', () => {
    // Les appuis des fenêtres aveugles du nord : les pierres minces, saillantes, larges de moins de 2,5 m.
    const appuis = facade(MUSEE).pierre.filter((b) => b.z + b.d / 2 <= 1e-3 && b.h < 0.2 && b.w < 2.5 && b.y > 1)
    expect(appuis.length).toBeGreaterThan(6)
    for (const b of appuis) {
      const [a, fin, bas] = [b.x - b.w / 2, b.x + b.w / 2, b.y - b.h / 2]
      const bout = Math.max(lire(0, a + 0.05, bas - 0.15)[0], lire(0, fin - 0.05, bas - 0.15)[0])
      const milieu = lire(0, b.x, bas - 0.15)[0]
      expect(bout, `${b.x}, ${b.y}`).toBeGreaterThan(milieu)
      expect(bout).toBeGreaterThan(60)
      // Au rez-de-chaussée, rien d'autre ne coule dessous : la coulure pâlit en descendant.
      if (b.y < 3) expect(lire(0, a + 0.05, bas - 0.15)[0]).toBeGreaterThan(lire(0, a + 0.05, bas - 0.9)[0])
    }
  })

  it('ruisselle aux angles du bâtiment, pas au milieu des faces', () => {
    for (let face = 0; face < 4; face++) {
      const L = face < 2 ? MUSEE.width : MUSEE.depth
      const coin = lire(face, -EXT - 0.1, 5)[1]
      expect(coin, `face ${face}`).toBeGreaterThan(100)
      expect(lire(face, L / 2 + 0.3, 5)[1]).toBe(0)
    }
  })
})

describe('usure — le hall', () => {
  it('trace l’axe de l’entrée au pied de l’escalier, et de l’axe à chaque porte des galeries', () => {
    const segments = passagesDuHall(MUSEE)
    expect(segments[0]).toEqual([24, 40, 24, 20])
    const portes = MUSEE.levels[0].openings.filter((o) => o.kind === 'door' && (o.a === 'hall' || o.b === 'hall'))
    expect(segments).toHaveLength(1 + portes.length)
    for (const [x0, z0, x1, z1] of segments) {
      for (const [x, z] of [[x0, z0], [x1, z1]]) {
        expect(x).toBeGreaterThanOrEqual(16)
        expect(x).toBeLessThanOrEqual(32)
        expect(z).toBeGreaterThanOrEqual(12)
        expect(z).toBeLessThanOrEqual(40)
      }
    }
  })
})

describe('usure — le parc', () => {
  const parc = parkPlacements(MUSEE)
  const c = carteDesPassages(parc, MUSEE)
  const lire2 = (x: number, z: number) => {
    const [i, j] = [Math.floor((x - parc.terrain.x) / TEXEL_PASSAGE), Math.floor((z - parc.terrain.z) / TEXEL_PASSAGE)]
    const k = (j * c.nx + i) * 2
    return [c.data[k], c.data[k + 1]]
  }
  const axe = parc.allees.find((a) => a.sol === 'dalles')!

  it('use le milieu de l’axe, jusque sous le portique', () => {
    for (const z of [42, 50, 60, 70]) {
      const [pas, mousse] = lire2(axe.a.x, z)
      expect(pas, `z ${z}`).toBeGreaterThan(200)
      expect(mousse).toBeLessThan(40)
    }
  })

  it('laisse les bords des allées à la mousse, et rien hors des allées', () => {
    const [pas, mousse] = lire2(axe.a.x + axe.largeur / 2 - 0.15, 65)
    expect(mousse).toBeGreaterThan(pas)
    expect(mousse).toBeGreaterThan(80)
    // Sur la pelouse, loin de toute allée : rien.
    expect(lire2(axe.a.x + 12, 65)).toEqual([0, 0])
  })

  it('verdit davantage le parvis du nord, à l’ombre du musée, que celui du sud', () => {
    expect(lire2(12, -2.5)[1]).toBeGreaterThan(lire2(12, MUSEE.depth + 2.5)[1])
  })
})
