import { expect, it } from 'vitest'

import { facade, OBSTACLES_PORTIQUE } from '../facade'
import { MUSEE } from '../musee'

it('centre le portique sur l’entrée et laisse sa baie du milieu libre', () => {
  const entree = MUSEE.levels[0].openings.find((o) => o.kind === 'entrance')!
  const xs = OBSTACLES_PORTIQUE.flatMap((r) => [r.x, r.x + r.width])
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(entree.x)
  // Aucun pilier devant l'ouverture : la baie du milieu est plus large qu'une porte.
  const devant = OBSTACLES_PORTIQUE.filter((r) => r.x < entree.x + 1 && r.x + r.width > entree.x - 1)
  expect(devant).toHaveLength(0)
})

it('habille de brique les quatre façades et pose l’enseigne au-dessus du portique', () => {
  const f = facade(MUSEE)
  expect(f.brique.length).toBeGreaterThan(8)
  expect(f.piliers).toHaveLength(4)
  expect(f.enseigne.y).toBeGreaterThan(8)
  expect(f.bannieres).toHaveLength(2)
})
