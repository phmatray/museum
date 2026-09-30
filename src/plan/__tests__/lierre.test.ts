import { describe, expect, it } from 'vitest'

import { CHAPERON_MUR, enceinte } from '../enceinte'
import { SORTE, lierreDuMur } from '../lierre'
import { MUSEE } from '../musee'
import { parkPlacements } from '../park'
import { hauteurDuParc } from '../relief'

const parc = parkPlacements(MUSEE)
const { plaques } = enceinte(parc.terrain, parc.allees)
const tout = lierreDuMur(plaques)

/** Une feuille dans le repère de son mur : (u, v). */
const repere = (p: (typeof plaques)[number], x: number, z: number) => {
  const [dx, dz] = [x - p.origine[0], z - p.origine[1]]
  return { u: dx * p.long[0] + dz * p.long[1], v: dx * p.dehors[0] + dz * p.dehors[1] }
}

describe('lierre', () => {
  it('pousse le même lierre à chaque chargement', () => {
    const encore = lierreDuMur(plaques)
    expect(encore).toHaveLength(tout.length)
    expect(encore[123]).toEqual(tout[123])
  })

  it('couvre chaque pied d’une vraie plaque, dense', () => {
    expect(plaques.length).toBeGreaterThan(30)
    expect(tout.length / plaques.length).toBeGreaterThan(500)
  })

  it('reste dans sa travée, contre le mur, entre le sol et le chaperon', () => {
    for (const p of plaques.slice(0, 20)) {
      const feuilles = lierreDuMur([p])
      for (const f of feuilles) {
        const { u, v } = repere(p, f.position[0], f.position[2])
        expect(u).toBeGreaterThan(p.a - 0.45)
        expect(u).toBeLessThan(p.b + 0.45)
        expect(v).toBeGreaterThan(-0.3)
        expect(v).toBeLessThan(p.epaisseur + CHAPERON_MUR.debord + 0.2)
        expect(f.position[1]).toBeGreaterThan(hauteurDuParc(f.position[0], f.position[2]) - 0.1)
        expect(f.position[1]).toBeLessThan(p.arase + CHAPERON_MUR.h + 0.1)
      }
    }
  })

  it('part du pied en tiges ligneuses, et les plus vigoureuses passent le chaperon pour retomber dehors', () => {
    let passent = 0
    for (const p of plaques) {
      const feuilles = lierreDuMur([p])
      const tiges = feuilles.filter((f) => f.sorte === SORTE.tige)
      expect(tiges.some((t) => t.position[1] - hauteurDuParc(t.position[0], t.position[2]) < 0.3)).toBe(true)
      const dehors = feuilles.filter((f) => repere(p, f.position[0], f.position[2]).v > p.epaisseur && f.position[1] < p.arase)
      const dessus = feuilles.filter((f) => f.position[1] > p.arase && f.normale[1] > 0.5)
      if (dehors.length > 20 && dessus.length > 5) passent++
    }
    expect(passent).toBeGreaterThan(plaques.length * 0.3)
    expect(passent).toBeLessThan(plaques.length)
  })
})
