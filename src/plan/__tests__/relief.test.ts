/**
 * Le relief du parc : des buttes douces, mais plat là où le monde doit l'être —
 * le parvis, l'axe de l'entrée, le sol creusé du jardin (Blender le pose à 0).
 */
import { describe, expect, it } from 'vitest'

import { JARDIN } from '../jardin.ts'
import { MUSEE } from '../musee.ts'
import { parkPlacements } from '../park.ts'
import { hauteurDuParc } from '../relief.ts'

const parc = parkPlacements(MUSEE)
const { terrain, parvis } = parc

/** Tous les points du terrain, au pas donné. */
function* points(pas: number) {
  for (let z = terrain.z; z <= terrain.z + terrain.depth; z += pas)
    for (let x = terrain.x; x <= terrain.x + terrain.width; x += pas) yield [x, z] as const
}

describe('hauteurDuParc', () => {
  it('est déterministe', () => {
    for (const [x, z] of points(7)) expect(hauteurDuParc(x, z)).toBe(hauteurDuParc(x, z))
  })

  it('reste dans des bornes de parc, avec de vraies buttes', () => {
    const h = [...points(1)].map(([x, z]) => hauteurDuParc(x, z))
    expect(Math.min(...h)).toBeGreaterThan(-0.5)
    expect(Math.max(...h)).toBeLessThan(4)
    expect(Math.max(...h)).toBeGreaterThan(1.5)
  })

  it('est continu et praticable : pas de pente au-delà de 40 %', () => {
    const e = 0.05
    for (const [x, z] of points(0.5)) {
      const h = hauteurDuParc(x, z)
      expect(Math.abs(hauteurDuParc(x + e, z) - h) / e).toBeLessThan(0.4)
      expect(Math.abs(hauteurDuParc(x, z + e) - h) / e).toBeLessThan(0.4)
    }
  })

  it('vaut 0 sur le parvis, l’axe de l’entrée et les zones du jardin, bords compris', () => {
    const plats = [parvis, ...JARDIN.zones, { x: 22.8, z: parvis.z + parvis.depth, width: 2.4, depth: 35 }]
    for (const r of plats)
      for (let z = r.z; z <= r.z + r.depth; z += 0.5)
        for (let x = r.x; x <= r.x + r.width; x += 0.5) expect(hauteurDuParc(x, z), `(${x}, ${z})`).toBe(0)
  })
})
