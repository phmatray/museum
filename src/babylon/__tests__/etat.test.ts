import { afterEach, describe, expect, it, vi } from 'vitest'

/** etat.ts relu à neuf avec une adresse et des réglages donnés (le store se calcule à l'import). */
async function etatAvec(search: string, reglages: object | null = null) {
  vi.resetModules()
  vi.stubGlobal('location', { search })
  vi.stubGlobal('localStorage', { getItem: () => (reglages ? JSON.stringify(reglages) : null) })
  return import('../etat')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('état vivant', () => {
  it('?heure=22:00 donne la nuit', async () => {
    const { cielDuMoment, vivant } = await etatAvec('?heure=22:00')
    expect(cielDuMoment().jour).toBe(0)
    expect(vivant.getState().ciel.jour).toBe(0)
  })

  it('?meteo=pluie fait pleuvoir', async () => {
    const { vivant } = await etatAvec('?meteo=pluie')
    expect(vivant.getState().meteo.pluie).toBeGreaterThan(0)
  })

  it("l'adresse l'emporte sur les réglages, qui comblent ce qu'elle tait", async () => {
    const { recherche, vivant } = await etatAvec('?meteo=clair', { meteo: 'neige', saison: 'hiver' })
    expect(vivant.getState().meteo.neige).toBe(0)
    expect(new URLSearchParams(recherche()).get('saison')).toBe('hiver')
    expect(vivant.getState().saison.pelouse.terne).toBeGreaterThan(0.5)
  })

  it("l'heure forcée reste fixe : le cycle ne republie pas le même ciel", async () => {
    vi.useFakeTimers()
    const { demarrerCycle, vivant } = await etatAvec('?heure=13:00&meteo=clair')
    const avant = vivant.getState().ciel
    const arreter = demarrerCycle()
    vi.advanceTimersByTime(30_000)
    expect(vivant.getState().ciel).toBe(avant)
    arreter()
  })

  it('auCiel : tout de suite, puis à chaque nouveau ciel', async () => {
    const { auCiel, cielDuMoment, vivant } = await etatAvec('?heure=13:00')
    const vus: number[] = []
    const fin = auCiel((c) => vus.push(c.jour))
    vivant.setState({ meteo: vivant.getState().meteo })
    vivant.setState({ ciel: { ...cielDuMoment(), jour: 0.5 } })
    fin()
    expect(vus).toEqual([1, 0.5])
  })
})
