/**
 * `Boites` : chaque instance porte sa PROPRE taille en attribut de géométrie
 * (#38), pas seulement sa matrice. Sans ça, `appliquerEchelleInstance`
 * (`materials.ts`) n'a rien à lire et les matières PBR restent étirées sur
 * toute Boite qui n'est pas un cube unité.
 *
 * Nommé `boites.test.tsx` et non `planBuilding.test.ts` (voir la note de
 * déviation dans le rapport de tâche) : le système de fichiers du poste est
 * insensible à la casse, et `planBuilding.test.tsx` serait le MÊME fichier que
 * `PlanBuilding.test.tsx`, déjà pris par le test du rendu complet.
 *
 * Même harnais que `PlanBuilding.test.tsx` : `@react-three/test-renderer`,
 * pas de vrai contexte WebGL, et l'InstancedMesh se retrouve par son marqueur
 * `isInstancedMesh` plutôt que par `findAllByType('instancedMesh')` (qui ne
 * voit pas au-delà du type JSX, perdu une fois l'objet three construit) ou par
 * `instanceof THREE.InstancedMesh` (deux copies de three cohabitent au banc).
 */
import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import * as THREE from 'three'

import { Boites } from '../PlanBuilding'
import type { Box } from '../../plan/mesh'

function instancedMesh(renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>): THREE.InstancedMesh {
  const noeud = renderer.scene.findAll(
    (n) => (n.instance as { isInstancedMesh?: boolean }).isInstancedMesh === true,
  )[0]
  return noeud.instance as THREE.InstancedMesh
}

const boite = (w: number, h: number, d: number): Box => ({ x: 0, y: 0, z: 0, w, h, d, kind: 'wall' })

describe('Boites', () => {
  it('pose un aTailleBoite différent par instance, pas une valeur partagée', async () => {
    const boites = [boite(1, 1, 1), boite(8, 3, 1)]
    const renderer = await ReactThreeTestRenderer.create(
      <Boites boites={boites} material={new THREE.MeshStandardMaterial()} />,
    )
    const mesh = instancedMesh(renderer)
    const attribut = mesh.geometry.getAttribute('aTailleBoite')

    expect(Array.from(attribut.array)).toEqual([1, 1, 1, 8, 3, 1])
  })

  it('monte sans erreur pour une liste vide (sortes absentes du niveau)', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <Boites boites={[]} material={new THREE.MeshStandardMaterial()} />,
    )
    const mesh = instancedMesh(renderer)

    expect(mesh.count).toBe(0)
  })

  // Le plâtre est partagé par `wall` et `lintel` (voir `Niveau` dans
  // PlanBuilding.tsx) : un seul objet `material`, donc un seul
  // `onBeforeCompile`, monté dans deux `<Boites>`. Que ce partage ne fasse
  // toujours compiler qu'UN programme est déjà couvert par
  // `materials.test.ts` (« ne compile qu'UN programme… ») ; rien de plus à
  // vérifier ici, ce test-ci ne touche pas au matériau.
})
