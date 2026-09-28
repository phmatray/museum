/**
 * Le jardin japonais : l'eau arrête la marche, le pont la laisse passer,
 * l'axe de l'entrée reste libre et rien ne pousse dans l'étang.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { JARDIN, OBSTACLES_JARDIN, TABLIER, distanceEtang, distanceRuisseau } from '../jardin.ts'
import { parkPlacements } from '../park.ts'
import { step, type Walker } from '../walk.ts'
import type { Rect } from '../types.ts'

const DT = 1 / 60
const dans = (r: Rect, x: number, z: number) => x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth
const dehors = (x: number, z: number): Walker => ({ level: 0, x, z, y: 0, yaw: 0, surface: 'parc:terrain' })
const marcher = (w: Walker, yaw: number, secondes: number) => {
  for (let t = 0; t < secondes; t += DT) w = step(MUSEE, w, { forward: 1, strafe: 0, yaw }, DT)
  return w
}

describe('le jardin japonais', () => {
  it('couvre l’eau d’obstacles, sauf le tablier du pont', () => {
    for (let x = 30; x < 88; x += 0.5) {
      for (let z = -6; z < 80; z += 0.5) {
        const profond = Math.min(distanceEtang(x, z), distanceRuisseau(x, z)) < -0.6
        if (profond && !dans(TABLIER, x, z)) expect(OBSTACLES_JARDIN.some((o) => dans(o, x, z)), `(${x}, ${z})`).toBe(true)
      }
    }
  })

  it('arrête le visiteur au bord de l’étang', () => {
    const w = marcher(dehors(45, 53), Math.PI, 10)
    expect(w.surface).toBe('parc:terrain')
    expect(distanceEtang(w.x, w.z)).toBeGreaterThan(-0.5)
  })

  it('laisse traverser le ruisseau sur le pont, et pas à côté', () => {
    const z = JARDIN.pont.z
    expect(marcher(dehors(66, z), -Math.PI / 2, 12).x).toBeGreaterThan(82)
    expect(marcher(dehors(66, z + 4), -Math.PI / 2, 12).x).toBeLessThan(JARDIN.pont.x - 0.5)
  })

  it('laisse libres l’axe de l’entrée et le portique', () => {
    for (const o of OBSTACLES_JARDIN) expect(o.x > 26 || o.x + o.width < 22).toBe(true)
    for (let z = 40; z < 80; z += 0.5) expect(Math.min(distanceEtang(24, z), distanceRuisseau(24, z))).toBeGreaterThan(5)
  })
})

describe('le parc autour du jardin', () => {
  const parc = parkPlacements(MUSEE)

  it('ne plante rien dans l’eau : seuls les rochers ont le pied mouillé', () => {
    for (const p of parc.plantations) {
      if (p.espece.startsWith('rocher')) continue
      expect(Math.min(distanceEtang(p.x, p.z), distanceRuisseau(p.x, p.z)), `${p.espece} en (${p.x}, ${p.z})`).toBeGreaterThan(0)
    }
  })

  it('plante des érables, des boules taillées et des rochers', () => {
    const especes = new Set(parc.plantations.map((p) => p.espece))
    for (const e of ['erable-rouge', 'erable-vert', 'buis', 'azalee', 'rocher-1']) expect(especes.has(e as never), e).toBe(true)
  })

  it('arrête la pelouse au bord du sol creusé du jardin', () => {
    for (const r of parc.sol) {
      for (const z of JARDIN.zones) {
        const recouvre = r.x < z.x + z.width && r.x + r.width > z.x && r.z < z.z + z.depth && r.z + r.depth > z.z
        expect(recouvre).toBe(false)
      }
    }
  })

  it('garde droite l’allée de l’entrée, et coupe l’accès est au pont', () => {
    expect(parc.allees.some((a) => a.a.x === 24 && a.b.x === 24 && a.b.z === parc.terrain.z + parc.terrain.depth)).toBe(true)
    for (const a of parc.allees) {
      const [x0, x1] = [Math.min(a.a.x, a.b.x), Math.max(a.a.x, a.b.x)]
      const surLePont = Math.abs(a.a.z - JARDIN.pont.z) < 0.01 && x0 < JARDIN.pont.x && x1 > JARDIN.pont.x
      expect(surLePont).toBe(false)
    }
  })
})
