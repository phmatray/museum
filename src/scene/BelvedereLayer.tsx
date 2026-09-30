/**
 * Le pavillon du BELVÉDÈRE, la palissade du roji, sa porte et la lanterne de
 * la terrasse (`assets/architecture/belvedere.glb`,
 * `tools/blender/build-belvedere.py`), modelés dans le repère du plan : posés
 * tels quels. La terrasse de pierre est dans le lot de pierre du parc
 * (`ParkLayer`, `plan/belvedere.ts`) ; les pas japonais de la rive sud, ici, en
 * un seul lot d'instances.
 *
 * Les lanternes s'allument au crépuscule : de l'autre bout de l'étang, la
 * nuit, c'est elles qu'on voit, et elles appellent.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { PAS_DE_LA_RIVE } from '../plan/belvedere'
import { hauteurDuParc } from '../plan/relief'
import { PARC } from '../plan/visibilite'
import { useGameStore } from '../stores/gameStore'
import { intemperer } from './intemperies'
import { REGLAGE_MATIERE, repetitionMetrique, useMatiere } from './materials'
import { chargerGlb } from './propAssets'

/** L'éclat des lanternes, la nuit ; éteintes en plein jour. */
const ECLAT = 3.2

export function BelvedereLayer() {
  const [modele, setModele] = useState<{ scene: THREE.Object3D; lueur: THREE.MeshStandardMaterial | null } | null>(null)
  useEffect(() => {
    let vivant = true
    chargerGlb(`${import.meta.env.BASE_URL}assets/architecture/belvedere.glb`)
      .then(({ scene }) => {
        let lueur: THREE.MeshStandardMaterial | null = null
        scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          const m = o.material as THREE.MeshStandardMaterial
          if (m.name === 'Belvedere_Lueur') lueur = m
          // Mouillés sous l'averse, blancs sous la neige, comme le pont du jardin.
          else intemperer(m)
        })
        if (vivant) setModele({ scene, lueur })
      })
      .catch((erreur: unknown) => console.error('belvédère indisponible', erreur))
    return () => {
      vivant = false
    }
  }, [])
  useFrame(() => {
    if (!modele?.lueur) return
    const jour = useGameStore.getState().ciel.jour
    /* eslint-disable react-hooks/immutability */
    modele.lueur.emissiveIntensity = ECLAT * (1 - THREE.MathUtils.smoothstep(jour, 0.15, 0.6))
    /* eslint-enable */
  })
  return (
    <>
      {modele && <primitive object={modele.scene} />}
      <PasJaponais />
    </>
  )
}

/**
 * Les pas japonais de la rive sud : une dalle de granit plate et irrégulière,
 * neuf pans au contour cassé, affleurant de 5 cm. Un appel de dessin.
 */
function PasJaponais() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometrie = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1.06, 0.1, 9, 1)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i))
      const k = 0.82 + 0.18 * Math.abs(Math.sin(a * 2.3 + 1.1) * Math.cos(a * 3.7))
      p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k)
    }
    g.computeVertexNormals()
    return g
  }, [])
  useEffect(() => () => geometrie.dispose(), [geometrie])
  const pierre = useMatiere('roche', repetitionMetrique(REGLAGE_MATIERE.roche.motif), { teinte: '#b9bbb6' })
  useMemo(() => intemperer(pierre), [pierre])
  useEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const haut = new THREE.Vector3(0, 1, 0)
    PAS_DE_LA_RIVE.forEach((s, i) => {
      const e = new THREE.Vector3(s.rayon * (0.9 + 0.2 * Math.sin(s.lacet * 3)), 1, s.rayon)
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, hauteurDuParc(s.x, s.z) + 0.02, s.z), q.setFromAxisAngle(haut, s.lacet), e))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [])
  return <instancedMesh ref={ref} args={[geometrie, undefined, PAS_DE_LA_RIVE.length]} material={pierre} userData={{ zone: PARC }} />
}
