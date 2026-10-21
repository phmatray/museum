import { describe, expect, it } from 'vitest'

import { neutre, PELLICULES, VOL, voler } from '../photo'

const immobile = { avant: 0, cote: 0, haut: 0, hate: false }

describe('mode photo', () => {
  it('ouvre sur la pellicule naturelle, la seule sans passe ; les autres ont chacune leur nom', () => {
    expect(neutre(PELLICULES[0])).toBe(true)
    expect(PELLICULES.slice(1).every((p) => !neutre(p))).toBe(true)
    expect(new Set(PELLICULES.map((p) => p.id)).size).toBe(PELLICULES.length)
  })

  it('vole le long du regard : cap 0 vers −z, un quart de tour vers −x, le tangage monte', () => {
    const [x, y, z] = voler([0, 1, 0], 0, 0, { ...immobile, avant: 1 }, 1)
    expect([x, y, z].map((v) => +v.toFixed(6))).toEqual([0, 1, -VOL.vitesse])
    expect(voler([0, 0, 0], Math.PI / 2, 0, { ...immobile, avant: 1 }, 1)[0]).toBeCloseTo(-VOL.vitesse)
    expect(voler([0, 0, 0], 0, Math.PI / 2, { ...immobile, avant: 1 }, 1)[1]).toBeCloseTo(VOL.vitesse)
  })

  it('glisse de côté à l\'horizontale, monte à la verticale du monde, plus vite en hâte', () => {
    const cote = voler([0, 0, 0], 0, 0.8, { ...immobile, cote: 1 }, 1)
    expect(cote[0]).toBeCloseTo(VOL.vitesse)
    expect(cote[1]).toBeCloseTo(0)
    expect(voler([0, 0, 0], 1, 0.3, { ...immobile, haut: 1, hate: true }, 0.5)).toEqual([0, VOL.vitesse * VOL.hate * 0.5, 0])
  })
})
