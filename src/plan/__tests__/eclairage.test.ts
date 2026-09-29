import { describe, expect, it } from 'vitest'

import { GLOBE, PROJECTEURS_FACADE, SOURCES_LAMPADAIRES, SOUS_BALCON, SPOTS_BALCON } from '../eclairage'
import { presDeLEau } from '../jardin'
import { MOBILIER, emprise } from '../mobilier'
import { MUSEE } from '../musee'
import { parkPlacements, surUneAllee } from '../park'
import { solDuParc } from '../relief'
import type { Rect } from '../types'

const PARC = parkPlacements(MUSEE)
const LAMPADAIRES = MOBILIER.filter((m) => m.piece === 'Lampadaire')
const nom = (m: { x: number; z: number }) => `lampadaire (${m.x}, ${m.z})`
const dans = (r: Rect, x: number, z: number) => x >= r.x && x <= r.x + r.width && z >= r.z && z <= r.z + r.depth

describe('les lampadaires du parc', () => {
  it('bordent les allées sans y mordre, au sec, hors des troncs', () => {
    expect(LAMPADAIRES.length).toBeGreaterThanOrEqual(30)
    for (const m of LAMPADAIRES) {
      // Sur le gazon, bordure de galets comprise…
      expect(surUneAllee(PARC.allees, m.x, m.z, 0.4), nom(m)).toBe(false)
      // … mais à deux pas du gravier : un lampadaire éclaire une allée.
      expect(surUneAllee(PARC.allees, m.x, m.z, 1.5), nom(m)).toBe(true)
      expect(presDeLEau(m.x, m.z, 1), nom(m)).toBe(false)
      for (const p of PARC.plantations.filter((p) => p.espece !== 'petales' && p.espece !== 'fougere')) {
        const tronc = p.espece.startsWith('erable') ? 0.5 : p.rayon
        expect(Math.hypot(p.x - m.x, p.z - m.z), `${nom(m)} dans ${p.espece}`).toBeGreaterThan(tronc)
      }
    }
  })

  it('tend la crosse au-dessus de l’allée : le globe est plus près du gravier que le fût', () => {
    SOURCES_LAMPADAIRES.forEach(([x, y, z], i) => {
      const m = LAMPADAIRES[i]
      expect(surUneAllee(PARC.allees, x, z, 1.5 - GLOBE.portee + 0.01), nom(m)).toBe(true)
      expect(y - m.y).toBeCloseTo(GLOBE.hauteur)
    })
  })

  it('n’en pose jamais deux au même pied, ni un seul à plus de 16,5 m d’un autre', () => {
    for (const a of LAMPADAIRES) {
      const voisins = LAMPADAIRES.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z))
      expect(Math.min(...voisins), nom(a)).toBeGreaterThan(4.9)
      expect(Math.min(...voisins), nom(a)).toBeLessThan(16.5)
    }
  })

  it('ne touche aucun autre meuble du parc', () => {
    const autres = MOBILIER.filter((m) => m.surface === 'parc:terrain' && m.piece !== 'Lampadaire').map(emprise)
    for (const m of LAMPADAIRES) for (const r of autres) expect(dans({ x: r.x - 0.5, z: r.z - 0.5, width: r.width + 1, depth: r.depth + 1 }, m.x, m.z), nom(m)).toBe(false)
  })
})

describe('les spots sous les balcons', () => {
  const balcons = MUSEE.levels[1].rooms.filter((r) => r.kind === 'balcony')
  it('sont encastrés sous la dalle d’un balcon, au-dessus du rez-de-chaussée du hall', () => {
    expect(SPOTS_BALCON.length).toBeGreaterThan(20)
    for (const [x, y, z] of SPOTS_BALCON) {
      expect(balcons.some((b) => dans(b, x, z)), `spot (${x}, ${z})`).toBe(true)
      expect(y).toBeLessThan(SOUS_BALCON)
      expect(y).toBeGreaterThan(SOUS_BALCON - 0.05)
    }
  })
})

describe('les projecteurs de la façade', () => {
  it('sont au pied de la façade sud, dehors, hors des obstacles et du passage de l’entrée', () => {
    const obstacles = MUSEE.levels[0].obstacles
    for (const [x, y, z] of PROJECTEURS_FACADE) {
      expect(z).toBeGreaterThan(40.45)
      expect(y).toBeGreaterThanOrEqual(solDuParc(x, z))
      expect(Math.abs(x - 24), `projecteur (${x}, ${z})`).toBeGreaterThan(3)
      for (const r of obstacles) expect(dans(r, x, z), `projecteur (${x}, ${z})`).toBe(false)
    }
  })
})
