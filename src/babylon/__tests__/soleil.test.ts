import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { cielA } from '../../domain/soleil'
import { monterSoleil, reglagesDuCiel } from '../soleil'

const bruxelles = (iso: string) => cielA(new Date(iso), 50.85, 4.35)

describe('reglagesDuCiel', () => {
  it('éclaire depuis le soleil réel en plein jour', () => {
    const r = reglagesDuCiel(bruxelles('2026-10-19T13:00:00Z'))
    r.direction.forEach((v, i) => expect(v).toBeCloseTo([0.386, -0.436, -0.813][i], 2))
    expect(r.intensite).toBeCloseTo(3.4)
    expect(r.fond).toBe('#DBE6F5')
  })

  it('passe à la lune la nuit, qui éclaire d’en haut', () => {
    const c = bruxelles('2026-10-19T22:00:00Z')
    expect(c.elevation).toBeLessThan(0)
    const r = reglagesDuCiel(c)
    expect(r.direction[1]).toBeLessThan(0)
    expect(r.couleur).toBe('#A9BCFF')
    expect(r.intensite).toBeCloseTo(0.35)
  })
})

describe('monterSoleil', () => {
  it('ne redessine la carte que quand la boîte glisse d’un pas', () => {
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    const camera = new FreeCamera('oeil', new Vector3(24, 1.62, 37), scene)
    const { generateur } = monterSoleil(scene, bruxelles('2026-10-19T13:00:00Z'), true)
    const redessin = vi.spyOn(generateur!.getShadowMap()!, 'resetRefreshCounter')
    scene.render()
    scene.render()
    expect(redessin).toHaveBeenCalledTimes(1)
    camera.position.x += 0.4
    scene.render()
    expect(redessin).toHaveBeenCalledTimes(1)
    camera.position.x += 5
    scene.render()
    expect(redessin).toHaveBeenCalledTimes(2)
  })

  it('sans ombres, pas de générateur', () => {
    const scene = new Scene(new NullEngine())
    expect(monterSoleil(scene, bruxelles('2026-10-19T13:00:00Z'), false).generateur).toBeNull()
  })
})
