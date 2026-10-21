import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { CELLULE, coteDuSol, entraves, percer, soupeDeNavigation } from '../navigation'
import { parkPlacements } from '../park'
import { hauteurDuParc } from '../relief'

const PARC = parkPlacements(MUSEE)
const E = entraves(MUSEE, PARC)
const S = soupeDeNavigation(MUSEE, E)

/** Le centre de chaque triangle de la soupe, et sa normale (non normée). */
function triangles() {
  const out: { x: number; y: number; z: number; ny: number }[] = []
  const p = S.positions
  for (let i = 0; i < S.indices.length; i += 3) {
    const [a, b, c] = [S.indices[i] * 3, S.indices[i + 1] * 3, S.indices[i + 2] * 3]
    const [e0, e1] = [[p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]]
    out.push({ x: (p[a] + p[b] + p[c]) / 3, y: (p[a + 1] + p[b + 1] + p[c + 1]) / 3, z: (p[a + 2] + p[b + 2] + p[c + 2]) / 3, ny: e0[2] * e1[0] - e0[0] * e1[2] })
  }
  return out
}

describe('le sol des PNJ, tiré du plan', () => {
  it('perce un rectangle de ses trous, et élargit un trou trop fin pour Recast', () => {
    const sol = [{ x: 0, z: 0, width: 10, depth: 10 }]
    const aire = (r: { width: number; depth: number }[]) => r.reduce((s, q) => s + q.width * q.depth, 0)
    expect(aire(percer(sol, [{ x: 2, z: 2, width: 2, depth: 3 }]))).toBeCloseTo(94)
    // Une palissade de 4 cm devient un trou de deux cellules.
    expect(aire(percer(sol, [{ x: 5, z: 0, width: 0.04, depth: 10 }]))).toBeCloseTo(100 - 2 * CELLULE * 10)
  })

  it('des triangles qui regardent le ciel (normale +y dans le repère de Recast)', () => {
    const t = triangles()
    expect(t.length).toBeGreaterThan(10_000)
    expect(t.every((q) => q.ny > 0)).toBe(true)
  })

  it('aucun sol sous un obstacle du plan, un sujet du parc ou dans l\'épaisseur d\'un mur', () => {
    const fautes: string[] = []
    const dedans = (o: { x: number; z: number; width: number; depth: number }, x: number, z: number) => x > o.x && x < o.x + o.width && z > o.z && z < o.z + o.depth
    for (const q of triangles()) {
      const plancher = MUSEE.levels.find((l) => Math.abs(l.elevation - q.y) < 1e-3 && l.rooms.some((r) => dedans(r, q.x, q.z)))
      // Le parc : les obstacles du rez-de-chaussée, au relief près.
      const obstacles = plancher ? E.obstacles.get(plancher.id)! : dedans({ x: 0, z: 0, width: MUSEE.width, depth: MUSEE.depth }, q.x, q.z) ? [] : E.obstacles.get(0)!
      const o = obstacles.find((o) => dedans(o, q.x, q.z))
      if (o) fautes.push(`(${q.x}, ${q.y}, ${q.z}) sous ${JSON.stringify(o)}`)
      const c = E.cercles.find((c) => Math.hypot(q.x - c.x, q.z - c.z) < c.r * 0.7)
      if (c) fautes.push(`(${q.x}, ${q.y}, ${q.z}) sous ${JSON.stringify(c)}`)
      if (fautes.length > 5) break
    }
    expect(fautes).toEqual([])
  })

  it('pose les pieds sur le vrai sol : plancher, palier, volée ou relief du parc', () => {
    expect(coteDuSol(MUSEE, 8, 20, 4.83)).toBe(4.8)
    expect(coteDuSol(MUSEE, 8, 20, 0.06)).toBe(0)
    expect(coteDuSol(MUSEE, 24, 13, 2.35)).toBe(2.4)
    expect(coteDuSol(MUSEE, 24, 17.75, 1.2)).toBeCloseTo(1.2, 1)
    expect(coteDuSol(MUSEE, 70, 60, 0)).toBe(hauteurDuParc(70, 60))
  })
})
