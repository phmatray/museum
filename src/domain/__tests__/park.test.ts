/**
 * Tests du parc (§ parc).
 *
 * Ce que ces tests empêchent, dans l'ordre :
 *
 *  1. Un arbre dans une allée. C'est le détail qui ruine tout le reste : un
 *     sentier qu'on ne peut pas suivre annonce que rien n'a été pensé.
 *  2. Un arbre dans le bâtiment, ou sur le parvis.
 *  3. Deux sujets qui se traversent.
 *  4. Un parc qui change d'une exécution à l'autre — le rendu deviendrait
 *     invérifiable, et le harnais de capture ne comparerait plus rien.
 */
import { describe, expect, it } from 'vitest'

import { ESPECES_PARC, planterParc, surUneAllee, tracerAllees } from '../park'
import type { EspeceParc } from '../park'
import type { Rect } from '../types'

const emprise: Rect = { x: -15, z: -15, width: 30, depth: 30 }
const parc = planterParc(emprise)

const RAYON: Record<EspeceParc, number> = {
  'arbre-01': 3.2,
  'arbre-02': 2.8,
  'arbuste-01': 1.1,
  'arbuste-02': 0.9,
}

describe('parc', () => {
  it('plante réellement quelque chose, des deux strates', () => {
    expect(parc.plantations.length).toBeGreaterThan(30)
    const especes = new Set(parc.plantations.map((p) => p.espece))
    expect(especes.has('arbre-01') || especes.has('arbre-02')).toBe(true)
    expect(especes.has('arbuste-01') || especes.has('arbuste-02')).toBe(true)
    for (const p of parc.plantations) expect(ESPECES_PARC).toContain(p.espece)
  })

  it('ne plante RIEN dans une allée, houppier compris', () => {
    for (const p of parc.plantations) {
      expect(
        surUneAllee(parc.allees, p.position.x, p.position.z, RAYON[p.espece]),
        `${p.espece} en (${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)})`,
      ).toBe(false)
    }
  })

  it('ne plante rien sur le parvis ni dans le bâtiment', () => {
    const { parvis } = parc
    for (const p of parc.plantations) {
      const dedans =
        p.position.x > parvis.x &&
        p.position.x < parvis.x + parvis.width &&
        p.position.z > parvis.z &&
        p.position.z < parvis.z + parvis.depth
      expect(dedans, `${p.espece} sur le parvis`).toBe(false)
    }
  })

  it('garde tout le monde dans le terrain', () => {
    const { terrain } = parc
    for (const p of parc.plantations) {
      expect(p.position.x).toBeGreaterThanOrEqual(terrain.x)
      expect(p.position.x).toBeLessThanOrEqual(terrain.x + terrain.width)
      expect(p.position.z).toBeGreaterThanOrEqual(terrain.z)
      expect(p.position.z).toBeLessThanOrEqual(terrain.z + terrain.depth)
    }
  })

  it('ne fait se traverser aucun sujet', () => {
    for (let i = 0; i < parc.plantations.length; i++) {
      for (let j = i + 1; j < parc.plantations.length; j++) {
        const a = parc.plantations[i]
        const b = parc.plantations[j]
        const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)
        expect(d, `${a.espece} ∩ ${b.espece}`).toBeGreaterThanOrEqual(
          RAYON[a.espece] + RAYON[b.espece] - 1e-9,
        )
      }
    }
  })

  it('boucle la périphérique : aucun coin ouvert', () => {
    const boucle = tracerAllees(parc.parvis, parc.terrain).slice(0, 4)
    for (let i = 0; i < 4; i++) {
      const fin = boucle[i].b
      const debut = boucle[(i + 1) % 4].a
      expect(Math.hypot(fin.x - debut.x, fin.z - debut.z)).toBeCloseTo(0, 9)
    }
  })

  it('mène les quatre accès jusqu’au bord du terrain', () => {
    // Un accès qui s'arrête au milieu de l'herbe n'est pas une entrée.
    const acces = parc.allees.slice(4)
    expect(acces).toHaveLength(4)
    const { terrain } = parc
    for (const a of acces) {
      const surLeBord =
        Math.abs(a.b.x - terrain.x) < 1e-6 ||
        Math.abs(a.b.x - (terrain.x + terrain.width)) < 1e-6 ||
        Math.abs(a.b.z - terrain.z) < 1e-6 ||
        Math.abs(a.b.z - (terrain.z + terrain.depth)) < 1e-6
      expect(surLeBord).toBe(true)
    }
  })

  it('produit deux fois le même parc, arbre pour arbre', () => {
    expect(JSON.stringify(planterParc(emprise))).toBe(JSON.stringify(planterParc(emprise)))
  })

  it('change quand la graine change', () => {
    // Sinon la graine ne servirait à rien et deux musées auraient le même parc.
    expect(JSON.stringify(planterParc(emprise, 'a'))).not.toBe(
      JSON.stringify(planterParc(emprise, 'b')),
    )
  })
})
