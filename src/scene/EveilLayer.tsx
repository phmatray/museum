/**
 * Des toiles qui s'éveillent (`plan/eveil.ts`) :
 *
 * - la toile que le visiteur regarde reçoit la lumière chaude de SON projecteur
 *   sur rail (`ProjecteursLayer`), qui s'allume en fondu, et sa clé est publiée
 *   dans le magasin pour la carte à l'écran ;
 * - chaque toile porte un halo doré selon la fraîcheur de son dernier push.
 *
 * UN seul projecteur, toujours monté, qu'on déplace et qu'on éteint : ajouter
 * ou retirer une lumière recompilerait toutes les matières de la scène, et la
 * visite saccaderait à chaque toile.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { DEFAULT_ASPECT } from '../domain/hanging'
import { useAccrochage } from '../hooks/useAccrochage'
import { useCatalogue } from '../hooks/useCatalogue'
import { eclat, toileRegardee, type Placement } from '../plan/eveil'
import { MUSEE } from '../plan/musee'
import { projecteurs } from '../plan/projecteurs'
import { useGameStore } from '../stores/gameStore'

const INTENSITE = 9
/** Le fondu, en s⁻¹ : allumé en un tiers de seconde. */
const FONDU = 6
const OR = new THREE.Color('#ffb54a')
/** Le halo déborde du cadre de 35 cm de chaque côté. */
const DEBORD = 0.7

export function EveilLayer() {
  const accrochage = useAccrochage()
  const catalogue = useCatalogue()
  const visiteur = useGameStore((s) => s.visiteur)
  const placements = useMemo<Placement[]>(() => accrochage?.rooms.flatMap((r) => r.placements) ?? [], [accrochage])
  const regardee = useMemo(() => (visiteur ? toileRegardee(placements, visiteur) : null), [placements, visiteur])
  // La lumière part du projecteur de la toile, sur son rail (`ProjecteursLayer`).
  const sources = useMemo(() => new Map((accrochage ? projecteurs(MUSEE, accrochage) : []).map((p) => [p.key, p])), [accrochage])

  useEffect(() => {
    if (useGameStore.getState().toile !== (regardee?.key ?? null)) useGameStore.setState({ toile: regardee?.key ?? null })
  }, [regardee])

  const spot = useRef<THREE.SpotLight>(null)
  const cible = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    const s = spot.current
    const source = regardee && sources.get(regardee.key)
    if (s === null || !source) return
    s.position.set(...source.source)
    cible.position.set(...source.cible)
    cible.updateMatrixWorld()
  }, [regardee, cible, sources])

  useFrame((_, dt) => {
    const s = spot.current
    if (s === null) return
    const vise = regardee === null ? 0 : INTENSITE
    s.intensity += (vise - s.intensity) * (1 - Math.exp(-FONDU * dt))
  })

  return (
    <>
      <primitive object={cible} />
      <spotLight ref={spot} target={cible} intensity={0} color="#fff1d6" angle={0.42} penumbra={0.65} distance={7} decay={1.2} />
      {catalogue !== null && <Halos placements={placements} pushes={catalogue} />}
    </>
  )
}

function Halos({ placements, pushes }: { placements: Placement[]; pushes: ReadonlyMap<string, { pushedAt: string }> }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const ctx = c.getContext('2d')
    if (ctx === null) return null // jsdom
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])
  useEffect(() => () => texture?.dispose(), [texture])

  // Seules les toiles qui ont bougé dans l'année portent un halo.
  const allumees = useMemo(() => {
    const maintenant = new Date()
    return placements.flatMap((p) => {
      const push = pushes.get(p.key)?.pushedAt
      const e = push ? eclat(push, maintenant) : 0
      return e > 0.02 ? [{ p, e }] : []
    })
  }, [placements, pushes])

  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const c = new THREE.Color()
    allumees.forEach(({ p, e }, i) => {
      const [nx, nz] = p.normal
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, nz))
      m.compose(new THREE.Vector3(p.x + nx * 0.004, p.y, p.z + nz * 0.004), q, new THREE.Vector3(p.width + DEBORD, p.width / DEFAULT_ASPECT + DEBORD, 1))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.copy(OR).multiplyScalar(0.45 * e))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [allumees])

  if (texture === null || allumees.length === 0) return null
  return (
    <instancedMesh key={allumees.length} ref={ref} args={[undefined, undefined, allumees.length]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  )
}
