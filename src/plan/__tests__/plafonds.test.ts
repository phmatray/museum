import { expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { plafonds, VOUTE } from '../plafonds'

it('couvre chaque salle d’exposition, sous la dalle ou au sommet des murs, jamais le hall ni les balcons', () => {
  for (const level of MUSEE.levels) {
    const { platre, verre, resille } = plafonds(MUSEE, level.id)
    const salles = level.rooms.filter((r) => (r.kind === 'gallery' || r.kind === 'honneur') && r.id !== VOUTE.salle)
    expect(platre).toHaveLength(salles.length)
    expect(verre).toHaveLength(salles.length)
    expect(resille.length).toBeGreaterThan(0)
    const sous = level.elevation + MUSEE.storey - MUSEE.slab
    for (const p of platre) expect(p.y + p.h / 2).toBeCloseTo(sous, 6)
    // Au-dessus d'une tête levée sur la pointe des pieds : le plafond ne gêne pas la marche.
    for (const v of verre) expect(v.y).toBeGreaterThan(level.elevation + 4)
  }
})

it('laisse la salle d’honneur à sa voûte : ni plâtre plat ni lanterneau sous elle', () => {
  const h = MUSEE.levels[1].rooms.find((r) => r.id === VOUTE.salle)!
  const { platre, verre } = plafonds(MUSEE, 1)
  const dessous = (b: { x: number; z: number }) => b.x > h.x && b.x < h.x + h.width && b.z > h.z && b.z < h.z + h.depth
  expect([...platre, ...verre].filter(dessous)).toHaveLength(0)
})
