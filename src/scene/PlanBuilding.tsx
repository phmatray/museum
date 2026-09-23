/**
 * Le bâtiment du PLAN (`?batiment=plan`), tous ses niveaux extrudés.
 *
 * Tout est décidé dans `plan/mesh.ts` : ici on ne fait qu'instancier des boîtes.
 * Un `InstancedMesh` par sorte de boîte et par niveau, soit une poignée d'appels
 * de dessin par niveau, là où un maillage par mur en coûterait une centaine.
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MUSEE } from '../plan/musee'
import { meshLevel, type Box } from '../plan/mesh'
import { creerVitrageGardeCorps } from '../builders/glazing'
import { matiereDeDalle, useMatiere } from './materials'
import { AMBIANCE, SOLEIL } from './lighting'

// Un cube unité partagé, étiré par instance. Les UV s'étirent avec — assumé
// pour cette tranche : le plan cherche la volumétrie, pas encore la finition.
const CUBE = new THREE.BoxGeometry(1, 1, 1)

export function PlanBuilding() {
  return (
    <>
      {/* Pas de plafond à l'étage : le soleil tombe droit dans les salles. */}
      <hemisphereLight args={[AMBIANCE.ciel, AMBIANCE.sol, AMBIANCE.intensite]} />
      <directionalLight color={SOLEIL.couleur} intensity={SOLEIL.intensite} position={[30, 40, 20]} />
      {MUSEE.levels.map((l) => <Niveau key={l.id} level={l.id} />)}
    </>
  )
}

function Niveau({ level }: { level: number }) {
  const boites = useMemo(() => meshLevel(MUSEE, level), [level])
  const platre = useMatiere('platre')
  const dalle = useMatiere(matiereDeDalle(level))
  const pierre = useMatiere('marbre')
  // La baie et les garde-corps sont vitrés, comme les garde-corps de l'ancien atrium.
  const verre = useMemo(() => creerVitrageGardeCorps(), [])
  useEffect(() => () => verre.dispose(), [verre])
  const de = (kind: Box['kind']) => boites.filter((b) => b.kind === kind)

  return (
    <>
      <Boites boites={de('wall')} material={platre} />
      <Boites boites={de('lintel')} material={platre} />
      <Boites boites={de('slab')} material={dalle} />
      <Boites boites={de('landing')} material={pierre} />
      <Boites boites={de('step')} material={pierre} />
      <Boites boites={de('railing')} material={verre} />
      <Boites boites={de('glass')} material={verre} />
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
