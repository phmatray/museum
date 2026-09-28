/**
 * Le bâtiment du PLAN, tous ses niveaux extrudés.
 *
 * Tout est décidé dans `plan/mesh.ts` : ici on ne fait qu'instancier des boîtes.
 * Un `InstancedMesh` par sorte de boîte et par niveau, soit une poignée d'appels
 * de dessin par niveau, là où un maillage par mur en coûterait une centaine.
 */
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MUSEE } from '../plan/musee'
import { meshLevel, type Box } from '../plan/mesh'
import { creerVitrageGardeCorps } from '../builders/glazing'
import { matiereDeDalle, useMatiere } from './materials'
import { AMBIANCE, SOLEIL } from './lighting'
import { Ciel } from './Ciel'
import { PlanToiles } from './PlanToiles'
import { SculptureLayer } from './SculptureLayer'
import { sculpturePlacements } from '../plan/sculptures'
import { ParkLayer } from './ParkLayer'
import { parkPlacements } from '../plan/park'
import { PropsLayer } from './PropsLayer'
import { CartelLayer } from './CartelLayer'
import { NefLayer } from './NefLayer'
import { TableauDeparts } from './TableauDeparts'
import { EveilLayer } from './EveilLayer'
import { ConstellationLayer } from './ConstellationLayer'
import { FacadeLayer } from './FacadeLayer'
import { bandesDuSol, parementDuHall } from '../plan/parement'
import { plafonds } from '../plan/plafonds'
import { creerGranit, creerPierre } from './pierre'

const AUCUNE: Box[] = []
const SCULPTURES = sculpturePlacements(MUSEE)
const PARC = parkPlacements(MUSEE)
const BANDES = bandesDuSol(MUSEE)

export function PlanBuilding() {
  // La baie et les garde-corps sont vitrés, comme les garde-corps de l'ancien atrium.
  const verre = useMemo(() => creerVitrageGardeCorps(), [])
  useEffect(() => () => verre.dispose(), [verre])
  return (
    <>
      {/* Sans ce fond, le vide au-delà des ouvertures se rendait noir (#46). */}
      <Ciel />
      {/* Les salles ont un plafond (plan/plafonds.ts) ; le soleil sans ombre éclaire encore tout. */}
      <hemisphereLight args={[AMBIANCE.ciel, AMBIANCE.sol, AMBIANCE.intensite]} />
      <directionalLight color={SOLEIL.couleur} intensity={SOLEIL.intensite} position={[30, 40, 20]} />
      {MUSEE.levels.map((l) => <Niveau key={l.id} level={l.id} verre={verre} />)}
      <NefLayer />
      <TableauDeparts />
      <EveilLayer />
      <ConstellationLayer />
      {/* Le décor à part : un texte qui attend sa police ne doit pas suspendre les murs. */}
      <FacadeLayer />
      <Suspense fallback={null}>
        <SculptureLayer placements={SCULPTURES} />
        <ParkLayer placements={PARC} />
        <PropsLayer />
        <CartelLayer />
      </Suspense>
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
  const acier = useMatiere('metal')
  const parement = useMemo(() => parementDuHall(MUSEE, level), [level])
  const plafond = useMemo(() => plafonds(MUSEE, level), [level])
  const platrePlafond = useMatiere('platre')
  const lanterneau = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4f1ea', emissive: '#fff6e6', emissiveIntensity: 0.55, roughness: 0.9 }), [])
  useEffect(() => () => lanterneau.dispose(), [lanterneau])
  // Les balcons sont de pierre, comme la nef qu'ils bordent : pas de parquet vu d'en bas.
  const dalles = useMemo(() => {
    const balcons = (MUSEE.levels.find((l) => l.id === level)?.rooms ?? []).filter((r) => r.kind === 'balcony')
    const estBalcon = (b: Box) => balcons.some((r) => Math.abs(r.x + r.width / 2 - b.x) < 1e-6 && Math.abs(r.z + r.depth / 2 - b.z) < 1e-6)
    const toutes = de.get('slab') ?? AUCUNE
    return { balcons: toutes.filter(estBalcon), courantes: toutes.filter((b) => !estBalcon(b)) }
  }, [de, level])
  const taille = useMemo(() => creerPierre(), [])
  const granit = useMemo(() => creerGranit(), [])
  useEffect(() => () => {
    taille.map?.dispose()
    taille.dispose()
    granit.dispose()
  }, [taille, granit])

  return (
    <>
      <Boites boites={de.get('wall') ?? AUCUNE} material={platre} />
      <Boites boites={de.get('lintel') ?? AUCUNE} material={platre} />
      <Boites boites={dalles.courantes} material={dalle} />
      <Boites boites={dalles.balcons} material={taille} />
      <Boites boites={de.get('landing') ?? AUCUNE} material={pierre} />
      <Boites boites={de.get('step') ?? AUCUNE} material={pierre} />
      <Boites boites={de.get('railing') ?? AUCUNE} material={verre} />
      <Boites boites={de.get('handrail') ?? AUCUNE} material={acier} />
      <Boites boites={de.get('glass') ?? AUCUNE} material={verre} />
      <Boites boites={parement} material={taille} />
      <Boites boites={plafond.platre} material={platrePlafond} />
      <Boites boites={plafond.verre} material={lanterneau} />
      <Boites boites={plafond.resille} material={granit} />
      {level === 0 && <Boites boites={BANDES} material={granit} />}
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
    const cisaille = new THREE.Matrix4()
    boites.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d)
      // Un garde-corps rampant : y glisse avec x (ou z), les abouts restent d'aplomb.
      if (b.pente) m.premultiply(b.w > b.d ? cisaille.makeShear(b.pente, 0, 0, 0, 0, 0) : cisaille.makeShear(0, 0, 0, 0, 0, b.pente))
      mesh.setMatrixAt(i, m.setPosition(b.x, b.y, b.z))
    })
    mesh.instanceMatrix.needsUpdate = true
    // Sans recalcul, la sphère englobante est celle d'un cube unité à l'origine :
    // le niveau entier disparaîtrait dès que l'origine sort du champ.
    mesh.computeBoundingSphere()

    // La taille par instance, pour que `appliquerEchelleInstance` (materials.ts,
    // #38) corrige l'étirement des UV PBR. Dans le MÊME effet que les matrices
    // ci-dessus, jamais un second : tailles et matrices doivent rester en phase.
    // Pas de `needsUpdate` à poser : l'attribut est neuf à chaque passage de cet
    // effet, et three envoie toujours le tout premier buffer d'un attribut
    // jamais vu, `needsUpdate` ne servant qu'à REenvoyer un buffer déjà connu.
    const tailles = new Float32Array(boites.flatMap((b) => [b.w, b.h, b.d]))
    mesh.geometry.setAttribute('aTailleBoite', new THREE.InstancedBufferAttribute(tailles, 3))
  }, [boites])

  // `key` : le nombre d'instances est fixé à la construction, il faut remonter
  // le maillage s'il change. Le matériau passe en PROP, jamais dans `args` :
  // `useMatiere` en rend un nouveau quand les cartes PBR arrivent, et un `args`
  // qui change fait reconstruire l'objet par R3F — un maillage neuf aux matrices
  // identité, que l'effet ci-dessus ne repeuple pas. Tous les murs tombaient
  // alors en un cube à l'origine (#35).
  return <instancedMesh key={boites.length} ref={ref} args={[geometry, undefined, boites.length]} material={material} />
}
