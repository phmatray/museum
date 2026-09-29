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

describe('accès au musée', () => {
  const { parvis, allees } = parkPlacements(MUSEE)
  const cx = parvis.x + parvis.width / 2
  const cz = parvis.z + parvis.depth / 2

  it('relie le parvis de l’entrée au chemin de ceinture : jamais de gazon à traverser pour entrer', () => {
    // De l'entrée (sud) vers le sud, pas à pas de 25 cm jusqu'à 8 m.
    for (let t = 0.1; t < 8; t += 0.25) expect(surUneAllee(allees, cx, parvis.z + parvis.depth + t), `${t}`).toBe(true)
  })

  it('ne mène aucune allée droit dans un mur aveugle', () => {
    // Nord, ouest, est : pas de porte, donc pas d'allée qui touche le parvis au milieu du côté.
    for (const [x, z] of [[cx, parvis.z - 0.5], [parvis.x - 0.5, cz], [parvis.x + parvis.width + 0.5, cz]])
      expect(surUneAllee(allees, x, z), `${x}, ${z}`).toBe(false)
  })
})
