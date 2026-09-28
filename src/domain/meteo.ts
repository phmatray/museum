/**
 * Le temps qu'il fait au-dessus du musée : le relevé d'Open-Meteo (codes WMO
 * et mesures) traduit en quelques intensités que la scène sait peindre.
 *
 * Pur : un relevé entre, un état sort. Le code WMO donne le caractère (bruine,
 * averse, neige, orage), les mesures l'affinent quand elles sont là.
 */

export interface Meteo {
  /** Intensité de la pluie, 0 (sec) à 1 (déluge). */
  pluie: number
  /** Intensité de la neige qui tombe, 0 à 1. */
  neige: number
  /** Épaisseur du brouillard, 0 (on voit loin) à 1 (on ne voit pas le jardin). */
  brouillard: number
  /** Couverture nuageuse, 0 (ciel bleu) à 1 (couvert). */
  nuages: number
  orage: boolean
  /** Vent à 10 m, en m/s. */
  vent: number
}

export const CLAIR: Meteo = { pluie: 0, neige: 0, brouillard: 0, nuages: 0, orage: false, vent: 2 }

/** Le bloc `current` d'Open-Meteo, vent demandé en m/s (`wind_speed_unit=ms`). */
export interface Releve {
  weather_code: number
  /** mm/h */
  rain?: number
  /** cm/h */
  snowfall?: number
  /** % */
  cloud_cover?: number
  /** m/s */
  wind_speed_10m?: number
  /** m */
  visibility?: number
}

type Base = Omit<Meteo, 'vent'>
const b = (nuages: number, pluie = 0, neige = 0, brouillard = 0, orage = false): Base => ({ nuages, pluie, neige, brouillard, orage })

/** Le caractère de chaque code WMO (table 4677, sous-ensemble servi par Open-Meteo). */
function base(code: number): Base {
  if (code <= 0) return b(0)
  if (code === 1) return b(0.2)
  if (code === 2) return b(0.5)
  if (code === 3) return b(1)
  if (code === 45) return b(1, 0, 0, 0.8)
  if (code === 48) return b(1, 0, 0, 0.9)
  if (code >= 51 && code <= 57) return b(0.9, [0.15, 0.25, 0.35][Math.min(2, Math.floor((code - 51) / 2))] ?? 0.2, 0, 0.15)
  if (code >= 61 && code <= 67) return b(1, { 61: 0.35, 63: 0.6, 65: 0.9, 66: 0.4, 67: 0.8 }[code] ?? 0.5, 0, 0.2)
  if (code >= 71 && code <= 77) return b(1, 0, { 71: 0.3, 73: 0.6, 75: 0.9, 77: 0.2 }[code] ?? 0.5, 0.25)
  if (code >= 80 && code <= 82) return b(0.9, [0.4, 0.7, 1][code - 80], 0, 0.15)
  if (code === 85 || code === 86) return b(1, 0, code === 85 ? 0.5 : 0.9, 0.3)
  if (code >= 95) return b(1, code === 95 ? 0.8 : 0.9, 0, 0.2, true)
  return b(0.5)
}

const borne = (x: number) => Math.min(1, Math.max(0, x))

export function meteoDuReleve(r: Releve): Meteo {
  const m = base(r.weather_code)
  return {
    ...m,
    // Les mesures ne font que renforcer le caractère du code : il pleut quand le code le dit.
    pluie: m.pluie > 0 ? Math.max(m.pluie, borne((r.rain ?? 0) / 6)) : 0,
    neige: m.neige > 0 ? Math.max(m.neige, borne((r.snowfall ?? 0) / 2)) : 0,
    nuages: r.cloud_cover === undefined ? m.nuages : Math.max(m.nuages * 0.8, borne(r.cloud_cover / 100)),
    // 10 km et plus : rien ; 200 m : purée de pois. Échelle logarithmique, comme l'œil.
    brouillard: r.visibility === undefined ? m.brouillard : Math.max(m.brouillard * 0.5, borne(Math.log10(10000 / Math.max(1, r.visibility)) / Math.log10(50))),
    vent: r.wind_speed_10m ?? CLAIR.vent,
  }
}

/** Le temps forcé par l'adresse (`?meteo=pluie`), pour les démonstrations et les captures. */
const FORCES: Record<string, Releve> = {
  clair: { weather_code: 0, wind_speed_10m: 2 },
  pluie: { weather_code: 63, wind_speed_10m: 6 },
  neige: { weather_code: 73, wind_speed_10m: 3 },
  brouillard: { weather_code: 45, wind_speed_10m: 1, visibility: 150 },
  orage: { weather_code: 95, wind_speed_10m: 12 },
}

export function meteoDemandee(recherche: string): Meteo | null {
  const r = FORCES[new URLSearchParams(recherche).get('meteo') ?? '']
  return r === undefined ? null : meteoDuReleve(r)
}

/** L'adresse du relevé courant d'Open-Meteo, sans clé, lisible depuis le navigateur. */
export function urlOpenMeteo(latitude: number, longitude: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    '&current=weather_code,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,visibility,temperature_2m&wind_speed_unit=ms'
}
