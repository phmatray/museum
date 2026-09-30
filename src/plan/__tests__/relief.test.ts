/**
 * Le relief du parc : des buttes douces, mais plat là où le monde doit l'être —
 * le parvis, l'axe de l'entrée, le sol creusé du jardin (Blender le pose à 0).
 */
import { describe, expect, it } from 'vitest'
import { dansLeBelvedere } from '../belvedere.ts'

import { BERGE_RUISSEAU, JARDIN, TABLIER, creuxDuRuisseau, distanceRuisseau } from '../jardin.ts'
import { MUSEE } from '../musee.ts'
import { parkPlacements } from '../park.ts'
import { ARRONDI_PARVIS, distanceParvis, hauteurDuParc, solDuParc } from '../relief.ts'

const parc = parkPlacements(MUSEE)
const { terrain, parvis } = parc

/** Tous les points du terrain, au pas donné. */
function* points(pas: number) {
  for (let z = terrain.z; z <= terrain.z + terrain.depth; z += pas)
    for (let x = terrain.x; x <= terrain.x + terrain.width; x += pas) yield [x, z] as const
}

describe('hauteurDuParc', () => {
  it('est déterministe', () => {
    for (const [x, z] of points(7)) expect(hauteurDuParc(x, z)).toBe(hauteurDuParc(x, z))
  })

  it('reste dans des bornes de parc, avec de vraies buttes', () => {
    const h = [...points(1)].map(([x, z]) => hauteurDuParc(x, z))
    // Au plus bas, le fond d’une mouille du ruisseau, un demi-mètre sous la pelouse.
    expect(Math.min(...h)).toBeGreaterThan(-0.55)
    expect(Math.max(...h)).toBeLessThan(4)
    expect(Math.max(...h)).toBeGreaterThan(1.5)
  })

  it('est continu et praticable hors de l’eau : pas de pente au-delà de 40 %', () => {
    const e = 0.05
    const tablier = (x: number, z: number) => x > TABLIER.x - 0.2 && x < TABLIER.x + TABLIER.width + 0.2 && z > TABLIER.z - 0.2 && z < TABLIER.z + TABLIER.depth + 0.2
    for (const [x, z] of points(0.5)) {
      // Le lit du ruisseau et le rebord raide de sa berge ne se marchent pas ; le tablier l'enjambe, de plain-pied.
      // Le belvédère est bâti : ses murs sont des falaises qu'on ne franchit pas, sa volée un escalier.
      if (distanceRuisseau(x, z) < 0.5 || tablier(x, z) || dansLeBelvedere(x, z, 0.1)) continue
      const h = hauteurDuParc(x, z)
      expect(Math.abs(hauteurDuParc(x + e, z) - h) / e).toBeLessThan(0.4)
      expect(Math.abs(hauteurDuParc(x, z + e) - h) / e).toBeLessThan(0.4)
    }
  })

  it('vaut 0 sur le parvis, l’axe de l’entrée et les zones du jardin, bords compris — hors du lit du ruisseau', () => {
    const plats = [parvis, ...JARDIN.zones, { x: 22.8, z: parvis.z + parvis.depth, width: 2.4, depth: 35 }]
    for (const r of plats)
      for (let z = r.z; z <= r.z + r.depth; z += 0.5)
        for (let x = r.x; x <= r.x + r.width; x += 0.5) {
          if (distanceRuisseau(x, z) < BERGE_RUISSEAU) continue
          expect(hauteurDuParc(x, z), `(${x}, ${z})`).toBe(0)
        }
  })

  it('creuse le lit du ruisseau : la berge plonge d’une vingtaine de centimètres, le fond plus bas, le tablier reste de plain-pied', () => {
    const [x, z] = [JARDIN.ruisseau.trace[9][0], JARDIN.ruisseau.trace[9][1]]
    expect(hauteurDuParc(x, z)).toBeLessThan(JARDIN.ruisseau.niveau - 0.05)
    expect(creuxDuRuisseau(x, z)).toBeGreaterThan(-0.55)
    expect(hauteurDuParc(JARDIN.pont.x, JARDIN.pont.z)).toBe(0)
    // Continu au fil de l'eau : la berge rejoint le lit sans marche.
    for (let d = -0.3; d < BERGE_RUISSEAU + 0.3; d += 0.02) {
      const [a, b] = [creuxDuRuisseau(x + d, z), creuxDuRuisseau(x + d + 0.02, z)]
      expect(Math.abs(a - b)).toBeLessThan(0.02)
    }
  })
})

describe('distanceParvis', () => {
  const r = { x: 0, z: 0, width: 20, depth: 10 }
  const e = ARRONDI_PARVIS
  it('suit les côtés droits et arrondit les angles', () => {
    expect(distanceParvis(r, 10, -1)).toBeCloseTo(1)
    expect(distanceParvis(r, 10, 5)).toBeCloseTo(-5)
    // Le coin vif reste dehors : l'arc passe à e·(√2 − 1) de lui.
    expect(distanceParvis(r, 0, 0)).toBeCloseTo(e * (Math.SQRT2 - 1))
    expect(distanceParvis(r, 20 - e * (1 - Math.SQRT1_2), 10 - e * (1 - Math.SQRT1_2))).toBeCloseTo(0)
  })
  it('ne pose pas un meuble sur le dallage ôté à l’angle', () => {
    expect(solDuParc(-4.9, -4.9)).toBe(hauteurDuParc(-4.9, -4.9))
    expect(solDuParc(24, 44)).toBe(0.04)
  })
})
