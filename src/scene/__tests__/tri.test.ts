import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { NEF } from '../../plan/visibilite'
import { sansTri, trier } from '../tri'

/** Un lot de trois cubes : dans la galerie r-o1, dans la nef, dans le parc. */
function scene() {
  const s = new THREE.Scene()
  const lot = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), undefined, 3)
  const places: [number, number, number][] = [[8, 1, 6], [24, 1, 30], [40, 1, 60]]
  places.forEach(([x, y, z], i) => lot.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)))
  const seul = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5))
  seul.position.set(8, 1, 6)
  s.add(lot, seul)
  s.updateMatrixWorld(true)
  return { s, lot, seul }
}

const x = (m: THREE.InstancedMesh, i: number) => new THREE.Vector3().setFromMatrixPosition(m.getMatrixAt(i, new THREE.Matrix4())).x

describe('le tri des salles', () => {
  it('compacte un lot sur ses instances visibles, écarte un maillage caché, et rend tout le temps d’une sonde', () => {
    const { s, lot, seul } = scene()
    const vues = new Set([NEF])
    // Deux passes : un lot neuf n'est compacté qu'une fois resté tel quel.
    for (let i = 0; i < 3; i++) trier(s, vues, 'nef')
    expect(lot.count).toBe(1)
    expect(x(lot, 0)).toBe(24)
    expect(seul.layers.mask).toBe(0)

    const pendant = sansTri(() => [lot.count, x(lot, 0), seul.layers.mask])
    expect(pendant).toEqual([3, 8, 1])
    expect(lot.count).toBe(1)
    expect(x(lot, 0)).toBe(24)
  })

  it('un lot réécrit par sa couche repart de ses nouvelles matrices', () => {
    const { s, lot } = scene()
    for (let i = 0; i < 3; i++) trier(s, new Set([NEF]), 'nef')
    lot.setMatrixAt(0, new THREE.Matrix4().makeTranslation(24, 1, 20))
    lot.instanceMatrix.needsUpdate = true
    for (let i = 0; i < 3; i++) trier(s, new Set([NEF]), 'nef')
    expect(lot.count).toBe(2)
  })
})
