/**
 * L'éclairage artificiel (`plan/eclairage.ts`) : allume les lampadaires du parc
 * au crépuscule, tient allumés les spots sous les balcons, et pose ces spots —
 * des disques lumineux encastrés dans la sous-face des balcons.
 *
 * Aucune lumière de three : la lumière qu'ils versent est calculée par fragment
 * dans `lueurs.ts`, d'après `LAMPES`. Le globe des lampadaires, lui, est une
 * matière de `MobilierLayer`, qui lit la même force.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { PROJECTEURS_FACADE, SPOTS_BALCON } from '../plan/eclairage'
import { solDuParc } from '../plan/relief'
import { useGameStore } from '../stores/gameStore'
import { LAMPES } from './lueurs'

/** La force des lampadaires la nuit, et celle des spots (réglées à l'écran, contre la lueur de la nef). */
const FORCE = { lampadaires: 5, spots: 10 }

/** De 0 en plein jour à 1 la nuit : la même rampe que le foyer de la lanterne du jardin (`ParkLayer`). */
const nuit = (jour: number) => 1 - THREE.MathUtils.smoothstep(jour, 0.15, 0.6)

export function EclairageLayer() {
  useFrame(() => {
    const n = nuit(useGameStore.getState().ciel.jour)
    LAMPES.x = FORCE.lampadaires * n
    // Les spots brûlent toute la journée ; la nuit, sans le ciel, ils portent davantage.
    LAMPES.y = FORCE.spots * (0.6 + 0.4 * n)
  })
  return (
    <>
      {/* Les spots : 11 cm, à 5 mm sous la dalle des balcons, tournés vers le bas. */}
      <Disques points={SPOTS} rayon={0.055} bas />
      {/* Les projecteurs de façade : une grille de 16 cm au ras du dallage, allumée la nuit seulement. */}
      <Disques points={PROJECTEURS} rayon={0.08} nocturne />
    </>
  )
}

const SPOTS = SPOTS_BALCON.map(([x, y, z]): [number, number, number] => [x, y + 0.015, z])
const PROJECTEURS = PROJECTEURS_FACADE.map(([x, , z]): [number, number, number] => [x, solDuParc(x, z) + 0.006, z])
const BLANC_CHAUD = new THREE.Color('#ffd7a8').multiplyScalar(3)

/** Des disques lumineux, un lot d'instances : blanc chaud assez fort pour le bloom. */
function Disques({ points, rayon, bas = false, nocturne = false }: { points: [number, number, number][]; rayon: number; bas?: boolean; nocturne?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometrie = useMemo(() => new THREE.CircleGeometry(rayon, 16).rotateX(bas ? Math.PI / 2 : -Math.PI / 2), [rayon, bas])
  const materiau = useMemo(() => new THREE.MeshBasicMaterial({ color: BLANC_CHAUD.clone() }), [])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    points.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, y, z)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [points])
  useEffect(() => () => {
    geometrie.dispose()
    materiau.dispose()
  }, [geometrie, materiau])
  useFrame(() => {
    if (!nocturne) return
    // Éteint, le verre d'un projecteur est gris sombre, pas noir.
    materiau.color.copy(BLANC_CHAUD).multiplyScalar(Math.min(1, LAMPES.x / FORCE.lampadaires)).addScalar(0.04)
  })
  return <instancedMesh ref={ref} args={[geometrie, undefined, points.length]} material={materiau} />
}
