import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { COTE, PAS, dateDuJour, indexDuJour, moisDeLaMosaique, panneau, tesselles, texteDePlaque, type Contributions } from '../mosaique'
import { bandesDuSol } from '../parement'
import { MUSEE } from '../musee'

const REEL = JSON.parse(readFileSync(join(import.meta.dirname, '../../../public/data/contributions.json'), 'utf8')) as Contributions

describe('mosaïque des contributions', () => {
  const t = tesselles(REEL.weeks)
  const p = panneau(REEL.weeks.length)

  it('pose une tesselle par jour, sans qu’aucune ne se chevauche', () => {
    expect(t).toHaveLength(REEL.weeks.flat().length)
    expect(new Set(t.map((j) => `${j.x.toFixed(3)},${j.z.toFixed(3)}`)).size).toBe(t.length)
    expect(COTE).toBeLessThan(PAS)
  })

  it('reste dans l’allée centrale, entre le pied de l’escalier et le seuil', () => {
    const pied = Math.max(...MUSEE.flights.filter((f) => f.bottom === 0).map((f) => f.z + f.depth))
    expect(p.x0).toBeGreaterThanOrEqual(21.5)
    expect(p.x1).toBeLessThanOrEqual(26.5)
    expect(p.z0).toBeGreaterThan(pied + 1)
    expect(p.z1).toBeLessThan(37) // le visiteur entre en 37 : il la découvre à ses pieds
    // Et entre les deux filets de granit de l'allée.
    const filets = bandesDuSol(MUSEE).filter((b) => b.d > b.w).map((b) => b.x)
    expect(filets.every((x) => x < p.x0 || x > p.x1)).toBe(true)
    for (const j of t) {
      expect(j.x).toBeGreaterThan(p.x0)
      expect(j.x).toBeLessThan(p.x1)
      expect(j.z).toBeGreaterThan(p.z0)
      expect(j.z).toBeLessThan(p.z1)
    }
  })

  it('va de la plus vieille semaine, au pied, à la plus récente, vers l’escalier ; du dimanche à l’ouest au samedi à l’est', () => {
    const [premier, dernier] = [t[0], t[t.length - 1]]
    expect(premier.date < dernier.date).toBe(true)
    expect(premier.z).toBeGreaterThan(dernier.z)
    const semaine = tesselles([REEL.weeks[1]])
    expect(semaine.map((j) => j.x)).toEqual([...semaine.map((j) => j.x)].sort((a, b) => a - b))
  })

  it('cale une semaine partielle sur ses vrais jours', () => {
    const [mercredi] = tesselles([[{ date: '2026-09-30', count: 1, level: 1 }]])
    const [dimanche] = tesselles([[{ date: '2026-09-27', count: 1, level: 1 }]])
    expect(mercredi.x - dimanche.x).toBeCloseTo(3 * PAS)
  })

  it('écrit l’initiale de chaque mois en face de la semaine de son 1er', () => {
    const mois = moisDeLaMosaique([
      [{ date: '2026-01-25', count: 0, level: 0 }],
      [{ date: '2026-02-01', count: 0, level: 0 }],
      [{ date: '2026-02-08', count: 0, level: 0 }],
      [{ date: '2026-02-28', count: 0, level: 0 }, { date: '2026-03-01', count: 0, level: 0 }],
    ])
    expect(mois.map((m) => m.lettre)).toEqual(['F', 'M'])
    expect(moisDeLaMosaique(REEL.weeks).length).toBeGreaterThanOrEqual(11)
  })

  it('trouve la tesselle du jour, ou la dernière si le calendrier date d’hier', () => {
    expect(indexDuJour(t, t[5].date)).toBe(5)
    expect(indexDuJour(t, '2999-01-01')).toBe(t.length - 1)
    expect(dateDuJour(new Date(2026, 8, 3))).toBe('2026-09-03')
  })

  it('grave le total sur la plaque, en chiffres groupés', () => {
    expect(texteDePlaque(24013)).toBe('24 013 contributions cette année')
    expect(texteDePlaque(1)).toBe('1 contribution cette année')
  })
})
