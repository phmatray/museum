import { describe, expect, it } from 'vitest'

import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Scene } from '@babylonjs/core/scene'

import { auLoin, cacherAuLoin, matrices, posesDuMobilier } from '../lots'

describe('lots d’instances', () => {
  const poses = posesDuMobilier()
  const de = (piece: string) => poses.filter((p) => p.piece === piece)

  it('développe le cordon en 7 potelets à l’étage, espacés de 2,2 m, sans modèle « Cordon »', () => {
    const potelets = de('Potelet')
    expect(potelets).toHaveLength(7)
    expect(de('Cordon')).toHaveLength(0)
    potelets.forEach((p, i) => {
      expect(p.y).toBe(4.8)
      expect(p.x).toBeCloseTo(17.4 + 2.2 * i)
      expect(p.z).toBeCloseTo(0.7)
    })
  })

  it('accroche les extincteurs à 0,45 m et compte les banquettes', () => {
    expect(de('Extincteur').map((p) => p.y).sort()).toEqual([0.45, 0.45, 5.25])
    expect(de('Banquette')).toHaveLength(14)
  })

  it('compose position, lacet autour de +Y et échelle comme three', () => {
    const m = matrices(poses).get('BancNef')!
    expect(m.length).toBe(4 * 16)
    expect([m[12], m[13], m[14]]).toEqual([21.2, 0, 27.6].map(Math.fround))
    // Lacet π/2 : le x local (ligne 0) part vers (0, 0, −1).
    expect(m[0]).toBeCloseTo(0)
    expect(m[2]).toBeCloseTo(-1)
    const s = matrices([{ piece: 'Lyrata', x: 1, y: 2, z: 3, lacet: 0, echelle: 0.9 }]).get('Lyrata')!
    expect([s[0], s[5], s[10]]).toEqual([0.9, 0.9, 0.9].map(Math.fround))
    const v = matrices([{ piece: 'buis', x: 0, y: 0, z: 0, lacet: 0, echelle: [1, 2, 3] }]).get('buis')!
    expect([v[0], v[5], v[10]]).toEqual([1, 2, 3])
  })
})

