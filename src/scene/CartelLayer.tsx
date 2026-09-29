/**
 * Les cartels du plan : un par toile de `accrochage.json`, le texte tiré de
 * `catalogue.json`.
 *
 * Seuls les cartels proches du visiteur sont montés : un cartel est un bloc de
 * texte, donc un appel de dessin, et 116 d'un coup coûteraient plus que tout le
 * bâtiment. Au-delà de six mètres, un texte de 2 cm est illisible de toute façon.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

import { useAccrochage } from '../hooks/useAccrochage'
import { useCatalogue } from '../hooks/useCatalogue'
import { cartelPlacements, cartelTexte, type CartelPlacement } from '../plan/cartels'
import { Cartel } from './Cartel'
import { PLAQUE, PLAQUE_PANNEAU } from './cartelStyle'
import { CARTEL_LARGEUR } from '../plan/cartels'

const PORTEE = 6
/**
 * On ne retire un texte qu'au-delà de `SORTIE` : entre les deux seuils, un
 * cartel garde son état. Sans cette hystérésis, un visiteur qui piétinait à
 * six mètres voyait les cartels apparaître et disparaître (signalé par Philippe).
 */
const SORTIE = 8
/**
 * Recalcul du voisinage quatre fois par seconde. Le cas le plus rapide est la
 * hâte (`VITESSE_HATE` = 6 m/s) : entre deux recalculs le visiteur parcourt au
 * plus 6 * 0,25 = 1,5 m, bien en deçà de `PORTEE` (6 m).
 */
const PERIODE = 0.25

export function CartelLayer() {
  const accrochage = useAccrochage()
  const oeuvres = useCatalogue()
  const placements = useMemo(() => (accrochage ? cartelPlacements(accrochage) : []), [accrochage])
  const [proches, setProches] = useState<CartelPlacement[]>([])
  const attente = useRef(0)

  useFrame(({ camera }, delta) => {
    attente.current -= delta
    if (attente.current > 0) return
    attente.current = PERIODE
    const { x, y, z } = camera.position
    const deja = new Set(proches)
    const vus = placements.filter((p) => Math.hypot(p.x - x, p.y - y, p.z - z) < (deja.has(p) ? SORTIE : PORTEE))
    // Même liste, même état : pas de rendu React quatre fois par seconde pour rien.
    if (vus.length !== proches.length || vus.some((p, i) => p !== proches[i])) setProches(vus)
  })

  if (oeuvres === null) return null
  return (
    <group name="cartels">
      {/* Les plaques, toutes, toujours : un seul lot, et plus rien ne surgit sur le mur. */}
      <Plaques placements={placements} />
      {proches.map((p) => {
        const a = oeuvres.get(p.key)
        return a === undefined ? null : <Cartel key={p.key} placement={p} texte={cartelTexte(a)} />
      })}
    </group>
  )
}

function Plaques({ placements }: { placements: CartelPlacement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  // Blanc : la teinte de chaque plaque passe par la couleur d'instance.
  const materiau = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), [])
  const geometrie = useMemo(() => new THREE.BoxGeometry(CARTEL_LARGEUR, PLAQUE.hauteur, PLAQUE.epaisseur), [])
  useEffect(() => () => {
    materiau.dispose()
    geometrie.dispose()
  }, [materiau, geometrie])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const [m, q] = [new THREE.Matrix4(), new THREE.Quaternion()]
    const [haut, un] = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1, 1)]
    const [claire, sombre] = [new THREE.Color(PLAQUE.couleur), new THREE.Color(PLAQUE_PANNEAU.couleur)]
    placements.forEach((p, i) => {
      q.setFromAxisAngle(haut, p.rotation)
      // Le centre de la plaque : décollée d'une demi-épaisseur, comme dans `Cartel`.
      const avant = new THREE.Vector3(0, 0, PLAQUE.epaisseur / 2).applyQuaternion(q)
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z).add(avant), q, un))
      mesh.setColorAt(i, p.surPanneau ? sombre : claire)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [placements])
  return <instancedMesh key={placements.length} ref={ref} args={[geometrie, undefined, placements.length]} material={materiau} />
}
