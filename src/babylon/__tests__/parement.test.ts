import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import LUMIERE from '../../plan/lumiere.json' with { type: 'json' }
import { MUSEE } from '../../plan/musee'
import { COULEURS_SALLES, plinthes } from '../../plan/parement'
import { plafonds } from '../../plan/plafonds'
import { attributsDUsure, codeDuParement, matieresDuParement, type Parement, PENOMBRE, revetements } from '../parement'

describe('revetements', () => {
  const r = revetements(MUSEE)
  const sansCle = MUSEE.levels.reduce((n, l) => {
    const p = plinthes(MUSEE, l.id)
    return n + p.hall.length + p.salles.length + plafonds(MUSEE, l.id).resille.length
  }, 0)

  it('range les 808 surfaces cuites, plus le sous-sol, plinthes et résille sans clé', () => {
    const toutes = Object.values(r).flat()
    // Toutes cuites sauf la dalle du hall, que la trémie du sous-sol découpe (elle hérite de sa lumière, boites.ts).
    expect(toutes.filter((c) => c.cle in LUMIERE.boites)).toHaveLength(807)
    // Plus le sous-sol (foyer, escalier, cinéma, cabine de projection), sans lumière cuite.
    expect(toutes.filter((c) => c.cle)).toHaveLength(846)
    expect(toutes.filter((c) => !c.cle)).toHaveLength(sansCle)
    expect(r.granit.some((c) => !c.cle) && r.pierre.some((c) => !c.cle)).toBe(true)
  })

  it('teinte les peintures de leur couleur de salle, le reste en blanc', () => {
    expect(r.peinture.length).toBeGreaterThan(0)
    expect(r.peinture.every((c) => (COULEURS_SALLES as readonly string[]).includes(c.couleur))).toBe(true)
    expect(r.platre.every((c) => c.couleur === '#ffffff')).toBe(true)
  })

  it('parquette les galeries à bâtons rompus, aux deux niveaux, le reste de l’étage à lames droites', () => {
    const g = r['parquet-galeries']
    expect(new Set(g.map((c) => c.b.y + c.b.h / 2)).size).toBe(MUSEE.levels.filter((l) => l.rooms.some((r) => r.kind === 'gallery')).length)
    expect(r.parquet.length).toBeGreaterThan(0)
    // L'étage, et les sols du sous-sol (cinéma, foyer).
    expect(r.parquet.every((c) => c.b.y + c.b.h / 2 > 0 || c.b.y + c.b.h / 2 < -MUSEE.storey + 1e-6)).toBe(true)
    expect(r.terrazzo.every((c) => Math.abs(c.b.y + c.b.h / 2) < 1e-6)).toBe(true)
  })
})

describe('attributsDUsure', () => {
  it('donne la position dans la boîte en mètres et sa taille, par sommet', () => {
    const gabarit = { positions: [0.5, -0.5, 0.5, -0.5, 0.5, -0.5], normals: [], indices: [] }
    const u = attributsDUsure(gabarit, [{ x: 9, y: 9, z: 9, w: 2, h: 0.12, d: 0.4, kind: 'wall' }])
    expect([...u.boite].map((v) => +v.toFixed(4))).toEqual([1, -0.06, 0.2, -1, 0.06, -0.2])
    expect([...u.taille].map((v) => +v.toFixed(4))).toEqual([2, 0.12, 0.4, 2, 0.12, 0.4])
  })
})

describe('codeDuParement', () => {
  it('écrit un WGSL sans reste de GLSL', () => {
    const w = Object.values(codeDuParement(true, MUSEE).fragment).join('\n')
    expect(w).not.toMatch(/\bvec[234]\(|\bfloat |dFd[xy]|texture2D|textureGrad\(/)
    expect(w).toContain('textureSampleGrad(t, s, btUv, btDx, btDy)')
  })

  it('équilibre les accolades et les directives dans les deux langues', () => {
    for (const wgsl of [false, true]) {
      const c = codeDuParement(wgsl, MUSEE)
      for (const s of [...Object.values(c.fragment), ...Object.values(c.vertex)]) {
        expect(s.split('{').length).toBe(s.split('}').length)
        expect(s.match(/#if/g)?.length ?? 0).toBe(s.match(/#endif/g)?.length ?? 0)
      }
    }
  })
})

describe('la pénombre des galeries', () => {
  it('baisse la lumière cuite sous PM_PENOMBRE, avant les lumières, en GLSL et en WGSL', () => {
    const glsl = Object.values(codeDuParement(false, MUSEE).fragment).join('\n')
    const wgsl = Object.values(codeDuParement(true, MUSEE).fragment).join('\n')
    expect(glsl).toContain(`#if defined(LIGHTMAP) && defined(PM_PENOMBRE)\nlightmapColor.rgb *= ${PENOMBRE};`)
    expect(wgsl).toContain(`lightmapColor = vec4f(lightmapColor.rgb * ${PENOMBRE}, lightmapColor.a);`)
  })
})

describe('matieresDuParement', () => {
  it('greffe le plugin réglé comme les matières de three', () => {
    const scene = new Scene(new NullEngine())
    const m = matieresDuParement(scene, MUSEE)
    const r = (k: keyof typeof m) => m[k].pluginManager!.getPlugin<Parement>('Parement')!.reglages
    expect(r('platre')).toEqual({ rebond: 0.14 })
    expect(r('peinture').tenture).toBe(true)
    expect(r('terrazzo')).toEqual({ rebond: 0.24, terrazzo: true, hall: true, miroir: 'net' })
    expect(r('parquet-galeries')).toMatchObject({ batons: true, miroir: 'doux', penombre: true })
    expect(r('peinture').penombre).toBe(true)
    expect(r('pierre')).toEqual({ usure: true, eclats: true })
    expect(r('granit')).toEqual({ usure: true })
    scene.getEngine().dispose()
  })
})
