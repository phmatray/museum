/**
 * Le plan du musée respecte les règles, et chaque règle attrape vraiment son défaut.
 *
 * Les cas négatifs ne sont pas décoratifs : une règle qui ne peut pas échouer ne
 * prouve rien. Chacun reprend un défaut qu'a eu l'ancien bâtiment.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { guardrails, type Segment } from '../geometry.ts'
import { capacity, checkPlan } from '../rules.ts'
import type { Plan } from '../types.ts'

const catalogue = JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/catalogue.json'), 'utf8'))
const COLLECTION: number = catalogue.artworks.length

const variante = (modifier: (p: Plan) => void): Plan => {
  const p = structuredClone(MUSEE)
  modifier(p)
  return p
}

describe('le plan du musée', () => {
  it('ne viole aucune règle', () => {
    expect(checkPlan(MUSEE, COLLECTION)).toEqual([])
  })

  it('peut accrocher la collection avec 20 % de marge', () => {
    const total = MUSEE.levels.flatMap((l) => l.rooms.map((r) => (r.kind === 'hall' || r.kind === 'balcony' ? 0 : capacity(r, l))))
    expect(total.reduce((a, b) => a + b)).toBeGreaterThanOrEqual(Math.ceil(COLLECTION * 1.2))
  })
})

describe('les règles attrapent leur défaut', () => {
  it("sans volée centrale, l'étage est inaccessible", () => {
    const p = variante((p) => { p.flights = p.flights.filter((f) => f.id !== 'volee-centrale') })
    expect(checkPlan(p, COLLECTION)).toContain("Salle d'honneur (Étage noble) est inaccessible")
  })

  it('sans obstacle sous le palier, on s\'y cogne la tête', () => {
    const p = variante((p) => { p.levels[0].obstacles.shift() })
    expect(checkPlan(p, COLLECTION).some((v) => v.startsWith('hauteur libre de 2.10 m sur Hall'))).toBe(true)
  })

  it('une porte de 1,20 m est trop étroite', () => {
    const p = variante((p) => { p.levels[0].openings[1].width = 1.2 })
    expect(checkPlan(p, COLLECTION)).toContain('ouverture hall/r-o2 (Rez-de-chaussée) : 1.2 m de passage, il en faut 1.8')
  })

  it('une volée trop raide sort de Blondel', () => {
    const p = variante((p) => { p.flights[0].risers = 12 })
    expect(checkPlan(p, COLLECTION).some((v) => v.startsWith('volée volee-centrale : contremarche'))).toBe(true)
  })

  it('une porte posée hors du mur commun est refusée', () => {
    const p = variante((p) => { p.levels[0].openings[5].x = 20 })
    expect(checkPlan(p, COLLECTION)).toContain('ouverture r-o1/r-o2 (Rez-de-chaussée) : pas posée sur une arête commune')
  })
})

describe('les garde-corps', () => {
  const rdc = guardrails(MUSEE, 0)
  const etage = guardrails(MUSEE, 1)
  const sur = (segs: Segment[], s: Segment) => segs.some((g) => g.x1 === s.x1 && g.z1 === s.z1 && g.x2 === s.x2 && g.z2 === s.z2)

  it("bordent le palier entre les volées, et s'ouvrent devant chacune", () => {
    expect(sur(rdc, { x1: 19, z1: 15.5, x2: 21, z2: 15.5 })).toBe(true)
    expect(sur(rdc, { x1: 27, z1: 15.5, x2: 29, z2: 15.5 })).toBe(true)
    expect(rdc.some((g) => g.z1 === 15.5 && g.z2 === 15.5 && g.x1 < 27 && g.x2 > 21)).toBe(false)
  })

  it('longent les deux côtés de la volée centrale', () => {
    expect(sur(rdc, { x1: 21, z1: 15.5, x2: 21, z2: 20 })).toBe(true)
    expect(sur(rdc, { x1: 27, z1: 15.5, x2: 27, z2: 20 })).toBe(true)
  })

  it("ne ferment pas l'arrivée des volées sur les balcons", () => {
    expect(etage.some((g) => g.z1 === 20 && g.z2 === 20)).toBe(false)
    expect(sur(etage, { x1: 19, z1: 20, x2: 19, z2: 37 })).toBe(true)
  })
})
