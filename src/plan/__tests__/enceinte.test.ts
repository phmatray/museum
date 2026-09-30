import { describe, expect, it } from 'vitest'

import { enceinte } from '../enceinte'
import { MUSEE } from '../musee'
import { parkPlacements } from '../park'
import { hauteurDuParc } from '../relief'

const parc = parkPlacements(MUSEE)
const mur = enceinte(parc.terrain, parc.allees)
const { terrain } = parc
const [x1, z1] = [terrain.x + terrain.width, terrain.z + terrain.depth]
const dedans = (x: number, z: number) => x > terrain.x && x < x1 && z > terrain.z && z < z1

describe('enceinte', () => {
  it('habille le mur de plaques de lierre, au pied, côté parc, tournées vers lui', () => {
    expect(mur.lierre.length).toBeGreaterThan(30)
    for (const l of mur.lierre) {
      // Au ras de la face intérieure : à 1 cm dans le terrain.
      const bord = Math.min(l.x - terrain.x, x1 - l.x, l.z - terrain.z, z1 - l.z)
      expect(bord, `${l.x}, ${l.z}`).toBeCloseTo(0.01, 5)
      // Le modèle regarde +z : tourné de `rotation`, il regarde vers le centre du parc.
      const [vx, vz] = [Math.sin(l.rotation), Math.cos(l.rotation)]
      expect(vx * (terrain.x + terrain.width / 2 - l.x) + vz * (terrain.z + terrain.depth / 2 - l.z)).toBeGreaterThan(0)
      expect(Math.abs(l.y! - hauteurDuParc(l.x, l.z))).toBeLessThan(0.1)
    }
  })

  it('ferme le parc sur ses quatre côtés, hors du terrain où l’on marche', () => {
    const long = (f: (b: (typeof mur.brique)[number]) => boolean) => mur.brique.filter(f).reduce((s, b) => s + Math.max(b.w, b.d), 0)
    expect(long((b) => b.z < terrain.z)).toBeGreaterThan(terrain.width * 0.85)
    expect(long((b) => b.z > z1)).toBeGreaterThan(terrain.width * 0.85)
    expect(long((b) => b.x < terrain.x)).toBeGreaterThan(terrain.depth * 0.85)
    expect(long((b) => b.x > x1)).toBeGreaterThan(terrain.depth * 0.85)
    // Les travées et les piles sont centrées hors du terrain : seules les piles y avancent, de quelques centimètres.
    for (const b of mur.brique) expect(dedans(b.x, b.z), `${b.x}, ${b.z}`).toBe(false)
  })

  it('ouvre une grille au bout de chaque accès, sans brique en travers', () => {
    const bouts = parc.allees.flatMap((a) => [a.a, a.b].map((p) => ({ ...p, l: a.largeur })))
      .filter((p) => p.x === terrain.x || p.x === x1 || p.z === terrain.z || p.z === z1)
    // L'axe de l'entrée, l'ouest, le nord, l'est après le pont.
    expect(bouts).toHaveLength(4)
    for (const p of bouts) {
      for (const b of mur.brique) expect(Math.abs(b.x - p.x) < b.w / 2 + p.l / 2 && Math.abs(b.z - p.z) < b.d / 2 + p.l / 2, `${p.x}, ${p.z}`).toBe(false)
      expect(mur.fer.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < 1.5)).toBe(true)
    }
  })

  it('pose chaque travée dans le sol, son arase au-dessus de l’œil', () => {
    for (const b of mur.brique) {
      const sol = hauteurDuParc(Math.min(Math.max(b.x, terrain.x), x1), Math.min(Math.max(b.z, terrain.z), z1))
      expect(b.y - b.h / 2).toBeLessThan(sol)
      expect(b.y + b.h / 2 - sol).toBeGreaterThan(1.9)
    }
  })
})
