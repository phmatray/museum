/**
 * Les sculptures du plan : Bavette endormi dans le hall, sur son socle, là où
 * la marche ne peut pas la traverser.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { sculpturePlacements } from '../sculptures.ts'
import { step, type Walker } from '../walk.ts'

const dans = (r: { x: number; z: number; width: number; depth: number }, x0: number, x1: number, z0: number, z1: number) =>
  x0 >= r.x && x1 <= r.x + r.width && z0 >= r.z && z1 <= r.z + r.depth

describe('sculpturePlacements', () => {
  const placements = sculpturePlacements(MUSEE)
  const bavette = placements.find((p) => p.cartel.title === 'Bavette endormi')

  it('pose Bavette endormi dans le hall, au rez-de-chaussée', () => {
    expect(bavette).toBeDefined()
    const p = bavette!
    const hall = MUSEE.levels[0].rooms.find((r) => r.id === 'hall')!
    const [x0, x1, z0, z1] = [p.x - p.plinth.width / 2, p.x + p.plinth.width / 2, p.z - p.plinth.depth / 2, p.z + p.plinth.depth / 2]
    expect(p.y).toBe(0)
    expect(dans(hall, x0, x1, z0, z1)).toBe(true)
  })

  it('pose chaque socle dans un obstacle du plan : la marche le contourne', () => {
    for (const p of placements) {
      const [x0, x1, z0, z1] = [p.x - p.plinth.width / 2, p.x + p.plinth.width / 2, p.z - p.plinth.depth / 2, p.z + p.plinth.depth / 2]
      expect(MUSEE.levels[0].obstacles.some((o) => dans(o, x0, x1, z0, z1))).toBe(true)
    }
  })

  it('un visiteur qui marche droit sur Bavette s’arrête avant le socle', () => {
    const p = bavette!
    let w: Walker = { ...MUSEE.spawn, surface: '0:hall', y: 0, yaw: 0 }
    for (let t = 0; t < 30; t += 1 / 60) {
      const yaw = Math.atan2(-(p.x - w.x), -(p.z - w.z))
      w = step(MUSEE, w, { forward: 1, strafe: 0, yaw }, 1 / 60)
      expect(Math.abs(w.x - p.x) < p.plinth.width / 2 && Math.abs(w.z - p.z) < p.plinth.depth / 2).toBe(false)
    }
    // Il est venu tout près : la pièce se regarde à moins de deux mètres.
    expect(Math.hypot(w.x - p.x, w.z - p.z)).toBeLessThan(2)
  })

  it('tourne la pièce vers le sud, face à l’entrée', () => {
    expect(bavette!.rotation).toBe(0)
  })
})
