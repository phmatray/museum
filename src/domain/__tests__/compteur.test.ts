import { describe, expect, it, vi } from 'vitest'

import { TIRET, chiffres, compterLaVisite, dureeDuCompteur, faceDuTambour } from '../compteur'

describe('chiffres', () => {
  it('cale le nombre sur six tambours, des tirets en panne', () => {
    expect(chiffres(1234)).toEqual([0, 0, 1, 2, 3, 4])
    expect(chiffres(1234567)).toEqual([2, 3, 4, 5, 6, 7])
    expect(chiffres(null)).toEqual(Array(6).fill(TIRET))
  })
})

describe('faceDuTambour', () => {
  it('tourne toujours dans le même sens, et s’arrête sur sa cible', () => {
    expect(faceDuTambour(7, 2, 0)).toBe(7)
    // De 7 à 2 par 8, 9, le tiret, 0 et 1 : jamais en arrière.
    let avant = 7
    for (let t = 0; t < 0.7; t += 0.01) {
      const f = faceDuTambour(7, 2, t)
      expect((f - avant + 11) % 11).toBeLessThan(1)
      avant = f
    }
    expect(faceDuTambour(7, 2, 10)).toBe(2)
    expect(faceDuTambour(3, 3, 0)).toBe(3)
  })

  it('passe par le tiret entre 9 et 0', () => {
    expect(faceDuTambour(TIRET, 4, 10)).toBe(4)
    expect(dureeDuCompteur([TIRET, 1], [0, 1])).toBeCloseTo(0.12)
    expect(dureeDuCompteur([0, 9], [0, 0])).toBeCloseTo(2 * 0.12)
    expect(dureeDuCompteur([0, 0], [0, 9])).toBeCloseTo(9 * 0.12)
  })
})

describe('compterLaVisite', () => {
  const session = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }
  const reponse = (corps: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(corps) } as Response)

  it('compte une seule fois par session', async () => {
    const s = session()
    const recuperer = vi.fn(() => reponse({ value: 42 }))
    expect(await compterLaVisite(s, recuperer)).toBe(42)
    expect(await compterLaVisite(s, recuperer)).toBe(42)
    expect(recuperer).toHaveBeenCalledTimes(1)
  })

  it('rend null sans bloquer quand le service tombe', async () => {
    expect(await compterLaVisite(session(), () => Promise.reject(new Error('hors ligne')))).toBeNull()
    expect(await compterLaVisite(session(), () => reponse({}, false))).toBeNull()
    expect(await compterLaVisite(session(), () => reponse({ error: 'x' }))).toBeNull()
  })
})
