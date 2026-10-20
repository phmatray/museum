import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { matrices } from '../lots'
import { dansLeCone, monterVisibilite, plansDuPortail } from '../visibilite.ts'

describe('plansDuPortail', () => {
  // L'œil dans le hall, la porte de 3,2 m sur la façade sud (z = 40).
  const plans = plansDuPortail(new Vector3(24, 1.6, 37), [
    new Vector3(22.4, 0, 40), new Vector3(25.6, 0, 40), new Vector3(25.6, 4.8, 40), new Vector3(22.4, 4.8, 40),
  ])
  const dans = (x: number, y: number, z: number) => dansLeCone([new Vector3(x, y, z)], plans)

  it('voit ce qui est dans l’axe de la porte, au-delà', () => {
    expect(dans(24, 1, 50)).toBe(true)
  })

  it('ne voit ni de côté, ni en deçà de la porte', () => {
    expect(dans(60, 1, 50)).toBe(false)
    expect(dans(24, 1, 38)).toBe(false)
  })
})

describe('monterVisibilite', () => {
  it('cache l’autre côté de la façade sauf par la porte, compacte les lots de l’intérieur, oublie les maillages libérés', () => {
    let t = 1
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    // Dehors sur le parvis, face à la porte (nord, −z).
    const cam = new FreeCamera('c', new Vector3(24, 1.6, 60), scene)
    cam.setTarget(new Vector3(24, 1.6, 0))
    const boite = (nom: string, x: number, z: number) => {
      const b = CreateBox(nom, { size: 1 }, scene)
      b.position.set(x, 1, z)
      b.computeWorldMatrix(true)
      return b
    }
    const parc = boite('parc', 60, 70)
    const galerie = boite('galerie', 40, 10)
    const hall = boite('hall', 24, 30)
    // Un lot de l'intérieur à l'échelle du musée : une instance dans l'axe de la porte, deux dans les galeries.
    const lot = CreateBox('lot', { size: 0.5 }, scene)
    lot.thinInstanceSetBuffer('matrix', matrices([[24, 30], [40, 10], [5, 5]].map(([x, z]) => ({ piece: 'p', x, y: 1, z, lacet: 0 }))).get('p')!, 16)
    monterVisibilite(scene, cam, MUSEE)
    const image = () => {
      cam.getViewMatrix(true)
      cam.getProjectionMatrix(true)
      scene.onBeforeRenderObservable.notifyObservers(scene)
    }
    const vu = (m: { layerMask: number }) => (m.layerMask & cam.layerMask) !== 0
    image()
    expect([vu(parc), vu(galerie), vu(hall), vu(lot)]).toEqual([true, false, true, true])
    expect(lot.thinInstanceCount).toBe(1)
    // Libéré : oublié à la relecture suivante, sans erreur.
    hall.dispose()
    t += 2000
    image()
    // Dedans, dos à la porte : le parc caché, le lot entier.
    cam.position.set(24, 1.6, 30)
    cam.setTarget(new Vector3(24, 1.6, 0))
    image()
    expect([vu(parc), vu(galerie), vu(lot)]).toEqual([false, true, true])
    expect(lot.thinInstanceCount).toBe(3)
    vi.restoreAllMocks()
  })
})
