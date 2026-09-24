/**
 * Le parc à l'écran : la pelouse, le parvis et les allées, les arbres.
 *
 * `plan/park.ts` a décidé où. Ici : deux maillages de sol et un lot
 * d'instances par essence et par matériau.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Parc, PlantPlacement, EspeceParc } from '../plan/park'
import type { Rect } from '../plan/types'
import { REGLAGE_MATIERE, repetitionMetrique, useMatiere } from './materials'
import { parkAssetsResource, type ParkAssets, type ParkPiece } from './parkAssets'

/** Un sol d'épaisseur nulle montrerait sa tranche depuis l'horizon. */
const EPAISSEUR_SOL = 0.4
/** Assez pour ne pas scintiller avec la pelouse. */
const RELIEF_ALLEE = 0.015

export function ParkLayer({ placements }: { placements: Parc }) {
  const assets = useParkAssets()
  const herbe = useMatiere('herbe', repetitionMetrique(REGLAGE_MATIERE.herbe.motif))
  const gravier = useMatiere('gravier', repetitionMetrique(REGLAGE_MATIERE.gravier.motif))

  const sol = useMemo(() => dalles(placements.sol.map((r) => pave(r, -EPAISSEUR_SOL, 0))), [placements])
  const allees = useMemo(() => dalles([
    ...placements.dalles.map((r) => pave(r, 0, RELIEF_ALLEE)),
    ...placements.allees.map((a) => {
      const [dx, dz] = [a.b.x - a.a.x, a.b.z - a.a.z]
      // Rallongée d'une largeur : deux segments d'équerre ne laissent pas de coin manquant.
      const g = new THREE.BoxGeometry(Math.hypot(dx, dz) + a.largeur, RELIEF_ALLEE, a.largeur)
      g.rotateY(Math.atan2(-dz, dx))
      g.translate((a.a.x + a.b.x) / 2, RELIEF_ALLEE / 2, (a.a.z + a.b.z) / 2)
      return g
    }),
  ]), [placements])
  useEffect(() => () => {
    sol.dispose()
    allees.dispose()
  }, [sol, allees])

  const parEspece = useMemo(() => {
    const par = new Map<EspeceParc, PlantPlacement[]>()
    for (const p of placements.plantations) par.set(p.espece, [...(par.get(p.espece) ?? []), p])
    return par
  }, [placements])

  return (
    <group name="parc">
      <mesh geometry={sol} material={herbe} />
      <mesh geometry={allees} material={gravier} />
      {assets !== null &&
        [...parEspece].map(([espece, sujets]) =>
          (assets.get(espece) ?? []).map((lot, i) => <Instances key={`${espece}:${i}`} piece={lot} sujets={sujets} />))}
    </group>
  )
}

function pave(r: Rect, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(r.width, y1 - y0, r.depth)
  g.translate(r.x + r.width / 2, (y0 + y1) / 2, r.z + r.depth / 2)
  return g
}

/**
 * Fusionne des boîtes en un seul maillage, UV en MÈTRES lues sur le plan (x, z) :
 * `repetitionMetrique` donne alors la même échelle d'herbe sur chaque bande.
 */
function dalles(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const g of parts) {
    const p = g.getAttribute('position')
    const uv = new Float32Array(p.count * 2)
    for (let i = 0; i < p.count; i++) [uv[2 * i], uv[2 * i + 1]] = [p.getX(i), p.getZ(i)]
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }
  const fusion = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return fusion ?? new THREE.BufferGeometry()
}

function Instances({ piece, sujets }: { piece: ParkPiece; sujets: PlantPlacement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const haut = new THREE.Vector3(0, 1, 0)
    sujets.forEach((s, i) =>
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0, s.z), q.setFromAxisAngle(haut, s.rotation), new THREE.Vector3().setScalar(s.scale))))
    mesh.instanceMatrix.needsUpdate = true
    // Sinon la sphère englobante est celle d'un arbre à l'origine.
    mesh.computeBoundingSphere()
  }, [sujets])
  return <instancedMesh key={sujets.length} ref={ref} args={[piece.geometry, undefined, sujets.length]} material={piece.material} />
}

/** Sans suspendre : le bâtiment d'abord, les arbres ensuite. */
function useParkAssets(): ParkAssets | null {
  const [assets, setAssets] = useState<ParkAssets | null>(null)
  useEffect(() => {
    let vivant = true
    void parkAssetsResource().then((a) => vivant && setAssets(a))
    return () => {
      vivant = false
    }
  }, [])
  return assets
}
