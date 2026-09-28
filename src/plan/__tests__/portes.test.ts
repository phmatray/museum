import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { DOUBLURE, PLINTHE, portes } from '../portes'
import { INT } from '../svg'

const { pieces, embrasures, enseignes } = portes(MUSEE)
const niveaux = MUSEE.levels.map((l) => ({
  l,
  portes: l.openings.filter((o) => (o.kind === 'door' || o.kind === 'entrance') && o.a !== 'honneur' && o.b !== 'honneur'),
}))

/** La porte habillée par ce qui est posé en (x, y, z) : `u` le long du mur depuis son centre, `v` à travers. */
function porteDe(x: number, y: number, z: number) {
  for (const { l, portes: ps } of niveaux) {
    if (y < l.elevation - 1e-6 || y >= l.elevation + MUSEE.storey - 1e-6) continue
    for (const o of ps) {
      const a = l.rooms.find((r) => r.id === o.a)!
      const vertical = o.x === a.x || o.x === a.x + a.width
      const [u, v] = vertical ? [z - o.z, x - o.x] : [x - o.x, z - o.z]
      if (Math.abs(u) < o.width / 2 + 1 && Math.abs(v) < 0.8) return { o, u, v, vertical }
    }
  }
  return null
}

describe('portes', () => {
  it('encadre chaque porte sur ses deux faces, l’entrée côté hall seulement', () => {
    for (const { l, portes: ps } of niveaux) {
      for (const o of ps) {
        const miennes = pieces.filter((p) => p.nom === 'Chambranle' && porteDe(p.x, p.y, p.z)?.o === o)
        expect(miennes, `${l.id}:${o.a}>${o.b}`).toHaveLength(o.kind === 'entrance' ? 1 : 2)
        if (o.kind === 'entrance') expect(miennes[0].z).toBeLessThan(o.z)
        expect(pieces.filter((p) => p.nom === 'Plinthe' && porteDe(p.x, p.y, p.z)?.o === o)).toHaveLength(2 * miennes.length)
      }
    }
  })

  it('ne pose rien dans le passage : les pièces sur les faces du mur, la doublure mince', () => {
    for (const p of pieces) {
      const d = porteDe(p.x, p.y, p.z)!
      expect(Math.abs(d.v)).toBeGreaterThanOrEqual(INT - 1e-9)
      if (p.nom === 'Plinthe') expect(Math.abs(d.u) - PLINTHE.l / 2).toBeGreaterThanOrEqual(d.o.width / 2 - 1e-9)
      else expect(d.u).toBeCloseTo(0, 9)
    }
    expect(embrasures).toHaveLength(3 * niveaux.reduce((n, { portes: ps }) => n + ps.length, 0))
    for (const b of embrasures) {
      expect(Math.min(b.w, b.h, b.d)).toBeLessThanOrEqual(DOUBLURE + 1e-9)
      const d = porteDe(b.x, b.y, b.z)!
      const [long, epais] = d.vertical ? [b.d, b.w] : [b.w, b.d]
      // Dans la baie, et pas plus épais que le mur et ses peaux.
      expect(Math.abs(d.u) + long / 2).toBeLessThanOrEqual(d.o.width / 2 + 1e-9)
      expect(epais).toBeLessThanOrEqual(0.66)
    }
  })

  it('grave le nom de la salle côté nef ou balcon, jamais côté galerie', () => {
    const versNef = niveaux.flatMap(({ l, portes: ps }) =>
      ps.filter((o) => o.kind === 'door' && ['hall', 'balcony'].includes(l.rooms.find((r) => r.id === o.a)!.kind)).map((o) => o.b))
    expect(enseignes.map((e) => e.salle).sort()).toEqual([...versNef].sort())
    for (const e of enseignes) {
      const l = MUSEE.levels.find((l) => l.id === e.level)!
      const ici = l.rooms.find((r) => e.x > r.x && e.x < r.x + r.width && e.z > r.z && e.z < r.z + r.depth)
      expect(['hall', 'balcony']).toContain(ici?.kind)
    }
  })

  it('laisse la salle d’honneur et ses deux portes intactes', () => {
    const h = MUSEE.levels[1].rooms.find((r) => r.id === 'honneur')!
    const pres = (x: number, y: number, z: number) =>
      y >= MUSEE.levels[1].elevation - 1e-6 && x > h.x - 1 && x < h.x + h.width + 1 && z > h.z - 1 && z < h.z + h.depth
    expect(pieces.filter((p) => pres(p.x, p.y, p.z))).toEqual([])
    expect(embrasures.filter((b) => pres(b.x, b.y, b.z))).toEqual([])
  })
})
