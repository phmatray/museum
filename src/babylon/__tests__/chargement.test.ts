import { describe, expect, it } from 'vitest'

import { avancer, chargement, marquerPret, pret, suivre } from '../chargement'

describe('chargement (Babylon)', () => {
  it('compte une promesse suivie, rejet compris', async () => {
    const p = suivre(Promise.reject(new Error('404')))
    expect(chargement.getState()).toMatchObject({ faits: 0, total: 1 })
    await expect(p).rejects.toThrow('404')
    expect(chargement.getState().faits).toBe(1)
  })

  it('la barre de domain/chargement : 90 % des faits, jamais en arrière', () => {
    expect(avancer(0, 9, 10, 'chargement', 1, false)).toBeCloseTo(0.81)
    expect(avancer(0.5, 1, 10, 'chargement', 1)).toBe(0.5)
  })

  it('prêt une fois, window.__PRET__ posé', () => {
    expect(pret()).toBe(false)
    marquerPret()
    marquerPret()
    expect(pret()).toBe(true)
    expect((window as { __PRET__?: boolean }).__PRET__).toBe(true)
  })
})
