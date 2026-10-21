import { describe, expect, it } from 'vitest'

import { saisonA } from '../../domain/saisons'
import { bordsDuHouppier, constantesDuHerisson, corpsDeCarpe, corpsDOiseau, flaqueDesLampadaires, nuageDeLucioles, nuitDesLucioles, rameaux, saisonDesLucioles } from '../faune'
import { SOURCES_LAMPADAIRES } from '../../plan/eclairage'

const unitaires = (n: Float32Array) => Array.from({ length: n.length / 3 }, (_, i) => Math.hypot(n[3 * i], n[3 * i + 1], n[3 * i + 2])).every((l) => Math.abs(l - 1) < 1e-5)

describe('la faune', () => {
  it('une carpe d’un mètre : 8 × 10 × 6 sommets de corps lissés, puis 15 de nageoires', () => {
    const c = corpsDeCarpe()
    expect(c.positions.length / 3).toBe(495)
    expect(c.nageoire.indexOf(1)).toBe(480)
    expect(unitaires(c.normals)).toBe(true)
    // Sens retourné : (a, b, c) de three devient (a, c, b).
    expect(Array.from(c.indices.slice(0, 6))).toEqual([0, 2, 1, 3, 5, 4])
    const xs = Array.from({ length: 495 }, (_, i) => c.positions[3 * i])
    expect(Math.min(...xs)).toBeCloseTo(-0.72)
    expect(Math.max(...xs)).toBeCloseTo(0.5)
  })

  it('un passereau : robes linéaires, ailes marquées, bec vers −z', () => {
    const o = corpsDOiseau()
    const n = o.positions.length / 3
    expect(o.couleur.length).toBe(3 * n)
    expect(o.aile.filter((a) => a === 1).length).toBe(6)
    expect(o.aile.filter((a) => a === -1).length).toBe(6)
    expect(unitaires(o.normals)).toBe(true)
    const zs = Array.from({ length: n }, (_, i) => o.positions[3 * i + 2])
    expect(Math.min(...zs)).toBeCloseTo(-0.088, 3)
    // Le bec sombre en linéaire (#2a2622 ≈ 0,02), pas en sRGB (0,16).
    expect(Math.max(...o.couleur)).toBeLessThan(1)
    expect(Math.min(...o.couleur)).toBeLessThan(0.03)
  })

  it('trois cents lucioles, jamais dans le musée, toujours au même endroit', () => {
    const { centres, graines } = nuageDeLucioles()
    expect(centres.length).toBe(900)
    expect(graines.length).toBe(1200)
    for (let i = 0; i < 300; i++) {
      const [x, z] = [centres[3 * i], centres[3 * i + 2]]
      expect(x > -1 && x < 49 && z > -1 && z < 41).toBe(false)
    }
    expect(nuageDeLucioles().centres).toEqual(centres)
    expect(saisonDesLucioles(saisonA(new Date(2026, 6, 10)))).toBeGreaterThan(0.5)
    expect(saisonDesLucioles(saisonA(new Date(2026, 0, 10)))).toBe(0)
    const ete = saisonA(new Date(2026, 6, 10))
    expect(nuitDesLucioles({ ciel: { jour: 0 }, saison: ete, meteo: { pluie: 0, neige: 0 } })).toBe(saisonDesLucioles(ete))
    expect(nuitDesLucioles({ ciel: { jour: 1 }, saison: ete, meteo: { pluie: 0, neige: 0 } })).toBe(0)
    expect(nuitDesLucioles({ ciel: { jour: 0 }, saison: ete, meteo: { pluie: 1, neige: 0 } })).toBe(0)
  })

  it('les constantes du hérisson et la flaque des lampadaires', () => {
    const k = constantesDuHerisson([-0.08, 0, 0, 0.08, 0.08, 0, 0, 0.04, 0.05])
    expect(k).toMatchObject({ x0: -0.08, x1: 0.08, h: 0.08, xc: 0 })
    expect(k.neutre).toBeCloseTo(0.16 / (1.7 * Math.PI))
    expect(k.dessous).toBeLessThan(0)
    const [lx, , lz] = SOURCES_LAMPADAIRES[0]
    expect(flaqueDesLampadaires(lx, lz)).toBe(1)
    expect(flaqueDesLampadaires(lx + 100, lz + 100)).toBe(0)
  })

  it('perche les oiseaux au bord du houppier : le dernier feuillage touché d’en haut, plus haut que 1,2 m', () => {
    // Un toit carré de 6 m de demi-côté à 3 m, et une tige basse (0,5 m) au-delà qu'on ignore.
    const positions = Float32Array.of(-4, 3, -4, 4, 3, -4, 4, 3, 4, -4, 3, 4, 4.5, 0.5, -1, 5.5, 0.5, -1, 5, 0.5, 1)
    const bords = bordsDuHouppier({ positions, indices: Uint32Array.of(0, 1, 2, 0, 2, 3, 4, 5, 6) }, 4)
    expect(bords).toHaveLength(4)
    // Plein est : le toit s'arrête à 4 m (les rayons de 0,25 m), la tige basse à 5 m ne compte pas.
    expect(bords[0][0]).toBeCloseTo(4)
    expect(bords[0][1]).toBeCloseTo(3)
    expect(bords.every(([x, , z]) => Math.max(Math.abs(x), Math.abs(z)) <= 4 + 1e-9)).toBe(true)
  })

  it('l’hiver, sur le bout des rameaux : hauts, loin du tronc, espacés de 40 cm', () => {
    const p: number[] = []
    for (let i = 0; i < 50; i++) p.push(1.6 + i * 0.02, 2.5, 0, 0.5, 3, 0, 2, 1, 0, 2, 2.2, 0, 2.1, 2.2, 0)
    const r = rameaux({ positions: Float32Array.from(p), indices: new Uint32Array(0) })
    expect(r.length).toBeGreaterThan(0)
    expect(r.every(([x, y, z]) => y > 2 && Math.hypot(x, z) > 1.5)).toBe(true)
    r.forEach((a, i) => r.slice(i + 1).forEach((b) => expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(0.4 - 1e-6)))
  })
})
