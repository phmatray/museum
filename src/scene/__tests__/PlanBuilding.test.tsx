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
// L'escalier de marbre ne se charge pas sous jsdom : on décide ici s'il arrive.
const escalier = vi.hoisted(() => ({ charge: false }))
vi.mock('../EscalierLayer', async () => {
  const { useEffect } = await import('react')
  return {
    EscalierLayer: ({ onPret }: { onPret: () => void }) => {
      useEffect(() => {
        if (escalier.charge) onPret()
      }, [onPret])
      return null
    },
  }
})
// La faune du jardin (carpes, oiseaux, lucioles) a ses propres instances : hors du compte des boîtes.
vi.mock('../FauneLayer', () => ({ FauneLayer: () => null }))
import { Color } from 'three'
import type * as THREE from 'three'

import { PlanBuilding } from '../PlanBuilding'
import { MUSEE } from '../../plan/musee'
import { bandesDuSol, parementDuHall, peintureDesSalles, plinthes } from '../../plan/parement'
import { plafonds } from '../../plan/plafonds'
import { facade } from '../../plan/facade'
import { enceinte } from '../../plan/enceinte'
import { parkPlacements } from '../../plan/park'
import { portes } from '../../plan/portes'
import { boitesDesCimaises } from '../../plan/cimaises'
import { meshLevel, type Box } from '../../plan/mesh'
import { CIEL } from '../lighting'
import { useGameStore } from '../../stores/gameStore'
import { sansBaieBatllo } from '../batllo'

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
      // Puis la pierre du hall : son parement, les plinthes (hall, salles), et au rez-de-chaussée les bandes du sol.
      const { platre, verre, resille } = plafonds(MUSEE, niveau.id)
      const plinthe = plinthes(MUSEE, niveau.id)
      const pierre = [parementDuHall(MUSEE, niveau.id).length, plinthe.hall.length, plinthe.salles.length, platre.length, verre.length, resille.length, ...(niveau.id === 0 ? [bandesDuSol(MUSEE).length] : [])]
      const comptes = ORDRE_SORTES.map((kind) => boites.filter((b) => b.kind === kind).length)
      // La baie de la salle d'honneur est vitrée par la fenêtre Batlló (BatlloLayer), pas par une boîte.
      comptes[ORDRE_SORTES.indexOf('glass')] = sansBaieBatllo(boites.filter((b) => b.kind === 'glass'), niveau.id).length
      // Les dalles des balcons sont à part, en pierre, juste après les dalles courantes.
      const balcons = niveau.rooms.filter((r) => r.kind === 'balcony').length
      const galeriesRdc = niveau.id === 0 ? niveau.rooms.filter((r) => r.kind === 'gallery').length : 0
      comptes.splice(2, 1, comptes[2] - balcons - galeriesRdc, balcons)
      // Puis le parquet des galeries du rez-de-chaussée et leurs murs peints, un lot par couleur.
      return [...comptes, ...pierre, galeriesRdc, ...peintureDesSalles(MUSEE, niveau.id).map((p) => p.boites.length)]
    })
    // Puis les embrasures de pierre des portes (PortesLayer ; ses chambranles attendent leur GLB).
    attendus.push(portes(MUSEE).embrasures.length)
    // Puis les cimaises (CimaisesLayer) : le stratifié et l'aluminium de chaque niveau qui en a.
    for (const niveau of MUSEE.levels) {
      const { panneaux, alu } = boitesDesCimaises(MUSEE, niveau.id)
      if (panneaux.length) attendus.push(panneaux.length, alu.length)
    }
    // Puis la façade, après les niveaux : brique, pierre, piliers, vitres, menuiseries.
    const f = facade(MUSEE)
    attendus.push(f.brique.length, f.pierre.length, f.piliers.length, f.vitres.length, f.portes.length, f.menuiseries.length)
    // Puis le mur d'enceinte du parc (ParkLayer) : brique, pierre, grilles.
    const parc = parkPlacements(MUSEE)
    const mur = enceinte(parc.terrain, parc.allees)
    attendus.push(mur.brique.length, mur.pierre.length, mur.fer.length)

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

  it('ne rend plus marches, palier ni paillasses une fois l’escalier de marbre chargé', async () => {
    escalier.charge = true
    try {
      const renderer = await ReactThreeTestRenderer.create(<PlanBuilding />)
      const meshes = instancedMeshes(renderer)
      const n = ORDRE_SORTES.length + 1 // la dalle des balcons est à part
      const rdc = meshes.slice(0, n).map((m) => m.count)
      const boites = meshLevel(MUSEE, 0)
      const compte = (kind: Box['kind']) => boites.filter((b) => b.kind === kind).length
      // Les dalles qui restent : les planchers, pas les paillasses sous les marches.
      const planchers = boites.filter((b) => b.kind === 'slab' && b.y + b.h / 2 <= 1e-6).length
      const balcons = MUSEE.levels[0].rooms.filter((r) => r.kind === 'balcony').length
      const galeries = MUSEE.levels[0].rooms.filter((r) => r.kind === 'gallery').length
      expect(rdc).toEqual([compte('wall'), compte('lintel'), planchers - balcons - galeries, balcons, 0, 0, compte('railing'), compte('handrail'), compte('glass')])
    } finally {
      escalier.charge = false
    }
  })

  it('monte CIEL comme fond de scène en plein jour, et jamais le noir la nuit (#46)', async () => {
    // `lighting.test.ts` prouve que CIEL est une couleur claire ; ce test-ci
    // protège l'autre moitié du contrat : que ce fond est bien MONTÉ dans la
    // scène rendue. Depuis le cycle jour/nuit, il suit le soleil : on fixe
    // l'heure, sinon le test dépendrait de l'heure à laquelle il tourne.
    const midi = { elevation: 45, azimut: 180, jour: 1, crepuscule: 0 }
    useGameStore.setState({ ciel: midi })
    const renderer = await ReactThreeTestRenderer.create(<PlanBuilding />)
    const scene = renderer.scene.instance as THREE.Scene
    expect((scene.background as THREE.Color).getHexString()).toBe(new Color(CIEL).getHexString())

    await ReactThreeTestRenderer.act(async () => useGameStore.setState({ ciel: { ...midi, elevation: -30, jour: 0 } }))
    const nuit = scene.background as THREE.Color
    expect(nuit.getHexString()).not.toBe(new Color(CIEL).getHexString())
    expect(nuit.r + nuit.g + nuit.b).toBeGreaterThan(0.02)
  })
})
