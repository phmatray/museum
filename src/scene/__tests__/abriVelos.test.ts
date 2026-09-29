/**
 * L'abri à vélos (`tools/blender/build-accessoires.py`) posé à sa place du
 * plan : chaque vélo touche le dallage, ni enfoncé ni en l'air (« les 3 vélos
 * sont enfoncés dans le sol », Philippe).
 */
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'

import { MOBILIER } from '../../plan/mobilier'
import { solDuParc } from '../../plan/relief'
import { chargerGLTF, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

it('pose chaque vélo de l’abri sur le sol, à 1 cm près', async () => {
  const abri = MOBILIER.find((m) => m.piece === 'AbriVelos')!
  const { scene } = await chargerGLTF('public/assets/architecture/accessoires.glb')
  const racine = scene.getObjectByName('AbriVelos')!
  // Comme `MobilierLayer` : le nœud à la place du meuble, tourné de son lacet.
  racine.position.set(abri.x, abri.y, abri.z)
  racine.rotation.set(0, abri.lacet, 0)
  scene.updateMatrixWorld(true)
  const velos = racine.children.filter((o) => o.name.startsWith('Velo'))
  expect(velos.map((o) => o.name).sort()).toEqual(['VeloCourse', 'VeloDame', 'VeloHollandais'])
  for (const v of velos) {
    const b = new THREE.Box3().setFromObject(v)
    const centre = b.getCenter(new THREE.Vector3())
    expect(Math.abs(b.min.y - solDuParc(centre.x, centre.z)), v.name).toBeLessThan(0.01)
  }
})
