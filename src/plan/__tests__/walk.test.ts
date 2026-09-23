/**
 * La marche au rez-de-chaussée : les murs arrêtent, les portes laissent passer.
 *
 * Chaque cas part du point d'arrivée du plan et marche, sans téléporter : si
 * une ouverture ou un mur disparaît du plan, l'un de ces cas casse.
 */
import { describe, expect, it } from 'vitest'

import { DELTA_MAX, VITESSE_MARCHE, directionMarche } from '../../domain/locomotion.ts'
import { MUSEE } from '../musee.ts'
import { step, type Walker } from '../walk.ts'

const RAYON = 0.3
const DT = 1 / 120

const depart = (): Walker => ({ ...MUSEE.spawn, y: 0, yaw: 0 })

/** Le cap qui regarde de (x, z) vers la cible : l'avant est −z tourné du lacet. */
const capVers = (w: Walker, x: number, z: number) => Math.atan2(-(x - w.x), -(z - w.z))

const marcher = (w: Walker, yaw: number, secondes: number, dt = DT, hate = false, apres?: (w: Walker) => void) => {
  for (let t = 0; t < secondes; t += dt) {
    w = step(MUSEE, w, { forward: 1, strafe: 0, yaw, hate }, dt)
    apres?.(w)
  }
  return w
}

describe('la marche au rez-de-chaussée', () => {
  it('s’arrête contre le dessous du palier en marchant vers le nord', () => {
    let franchi = false
    const w = marcher(depart(), 0, 20, DT, false, (w) => { if (w.z < 15.5 + RAYON - 1e-6) franchi = true })
    expect(franchi).toBe(false)
    expect(w.z).toBeCloseTo(15.5 + RAYON, 3)
    expect(w.y).toBe(0)
  })

  it('entre dans « Librairies .NET » par la porte du hall', () => {
    const w0 = depart()
    const w = marcher(w0, capVers(w0, 16, 24), 10)
    expect(w.x).toBeLessThan(16)
    expect(w.z).toBeGreaterThan(13)
    expect(w.z).toBeLessThan(27)
  })

  it('ne traverse pas le mur plein entre deux portes, même en hâte au delta maximal', () => {
    // On remonte le hall jusqu'en face du mur plein, puis on fonce droit dessus.
    let w = marcher(depart(), 0, 8 / 1.8)
    expect(w.z).toBeCloseTo(29, 1)
    let minX = Infinity
    w = marcher(w, Math.PI / 2, 20, DELTA_MAX, true, (w) => { minX = Math.min(minX, w.x) })
    expect(minX).toBeGreaterThanOrEqual(16 + RAYON - 1e-6)
    expect(w.x).toBeCloseTo(16 + RAYON, 3)
  })

  it('ne sort pas par l’entrée : dehors, il n’y a pas encore de sol', () => {
    let w = depart()
    for (let t = 0; t < 10; t += DT) w = step(MUSEE, w, { forward: -1, strafe: 0, yaw: 0 }, DT)
    expect(w.z).toBeCloseTo(MUSEE.depth - RAYON, 3)
  })

  it('va de côté et en diagonale dans la direction et à la vitesse de directionMarche', () => {
    const cas = [
      { forward: 0, strafe: 1, touches: { forward: false, backward: false, left: false, right: true } },
      { forward: 1, strafe: -1, touches: { forward: true, backward: false, left: true, right: false } },
    ]
    for (const { forward, strafe, touches } of cas) {
      const w0 = depart()
      const w = step(MUSEE, w0, { forward, strafe, yaw: 0.3 }, DT)
      const d = directionMarche(touches, 0.3)
      expect((w.x - w0.x) / DT).toBeCloseTo(d.x * VITESSE_MARCHE, 6)
      expect((w.z - w0.z) / DT).toBeCloseTo(d.z * VITESSE_MARCHE, 6)
    }
  })
})
