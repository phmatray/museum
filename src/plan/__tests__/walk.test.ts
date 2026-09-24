/**
 * La marche dans le plan : les murs arrêtent, les portes laissent passer,
 * l'escalier impérial monte à l'étage noble et les garde-corps retiennent.
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

const depart = (): Walker => ({ ...MUSEE.spawn, surface: '0:hall', y: 0, yaw: 0 })

/** Le cap qui regarde de (x, z) vers la cible : l'avant est −z tourné du lacet. */
const capVers = (w: Walker, x: number, z: number) => Math.atan2(-(x - w.x), -(z - w.z))

const marcher = (w: Walker, yaw: number, secondes: number, dt = DT, hate = false, apres?: (w: Walker) => void) => {
  for (let t = 0; t < secondes; t += dt) {
    w = step(MUSEE, w, { forward: 1, strafe: 0, yaw, hate }, dt)
    apres?.(w)
  }
  return w
}

/** Marche droit vers (x, z), en recalant le cap à chaque pas, jusqu'à y être ou être bloqué. */
const vers = (w: Walker, x: number, z: number, apres?: (w: Walker) => void, hate = false) => {
  for (let i = 0; i < 20 / DT && Math.hypot(x - w.x, z - w.z) > 0.02; i++) {
    w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, x, z), hate }, DT)
    apres?.(w)
  }
  return w
}

/** Une suite de points de passage, depuis le point d'apparition. */
const parcours = (points: [number, number][], apres?: (w: Walker) => void, hate = false) =>
  points.reduce((w, [x, z]) => vers(w, x, z, apres, hate), depart())

/** Du hall au palier par la volée centrale, puis au balcon ouest par la volée ouest. */
const AU_PALIER: [number, number][] = [[24, 14]]
const AU_BALCON_OUEST: [number, number][] = [...AU_PALIER, [17.5, 14], [17.5, 24]]

describe('la marche au rez-de-chaussée', () => {
  it('s’arrête contre le dessous du palier en marchant vers le nord, à côté de la volée', () => {
    let franchi = false
    const w = marcher(vers(depart(), 20, 30), 0, 20, DT, false, (w) => { if (w.z < 15.5 + RAYON - 1e-6) franchi = true })
    expect(franchi).toBe(false)
    expect(w.z).toBeCloseTo(15.5 + RAYON, 3)
    expect(w.y).toBe(0)
  })

  it('entre dans « Librairies .NET » par la porte du hall', () => {
    const w0 = depart()
    // 18 m de marche : 15,3 m jusqu'à la porte, puis moins de trois dans la salle.
    // Une durée fixe mesurerait la vitesse, et au-delà la salle se traverse.
    const w = marcher(w0, capVers(w0, 16, 24), 18 / VITESSE_MARCHE)
    expect(w.x).toBeLessThan(16)
    expect(w.z).toBeGreaterThan(13)
    expect(w.z).toBeLessThan(27)
  })

  it('ne traverse pas le mur plein entre deux portes, même en hâte au delta maximal', () => {
    // On remonte le hall jusqu'en face du mur plein, puis on fonce droit dessus.
    let w = marcher(depart(), 0, 8 / VITESSE_MARCHE)
    expect(w.z).toBeCloseTo(29, 1)
    let minX = Infinity
    w = marcher(w, Math.PI / 2, 20, DELTA_MAX, true, (w) => { minX = Math.min(minX, w.x) })
    expect(minX).toBeGreaterThanOrEqual(16 + RAYON - 1e-6)
    expect(w.x).toBeCloseTo(16 + RAYON, 3)
  })

  it('traverse le hall en 6 s au pas et en 3,5 s en hâte', () => {
    // 21 m, de z = 39 à z = 18, écrits à la main : c'est la promesse faite au visiteur.
    const w0 = vers(depart(), 20, 39)
    expect(marcher(w0, 0, 6).z).toBeLessThan(18.1)
    expect(marcher(w0, 0, 3.5, DT, true).z).toBeLessThan(18.1)
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

describe("l'escalier impérial", () => {
  it("monte de l'entrée à la salle d'honneur, sans saut de cote", () => {
    const cotes: number[] = []
    const w = parcours(
      [...AU_BALCON_OUEST, [14, 24], [8, 24], [8, 11], [8, 6], [20, 6]],
      (w) => cotes.push(w.y),
    )
    expect(w.surface).toBe('1:honneur')
    expect(w.level).toBe(1)
    expect(w.y).toBeCloseTo(4.8, 6)
    expect(cotes.some((y) => Math.abs(y - 2.4) < 1e-6)).toBe(true)
    const sauts = cotes.slice(1).map((y, i) => Math.abs(y - cotes[i]))
    expect(Math.max(...sauts)).toBeLessThanOrEqual(0.05)
  })

  it("monte à la salle d'honneur en hâte, sans saut de cote", () => {
    const cotes: number[] = []
    const w = parcours(
      [...AU_BALCON_OUEST, [14, 24], [8, 24], [8, 11], [8, 6], [20, 6]],
      (w) => cotes.push(w.y),
      true,
    )
    expect(w.surface).toBe('1:honneur')
    const sauts = cotes.slice(1).map((y, i) => Math.abs(y - cotes[i]))
    expect(Math.max(...sauts)).toBeLessThanOrEqual(0.05)
  })

  it('redescend du balcon ouest au hall, sans saut de cote', () => {
    const cotes: number[] = []
    const w = parcours([...AU_BALCON_OUEST, [17.5, 14], [24, 14], [24, 30]], (w) => cotes.push(w.y))
    expect(w.surface).toBe('0:hall')
    expect(w.level).toBe(0)
    expect(w.y).toBe(0)
    expect(Math.max(...cotes)).toBeCloseTo(4.8, 6)
    const sauts = cotes.slice(1).map((y, i) => Math.abs(y - cotes[i]))
    expect(Math.max(...sauts)).toBeLessThanOrEqual(0.05)
  })

  it('arrête au garde-corps du palier entre deux volées, et laisse entrer dans une volée latérale', () => {
    const palier = parcours([...AU_PALIER, [20, 14]])
    expect(palier.surface).toBe('palier:palier')
    expect(palier.y).toBeCloseTo(2.4, 6)

    const bloque = marcher(palier, Math.PI, 5)
    expect(bloque.surface).toBe('palier:palier')
    expect(bloque.z).toBeCloseTo(15.5 - RAYON, 3)

    const entre = marcher(vers(palier, 17.5, 14), Math.PI, 1)
    expect(entre.surface).toBe('volee:volee-ouest')
    expect(entre.y).toBeGreaterThan(2.4)
  })

  it("arrête au garde-corps du balcon ouest vers l'est, et mène au balcon sud", () => {
    const balcon = parcours([...AU_BALCON_OUEST, [17.5, 30]])
    expect(balcon.surface).toBe('1:balcon-o')

    const bloque = marcher(balcon, -Math.PI / 2, 5)
    expect(bloque.x).toBeCloseTo(19 - RAYON, 3)
    expect(bloque.surface).toBe('1:balcon-o')

    const sud = vers(vers(balcon, 17.5, 38.5), 24, 38.5)
    expect(sud.surface).toBe('1:balcon-s')
    expect(sud.y).toBeCloseTo(4.8, 6)
  })
})
