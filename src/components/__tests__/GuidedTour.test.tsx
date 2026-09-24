/**
 * `GuidedTour` (#53) : même garde que `Minimap.test.tsx`, pour le cartouche de
 * la visite guidée. Le nom affiché doit venir de `themeName(accrochage, stop)`,
 * pas du nom de travail de l'arrêt (revert la ligne `themeName(...)` de
 * `GuidedTour.tsx` vers `stop?.name` : ce test passe au rouge).
 *
 * `useAccrochage` est mocké comme dans `Minimap.test.tsx` — même seam, même
 * raison (#49 travaille sur l'implémentation interne du hook, pas sur sa
 * signature publique). L'arrêt testé est `VISITE[0]`, le premier de
 * l'itinéraire réellement calculé par `buildTourItinerary(MUSEE)` : on ne
 * fige pas un id de salle en dur, qui deviendrait obsolète si le plan change.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { GuidedTour } from '../GuidedTour'
import { useAccrochage } from '../../hooks/useAccrochage'
import { useGameStore } from '../../stores/gameStore'
import { VISITE } from '../../plan/tour'
import type { Accrochage } from '../../plan/hang'

vi.mock('../../hooks/useAccrochage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAccrochage')>()
  return { ...actual, useAccrochage: vi.fn() }
})

const mockUseAccrochage = vi.mocked(useAccrochage)
const STOP = VISITE[0]

const ACCROCHAGE: Accrochage = {
  generatedAt: '2026-07-25T22:06:37.149Z',
  rooms: [{ id: STOP.roomId, level: STOP.level, name: 'Typescript / Tauri', placements: [] }],
}

describe('GuidedTour', () => {
  it("affiche le thème de l'accrochage pour l'arrêt en cours, pas son nom de travail", () => {
    mockUseAccrochage.mockReturnValue(ACCROCHAGE)
    useGameStore.setState({ tourActive: true, tourEtape: 0 })

    render(<GuidedTour />)

    expect(screen.getByText('Typescript / Tauri', { exact: false })).not.toBeNull()
    expect(screen.queryByText(STOP.name, { exact: false })).toBeNull()
  })

  it("retombe sur le nom de travail de l'arrêt quand l'accrochage n'est pas encore chargé", () => {
    mockUseAccrochage.mockReturnValue(null)
    useGameStore.setState({ tourActive: true, tourEtape: 0 })

    render(<GuidedTour />)

    expect(screen.getByText(STOP.name, { exact: false })).not.toBeNull()
  })
})
