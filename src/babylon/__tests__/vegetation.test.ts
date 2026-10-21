import { describe, expect, it } from 'vitest'

import { enceinte } from '../../plan/enceinte'
import type { PlantPlacement } from '../../plan/park'
import { PARC } from '../parc'
import { cartesDeFeuillage, codeVegetal, cote, echelleDe, estLoin, groupes, nomDe, varianteDe } from '../vegetation'

const sujet = (espece: PlantPlacement['espece'], x = 3, z = 7): PlantPlacement => ({ espece, x, z, rotation: 0, scale: 2, rayon: 1 })

describe('végétation', () => {
  it('groupe par essence, érables et lierre par côté du musée', () => {
    const tous = [...PARC.plantations, ...PARC.berges, ...enceinte(PARC.terrain, PARC.allees).lierre]
    const g = groupes(tous, PARC.terrain)
    expect([...g.values()].flat(2)).toHaveLength(tous.length)
    expect(g.get('erable-vert')!.length).toBeGreaterThan(1)
    expect(g.get('lierre')!.length).toBe(4)
    expect(g.get('buis')).toHaveLength(1)
    const t = { x: 0, z: 0, width: 90, depth: 90 }
    expect([cote({ x: 50, z: 10 }, t), cote({ x: 50, z: 80 }, t), cote({ x: 10, z: 45 }, t), cote({ x: 80, z: 45 }, t)]).toEqual(['nord', 'sud', 'ouest', 'est'])
  })

  it('étire buis et azalées d’un aléa de leur place, le reste uniforme', () => {
    expect(echelleDe(sujet('cedre'))).toEqual([2, 2, 2])
    expect(echelleDe(sujet('petales'), 0.5)).toEqual([1, 1, 1])
    const [sx, sy, sz] = echelleDe(sujet('buis'))
    expect(sx).toBeGreaterThanOrEqual(1.7)
    expect(sx).toBeLessThanOrEqual(2.4)
    expect(sy).toBeGreaterThanOrEqual(1.5)
    expect(sy).toBeLessThanOrEqual(2.5)
    expect(sz).not.toBe(sx)
  })

  it('bascule au loin à 36 m, revient en deçà de 33 m', () => {
    expect([estLoin(35, false), estLoin(37, false), estLoin(34, true), estLoin(32, true)]).toEqual([false, true, true, false])
  })

  it('retrouve les cartes de feuillage : centre et aléa par carte', () => {
    // Deux quads disjoints.
    const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 6, 1, 0, 5, 1, 0]
    const c = cartesDeFeuillage(p, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
    expect([...c.slice(0, 3)]).toEqual([0.5, 0.5, 0])
    expect([...c.slice(16, 19)]).toEqual([5.5, 0.5, 0])
    expect(c[3]).toBe(c[15])
    expect(c[3]).toBeCloseTo(Math.abs(Math.sin(2 * 12.9898 + 2 * 78.233) * 43758.5453) % 1, 5)
    expect(c[3]).not.toBe(c[19])
  })

  it('une variante par usage, un nom (donc un define) par variante', () => {
    expect(varianteDe('erable-vert', 'Jardin_Feuillage')).toEqual({ carte: 'vert', nuance: 0.45 })
    expect(varianteDe('erable-vert', 'Jardin_Ecorce')).toBeNull()
    expect(varianteDe('pin', 'Jardin_Feuillage_Fond_Pin')).toBeNull()
    expect(varianteDe('pin', 'Jardin_Feuillage_Grands')).toEqual({ nuance: 0.35 })
    expect(varianteDe('lierre', 'Jardin_Feuillage')).toEqual({ nuance: 0.5 })
    expect(varianteDe('roseaux', 'Jardin_Herbe')).toEqual({ herbe: true })
    expect(varianteDe('rocher-3', 'rock_moss_set_02')).toEqual({ mousse: true })
    expect(varianteDe('fougere', 'fern_02')).toBeNull()
    expect(nomDe({ carte: 'rouge', nuance: 0.45 })).toBe('Vegetal-rouge-n45')
    expect(nomDe({ azalee: true, nuance: 1 })).not.toBe(nomDe({ nuance: 1 }))
  })

  it('écrit la greffe dans les deux langues, saison en uniform', () => {
    for (const wgsl of [false, true]) {
      const c = codeVegetal({ carte: 'vert', nuance: 0.45 }, wgsl)
      expect(c.vertex.CUSTOM_VERTEX_DEFINITIONS).toContain(wgsl ? 'attribute aCarte: vec4f;' : 'attribute vec4 aCarte;')
      expect(c.vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain(wgsl ? 'vertexInputs.world3.xz' : 'world3.xz')
      expect(c.vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain(wgsl ? 'uniforms.vegTemps' : 'vegTemps')
      expect(c.vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain(wgsl ? 'uniforms.vegVent' : 'vegVent')
      expect(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain(wgsl ? 'uniforms.vegSaison.x' : 'vegSaison.x')
      expect(/\bvec[234]\(/.test(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA)).toBe(!wgsl)
      expect(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA.includes('select(')).toBe(wgsl)
    }
    const roche = codeVegetal({ mousse: true }, true)
    expect(roche.fragment.CUSTOM_FRAGMENT_DEFINITIONS).toBe('')
    expect(roche.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain('fragmentInputs.vNormalW.y')
    expect(codeVegetal({ herbe: true }, false).fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain('clamp(max(vegSaison.x * 0.75, vegSaison.y), 0.0, 1.0)')
  })

  it('replie les pétales hors floraison, sans autre greffe', () => {
    expect(varianteDe('petales', 'Jardin_Feuillage')).toEqual({ petales: true })
    expect(nomDe({ petales: true })).toBe('Vegetal-petales')
    const c = codeVegetal({ petales: true }, true)
    expect(c.vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain('positionUpdated *= smoothstep(0.0, 0.4, uniforms.vegSaison.z);')
    expect(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toBe('')
  })
})
