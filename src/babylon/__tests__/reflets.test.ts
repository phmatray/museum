import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Constants } from '@babylonjs/core/Engines/constants'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { intensiteDesReflets, monterReflets, sondes } from '../reflets.ts'

describe('sondes', () => {
  const s = sondes(MUSEE)

  it('une par salle, la nef à 3 m, la salle d’honneur à 2 m de son plancher, pas de balcon', () => {
    expect(s.size).toBe(18)
    expect(s.get('nef')![1]).toBe(3)
    expect(s.get('1:honneur')![1]).toBeCloseTo(6.8)
    expect(s.get('0:r-o1')![1]).toBe(2)
    expect([...s.keys()].some((k) => k.includes('balcon'))).toBe(false)
  })
})

describe('intensiteDesReflets', () => {
  it('0,6 au ciel, 0,8 dedans, 25 % la nuit', () => {
    expect(intensiteDesReflets({ sonde: 'ciel', voisine: 'ciel', part: 0 }, true, 1)).toEqual([0.6, 0])
    expect(intensiteDesReflets({ sonde: 'nef', voisine: 'nef', part: 0 }, true, 0)[0]).toBeCloseTo(0.2)
  })

  it('sur le seuil, mix(a, b, part) × intensité mêlée ; une seule carte, la part ne compte plus', () => {
    const [ka, kb] = intensiteDesReflets({ sonde: 'nef', voisine: 'ciel', part: 0.5 }, false, 1)
    expect(ka).toBeCloseTo(0.35)
    expect(kb).toBeCloseTo(0.35)
    expect(intensiteDesReflets({ sonde: 'nef', voisine: 'ciel', part: 0.5 }, true, 1)).toEqual([0.8, 0])
  })
})

describe('monterReflets sous NullEngine', () => {
  it('une texture d’environnement fixe, inversée en z, linéaire, intensité 1', () => {
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    monterReflets(scene, MUSEE, () => ({ level: 0, surface: '0:hall', x: 24, y: 0, z: 20, yaw: 0 }), null)
    const env = scene.environmentTexture!
    expect(env.coordinatesMode).toBe(Constants.TEXTURE_INVCUBIC_MODE)
    expect(env.invertZ).toBe(true)
    expect(env.gammaSpace).toBe(false)
    expect(scene.environmentIntensity).toBe(1)
    expect(scene.reflectionProbes.length).toBe(19)
    // Aucune sonde rendue d'office : la file les place une par image.
    expect(scene.customRenderTargets.length).toBe(0)
  })
})

describe('prises', () => {
  it('résolue une fois la file vidée, une sonde par image', async () => {
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    const r = monterReflets(scene, MUSEE, () => ({ level: 0, surface: '0:hall', x: 24, y: 0, z: 20, yaw: 0 }), null)
    new FreeCamera('c', Vector3.Zero(), scene)
    r.rafraichir()
    let fini = false
    void r.prises().then(() => (fini = true))
    let images = 0
    while (!fini && images < 100) {
      scene.render()
      images++
      await Promise.resolve()
    }
    expect(fini).toBe(true)
    expect(images).toBeGreaterThan(16)
  })
})
