import { describe, expect, it } from 'vitest'

import { placement } from '../spectateurs'

// Repère du modèle : il regarde +z ; le dos est à `dos`, contre le dossier (22 cm derrière le centre de la place).
const gabarit = (genouZ: number, genouY: number, pied = 0) => ({ dos: -0.5, cote: 0.18, pied, genou: { z: genouZ, y: genouY } })

describe('placement des spectateurs', () => {
  it('avance des cuisses courtes jusqu’à ce que le genou passe le bord de l’assise', () => {
    // Genou à 0,30 m devant le centre de la place : il faut 14 cm de plus.
    const { avance } = placement(gabarit(-0.5 + 0.22 + 0.3, 0.47))
    expect(avance).toBeCloseTo(0.14, 5)
  })

  it('n’avance pas des cuisses assez longues', () => {
    expect(placement(gabarit(-0.5 + 0.22 + 0.5, 0.47)).avance).toBe(0)
  })

  it('pose les cuisses sur l’assise sans enfoncer les pieds dans le sol', () => {
    // Genou trop haut de 5 cm, pieds au ras du sol : on ne peut pas baisser.
    expect(placement(gabarit(0.2, 0.52, 0)).hausse).toBeCloseTo(0, 5)
    // Pieds 3 cm au-dessus du sol : on baisse de 3 cm, pas plus.
    expect(placement(gabarit(0.2, 0.52, 0.03)).hausse).toBeCloseTo(-0.03, 5)
  })

  it('remonte des pieds passés sous le sol, de 4 cm au plus', () => {
    expect(placement(gabarit(0.2, 0.47, -0.02)).hausse).toBeCloseTo(0.02, 5)
    expect(placement(gabarit(0.2, 0.3, -0.1)).hausse).toBeCloseTo(0.04, 5)
  })
})
