/**
 * Le bâtiment du PLAN, tous ses niveaux extrudés.
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
import { PlanToiles } from './PlanToiles'

const AUCUNE: Box[] = []

export function PlanBuilding() {
  // La baie et les garde-corps sont vitrés, comme les garde-corps de l'ancien atrium.
  const verre = useMemo(() => creerVitrageGardeCorps(), [])
  useEffect(() => () => verre.dispose(), [verre])
  return (
    <>
      {/* Pas de plafond à l'étage : le soleil tombe droit dans les salles. */}
      <hemisphereLight args={[AMBIANCE.ciel, AMBIANCE.sol, AMBIANCE.intensite]} />
      <directionalLight color={SOLEIL.couleur} intensity={SOLEIL.intensite} position={[30, 40, 20]} />
      {MUSEE.levels.map((l) => <Niveau key={l.id} level={l.id} verre={verre} />)}
    </>
  )
}

function Niveau({ level, verre }: { level: number; verre: THREE.Material }) {
  // Une liste par sorte, calculée une fois : une nouvelle liste à chaque rendu
  // referait l'envoi de toutes les matrices d'instance.
  const de = useMemo(() => {
    const par = new Map<Box['kind'], Box[]>()
    for (const b of meshLevel(MUSEE, level)) {
      const liste = par.get(b.kind)
      if (liste) liste.push(b)
      else par.set(b.kind, [b])
    }
    return par
  }, [level])
  const platre = useMatiere('platre')
  const dalle = useMatiere(matiereDeDalle(level))
  const pierre = useMatiere('marbre')

  return (
    <>
      <Boites boites={de.get('wall') ?? AUCUNE} material={platre} />
      <Boites boites={de.get('lintel') ?? AUCUNE} material={platre} />
      <Boites boites={de.get('slab') ?? AUCUNE} material={dalle} />
      <Boites boites={de.get('landing') ?? AUCUNE} material={pierre} />
      <Boites boites={de.get('step') ?? AUCUNE} material={pierre} />
      <Boites boites={de.get('railing') ?? AUCUNE} material={verre} />
      <Boites boites={de.get('glass') ?? AUCUNE} material={verre} />
      <PlanToiles level={level} />
    </>
  )
}

export function Boites({ boites, material }: { boites: Box[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  // Une géométrie privée à ce montage, plus le cube unité partagé d'avant : le
  // partage empêchait de poser une taille par instance (ci-dessous), puisque
  // c'est la géométrie qui porte l'attribut. Créée une fois — jamais recréée
  // quand `boites` change, seul son ATTRIBUT l'est, dans l'effet ci-dessous —
  // pour ne pas rejouer le cas #35 sur la géométrie cette fois.
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    boites.forEach((b, i) => mesh.setMatrixAt(i, m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z)))
    mesh.instanceMatrix.needsUpdate = true
    // Sans recalcul, la sphère englobante est celle d'un cube unité à l'origine :
    // le niveau entier disparaîtrait dès que l'origine sort du champ.
    mesh.computeBoundingSphere()

    // La taille par instance, pour que `appliquerEchelleInstance` (materials.ts,
    // #38) corrige l'étirement des UV PBR. Dans le MÊME effet que les matrices
    // ci-dessus, jamais un second : tailles et matrices doivent rester en phase.
    const tailles = new Float32Array(boites.flatMap((b) => [b.w, b.h, b.d]))
    mesh.geometry.setAttribute('aTailleBoite', new THREE.InstancedBufferAttribute(tailles, 3))
    mesh.geometry.getAttribute('aTailleBoite').needsUpdate = true
  }, [boites])

  // `key` : le nombre d'instances est fixé à la construction, il faut remonter
  // le maillage s'il change. Le matériau passe en PROP, jamais dans `args` :
  // `useMatiere` en rend un nouveau quand les cartes PBR arrivent, et un `args`
  // qui change fait reconstruire l'objet par R3F — un maillage neuf aux matrices
  // identité, que l'effet ci-dessus ne repeuple pas. Tous les murs tombaient
  // alors en un cube à l'origine (#35).
  return <instancedMesh key={boites.length} ref={ref} args={[geometry, undefined, boites.length]} material={material} />
}
