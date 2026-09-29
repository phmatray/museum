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
import { CARTEL_LARGEUR, CARTEL_QR } from '../plan/cartels'
import { adresseQr, atlasQr } from '../domain/qr'
import type { Artwork } from '../domain/types'

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
      <QrCodes placements={placements} oeuvres={oeuvres} />
      {proches.map((p) => {
        const a = oeuvres.get(p.key)
        return a === undefined ? null : <Cartel key={p.key} placement={p} texte={cartelTexte(a)} />
      })}
    </group>
  )
}

/**
 * Les plaques des cartels puis celles des QR codes (instances `n..2n-1`) : un
 * seul lot, une boîte unité mise à l'échelle par instance.
 */
function Plaques({ placements }: { placements: CartelPlacement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  // Blanc : la teinte de chaque plaque passe par la couleur d'instance.
  const materiau = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9 }), [])
  const geometrie = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  useEffect(() => () => {
    materiau.dispose()
    geometrie.dispose()
  }, [materiau, geometrie])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const [m, q] = [new THREE.Matrix4(), new THREE.Quaternion()]
    const haut = new THREE.Vector3(0, 1, 0)
    const cartel = new THREE.Vector3(CARTEL_LARGEUR, PLAQUE.hauteur, PLAQUE.epaisseur)
    const carre = new THREE.Vector3(CARTEL_QR.plaque, CARTEL_QR.plaque, PLAQUE.epaisseur)
    const [claire, sombre] = [new THREE.Color(PLAQUE.couleur), new THREE.Color(PLAQUE_PANNEAU.couleur)]
    const n = placements.length
    placements.forEach((p, i) => {
      q.setFromAxisAngle(haut, p.rotation)
      const origine = new THREE.Vector3(p.x, p.y, p.z)
      // Le centre de la plaque : décollée d'une demi-épaisseur, comme dans `Cartel`.
      const avant = new THREE.Vector3(0, 0, PLAQUE.epaisseur / 2).applyQuaternion(q)
      const qr = new THREE.Vector3(CARTEL_QR.x, CARTEL_QR.y, PLAQUE.epaisseur / 2).applyQuaternion(q)
      mesh.setMatrixAt(i, m.compose(origine.clone().add(avant), q, cartel))
      mesh.setMatrixAt(n + i, m.compose(origine.add(qr), q, carre))
      mesh.setColorAt(i, p.surPanneau ? sombre : claire)
      mesh.setColorAt(n + i, p.surPanneau ? sombre : claire)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [placements])
  return <instancedMesh key={placements.length} ref={ref} args={[geometrie, undefined, 2 * placements.length]} material={materiau} />
}

/**
 * Les QR codes de tous les cartels : un atlas (`domain/qr.ts`), un lot
 * d'instances, un appel de dessin. L'instance `i` lit la case `i` de l'atlas
 * par un attribut d'instance, que le tri des salles compacte avec la matrice.
 *
 * Sans lumière (`MeshBasicMaterial`) : sous l'éclairage chaud du soir ou la
 * nuit, un code éclairé perdrait son contraste et ne se scannerait plus.
 */
function QrCodes({ placements, oeuvres }: { placements: CartelPlacement[]; oeuvres: Map<string, Artwork> }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const avecCode = useMemo(() => placements.filter((p) => oeuvres.has(p.key)), [placements, oeuvres])
  const [geometrie, materiau] = useMemo(() => {
    const cles = [...oeuvres.keys()]
    const atlas = atlasQr(avecCode.map((p) => adresseQr(oeuvres.get(p.key)!, cles)))
    const g = new THREE.PlaneGeometry(CARTEL_QR.cote, CARTEL_QR.cote)
    // (u, v, côté) du code de chaque instance : chaque code remplit la plaque, quelle que soit sa version.
    const cases = atlas.uv.flatMap(([u, v], i) => [u, v, atlas.tailles[i] / atlas.cote])
    g.setAttribute('aCase', new THREE.InstancedBufferAttribute(new Float32Array(cases), 3))
    const t = new THREE.DataTexture(atlas.pixels, atlas.cote, atlas.cote)
    t.colorSpace = THREE.SRGBColorSpace
    // Net de près (un module = un texel), gris uni de loin plutôt qu'un moiré.
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.anisotropy = 4
    t.needsUpdate = true
    // Ni tone mapping : un blanc pur reste blanc, un noir reste noir.
    const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aCase;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * aCase.z + aCase.xy;')
    }
    m.customProgramCacheKey = () => 'cartel-qr'
    return [g, m]
  }, [avecCode, oeuvres])
  useEffect(() => () => {
    geometrie.dispose()
    materiau.map?.dispose()
    materiau.dispose()
  }, [geometrie, materiau])
  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const [m, q] = [new THREE.Matrix4(), new THREE.Quaternion()]
    const [haut, un] = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1, 1)]
    avecCode.forEach((p, i) => {
      q.setFromAxisAngle(haut, p.rotation)
      // Sur la face de sa plaque, un demi-millimètre devant.
      const decale = new THREE.Vector3(CARTEL_QR.x, CARTEL_QR.y, PLAQUE.epaisseur + 0.0005).applyQuaternion(q)
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y, p.z).add(decale), q, un))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [avecCode, geometrie])
  return <instancedMesh key={geometrie.uuid} ref={ref} args={[geometrie, undefined, avecCode.length]} material={materiau} />
}
