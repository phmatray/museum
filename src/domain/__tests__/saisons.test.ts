import { describe, expect, it } from 'vitest'

import { jourDeLAnnee, saisonA, saisonDuJour } from '../saisons'

const le = (iso: string) => saisonA(new Date(`${iso}T12:00:00`))

describe('saisonDuJour', () => {
  it('garde l’été vert et plein', () => {
    const s = le('2026-07-10')
    expect(s.feuillage).toBe(0)
    expect(s.chute).toBe(0)
    expect(s.floraison).toBe(0)
  })
  it('rougit les érables fin octobre, sans encore les dénuder', () => {
    const s = le('2026-10-25')
    expect(s.feuillage).toBeGreaterThan(0.95)
    expect(s.chute).toBeLessThan(0.2)
    expect(s.feuillesAuSol).toBeGreaterThan(0.5)
  })
  it('laisse les branches nues en hiver, la pelouse terne, les feuilles ratissées', () => {
    const s = le('2027-01-15')
    expect(s.chute).toBe(1)
    expect(s.pelouse.terne).toBe(1)
    expect(s.feuillesAuSol).toBe(0)
  })
  it('fait fleurir les azalées en mai, sur de jeunes feuilles tendres', () => {
    const s = le('2026-05-15')
    expect(s.floraison).toBe(1)
    expect(s.tendre).toBe(1)
    expect(s.chute).toBe(0)
    expect(s.feuillage).toBe(0)
    expect(le('2026-08-01').floraison).toBe(0)
  })
  it('jaunit la pelouse à la fin de l’été', () => {
    expect(le('2026-08-25').pelouse.jaune).toBe(1)
  })
  it('glisse d’un jour à l’autre, sans saut, même au nouvel an', () => {
    for (let j = 1; j <= 365; j++) {
      const [a, b] = [saisonDuJour(j), saisonDuJour((j % 365) + 1)]
      for (const k of ['feuillage', 'chute', 'floraison', 'tendre', 'feuillesAuSol'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(0.1)
      expect(Math.abs(a.pelouse.terne - b.pelouse.terne)).toBeLessThan(0.1)
    }
  })
})

describe('saisonA', () => {
  it('force la saison par l’adresse', () => {
    const juillet = new Date('2026-07-10T12:00:00')
    expect(saisonA(juillet, '?saison=hiver').chute).toBe(1)
    expect(saisonA(juillet, '?saison=automne').feuillage).toBeGreaterThan(0.95)
    expect(saisonA(juillet, '?saison=printemps').floraison).toBe(1)
    expect(saisonA(juillet, '?saison=ete')).toEqual(saisonDuJour(196))
    expect(saisonA(juillet, '?saison=mousson')).toEqual(saisonA(juillet))
  })
  it('compte les jours depuis le 1er janvier', () => {
    expect(jourDeLAnnee(new Date('2026-01-01T12:00:00'))).toBe(1)
    expect(jourDeLAnnee(new Date('2026-12-31T12:00:00'))).toBe(365)
  })
})
