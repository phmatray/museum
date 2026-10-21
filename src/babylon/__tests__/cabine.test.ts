import { describe, expect, it } from 'vitest'

import { morceaux } from '../cabine'

describe('la cabine', () => {
  it('morceaux : un mur autour de ses trous, sans rien recouvrir ni rien oublier', () => {
    const mur = { a: 0, b: 10, y0: 0, y1: 4 }
    const trous = [{ a: 1, b: 2, y0: 0, y1: 2 }, { a: 4, b: 5, y0: 3, y1: 3.5 }]
    const m = morceaux(mur, trous)
    const aire = (r: { a: number; b: number; y0: number; y1: number }) => (r.b - r.a) * (r.y1 - r.y0)
    expect(m.reduce((s, r) => s + aire(r), 0)).toBeCloseTo(aire(mur) - trous.reduce((s, t) => s + aire(t), 0), 9)
    for (const r of m) for (const t of trous) expect(r.a < t.b && r.b > t.a && r.y0 < t.y1 && r.y1 > t.y0).toBe(false)
  })
})
