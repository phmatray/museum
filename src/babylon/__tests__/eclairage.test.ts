import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Light } from '@babylonjs/core/Lights/light'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { describe, expect, it } from 'vitest'

import ACCROCHAGE from '../../../public/data/accrochage.json' with { type: 'json' }
import type { Accrochage } from '../../plan/hang'
import { MUSEE } from '../../plan/musee'
import { projecteurs } from '../../plan/projecteurs'
import { avecVitrines } from '../../plan/vitrines'
import { Scene } from '@babylonjs/core/scene'
import { depoli, FLAQUE, halos, matriceDePiece, monterFlaques, sousLesProjecteurs, spotsDesFlaques } from '../eclairage'

const lin = (hex: string) => Color3.FromHexString(hex).toLinearSpace()

describe('depoli', () => {
  it('sous le toit, s’éteint et grisonne la nuit', () => {
    const n = depoli(0, true)
    expect(n.force).toBeCloseTo(0.03)
    expect(n.albedo.r).toBeCloseTo(lin('#f4f1ea').r * 0.4)
    expect(n.emissive.equalsWithEpsilon(lin('#fff6e6'))).toBe(true)
    expect(depoli(1, true).force).toBeCloseTo(0.55)
  })
  it('au rez-de-chaussée, reste allumé et chauffe la nuit (lerp linéaire)', () => {
    const n = depoli(0, false)
    expect(n.force).toBeCloseTo(0.25)
    expect(n.albedo.equalsWithEpsilon(lin('#f4f1ea'))).toBe(true)
    expect(n.emissive.equalsWithEpsilon(lin('#ffd6a0'))).toBe(true)
    expect(depoli(0.5, false).emissive.g).toBeCloseTo((lin('#fff6e6').g + lin('#ffd6a0').g) / 2)
  })
})

describe('matriceDePiece', () => {
  const tous = projecteurs(MUSEE, avecVitrines(ACCROCHAGE as unknown as Accrochage))
  it('116 projecteurs', () => expect(tous).toHaveLength(116))
  it('l’avant (+z) de la tête inclinée vise la toile depuis l’axe de l’étrier', () => {
    for (const p of tous) {
      const m = matriceDePiece(p, -0.17, true)
      const o = Vector3.TransformCoordinates(Vector3.Zero(), m)
      const avant = Vector3.TransformCoordinates(new Vector3(0, 0, 1), m).subtract(o)
      expect(o.subtract(Vector3.FromArray(p.source)).length()).toBeLessThan(1e-5)
      const vers = Vector3.FromArray(p.cible).subtract(o).normalize()
      expect(Vector3.Dot(avant, vers)).toBeCloseTo(1, 5)
    }
  })
  it('la monture reste droite, tournée vers le mur', () => {
    const p = tous[0]
    const m = matriceDePiece(p, 0, false)
    const avant = Vector3.TransformNormal(new Vector3(0, 0, 1), m)
    expect(avant.y).toBeCloseTo(0)
    expect(avant.x * (p.cible[0] - p.x) + avant.z * (p.cible[2] - p.z)).toBeGreaterThan(0)
  })
})

describe('halos', () => {
  const placements = (ACCROCHAGE as Accrochage).rooms.flatMap((r) => r.placements).slice(0, 3)
  const maintenant = new Date('2026-06-01T00:00:00Z')
  const pushes = new Map([
    [placements[0].key, '2026-05-30T00:00:00Z'],
    [placements[1].key, '2024-01-01T00:00:00Z'],
  ])

  it('n’en pose qu’autour des toiles poussées dans l’année, or × 0,45 × éclat', () => {
    const h = halos(placements, pushes, maintenant)
    expect(h.couleurs.length).toBe(4)
    expect(h.couleurs[0]).toBeCloseTo(lin('#ffb54a').r * 0.45, 5)
  })

  it('déborde du cadre de 0,7 m et se tient 4 mm devant le mur', () => {
    const p = placements[0]
    const m = halos(placements, pushes, maintenant).matrices
    expect(Math.hypot(m[0], m[1], m[2])).toBeCloseTo(p.width + 0.7, 5)
    expect(Math.hypot(m[4], m[5], m[6])).toBeCloseTo(p.width / 2 + 0.7, 5)
    expect(m[12]).toBeCloseTo(p.x + p.normal[0] * 0.004, 5)
    expect(m[14]).toBeCloseTo(p.z + p.normal[1] * 0.004, 5)
    // L'axe z local (la face du plan) suit la normale du mur.
    expect(m[8] * p.normal[0] + m[10] * p.normal[1]).toBeCloseTo(1, 5)
  })
})

describe('les flaques des projecteurs', () => {
  const tous = projecteurs(MUSEE, avecVitrines(ACCROCHAGE as unknown as Accrochage))

  it('un spot hors scène par projecteur, de l’étrier vers la toile, qui l’atteint avant sa portée', () => {
    const scene = new Scene(new NullEngine())
    const spots = spotsDesFlaques(tous, scene)
    expect(spots).toHaveLength(116)
    expect(scene.lights).toHaveLength(0)
    spots.forEach((s, i) => {
      const p = tous[i]
      expect(s.falloffType).toBe(Light.FALLOFF_DEFAULT)
      expect(s.position.asArray()).toEqual(p.source)
      const vers = Vector3.FromArray(p.cible).subtract(s.position)
      expect(Vector3.Dot(s.direction, vers.normalizeToNew())).toBeCloseTo(1, 5)
      // Chute glTF (1 − (d/portée)⁴)² : la toile garde plus de la moitié de sa lumière.
      expect((1 - (vers.length() / FLAQUE.portee) ** 4) ** 2).toBeGreaterThan(0.5)
    })
    scene.getEngine().dispose()
  })

  it('sans forward+ (NullEngine), pas de grappe et aucune lumière laissée', () => {
    const scene = new Scene(new NullEngine())
    expect(monterFlaques(tous, scene)).toBeNull()
    expect(scene.lights).toHaveLength(0)
    scene.getEngine().dispose()
  })

  it('une matière sous les projecteurs prend six lumières et la chute glTF', () => {
    const scene = new Scene(new NullEngine())
    const m = new PBRMaterial('m', scene)
    sousLesProjecteurs([m])
    expect(m.maxSimultaneousLights).toBe(6)
    expect(m.useGLTFLightFalloff).toBe(true)
    scene.getEngine().dispose()
  })
})
