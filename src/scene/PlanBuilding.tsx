/**
 * Le bâtiment du PLAN (`?batiment=plan`), un niveau extrudé.
 *
 * Tout est décidé dans `plan/mesh.ts` : ici on ne fait qu'instancier des boîtes.
 * Un `InstancedMesh` par sorte de boîte, soit trois appels de dessin pour tout
 * un niveau, là où un maillage par mur en coûterait une centaine.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MUSEE } from '../plan/musee'
import { meshLevel, type Box } from '../plan/mesh'
import { matiereDeDalle, useMatiere } from './materials'
import { AMBIANCE, SOLEIL } from './lighting'
import { PlanToiles } from './PlanToiles'

// Un cube unité partagé, étiré par instance. Les UV s'étirent avec — assumé
// pour cette tranche : le plan cherche la volumétrie, pas encore la finition.
const CUBE = new THREE.BoxGeometry(1, 1, 1)

export function PlanBuilding({ level }: { level: number }) {
  const boites = useMemo(() => meshLevel(MUSEE, level), [level])
  const platre = useMatiere('platre')
  const dalle = useMatiere(matiereDeDalle(level))

  return (
    <>
      {/* Pas de plafond encore : le soleil tombe droit dans les salles. */}
      <hemisphereLight args={[AMBIANCE.ciel, AMBIANCE.sol, AMBIANCE.intensite]} />
      <directionalLight color={SOLEIL.couleur} intensity={SOLEIL.intensite} position={[30, 40, 20]} />
      <Boites boites={boites.filter((b) => b.kind === 'wall')} material={platre} />
      <Boites boites={boites.filter((b) => b.kind === 'lintel')} material={platre} />
      <Boites boites={boites.filter((b) => b.kind === 'slab')} material={dalle} />
      <PlanToiles level={level} />
    </>
  )
}

function Boites({ boites, material }: { boites: Box[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    boites.forEach((b, i) => mesh.setMatrixAt(i, m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z)))
    mesh.instanceMatrix.needsUpdate = true
    // Sans recalcul, la sphère englobante est celle d'un cube unité à l'origine :
    // le niveau entier disparaîtrait dès que l'origine sort du champ.
    mesh.computeBoundingSphere()
  }, [boites])

  // `key` : le nombre d'instances est fixé à la construction, il faut remonter
  // le maillage s'il change.
  return <instancedMesh key={boites.length} ref={ref} args={[CUBE, material, boites.length]} />
}
