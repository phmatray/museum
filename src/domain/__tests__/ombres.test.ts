import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { surfaceAt } from '../../plan/rules'
import { FONDU_REFLET, cadrerOmbre, melangeDeReflets, regrouperEmprises, sondeDeReflet } from '../ombres'

describe('sondeDeReflet', () => {
  it('lit la sonde sur la surface du marcheur', () => {
    expect(sondeDeReflet('parc:terrain')).toBe('ciel')
    expect(sondeDeReflet(null)).toBe('ciel')
    expect(sondeDeReflet('0:hall')).toBe('nef')
    expect(sondeDeReflet('1:balcon-o')).toBe('nef')
    expect(sondeDeReflet('palier:p1')).toBe('nef')
    expect(sondeDeReflet('volee:v1')).toBe('nef')
    expect(sondeDeReflet('1:honneur')).toBe('1:honneur')
    expect(sondeDeReflet('0:r-o2')).toBe('0:r-o2')
  })
})

describe('melangeDeReflets', () => {
  // La part d'une sonde donnée dans le reflet, là où se tient le visiteur.
  const partDe = (cle: string, level: number, x: number, z: number) => {
    const n = MUSEE.levels.find((l) => l.id === level)!
    const m = melangeDeReflets(n, x, z, surfaceAt(MUSEE, x, z, n.elevation))
    return (m.sonde === cle ? 1 - m.part : 0) + (m.voisine === cle && m.voisine !== m.sonde ? m.part : 0)
  }
  it('passe une porte sans saut : moitié-moitié sur le seuil, sa seule salle au-delà du fondu', () => {
    for (const [level, cle, pas] of [
      [0, 'nef', (t: number) => [16 + t, 24.4]], // hall ↔ r-o2
      [0, '0:r-o3', (t: number) => [8.3, 27 + t]], // r-o2 ↔ r-o3
      [0, 'nef', (t: number) => [24.5, 40 - t]], // l'entrée : le ciel ↔ la nef
      [1, '1:honneur', (t: number) => [16 + t, 6]], // e-o1 ↔ salle d'honneur
    ] as const) {
      let avant = partDe(cle, level, ...(pas(-2) as [number, number]))
      expect(avant).toBe(0)
      for (let t = -2; t <= 2; t += 0.05) {
        const p = partDe(cle, level, ...(pas(t) as [number, number]))
        expect(Math.abs(p - avant)).toBeLessThan(0.05)
        avant = p
      }
      expect(avant).toBe(1)
      expect(partDe(cle, level, ...(pas(0.001) as [number, number]))).toBeCloseTo(0.5, 2)
    }
  })
  it('ne mélange rien au milieu d’une salle, ni le long d’un mur loin des portes', () => {
    const n = MUSEE.levels[0]
    expect(melangeDeReflets(n, 8, 20, '0:r-o2').part).toBe(0)
    expect(melangeDeReflets(n, 16.3, 24 + 1.2 + FONDU_REFLET + 0.1, '0:hall').part).toBe(0)
  })
})

describe('cadrerOmbre', () => {
  const d = [0.5, 0.6, -0.62].map((x, _, a) => x / Math.hypot(...a)) as [number, number, number]
  it('ne bouge pas un centre déjà sur la grille, et reste dans un texel', () => {
    const c = cadrerOmbre([10.013, 1.7, 33.4], d, 0.05)
    expect(Math.hypot(c[0] - 10.013, c[1] - 1.7, c[2] - 33.4)).toBeLessThan(0.05)
    expect(cadrerOmbre(c, d, 0.05).every((x, i) => Math.abs(x - c[i]) < 1e-9)).toBe(true)
  })
  it('laisse libre le déplacement le long du rayon', () => {
    const a = cadrerOmbre([3, 0, 4], d, 0.05)
    const b = cadrerOmbre([3 + d[0] * 7, d[1] * 7, 4 + d[2] * 7], d, 0.05)
    expect(b.every((x, i) => Math.abs(x - (a[i] + d[i] * 7)) < 1e-9)).toBe(true)
  })
  it('tient le soleil au zénith', () => {
    expect(cadrerOmbre([1.02, 0, 2.04], [0, 1, 0], 0.1).map((x) => +x.toFixed(6))).toEqual([1, 0, 2])
  })
})

describe('regrouperEmprises', () => {
  it('fond les pièces d’un meuble, garde les meubles voisins à part', () => {
    const g = regrouperEmprises([
      { minX: 0, maxX: 2, minY: 0, minZ: 0, maxZ: 0.5 },
      { minX: 0.1, maxX: 0.2, minY: 0.02, minZ: 0.1, maxZ: 0.4 },
      { minX: 1.9, maxX: 2.1, minY: 0, minZ: 0.4, maxZ: 0.6 },
      { minX: 5, maxX: 6, minY: 0, minZ: 0, maxZ: 1 },
      { minX: 0, maxX: 2, minY: 4.8, minZ: 0, maxZ: 0.5 },
    ])
    expect(g).toHaveLength(3)
    expect(g).toContainEqual({ minX: 0, maxX: 2.1, minY: 0, minZ: 0, maxZ: 0.6 })
  })
})
