/**
 * La constellation de la verrière (`plan/constellation.ts`), qui s'allume la
 * nuit (`gameStore.ciel`) : les étoiles en un lot d'instances qui scintillent,
 * un halo additif autour de chacune, les filets d'or en un seul trait, et le nom
 * de chaque salle sous sa constellation. Le jour, rien : le verre laiteux les
 * noyait, et c'est la nuit qu'un ciel s'illumine.
 */
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { useAccrochage } from '../hooks/useAccrochage'
import { useCatalogue } from '../hooks/useCatalogue'
import { constellations, versLAxe, type Constellation } from '../plan/constellation'
import { useGameStore } from '../stores/gameStore'
import { CARTEL_FONT } from './cartelStyle'

const OR = '#e7b24c'
const ETOILE = '#fff3d2'

export function ConstellationLayer() {
  const accrochage = useAccrochage()
  const catalogue = useCatalogue()
  const ciel = useMemo(() => {
    if (accrochage === null) return []
    const etoiles = new Map([...(catalogue ?? new Map())].map(([k, a]) => [k, a.stars as number]))
    return constellations(accrochage, etoiles)
  }, [accrochage, catalogue])
  const nuit = 1 - useGameStore((s) => s.ciel.jour)
  if (ciel.length === 0 || nuit < 0.02) return null
  return (
    <group name="constellation">
      <Etoiles ciel={ciel} />
      <Halos ciel={ciel} nuit={nuit} />
      <Filets ciel={ciel} nuit={nuit} />
      <Suspense fallback={null}>
        {ciel.map((c) => <Etiquette key={c.salle} c={c} nuit={nuit} />)}
      </Suspense>
    </group>
  )
}

function Etoiles({ ciel }: { ciel: Constellation[] }) {
  const etoiles = useMemo(() => ciel.flatMap((c) => c.etoiles), [ciel])
  const ref = useRef<THREE.InstancedMesh>(null)
  const m = useMemo(() => new THREE.Matrix4(), [])
  const phases = useMemo(() => etoiles.map((_, i) => (i * 2.399) % (2 * Math.PI)), [etoiles])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (mesh === null) return
    const t = clock.getElapsedTime()
    // Un scintillement lent et décalé : ±15 %, jamais deux étoiles en phase.
    etoiles.forEach((e, i) => {
      const s = e.taille * (1 + 0.15 * Math.sin(t * 1.3 + phases[i]))
      mesh.setMatrixAt(i, m.makeScale(s, s, s).setPosition(e.x, e.y, e.z))
    })
    mesh.instanceMatrix.needsUpdate = true
  })
  useLayoutEffect(() => ref.current?.computeBoundingSphere(), [etoiles])
  return (
    <instancedMesh key={etoiles.length} ref={ref} args={[undefined, undefined, etoiles.length]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color={ETOILE} toneMapped={false} />
    </instancedMesh>
  )
}

/** Le rayonnement autour de chaque étoile : un point additif, qui ne luit que sur un fond sombre. */
function Halos({ ciel, nuit }: { ciel: Constellation[]; nuit: number }) {
  const { geometrie, texture } = useMemo(() => {
    const pts = ciel.flatMap((c) => c.etoiles.map((e) => new THREE.Vector3(e.x, e.y, e.z)))
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')
    let texture: THREE.Texture | null = null
    if (ctx !== null) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.25, 'rgba(255,255,255,0.35)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 64)
      texture = new THREE.CanvasTexture(c)
    }
    return { geometrie: new THREE.BufferGeometry().setFromPoints(pts), texture }
  }, [ciel])
  useEffect(() => () => { geometrie.dispose(); texture?.dispose() }, [geometrie, texture])
  if (texture === null) return null
  return (
    <points geometry={geometrie}>
      <pointsMaterial map={texture} size={1.4} color="#ffd98a" transparent opacity={nuit} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </points>
  )
}

function Filets({ ciel, nuit }: { ciel: Constellation[]; nuit: number }) {
  const geometrie = useMemo(() => {
    const pts = ciel.flatMap((c) => c.filets.flatMap(([a, b]) => [c.etoiles[a], c.etoiles[b]]).map((e) => new THREE.Vector3(e.x, e.y, e.z)))
    return new THREE.BufferGeometry().setFromPoints(pts)
  }, [ciel])
  useEffect(() => () => geometrie.dispose(), [geometrie])
  return (
    <lineSegments geometry={geometrie}>
      <lineBasicMaterial color={OR} transparent opacity={0.7 * nuit} toneMapped={false} />
    </lineSegments>
  )
}

/**
 * Le nom de la salle, plaqué sous le verre et tourné vers l'axe. Le haut des
 * lettres vers le SUD : c'est ce qui les rend lisibles au visiteur qui lève la
 * tête en regardant vers l'horloge (vers le nord, elles se lisaient en miroir).
 */
function Etiquette({ c, nuit }: { c: Constellation; nuit: number }) {
  const ref = useRef<THREE.Group>(null)
  useLayoutEffect(() => {
    const g = ref.current
    if (g === null) return
    g.up.set(0, 0, 1)
    g.lookAt(...versLAxe(c.etiquette.z))
  }, [c])
  return (
    <group ref={ref} position={[c.etiquette.x, c.etiquette.y, c.etiquette.z]}>
      <Text font={CARTEL_FONT} fontSize={0.36} letterSpacing={0.08} lineHeight={1.1} maxWidth={3.4} textAlign="center" color={OR} fillOpacity={nuit} anchorX="center" anchorY="middle">
        {c.nom.toUpperCase()}
      </Text>
    </group>
  )
}
