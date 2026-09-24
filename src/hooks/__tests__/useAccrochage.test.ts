/**
 * `themeName` (#43) : le thème que l'accrochage donne à une salle, avec repli
 * quand l'accrochage n'est pas encore chargé ou ne porte pas la salle.
 * Seam pur — pas de fetch, pas de montage React.
 */
import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../../plan/hang'
import { themeName } from '../useAccrochage'

const accrochage: Accrochage = {
  generatedAt: '2026-07-25T22:06:37.149Z',
  rooms: [{ id: 'r-o1', level: 0, name: 'Typescript / Tauri', placements: [] }],
}

describe('themeName', () => {
  it('retourne le thème de la salle quand elle est dans l’accrochage', () => {
    expect(themeName(accrochage, 'r-o1', 0, 'Blazor')).toBe('Typescript / Tauri')
  })

  it("retombe sur le repli quand la salle n'est pas dans l'accrochage", () => {
    expect(themeName(accrochage, 'r-inconnue', 0, 'Blazor')).toBe('Blazor')
  })

  it("retombe sur le repli quand l'accrochage n'est pas encore chargé", () => {
    expect(themeName(null, 'r-o1', 0, 'Blazor')).toBe('Blazor')
  })
})
