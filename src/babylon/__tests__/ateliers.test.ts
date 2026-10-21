import { describe, expect, it } from 'vitest'

import donnees from '../../../public/data/ateliers.json'
import type { Atelier } from '../../domain/atelier'
import { disposerCoupe } from '../../plan/ateliers'
import { codeDeLaComete, geometrieDesFils, laiton } from '../ateliers'

const atelier = (donnees as unknown as { ateliers: Atelier[] }).ateliers[0]

describe('ateliers', () => {
  it('le cadre de laiton : 4 montants, 4 ceintures, 2 lisses et un filet par plaque, jonc et plinthe', () => {
    const coupe = disposerCoupe(atelier)
    const n = coupe.plaques.length
    const b = laiton(coupe)
    expect(b).toHaveLength(4 + 4 + 3 * n + 4 + 1)
    // La plinthe, au pied du socle.
    expect(b[8 + 2 * n + 4]).toMatchObject({ x: 0, y: 0.03, z: 0, kind: 'wall' })
    expect(b[0].h).toBeCloseTo(coupe.hauteur - 0.5)
  })

  it('un tube de 41 anneaux × 5 côtés par fil, ouvert, faces vers l’extérieur', () => {
    const g = geometrieDesFils([{ points: [[0, 0, 0], [0, 0.1, 0], [0.2, 0.1, 0], [0.2, 0.2, 0]], phase: 0.3 }])
    expect(g.positions.length).toBe(41 * 5 * 3)
    expect(g.indices.length / 3).toBe(400)
    // phase − t : 0,3 à la dépendance, 0,3 − 1 à l'autre bout.
    expect(g.decalage[0]).toBeCloseTo(0.3)
    expect(g.decalage[g.decalage.length - 1]).toBeCloseTo(-0.7)
    // Premier triangle : sa normale main droite pointe vers l'intérieur (face avant horaire vue du dehors, Babylon main droite).
    const p = (i: number) => [0, 1, 2].map((k) => g.positions[3 * g.indices[i] + k])
    const [a, b, c] = [p(0), p(1), p(2)]
    const [u, v] = [b.map((x, k) => x - a[k]), c.map((x, k) => x - a[k])]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const r = [0, 1, 2].map((k) => g.normals[3 * g.indices[0] + k])
    expect(n[0] * r[0] + n[1] * r[1] + n[2] * r[2]).toBeLessThan(0)
  })

  it('48 fils dans les données commitées si les trois vitrines ont leur atelier : ≈ 19 200 triangles', () => {
    const fils = (donnees as unknown as { ateliers: Atelier[] }).ateliers.flatMap((a) => disposerCoupe(a).fils.map((f) => ({ points: f.points, phase: 0 })))
    expect(geometrieDesFils(fils).indices.length / 3).toBe(400 * fils.length)
  })

  it('la comète : le même calcul en GLSL et en WGSL, sur l’attribut phase − t', () => {
    for (const wgsl of [false, true]) {
      const c = codeDeLaComete(wgsl)
      expect(c.vertex.CUSTOM_VERTEX_DEFINITIONS).toContain('filDecalage')
      expect(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toMatch(/0\.35 \+ 0\.3 \* (uniforms\.)?comete\.y \+ 2\.4 \* pow\(1\.0 - d, 10\.0\)/)
    }
  })
})
