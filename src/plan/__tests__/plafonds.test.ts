import { expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { plafonds } from '../plafonds'

it('couvre chaque salle d’exposition, sous la dalle ou au sommet des murs, jamais le hall ni les balcons', () => {
  for (const level of MUSEE.levels) {
    const { platre, verre, resille } = plafonds(MUSEE, level.id)
    const salles = level.rooms.filter((r) => r.kind === 'gallery' || r.kind === 'honneur')
    expect(platre).toHaveLength(salles.length)
    expect(verre).toHaveLength(salles.length)
    expect(resille.length).toBeGreaterThan(0)
    const sous = level.elevation + MUSEE.storey - MUSEE.slab
    for (const p of platre) expect(p.y + p.h / 2).toBeCloseTo(sous, 6)
    // Au-dessus d'une tête levée sur la pointe des pieds : le plafond ne gêne pas la marche.
    for (const v of verre) expect(v.y).toBeGreaterThan(level.elevation + 4)
  }
})
