import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../../plan/hang'
import { elargir, poserPieces, texteDEnseigne } from '../portes'

describe('elargir', () => {
  it('fait glisser chaque moitié vers son côté, sans toucher y, z ni le milieu', () => {
    expect(Array.from(elargir([-1.22, 0.3, 0.08, 1.22, 2.6, 0, 0, 1, 0.05], 2.4))).toEqual(
      [-1.42, 0.3, 0.08, 1.42, 2.6, 0, 0, 1, 0.05].map((v) => expect.closeTo(v, 6)),
    )
  })
})

describe('poserPieces', () => {
  const tri = { positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), indices: new Uint32Array([0, 1, 2]) }
  const modele = { Chambranle: tri, Entablement: tri, Plinthe: tri }
  it('tourne +z local vers (sin, 0, cos), +x vers (cos, 0, −sin), pose et décale les indices', () => {
    const g = poserPieces(modele, [
      { nom: 'Plinthe', x: 10, y: 4.8, z: 5, lacet: Math.PI / 2, largeur: 2.4 },
      { nom: 'Chambranle', x: 0, y: 0, z: 0, lacet: 0, largeur: 3 },
    ])
    // lacet π/2 : +x local → −z, +z local → +x.
    expect(Array.from(g.positions.slice(0, 9))).toEqual([10, 4.8, 4, 10, 5.8, 5, 11, 4.8, 5].map((v) => expect.closeTo(v, 5)))
    expect(Array.from(g.normals.slice(0, 3))).toEqual([1, 0, 0].map((v) => expect.closeTo(v, 6)))
    // Chambranle élargi de (3 − 2)/2 de chaque côté.
    expect(g.positions[9]).toBeCloseTo(1.5)
    expect(Array.from(g.indices)).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('texteDEnseigne', () => {
  const acc = { rooms: [{ id: 'g1', level: 0, name: 'Blazor', placements: [{}, {}] }, { id: 'g2', level: 0, name: 'Rust', placements: [{}] }] } as unknown as Accrochage
  it('écrit le thème en capitales et accorde le nombre de projets', () => {
    expect(texteDEnseigne(acc, 'g1', 0)).toBe('BLAZOR · 2 PROJETS')
    expect(texteDEnseigne(acc, 'g2', 0)).toBe('RUST · 1 PROJET')
    expect(texteDEnseigne(acc, 'g1', 1)).toBe('G1 · 0 PROJET')
  })
})
