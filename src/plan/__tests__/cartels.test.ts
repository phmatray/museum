/**
 * Les cartels du plan : un par toile de l'accrochage, sur le même mur, à droite
 * du cadre, sans mordre la toile voisine.
 */
import { describe, expect, it } from 'vitest'

import accrochage from '../../../public/data/accrochage.json'
import type { Artwork } from '../../domain/types.ts'
import { CARTEL_LARGEUR, cartelPlacements, cartelTexte } from '../cartels.ts'
import type { Accrochage } from '../hang.ts'

const ACC = accrochage as Accrochage

describe('cartelPlacements', () => {
  const cartels = cartelPlacements(ACC)
  const toiles = ACC.rooms.flatMap((r) => r.placements)

  it('pose exactement un cartel par toile', () => {
    expect(cartels).toHaveLength(toiles.length)
    expect(new Set(cartels.map((c) => c.key))).toEqual(new Set(toiles.map((t) => t.key)))
  })

  it('pose chaque cartel à côté de sa toile, sur le même mur, à droite du cadre', () => {
    for (const c of cartels) {
      const t = toiles.find((t) => t.key === c.key)!
      const [nx, nz] = t.normal
      // Sur le mur : le décalage le long de la normale est de quelques millimètres.
      expect(Math.abs((c.x - t.x) * nx + (c.z - t.z) * nz)).toBeLessThan(0.02)
      // À droite pour qui regarde le mur (tangente = haut × normale), hors du cadre, à moins d'un mètre.
      const aDroite = (c.x - t.x) * nz - (c.z - t.z) * nx
      expect(aDroite).toBeGreaterThan(t.width / 2)
      expect(Math.hypot(c.x - t.x, c.z - t.z)).toBeLessThan(t.width / 2 + 1)
      expect(c.y).toBeLessThan(t.y)
    }
  })

  it('ne mord aucune autre toile du même mur', () => {
    for (const c of cartels) {
      const t = toiles.find((t) => t.key === c.key)!
      for (const o of toiles) {
        // Même mur : même normale, même plan, même niveau (l'étage répète le plan du rez-de-chaussée).
        if (o === t || o.normal[0] !== t.normal[0] || o.normal[1] !== t.normal[1] || o.y !== t.y) continue
        if (Math.abs((o.x - t.x) * t.normal[0] + (o.z - t.z) * t.normal[1]) > 0.01) continue
        expect(Math.hypot(c.x - o.x, c.z - o.z)).toBeGreaterThan(o.width / 2 + CARTEL_LARGEUR / 2)
      }
    }
  })
})

describe('cartelTexte', () => {
  const oeuvre = { title: 'museum', owner: 'phmatray', language: 'TypeScript', stars: 12, createdAt: '2026-01-02T00:00:00Z' } as Artwork

  it('écrit le titre, l’auteur, la langue, les étoiles et l’année', () => {
    expect(cartelTexte(oeuvre)).toBe('museum\nphmatray · TypeScript\n★ 12 · 2026')
  })

  it('coupe un titre très long pour que le cartel reste lisible', () => {
    const long = cartelTexte({ ...oeuvre, title: 'un titre vraiment beaucoup trop long pour tenir sur un cartel de trente centimètres' })
    const titre = long.split('\n')[0]
    expect(titre.length).toBeLessThanOrEqual(41)
    expect(titre.endsWith('…')).toBe(true)
  })
})
