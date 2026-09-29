/**
 * Les allées dessinées : des courbes et des congés, jamais un angle droit
 * (« ce type de chemin en angle droit fait trop jeu vidéo », Philippe), une
 * bordure tout du long, et le décor posé hors de l'eau et des allées.
 */
import { describe, expect, it } from 'vitest'

import { amenagerAllees, champDesAllees, unionArrondie } from '../allees.ts'
import { distanceEtang, distanceRuisseau } from '../jardin.ts'
import { MUSEE } from '../musee.ts'
import { distanceRect, parkPlacements } from '../park.ts'

const parc = parkPlacements(MUSEE)
const champ = champDesAllees(parc)
const a = amenagerAllees(parc)
const eau = (x: number, z: number) => Math.min(distanceEtang(x, z), distanceRuisseau(x, z))

describe('allées', () => {
  it('raccorde deux bords perpendiculaires d’un arc du rayon demandé', () => {
    // Loin du coin, l'union est le minimum ; au coin, on est dans le congé.
    expect(unionArrondie(0, 5, 2)).toBeCloseTo(0)
    expect(unionArrondie(0.3, 0.3, 2)).toBeLessThan(0)
    expect(unionArrondie(2 - Math.SQRT1_2 * 2, 2 - Math.SQRT1_2 * 2, 2)).toBeCloseTo(0)
  })

  it('arrondit la jonction de l’accès ouest : le coin de gazon est pris dans le congé', () => {
    const [cx, cz] = [parc.parvis.x - 6 - 1.5, parc.parvis.z + parc.parvis.depth / 2]
    // Le coin géométrique entre le bord extérieur de la ceinture et le bord nord de l'accès, un peu dans le gazon.
    expect(champ.reseau(cx - 0.25, cz - 1.2 - 0.25)).toBeLessThan(0)
    // Loin de la jonction, le gazon reste du gazon.
    expect(champ.reseau(cx - 3, cz - 6)).toBeGreaterThan(0)
  })

  it('ne trace aucun angle vif : la bordure tourne de moins de 35° par mètre (un congé de 1,6 m au moins), hors des coins du parvis', () => {
    for (const ligne of a.bordures) {
      const long = [0]
      for (let i = 1; i < ligne.length; i++) long.push(long[i - 1] + Math.hypot(ligne[i].x - ligne[i - 1].x, ligne[i].z - ligne[i - 1].z))
      for (let i = 0; i < ligne.length; i++) {
        const p = ligne[i]
        if (distanceRect(parc.parvis, p.x, p.z) < 0.5) continue
        const k = long.findIndex((l) => l > long[i] - 1)
        const j = long.findIndex((l) => l >= long[i] + 1)
        if (k >= i || j < 0) continue
        const [u, v] = [[p.x - ligne[k].x, p.z - ligne[k].z], [ligne[j].x - p.x, ligne[j].z - p.z]]
        const cos = (u[0] * v[0] + u[1] * v[1]) / Math.hypot(...u) / Math.hypot(...v)
        expect(Math.acos(Math.min(1, cos)) * (180 / Math.PI), `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeLessThan(35)
      }
    }
  })

  it('borde tout le réseau, et pave l’axe de l’entrée', () => {
    const longueur = a.bordures.reduce((s, l) => s + l.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - l[i].x, p.z - l[i].z), 0), 0)
    // Les deux bords de la ceinture et des accès, plus le tour du parvis : bien plus de 500 m.
    expect(longueur).toBeGreaterThan(500)
    expect(a.dalles.index.length).toBeGreaterThan(0)
    expect(champ.dalles(24, 60)).toBeLessThan(0)
    expect(champ.dalles(24, -20)).toBeGreaterThan(0)
  })

  it('pose dalles de pierre et piquets près de l’eau, le décor hors de l’eau et des allées', () => {
    expect(a.pierres.length).toBeGreaterThan(50)
    for (const p of a.pierres) {
      expect(eau(p.x, p.z)).toBeLessThan(9)
      expect(champ.reseau(p.x, p.z)).toBeLessThan(0)
    }
    expect(a.poteaux.length).toBeGreaterThan(3)
    for (const p of [...a.poteaux, ...a.touffes, ...a.couvreSol]) {
      expect(eau(p.x, p.z), `${p.x}, ${p.z}`).toBeGreaterThan(1)
      expect(champ.reseau(p.x, p.z), `${p.x}, ${p.z}`).toBeGreaterThan(0.2)
    }
  })

  it('ne laisse aucun jour de gazon entre le gravier et les dalles, là où l’axe traverse la ceinture', () => {
    const couvre = (s: { xz: number[]; index: number[] }, x: number, z: number) => {
      for (let i = 0; i < s.index.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => [s.xz[2 * s.index[i + k]], s.xz[2 * s.index[i + k] + 1]])
        const d = (p: number[], q: number[]) => (q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0])
        const [u, v, w] = [d(a, b), d(b, c), d(c, a)]
        if ((u >= -1e-9 && v >= -1e-9 && w >= -1e-9) || (u <= 1e-9 && v <= 1e-9 && w <= 1e-9)) return true
      }
      return false
    }
    // Tout ce que borde la bordure (à 4 cm près, sa face intérieure) est pavé ou gravillonné.
    for (let x = 18; x <= 30; x += 0.1)
      for (let z = 46; z <= 56; z += 0.1)
        if (champ.reseau(x, z) < -0.04) expect(couvre(a.gravier, x, z) || couvre(a.dalles, x, z), `${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(true)
  })

  it('tourne d’équerre aux coins du parvis, et suit le bord pas à pas, à 20 cm (40 au plus, près d’un angle)', () => {
    const { x, z } = parc.parvis
    const pres = a.bordures.flat().filter((p) => Math.hypot(p.x - x, p.z - z) < 0.01)
    expect(pres.length).toBeGreaterThan(0)
    // La normale en onglet : √2 le long de la bissectrice.
    expect(Math.hypot(pres[0].nx, pres[0].nz)).toBeCloseTo(Math.SQRT2, 2)
    for (const l of a.bordures)
      for (let i = 1; i < l.length; i++) {
        expect(Math.hypot(l[i].x - l[i - 1].x, l[i].z - l[i - 1].z)).toBeLessThan(0.4)
        expect(Math.abs(champ.reseau(l[i].x, l[i].z))).toBeLessThan(0.005)
      }
  })

  it('est déterministe', () => {
    expect(amenagerAllees(parc)).toEqual(a)
  })
})
