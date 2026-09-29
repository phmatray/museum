import { describe, expect, it } from 'vitest'

import { CLAIR, meteoDemandee, meteoDuReleve, urlOpenMeteo } from '../meteo'

describe('meteoDuReleve', () => {
  it('traduit un ciel dégagé en beau temps, sans pluie ni brume', () => {
    expect(meteoDuReleve({ weather_code: 0, cloud_cover: 0, visibility: 30000, wind_speed_10m: 3 })).toEqual({ ...CLAIR, vent: 3 })
  })
  it('fait pleuvoir sous une pluie modérée, et plus fort quand le pluviomètre le dit', () => {
    const m = meteoDuReleve({ weather_code: 63 })
    expect(m.pluie).toBeCloseTo(0.6)
    expect(m.nuages).toBe(1)
    expect(m.neige).toBe(0)
    expect(meteoDuReleve({ weather_code: 61, rain: 6 }).pluie).toBe(1)
  })
  it('ne fait pas pleuvoir sur un code sec, même si le cumul horaire traîne', () => {
    expect(meteoDuReleve({ weather_code: 2, rain: 0.4 }).pluie).toBe(0)
  })
  it('fait neiger, gronder l’orage et tomber le brouillard selon le code', () => {
    expect(meteoDuReleve({ weather_code: 75 }).neige).toBeCloseTo(0.9)
    expect(meteoDuReleve({ weather_code: 95 }).orage).toBe(true)
    expect(meteoDuReleve({ weather_code: 45 }).brouillard).toBeGreaterThan(0.7)
  })
  it('lit la visibilité en échelle logarithmique : 10 km rien, 200 m tout', () => {
    expect(meteoDuReleve({ weather_code: 3, visibility: 10000 }).brouillard).toBe(0)
    expect(meteoDuReleve({ weather_code: 3, visibility: 200 }).brouillard).toBeCloseTo(1)
    const km = meteoDuReleve({ weather_code: 3, visibility: 1000 }).brouillard
    expect(km).toBeGreaterThan(0.5)
    expect(km).toBeLessThan(0.7)
  })
  it('garde la bruine plus légère que l’averse', () => {
    expect(meteoDuReleve({ weather_code: 51 }).pluie).toBeLessThan(meteoDuReleve({ weather_code: 82 }).pluie)
  })
})

describe('meteoDemandee', () => {
  it('force le temps par l’adresse, et rien sinon', () => {
    expect(meteoDemandee('?meteo=pluie')?.pluie).toBeGreaterThan(0.5)
    expect(meteoDemandee('?heure=14:00&meteo=neige')?.neige).toBeGreaterThan(0.5)
    expect(meteoDemandee('?meteo=orage')?.orage).toBe(true)
    expect(meteoDemandee('?meteo=clair')).toEqual(CLAIR)
    expect(meteoDemandee('?meteo=grele')).toBeNull()
    expect(meteoDemandee('')).toBeNull()
  })
})

it('demande le vent en m/s au lieu du musée', () => {
  expect(urlOpenMeteo(50.85, 4.35)).toMatch(/latitude=50\.85&longitude=4\.35&current=weather_code.*wind_speed_unit=ms/)
})
