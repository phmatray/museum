/**
 * Les props par salle : des plantes dans les angles, choisies d'après le thème
 * de la salle, hors des murs et hors des passages.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { passage, propPlacements, PROP_RAYON } from '../props.ts'
import { INT as DEMI_MUR } from '../svg.ts'

const THEMES = [{ id: 'r-o1', name: 'Typescript / Tauri' }, { id: 'honneur', name: 'Les plus étoilés' }]

describe('propPlacements', () => {
  const props = propPlacements(MUSEE, THEMES)

  it('pose des props dans une salle réelle du plan, à l’intérieur de son contour, murs compris', () => {
    const salle = MUSEE.levels[0].rooms.find((r) => r.id === 'r-o1')!
    const siens = props.filter((p) => p.roomId === 'r-o1')
    expect(siens.length).toBeGreaterThan(0)
    for (const p of siens) {
      const r = PROP_RAYON[p.id] * p.scale + DEMI_MUR
      expect(p.x - r).toBeGreaterThanOrEqual(salle.x)
      expect(p.x + r).toBeLessThanOrEqual(salle.x + salle.width)
      expect(p.z - r).toBeGreaterThanOrEqual(salle.z)
      expect(p.z + r).toBeLessThanOrEqual(salle.z + salle.depth)
    }
  })

  it('ne pose rien dans un passage : aucun prop ne mord le couloir d’une ouverture', () => {
    for (const p of props) {
      const level = MUSEE.levels.find((l) => l.id === p.level)!
      const r = PROP_RAYON[p.id] * p.scale
      for (const o of level.openings) {
        const c = passage(level, o)
        const d = Math.hypot(p.x - Math.max(c.x, Math.min(p.x, c.x + c.width)), p.z - Math.max(c.z, Math.min(p.z, c.z + c.depth)))
        expect(d, `${p.id} de ${p.roomId} contre l’ouverture ${o.a}/${o.b}`).toBeGreaterThanOrEqual(r)
      }
    }
  })

  it('tire les espèces du thème : deux thèmes différents, deux salles différentes', () => {
    const espece = (name: string) => propPlacements(MUSEE, [{ id: 'r-o1', name }]).filter((p) => p.roomId === 'r-o1').map((p) => `${p.id}:${p.rotation}`)
    expect(espece('Blazor')).not.toEqual(espece('Jeux'))
    expect(espece('Blazor')).toEqual(espece('Blazor'))
  })

  it('une salle sans thème assigné garde ses props, tirés de son nom de plan', () => {
    const sans = propPlacements(MUSEE, [])
    expect(new Set(sans.map((p) => p.roomId)).size).toBe(14)
  })
})
