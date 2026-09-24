/**
 * `Minimap` (#53) : le premier test monté du dépôt sur un composant qui lit
 * `themeName()`. La légende affichée doit venir de `themeName(accrochage,
 * room)`, pas du nom de travail de la salle — c'est précisément le bug que
 * #43 a corrigé au niveau de son appel JSX, et que rien ne gardait avant ce
 * test (revert la ligne `themeName(...)` de `Minimap.tsx` vers `room.name` :
 * ce test passe au rouge).
 *
 * `useAccrochage` est mocké (le hook, pas `fetch`) : #49 est en cours sur son
 * implémentation interne (fusion avec le hook dupliqué de `src/scene/`), donc
 * ce test ne doit dépendre que de sa signature publique
 * `useAccrochage(): Accrochage | null`, pas de la façon dont elle charge le
 * fichier.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Minimap } from '../Minimap'
import { useAccrochage } from '../../hooks/useAccrochage'
import { useGameStore } from '../../stores/gameStore'
import { MUSEE } from '../../plan/musee'
import type { Accrochage } from '../../plan/hang'
import type { Walker } from '../../plan/walk'

// Vitest hoiste `vi.mock` au-dessus des imports : la fabrique reste inline
// (et non dans un util partagé) pour éviter la ReferenceError de TDZ qu'un
// import référencé depuis elle déclencherait sinon.
vi.mock('../../hooks/useAccrochage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAccrochage')>()
  return { ...actual, useAccrochage: vi.fn() }
})

const mockUseAccrochage = vi.mocked(useAccrochage)

// r-o1, rez-de-chaussée : nom de travail "Blazor" dans musee.ts — une galerie
// réelle du plan, au centre de laquelle on place le visiteur.
const ROOM = MUSEE.levels[0].rooms.find((r) => r.id === 'r-o1')!
const VISITEUR: Walker = {
  level: 0,
  surface: `0:${ROOM.id}`,
  x: ROOM.x + ROOM.width / 2,
  z: ROOM.z + ROOM.depth / 2,
  y: 0,
  yaw: 0,
}

const ACCROCHAGE: Accrochage = {
  generatedAt: '2026-07-25T22:06:37.149Z',
  rooms: [{ id: ROOM.id, level: 0, name: 'Typescript / Tauri', placements: [] }],
}

describe('Minimap', () => {
  it("affiche le thème de l'accrochage, pas le nom de travail de la salle", () => {
    mockUseAccrochage.mockReturnValue(ACCROCHAGE)
    useGameStore.setState({ visiteur: VISITEUR })

    render(<Minimap />)

    expect(screen.getByText('Typescript / Tauri')).not.toBeNull()
    expect(screen.queryByText(ROOM.name)).toBeNull()
  })

  it("retombe sur le nom de travail de la salle quand l'accrochage n'est pas encore chargé", () => {
    mockUseAccrochage.mockReturnValue(null)
    useGameStore.setState({ visiteur: VISITEUR })

    render(<Minimap />)

    expect(screen.getByText(ROOM.name)).not.toBeNull()
  })
})
