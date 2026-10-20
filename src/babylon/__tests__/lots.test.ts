import { describe, expect, it } from 'vitest'

import { matrices, posesDuMobilier } from '../lots'

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
    expect(de('Banquette')).toHaveLength(13)
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
})
