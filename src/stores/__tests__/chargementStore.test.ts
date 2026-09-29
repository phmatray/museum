import { describe, expect, it } from 'vitest'

import { avancer, marquerPret, suivre, useChargement } from '../chargementStore'

describe('chargementStore', () => {
  it('compte une promesse suivie, rejet compris', async () => {
    const avant = useChargement.getState()
    const p = suivre(Promise.reject(new Error('404')))
    expect(useChargement.getState().total).toBe(avant.total + 1)
    await expect(p).rejects.toThrow('404')
    expect(useChargement.getState().faits).toBe(avant.faits + 1)
  })

  it('la barre ne recule jamais quand le total grossit, et ne touche 100 % qu’une fois prêt', () => {
    let a = 0
    for (let i = 0; i < 200; i++) a = avancer(a, 9, 10, 'chargement', 1 / 60)
    expect(a).toBeCloseTo(0.81, 2)
    expect(avancer(a, 9, 30, 'chargement', 1 / 60)).toBe(a)
    for (let i = 0; i < 200; i++) a = avancer(a, 30, 30, 'finition', 1 / 60)
    expect(a).toBeLessThan(0.98)
    expect(avancer(a, 30, 30, 'pret', 0, false)).toBe(1)
  })

  it('les premières arrivées ne remplissent pas la barre quand on attend davantage', () => {
    expect(avancer(0, 5, 5, 'chargement', 1, false, 120)).toBeCloseTo(0.0375)
  })

  it('prêt pose window.__PRET__', () => {
    marquerPret()
    expect(useChargement.getState().etape).toBe('pret')
    expect((window as { __PRET__?: boolean }).__PRET__).toBe(true)
  })
})
