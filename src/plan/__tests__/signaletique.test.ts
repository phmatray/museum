import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { LINTEAU } from '../portes'
import { surfaceAt } from '../rules'
import { sorties } from '../signaletique'

describe('sorties', () => {
  const liste = sorties(MUSEE)

  it('en met une au-dessus de l’entrée, côté hall, et une côté galerie de chaque porte vers le hall', () => {
    const portesDuHall = MUSEE.levels[0].openings.filter((o) => o.kind === 'door' && (o.a === 'hall' || o.b === 'hall'))
    expect(liste).toHaveLength(1 + portesDuHall.length)
    expect(surfaceAt(MUSEE, liste[0].x, liste[0].z, 0)).toBe('0:hall')
    for (const s of liste.slice(1)) expect(surfaceAt(MUSEE, s.x, s.z, 0)).toMatch(/^0:r-/)
  })

  it('les accroche au-dessus des portes, tournées vers la pièce, collées au mur', () => {
    for (const s of liste) {
      expect(s.y).toBeGreaterThan(LINTEAU + 0.4)
      // Un pas vers où le bloc regarde reste dans la même pièce ; un pas en arrière passe le mur.
      const ici = surfaceAt(MUSEE, s.x, s.z, 0)
      expect(surfaceAt(MUSEE, s.x + Math.sin(s.lacet), s.z + Math.cos(s.lacet), 0)).toBe(ici)
      expect(surfaceAt(MUSEE, s.x - Math.sin(s.lacet) * 0.4, s.z - Math.cos(s.lacet) * 0.4, 0)).not.toBe(ici)
    }
  })
})
