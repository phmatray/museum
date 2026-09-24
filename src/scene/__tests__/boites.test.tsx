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

type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

const instancedMeshes = (renderer: Renderer): THREE.InstancedMesh[] =>
  renderer.scene
    .findAll((n) => (n.instance as { isInstancedMesh?: boolean }).isInstancedMesh === true)
    .map((n) => n.instance as THREE.InstancedMesh)

function instancedMesh(renderer: Renderer): THREE.InstancedMesh {
  return instancedMeshes(renderer)[0]
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
  // `materials.test.ts` (« ne compile qu'UN programme… »). Ce qui ne l'était
  // PAS encore (trouvaille de revue) : que les DEUX `<Boites>` obtiennent
  // chacun sa PROPRE géométrie/attribut malgré ce matériau partagé — un cube
  // module-niveau réintroduit par erreur passerait le test ci-dessus tout en
  // faisant lire à `lintel` les tailles de `wall`.
  it("donne à deux <Boites> qui partagent un matériau des géométries et des aTailleBoite distincts", async () => {
    const material = new THREE.MeshStandardMaterial()
    const mur = [boite(1, 1, 1)]
    const linteau = [boite(2, 0.5, 0.25)]
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Boites boites={mur} material={material} />
        <Boites boites={linteau} material={material} />
      </>,
    )
    const [meshMur, meshLinteau] = instancedMeshes(renderer)

    expect(meshMur.material).toBe(material)
    expect(meshLinteau.material).toBe(material)
    expect(meshMur.geometry).not.toBe(meshLinteau.geometry)
    expect(Array.from(meshMur.geometry.getAttribute('aTailleBoite').array)).toEqual([1, 1, 1])
    expect(Array.from(meshLinteau.geometry.getAttribute('aTailleBoite').array)).toEqual([2, 0.5, 0.25])
  })
})
