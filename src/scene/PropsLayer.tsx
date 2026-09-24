/**
 * Les props du plan à l'écran : une plante dans chaque angle des salles.
 *
 * `plan/props.ts` a décidé où, d'après le thème de chaque salle lu dans
 * `accrochage.json`. Ici : un lot d'instances par prop et par matériau.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import { useAccrochage } from '../hooks/useAccrochage'
import { MUSEE } from '../plan/musee'
import { propPlacements, type PropId, type PropPlacement } from '../plan/props'
import { propAssetsResource, type PropAssets, type PropPiece } from './propAssets'

const SANS_THEME: { id: string; name: string }[] = []

export function PropsLayer() {
  const accrochage = useAccrochage()
  const assets = usePropAssets()
  const parProp = useMemo(() => {
    const par = new Map<PropId, PropPlacement[]>()
    for (const p of propPlacements(MUSEE, accrochage?.rooms ?? SANS_THEME)) par.set(p.id, [...(par.get(p.id) ?? []), p])
    return par
  }, [accrochage])

  if (assets === null) return null
  return (
    <group name="props">
      {[...parProp].map(([id, liste]) =>
        (assets.get(id) ?? []).map((lot, i) => <Instances key={`${id}:${i}`} piece={lot} props={liste} />))}
    </group>
  )
}

function Instances({ piece, props }: { piece: PropPiece; props: PropPlacement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const haut = new THREE.Vector3(0, 1, 0)
    props.forEach((p, i) =>
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(haut, p.rotation), new THREE.Vector3().setScalar(p.scale))))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [props])
  return <instancedMesh key={props.length} ref={ref} args={[piece.geometry, undefined, props.length]} material={piece.material} />
}

/** Sans suspendre : le bâtiment d'abord, les plantes ensuite. */
function usePropAssets(): PropAssets | null {
  const [assets, setAssets] = useState<PropAssets | null>(null)
  useEffect(() => {
    let vivant = true
    void propAssetsResource().then((a) => vivant && setAssets(a))
    return () => {
      vivant = false
    }
  }, [])
  return assets
}
