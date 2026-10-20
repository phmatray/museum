import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { matrices } from '../lots'
import { dansLeCone, monterVisibilite, plansDuPortail, retrier, toutMontrer } from '../visibilite.ts'

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
    lot.thinInstanceSetBuffer('matrix', matrices([[24, 25], [40, 10], [5, 5]].map(([x, z]) => ({ piece: 'p', x, y: 1, z, lacet: 0 }))).get('p')!, 16)
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
    // Dans la nef, dos à la porte : le parc caché ; la galerie r-e1 (par r-n seulement) aussi, le lot réduit à son instance de la nef, devant.
    cam.position.set(24, 1.6, 30)
    cam.setTarget(new Vector3(24, 1.6, 0))
    image()
    expect([vu(parc), vu(galerie), vu(lot)]).toEqual([false, false, true])
    expect(lot.thinInstanceCount).toBe(1)
    // Les sondes : tout le lot le temps d'une capture, puis le tri d'avant.
    toutMontrer()
    expect(lot.thinInstanceCount).toBe(3)
    retrier()
    expect(lot.thinInstanceCount).toBe(1)
    vi.restoreAllMocks()
  })

  it('trie les salles depuis r-o1 : la nef cachée, le lot compacté, la carte d’ombre filtrée et redessinée', () => {
    const t = 1
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    const soleil = new DirectionalLight('soleil', new Vector3(0, -1, 0), scene)
    const g = new ShadowGenerator(64, soleil)
    const cam = new FreeCamera('c', new Vector3(8, 1.6, 5), scene)
    cam.setTarget(new Vector3(8, 1.6, 20))
    const boite = (nom: string, x: number, z: number) => {
      const b = CreateBox(nom, { size: 1 }, scene)
      b.position.set(x, 1, z)
      b.computeWorldMatrix(true)
      g.addShadowCaster(b)
      return b
    }
    const nef = boite('nef', 24, 30)
    const voisine = boite('r-o2', 8, 20)
    const ciel = boite('ciel', 24, 30)
    ciel.metadata = { zone: 'ciel' }
    const lot = CreateBox('lot', { size: 0.5 }, scene)
    lot.thinInstanceSetBuffer('matrix', matrices([[24, 30], [8, 20], [5, 5]].map(([x, z]) => ({ piece: 'p', x, y: 1, z, lacet: 0 }))).get('p')!, 16)
    monterVisibilite(scene, cam, MUSEE)
    const carte = g.getShadowMap()!
    const redessins = vi.spyOn(carte, 'resetRefreshCounter')
    const image = () => {
      cam.getViewMatrix(true)
      cam.getProjectionMatrix(true)
      scene.onBeforeRenderObservable.notifyObservers(scene)
    }
    const vu = (m: { layerMask: number }) => (m.layerMask & cam.layerMask) !== 0
    image()
    expect([vu(nef), vu(voisine), vu(ciel), vu(lot)]).toEqual([false, true, true, true])
    // Celle de r-o2, devant ; celle de r-o1, à côté de l'œil, est hors du champ.
    expect(lot.thinInstanceCount).toBe(1)
    const liste = carte.renderList!
    expect(carte.getCustomRenderList!(0, liste, liste.length)!.map((m) => m.name)).toEqual(['r-o2', 'ciel'])
    expect(redessins).toHaveBeenCalled()
    // Une couche réécrit le lot : il lui est rendu, plus jamais compacté.
    lot.thinInstanceSetBuffer('matrix', matrices([[24, 30], [24, 31]].map(([x, z]) => ({ piece: 'p', x, y: 1, z, lacet: 0 }))).get('p')!, 16)
    image()
    expect(lot.thinInstanceCount).toBe(2)
    expect(vu(lot)).toBe(true)
    // Rentré dans la nef : elle revient, la carte est redessinée.
    redessins.mockClear()
    cam.position.set(24, 1.6, 34)
    image()
    expect(vu(nef)).toBe(true)
    expect(redessins).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
