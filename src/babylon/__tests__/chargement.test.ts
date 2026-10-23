import { describe, expect, it } from 'vitest'

import { avancer, chargement, detailDuChargement, marquerPret, pret, suivre } from '../chargement'

describe('chargement (Babylon)', () => {
  it('compte une promesse suivie, rejet compris', async () => {
    const p = suivre(Promise.reject(new Error('404')))
    expect(chargement.getState()).toMatchObject({ faits: 0, total: 1 })
    await expect(p).rejects.toThrow('404')
    expect(chargement.getState().faits).toBe(1)
  })

  it('nomme ce qu’on attend, jusqu’à son arrivée (même en échec)', async () => {
    let finir = () => {}
    const p = suivre(new Promise<void>((ok) => (finir = ok)), 'jardin')
    const q = suivre(Promise.reject(new Error('404')), 'cinéma')
    expect(chargement.getState().attendus).toEqual(['jardin', 'cinéma'])
    await expect(q).rejects.toThrow('404')
    expect(chargement.getState().attendus).toEqual(['jardin'])
    finir()
    await p
    expect(chargement.getState().attendus).toEqual([])
  })

  it('le détail sous la barre : mégaoctets (sur le dernier poids connu), shaders, puis les reflets', () => {
    const s = { faits: 0, total: 0, etape: 'chargement' as const, attendus: [], octets: 0, shaders: 0, sondes: [0, 0] as [number, number] }
    expect(detailDuChargement(s)).toEqual({ chiffres: '…', attente: '' })
    expect(detailDuChargement({ ...s, octets: 2.34e6, shaders: 1 }).chiffres).toBe('2,3 Mo · 1 shader compilé')
    expect(detailDuChargement({ ...s, octets: 23e6 }, 62e6).chiffres).toBe('23 / 62 Mo')
    // Plus lourd que la dernière fois (un modèle ajouté) : pas de « 70 / 62 ».
    expect(detailDuChargement({ ...s, octets: 70e6 }, 62e6).chiffres).toBe('70 Mo')
    expect(detailDuChargement({ ...s, etape: 'finition', octets: 62e6, sondes: [3, 12] }).chiffres).toBe('reflets des salles 3 / 12')
  })

  it('le détail : trois noms au plus, le reste compté', () => {
    const s = { faits: 0, total: 0, etape: 'chargement' as const, octets: 0, shaders: 0, sondes: [0, 0] as [number, number] }
    expect(detailDuChargement({ ...s, attendus: ['jardin', 'cinéma', 'visiteurs', 'faune'] }).attente).toBe('Encore : jardin, cinéma, visiteurs et 1 autre')
    expect(detailDuChargement({ ...s, attendus: ['a', 'b', 'c', 'd', 'e'] }).attente).toBe('Encore : a, b, c et 2 autres')
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