describe('instancier', () => {
  it('pose chaque primitive par son nom ou sa pièce, jette l’instance partagée et ce qui n’a pas de pose', async () => {
    const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine')
    const { Scene } = await import('@babylonjs/core/scene')
    const { AssetContainer } = await import('@babylonjs/core/assetContainer')
    const { TransformNode } = await import('@babylonjs/core/Meshes/transformNode')
    const { CreateBox } = await import('@babylonjs/core/Meshes/Builders/boxBuilder')
    const { PBRMaterial } = await import('@babylonjs/core/Materials/PBR/pbrMaterial')
    const { instancier } = await import('../lots')
    const scene = new Scene(new NullEngine())
    const c = new AssetContainer(scene)
    const racine = new TransformNode('__root__', scene)
    const noeud = (nom: string) => Object.assign(new TransformNode(nom, scene), { parent: racine })
    const [lyrata, olivier, kentia] = [noeud('Lyrata'), noeud('Olivier'), noeud('Kentia')]
    const boite = (nom: string, parent: InstanceType<typeof TransformNode>, alpha = 1) => {
      const m = CreateBox(nom, { size: 1 }, scene)
      m.parent = parent
      m.material = Object.assign(new PBRMaterial(nom, scene), { alpha })
      return m
    }
    const cuve = boite('Lyrata-cuve', lyrata)
    const feuilles = boite('Lyrata-feuilles', lyrata, 0.5)
    const instance = cuve.createInstance('Olivier-cuve')
    instance.parent = olivier
    const bois = boite('Olivier-bois', olivier)
    const fronde = boite('Kentia-frondes', kentia)
    c.meshes.push(cuve, feuilles, instance, bois, fronde)
    c.transformNodes.push(racine, lyrata, olivier, kentia)
    // Comme un conteneur chargé : hors de la scène jusqu'à `addAllToScene`.
    for (const m of c.meshes) scene.removeMesh(m)
    for (const t of c.transformNodes) scene.removeTransformNode(t)

    const buf = matrices([
      { piece: 'Lyrata-cuve', x: 1, y: 0, z: 0, lacet: 0 },
      { piece: 'Lyrata-cuve', x: 2, y: 0, z: 0, lacet: 0 },
      { piece: 'Lyrata', x: 1, y: 0, z: 0, lacet: 0 },
      { piece: 'Olivier', x: 2, y: 0, z: 0, lacet: 0 },
    ])
    const porteurs = instancier(c, buf)
    expect(cuve.thinInstanceCount).toBe(2)
    expect(feuilles.thinInstanceCount).toBe(1)
    expect(bois.thinInstanceCount).toBe(1)
    expect(cuve.parent).toBeNull()
    expect(instance.isDisposed()).toBe(true)
    expect(fronde.isDisposed()).toBe(true)
    // Le fondu ne porte pas d'ombre.
    expect(porteurs).toEqual([cuve, bois])
    expect(cuve.material!.pluginManager?.getPlugin('Lueurs')).toBeTruthy()
  })

  it('auLoin : au loin au-delà de la portée, de retour 3 m en deçà', () => {
    expect([auLoin(29, false, 30), auLoin(31, false, 30), auLoin(28, true, 30), auLoin(26, true, 30)]).toEqual([false, true, true, false])
  })

  it('cacherAuLoin : recompacte matrices et attributs des instances proches et dans le champ', () => {
    const scene = new Scene(new NullEngine())
    const cam = new FreeCamera('c', new Vector3(0, 1.6, 0), scene)
    // Le regard vers +x.
    cam.setTarget(new Vector3(10, 1.6, 0))
    const m = CreateBox('b', { size: 0.2 }, scene)
    const mats = matrices([5, 20, 50, -10].map((x) => ({ piece: 'p', x, y: 0, z: 0, lacet: 0 }))).get('p')!
    const teinte = Float32Array.of(1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4)
    m.thinInstanceSetBuffer('matrix', mats, 16)
    m.thinInstanceSetBuffer('teinte', teinte, 4)
    cacherAuLoin(scene, m, { matrix: [mats, 16], teinte: [teinte, 4] }, 30)
    // Vue et projection recalculées comme par un rendu (le tri lit `getTransformationMatrix`).
    const image = () => (cam.getViewMatrix(true), cam.getProjectionMatrix(true), scene.onBeforeRenderObservable.notifyObservers(scene))
    image()
    // 50 m : trop loin ; −10 m : dans le dos.
    expect(m.thinInstanceCount).toBe(2)
    expect([mats[12], mats[16 + 12]]).toEqual([5, 20])
    expect(Array.from(teinte.slice(0, 8))).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
    // En x = 22, regard vers +x : 50 m est à 28 m, encore « au loin » (retour sous 27 m) ; le reste dans le dos.
    cam.position.x = 22
    cam.setTarget(new Vector3(60, 1.6, 0))
    image()
    expect(m.thinInstanceCount).toBe(0)
    expect(m.isEnabled()).toBe(false)
    // Deux mètres de plus : il revient, seul.
    cam.position.x = 24
    cam.setTarget(new Vector3(60, 1.6, 0))
    image()
    expect(m.thinInstanceCount).toBe(1)
    expect(Array.from(teinte.slice(0, 4))).toEqual([3, 3, 3, 3])
    // Demi-tour : 20 et 5 devant, −10 à 34 m, 50 dans le dos.
    cam.setTarget(new Vector3(-60, 1.6, 0))
    image()
    expect(m.thinInstanceCount).toBe(2)
    expect(Array.from(teinte.slice(0, 8))).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
    expect(m.isEnabled()).toBe(true)
  })
})
