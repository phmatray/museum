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

import { ESPECES_PARC, couronne, planterParc, surUneAllee, tracerAllees } from '../park'
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

describe('couronne — le parc ne passe pas sous le musée', () => {
  const aire = (r: Rect): number => r.width * r.depth
  const total = (rs: Rect[]): number => rs.reduce((s, r) => s + aire(r), 0)
  const chevauchent = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.z < b.z + b.depth && b.z < a.z + a.depth

  /**
   * LE défaut que cette fonction ferme. Le parvis de gravier était un rectangle
   * PLEIN, plus grand que le bâtiment et posé 1,5 cm au-dessus du plancher du
   * rez-de-chaussée : il recouvrait la dalle entière. Ce qu'on prenait pour le
   * sol du hall depuis le premier jour était le gravier des allées du parc.
   *
   * Rien ne cassait — la dalle existait, portait le visiteur, chargeait sa
   * matière. Elle était seulement invisible.
   */
  it('ne laisse aucune pièce au-dessus de l’emprise', () => {
    const emprise: Rect = { x: -19, z: -19, width: 38, depth: 38 }
    const parvis: Rect = { x: -24, z: -24, width: 48, depth: 48 }
    for (const piece of couronne(parvis, emprise)) {
      expect(chevauchent(piece, emprise), `${JSON.stringify(piece)} recouvre le bâtiment`).toBe(
        false,
      )
    }
  })

  it('conserve exactement l’aire du rectangle moins celle du trou', () => {
    const exterieur: Rect = { x: -10, z: -20, width: 30, depth: 50 }
    const trou: Rect = { x: -3, z: 4, width: 7, depth: 11 }
    expect(total(couronne(exterieur, trou))).toBeCloseTo(aire(exterieur) - aire(trou), 9)
  })

  it('découpe des pièces qui ne se recouvrent pas entre elles', () => {
    // Deux bandes superposées feraient rendre deux fois la même herbe : sans
    // conséquence sur une surface opaque, mais l'aire ci-dessus serait juste
    // par compensation et ne prouverait plus rien.
    const pieces = couronne({ x: 0, z: 0, width: 20, depth: 20 }, { x: 6, z: 7, width: 3, depth: 4 })
    for (let i = 0; i < pieces.length; i += 1) {
      for (let j = i + 1; j < pieces.length; j += 1) {
        expect(chevauchent(pieces[i], pieces[j])).toBe(false)
      }
    }
  })

  it('rend le rectangle intact quand le trou est ailleurs, et rien quand il avale tout', () => {
    const r: Rect = { x: 0, z: 0, width: 10, depth: 10 }
    expect(couronne(r, { x: 50, z: 50, width: 4, depth: 4 })).toEqual([r])
    expect(couronne(r, { x: -5, z: -5, width: 30, depth: 30 })).toEqual([])
  })

  it('perce le vrai parvis du musée', () => {
    // Sur l'emprise réelle : c'est celle-là qui était recouverte.
    const emprise: Rect = { x: -19, z: -19, width: 38, depth: 38 }
    const { parvis, terrain } = planterParc(emprise)
    for (const piece of [...couronne(parvis, emprise), ...couronne(terrain, emprise)]) {
      expect(chevauchent(piece, emprise)).toBe(false)
    }
    // Et le parvis reste un parvis : il borde le bâtiment de tous les côtés.
    expect(couronne(parvis, emprise)).toHaveLength(4)
  })
})
