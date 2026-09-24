/**
 * Le parc autour du bâtiment du plan : rien ne pousse dans l'emprise, ni sur le
 * parvis, ni dans une allée, et le sol ne passe pas sous le musée.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { parkPlacements, surUneAllee } from '../park.ts'

describe('parkPlacements', () => {
  const parc = parkPlacements(MUSEE)

  it('plante des arbres et des arbustes', () => {
    expect(parc.plantations.length).toBeGreaterThan(10)
    expect(new Set(parc.plantations.map((p) => p.espece)).size).toBeGreaterThan(1)
  })

  it('ne plante rien dans l’emprise du bâtiment ni sur son parvis, houppier compris', () => {
    for (const p of parc.plantations) {
      const dedans = p.x > parc.parvis.x - p.rayon && p.x < parc.parvis.x + parc.parvis.width + p.rayon
        && p.z > parc.parvis.z - p.rayon && p.z < parc.parvis.z + parc.parvis.depth + p.rayon
      expect(dedans, `${p.espece} en (${p.x}, ${p.z})`).toBe(false)
    }
    // Le parvis contient l'emprise : ne rien planter sur l'un, c'est épargner l'autre.
    expect(parc.parvis.x).toBeLessThan(0)
    expect(parc.parvis.x + parc.parvis.width).toBeGreaterThan(MUSEE.width)
  })

  it('ne plante rien dans une allée', () => {
    for (const p of parc.plantations) expect(surUneAllee(parc.allees, p.x, p.z, p.rayon)).toBe(false)
  })

  it('perce le sol et le parvis de l’emprise : rien ne recouvre la dalle', () => {
    for (const r of [...parc.sol, ...parc.dalles]) {
      const recouvre = r.x < MUSEE.width && r.x + r.width > 0 && r.z < MUSEE.depth && r.z + r.depth > 0
      expect(recouvre).toBe(false)
    }
  })

  it('est déterministe', () => {
    expect(parkPlacements(MUSEE)).toEqual(parc)
  })
})
