import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../../plan/hang'
import { billet } from '../billet'

const place = (key: string) => ({ key }) as Accrochage['rooms'][number]['placements'][number]

describe('billet', () => {
  it("imprime la collection du jour, la date, l'heure et le numéro de visiteur", () => {
    const accrochage = {
      generatedAt: '',
      rooms: [
        { id: 'a', level: 0, name: 'A', placements: [place('x/1'), place('x/2')] },
        { id: 'b', level: 0, name: 'B', placements: [place('x/3')] },
        { id: 'vide', level: 1, name: 'Vide', placements: [] },
      ],
    } as Accrochage
    const b = billet(accrochage, 3, new Date(2026, 8, 29, 21, 4), 159)
    expect(b.collection).toBe('6 œuvres · 2 salles')
    expect(b.jour).toBe('mardi 29 septembre 2026')
    expect(b.heure).toBe('21 h 04')
    expect(b.numero).toBe('000159')
  })

  it('attend l’accrochage et le compteur sans rien inventer', () => {
    const b = billet(null, 0, new Date(2026, 0, 1, 9, 30), null)
    expect(b.collection).toBeNull()
    expect(b.numero).toBe('––––––')
  })
})
