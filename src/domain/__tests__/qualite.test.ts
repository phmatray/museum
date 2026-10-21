import { describe, expect, it } from 'vitest'

import { QUALITE_INITIALE, ajusterQualite, paliersPour, qualiteDemandee, type EtatQualite } from '../qualite'

describe('qualité adaptative', () => {
  it('lit ?qualite=haute|basse et ignore le reste', () => {
    expect(qualiteDemandee('?qualite=haute')).toBe('haute')
    expect(qualiteDemandee('?heure=14:00&qualite=basse')).toBe('basse')
    expect(qualiteDemandee('?qualite=ultra')).toBeNull()
    expect(qualiteDemandee('')).toBeNull()
  })

  it('garde la densité de l’écran en pleine qualité, plafonnée à 2', () => {
    expect(paliersPour(2)).toEqual([2, 1.5, 1.25, 1, 0.75])
    expect(paliersPour(3)).toEqual([2, 1.5, 1.25, 1, 0.75])
    expect(paliersPour(1)).toEqual([1, 0.75])
    expect(paliersPour(1.25)).toEqual([1.25, 1, 0.75])
  })

  it('descend d’un palier par verdict, jamais sous le dernier', () => {
    let e = QUALITE_INITIALE
    for (let i = 0; i < 10; i++) e = ajusterQualite(e, 'baisse', 5)
    expect(e.palier).toBe(4)
  })

  it('remonte jusqu’à la pleine qualité quand la machine suit', () => {
    let e: EtatQualite = ajusterQualite(ajusterQualite(QUALITE_INITIALE, 'baisse', 5), 'baisse', 5)
    for (let i = 0; i < 10; i++) e = ajusterQualite(e, 'hausse', 5)
    expect(e.palier).toBe(0)
  })

  it('n’oscille pas : chaque remontée démentie double l’attente, sans jamais l’interdire', () => {
    let e = ajusterQualite(QUALITE_INITIALE, 'baisse', 5)
    const attentes: number[] = []
    for (let cycle = 0; cycle < 8; cycle++) {
      let n = 0
      while (e.palier > 0) {
        e = ajusterQualite(e, 'hausse', 5)
        n++
      }
      attentes.push(n)
      e = ajusterQualite(e, 'baisse', 5)
    }
    expect(attentes).toEqual([1, 2, 4, 8, 16, 16, 16, 16])
  })
})
