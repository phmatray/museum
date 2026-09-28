import { expect, it } from 'vitest'

import { facade, OBSTACLES_PORTIQUE } from '../facade'
import { MUSEE } from '../musee'

it('centre le portique sur l’entrée et laisse sa baie du milieu libre', () => {
  const entree = MUSEE.levels[0].openings.find((o) => o.kind === 'entrance')!
  const xs = OBSTACLES_PORTIQUE.flatMap((r) => [r.x, r.x + r.width])
  expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(entree.x)
  // Aucun pilier devant l'ouverture, sur toute sa largeur et 30 cm de jeu :
  // vu du hall, rien ne se dresse dans l'embrasure.
  const demi = entree.width / 2 + 0.3
  const devant = OBSTACLES_PORTIQUE.filter((r) => r.x < entree.x + demi - 1e-6 && r.x + r.width > entree.x - demi + 1e-6)
  expect(devant).toHaveLength(0)
})

it('habille de brique les quatre façades et pose l’enseigne au-dessus du portique', () => {
  const f = facade(MUSEE)
  expect(f.brique.length).toBeGreaterThan(8)
  expect(f.piliers).toHaveLength(4)
  expect(f.enseigne.y).toBeGreaterThan(8)
  expect(f.bannieres).toHaveLength(2)
})
