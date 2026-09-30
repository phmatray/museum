/**
 * Le lit du ruisseau : des galets dans l'eau et à son bord, jamais en l'air ;
 * des souches qu'on contourne ; l'écume là où le courant bute.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { INDICE_LEVRE, JARDIN, distanceEtang, distanceRuisseau, rubanDuRuisseau } from '../jardin.ts'
import { GALETS, GALETS_DU_RUISSEAU, REMOUS_MAX, SOUCHES, remous, versLeRuban } from '../ruisseau.ts'
import { parkPlacements } from '../park.ts'
import { hauteurDuParc } from '../relief.ts'
import { step, type Walker } from '../walk.ts'

describe('les galets de rivière', () => {
  it('sont au fond du lit, à son bord ou au bord de l’étang', () => {
    for (const g of GALETS_DU_RUISSEAU) {
      // Jamais sur la pelouse : au plus 8 cm au-delà du fil de l'eau, dans la terre nue du rebord.
      const pres = g.etang ? Math.abs(distanceEtang(g.x, g.z)) < 0.08 : distanceRuisseau(g.x, g.z) < 0.1
      expect(pres, `(${g.x.toFixed(2)}, ${g.z.toFixed(2)})`).toBe(true)
    }
  })

  it('ne flottent jamais : le pied est dans le sol', () => {
    for (const g of GALETS_DU_RUISSEAU) {
      const h = GALETS[g.modele].hauteur * g.echelle
      expect(g.y, `(${g.x.toFixed(2)}, ${g.z.toFixed(2)})`).toBeLessThanOrEqual(hauteurDuParc(g.x, g.z) - 0.1 * h + 1e-9)
    }
  })

  it('mêlent les sept modèles, de 5 à 50 cm, et quelques-uns crèvent la surface', () => {
    expect(new Set(GALETS_DU_RUISSEAU.map((g) => g.modele)).size).toBe(GALETS.length)
    for (const g of GALETS_DU_RUISSEAU) expect(g.echelle * 0.2).toBeGreaterThan(0.025)
    for (const g of GALETS_DU_RUISSEAU) expect(g.echelle * 0.2).toBeLessThan(0.5)
    const emergent = GALETS_DU_RUISSEAU.filter((g) => g.emerge)
    expect(emergent.length).toBeGreaterThan(5)
    for (const g of emergent) expect(g.y + GALETS[g.modele].hauteur * g.echelle).toBeGreaterThan(JARDIN.ruisseau.niveau)
  })
})

describe('les souches', () => {
  it('ont les racines dans l’eau et le pied dans la berge', () => {
    for (const s of SOUCHES) {
      const d = distanceRuisseau(s.x, s.z)
      // Le centre sur la berge, à moins d'une demi-souche de l'eau : ses racines y plongent.
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThan(0.75 * s.echelle)
      expect(s.y).toBeLessThan(hauteurDuParc(s.x, s.z))
    }
  })

  it('arrêtent le visiteur', () => {
    for (const s of SOUCHES) {
      // Depuis la pelouse, du côté opposé à l'eau, droit sur elle.
      const cote = distanceRuisseau(s.x - 3, s.z) > distanceRuisseau(s.x + 3, s.z) ? -1 : 1
      let w: Walker = { level: 0, x: s.x + 3 * cote, z: s.z, y: 0, yaw: 0, surface: 'parc:terrain' }
      for (let t = 0; t < 5; t += 1 / 60) w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: (cote * Math.PI) / 2 }, 1 / 60)
      expect(Math.hypot(w.x - s.x, w.z - s.z)).toBeGreaterThan(0.5 * s.echelle)
    }
  })

  it('ne laissent rien pousser dans leurs racines', () => {
    const { plantations } = parkPlacements(MUSEE)
    for (const s of SOUCHES) for (const p of plantations) expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(0.9 * s.echelle)
  })
})

describe('les remous', () => {
  it('rapporte un point au repère du ruban : u le long du courant, v en travers', () => {
    const { position, uv } = rubanDuRuisseau()
    for (const i of [30, 200, 500]) {
      const [u, v] = versLeRuban(position[3 * i], position[3 * i + 2])
      expect(u).toBeCloseTo(uv[2 * i], 1)
      expect(v).toBeCloseTo(uv[2 * i + 1], 1)
    }
  })

  it('écume au pied des souches, le long de la branche et autour des galets qui affleurent', () => {
    const r = remous()
    expect(r.length).toBeLessThanOrEqual(REMOUS_MAX)
    expect(r.length).toBeGreaterThan(JARDIN.souches.sujets.length + 5)
    for (const [u, , rayon, force] of r) {
      expect(u).toBeGreaterThanOrEqual(0)
      expect(rayon).toBeGreaterThan(0)
      expect(force).toBeGreaterThan(0)
    }
    expect(INDICE_LEVRE).toBeGreaterThan(0)
  })
})
