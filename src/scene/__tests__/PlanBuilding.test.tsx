/**
 * Le rendu de `PlanBuilding` : chaque sorte de boîte, sur chaque niveau, doit
 * atteindre l'`InstancedMesh` avec le même nombre d'instances que `meshLevel`
 * en a calculé — la preuve que le passage par React/three ne perd ni n'invente
 * rien en chemin. `meshLevel` lui-même est déjà couvert par
 * `plan/__tests__/mesh.test.ts` ; on ne recalcule pas sa géométrie ici.
 *
 * `PlanBuilding` ne prend plus de prop `level` depuis l'étage noble (#15) : un
 * seul rendu couvre tous les niveaux de `MUSEE.levels`, chacun avec ses sept
 * sortes de boîtes (mur, linteau, dalle, palier, marche, garde-corps, baie) —
 * voir l'ordre exact des `<Boites>` dans `PlanBuilding.tsx`.
 */
import { describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'

// Le texte troika (enseigne, cartels) ne tourne pas sous jsdom et y bloquait le
// test : on le neutralise, comme SculptureLayer.test et Cartel.test.
vi.mock('@react-three/drei', () => ({ Text: () => null }))
import { Color } from 'three'
import type * as THREE from 'three'

import { PlanBuilding } from '../PlanBuilding'
import { MUSEE } from '../../plan/musee'
import { bandesDuSol, parementDuHall } from '../../plan/parement'
import { plafonds } from '../../plan/plafonds'
import { facade } from '../../plan/facade'
import { meshLevel, type Box } from '../../plan/mesh'
import { CIEL } from '../lighting'

// Ordre exact des <Boites> par niveau dans PlanBuilding.tsx : un InstancedMesh
// par sorte, toujours dans cet ordre, même vide.
const ORDRE_SORTES: Box['kind'][] = ['wall', 'lintel', 'slab', 'landing', 'step', 'railing', 'handrail', 'glass']

/**
 * `InstancedMesh` n'écrase pas `Object3D.type` (il reste `'Mesh'`, hérité de
 * `Mesh`) : le type JSX `instancedMesh` ne survit donc pas jusqu'à l'objet
 * three rendu, et `findAllByType('instancedMesh')` ne trouve rien. Et comme
 * Vite optimise `@react-three/fiber` dans une copie de `three` séparée de
 * celle importée ici (le warning « Multiple instances of Three.js » au banc),
 * `instanceof THREE.InstancedMesh` échoue aussi entre les deux copies : on
 * distingue les instances par leur marqueur booléen, qui lui survit au
 * dédoublement du module.
 */
type Renderer = Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>

const instancedMeshes = (renderer: Renderer): THREE.InstancedMesh[] =>
  renderer.scene
    .findAll((node) => (node.instance as { isInstancedMesh?: boolean }).isInstancedMesh === true)
    .map((node) => node.instance as THREE.InstancedMesh)

describe('PlanBuilding', () => {
  it('rend un instancedMesh par sorte de boîte et par niveau, avec le compte de meshLevel', async () => {
    const renderer = await ReactThreeTestRenderer.create(<PlanBuilding />)
    const meshes = instancedMeshes(renderer)

    const attendus = MUSEE.levels.flatMap((niveau) => {
      const boites = meshLevel(MUSEE, niveau.id)
      // Puis la pierre du hall : son parement, et au rez-de-chaussée les bandes du sol.
      const { platre, verre, resille } = plafonds(MUSEE, niveau.id)
      const pierre = [parementDuHall(MUSEE, niveau.id).length, platre.length, verre.length, resille.length, ...(niveau.id === 0 ? [bandesDuSol(MUSEE).length] : [])]
      const comptes = ORDRE_SORTES.map((kind) => boites.filter((b) => b.kind === kind).length)
      // Les dalles des balcons sont à part, en pierre, juste après les dalles courantes.
      const balcons = niveau.rooms.filter((r) => r.kind === 'balcony').length
      comptes.splice(2, 1, comptes[2] - balcons, balcons)
      return [...comptes, ...pierre]
    })
    // Puis la façade, après les niveaux : brique, pierre, piliers, vitres, menuiseries.
    const f = facade(MUSEE)
    attendus.push(f.brique.length, f.pierre.length, f.piliers.length, f.vitres.length, f.menuiseries.length)

    expect(meshes).toHaveLength(attendus.length)
    expect(meshes.map((m) => m.count)).toEqual(attendus)
  })

  it('rend un instancedMesh même pour une sorte sans boîte sur ce niveau (args=[…, 0])', async () => {
    const renderer = await ReactThreeTestRenderer.create(<PlanBuilding />)
    const meshes = instancedMeshes(renderer)

    // Au moins une paire (niveau, sorte) est vide dans ce plan (ex. les baies
    // ne courent pas sur tous les niveaux) : le rendu ne doit ni l'omettre ni
    // planter, seulement produire un InstancedMesh à zéro instance.
    const comptesAZero = meshes.filter((m) => m.count === 0)
    expect(comptesAZero.length).toBeGreaterThan(0)
  })

  it('monte CIEL comme fond de scène (#46)', async () => {
    // `lighting.test.ts` prouve que CIEL est une couleur claire ; ce test-ci
    // protège l'autre moitié du contrat, que rien ne couvrait avant #46 : que
    // ce fond est bien MONTÉ dans la scène rendue, pas seulement exporté.
    // Sans lui, retirer le <color attach="background"> de PlanBuilding.tsx
    // repasserait le ciel au noir sans qu'aucun test ne le remarque.
    const renderer = await ReactThreeTestRenderer.create(<PlanBuilding />)
    const scene = renderer.scene.instance as THREE.Scene
    expect(scene.background).toBeDefined()
    expect((scene.background as THREE.Color).getHexString()).toBe(
      new Color(CIEL).getHexString(),
    )
  })
})
