/**
 * Le parc : le sol, les allées, les arbres.
 *
 * `domain/park.ts` a décidé OÙ. Ce composant dessine, et rien de plus.
 *
 * ── Ce que le parc apporte, et qui n'est pas décoratif ──
 *
 * Le musée n'avait AUCUN sol : il flottait sur un fond de ciel, ce qui le
 * faisait lire comme une maquette posée sur une table. Un bâtiment n'a d'échelle
 * que par ce qui l'entoure — un arbre de huit mètres dit la hauteur d'un étage
 * mieux qu'aucune texture, et un sentier dit d'où l'on vient.
 *
 * ── Trois draw calls pour tout le parc ──
 *
 * Le sol et les allées sont deux maillages. La végétation est instanciée par
 * espèce : quatre espèces, donc quatre lots au plus, quel que soit le nombre de
 * sujets. C'est le même pari que les œuvres du §9.1, et il tient pour la même
 * raison — une matrice par exemplaire coûte un tampon, pas un appel.
 *
 * ── Pourquoi le parc n'est pas dans le culling par étage ──
 *
 * Il n'appartient à aucun niveau : il est SOUS le bâtiment, et visible depuis
 * tous. Le masquer avec un plateau le ferait disparaître par les fenêtres du
 * plateau voisin, ce qui est exactement ce qu'on vient de percer pour le voir.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RigidBody } from '@react-three/rapier'

import { planterParc } from '../domain/park'
import type { Allee, EspeceParc, PlantationParc } from '../domain/park'
import type { Rect } from '../domain/types'
import { parkAssetsResource } from './parkAssets'
import type { ParkAssets, ParkPiece } from './parkAssets'
import { REGLAGE_MATIERE, repetitionMetrique, useMatiere } from './materials'

export interface ParkLayerProps {
  /** Emprise du bâtiment : le parc s'organise autour d'elle. */
  footprint: Rect
  /** Altitude du terrain naturel. C'est le plancher du rez-de-chaussée. */
  elevation: number
}

/**
 * Épaisseur du tapis de sol. Un plan d'épaisseur nulle montre sa tranche depuis
 * l'horizon, et le terrain semble alors flotter au-dessus du vide.
 */
const EPAISSEUR_SOL = 0.4

/** Surépaisseur des allées. Assez pour ne pas z-fighter avec la pelouse. */
const RELIEF_ALLEE = 0.015

export function ParkLayer({ footprint, elevation }: ParkLayerProps) {
  const parc = useMemo(() => planterParc(footprint), [footprint])
  const assets = useParkAssets()

  const herbe = useMatiere('herbe', repetitionMetrique(REGLAGE_MATIERE.herbe.motif))
  const gravier = useMatiere('gravier', repetitionMetrique(REGLAGE_MATIERE.gravier.motif))

  const sol = useMemo(() => geometrieSol(parc.terrain), [parc.terrain])
  const allees = useMemo(() => geometrieAllees(parc.allees, parc.parvis), [parc.allees, parc.parvis])

  useEffect(() => {
    return () => {
      sol.dispose()
      allees.dispose()
    }
  }, [sol, allees])

  const parEspece = useMemo(() => grouperParEspece(parc.plantations), [parc.plantations])

  return (
    <group name="parc" position={[0, elevation, 0]}>
      {/*
        Le sol est SOLIDE : sans collider, sortir du bâtiment par une porte fait
        tomber le visiteur dans le vide, et la garde anti-chute le téléporte
        aussitôt au spawn. Le parc deviendrait invisitable alors qu'il est là
        pour être vu.
      */}
      <RigidBody type="fixed" colliders="cuboid" name="parc:sol">
        <mesh geometry={sol} material={herbe} receiveShadow />
      </RigidBody>

      {/* Les allées ne portent rien : le sol dessous suffit à marcher. */}
      <mesh geometry={allees} material={gravier} receiveShadow />

      {assets !== null &&
        [...parEspece].map(([espece, sujets]) => {
          const lots = assets.get(espece)
          if (lots === undefined) return null
          return lots.map((lot, i) => (
            <Instances key={`${espece}:${i}`} piece={lot} sujets={sujets} />
          ))
        })}
    </group>
  )
}

// ── Un lot d'instances ───────────────────────────────────────────────────

function Instances({ piece, sujets }: { piece: ParkPiece; sujets: PlantationParc[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const mesh = ref.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    for (let i = 0; i < sujets.length; i++) {
      const sujet = sujets[i]
      p.set(sujet.position.x, sujet.position.y, sujet.position.z)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sujet.rotation)
      s.setScalar(sujet.scale)
      mesh.setMatrixAt(i, m.compose(p, q, s))
    }
    mesh.instanceMatrix.needsUpdate = true
    // La sphère englobante par défaut est celle d'UNE instance, à l'origine :
    // sans recalcul, tout le parc disparaît dès que l'origine sort du frustum.
    mesh.computeBoundingSphere()
  }, [sujets])

  return (
    <instancedMesh
      ref={ref}
      args={[piece.geometry, piece.material, sujets.length]}
      // Un arbre ne projette pas d'ombre : le budget du §9 n'autorise qu'un seul
      // porteur d'ombre, et c'est le bâtiment. Une centaine d'arbres dans la
      // passe de shadow map coûterait plus que toute la scène.
      castShadow={false}
      receiveShadow
      frustumCulled
    />
  )
}

function grouperParEspece(
  plantations: PlantationParc[],
): Map<EspeceParc, PlantationParc[]> {
  const parEspece = new Map<EspeceParc, PlantationParc[]>()
  for (const p of plantations) {
    const liste = parEspece.get(p.espece)
    if (liste === undefined) parEspece.set(p.espece, [p])
    else liste.push(p)
  }
  return parEspece
}

// ── Géométries ───────────────────────────────────────────────────────────

/**
 * Le tapis de sol : une dalle plate, face supérieure en y = 0.
 *
 * Ses UV sont en MÈTRES, comme celles d'`ExtrudeGeometry`, pour que
 * `repetitionMetrique` donne la même échelle d'herbe ici que de béton ailleurs.
 * Une `PlaneGeometry` porte des UV normalisés : la même pelouse s'y étirerait
 * sur 110 m et se lirait comme une nappe verte unie.
 */
function geometrieSol(terrain: Rect): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(terrain.width, EPAISSEUR_SOL, terrain.depth)
  g.translate(
    terrain.x + terrain.width / 2,
    -EPAISSEUR_SOL / 2,
    terrain.z + terrain.depth / 2,
  )
  metriserUv(g)
  return g
}

/** Le parvis et les allées, en un seul maillage — donc un seul draw call. */
function geometrieAllees(allees: Allee[], parvis: Rect): THREE.BufferGeometry {
  const morceaux: THREE.BufferGeometry[] = []

  const dalle = new THREE.BoxGeometry(parvis.width, RELIEF_ALLEE, parvis.depth)
  dalle.translate(parvis.x + parvis.width / 2, RELIEF_ALLEE / 2, parvis.z + parvis.depth / 2)
  morceaux.push(dalle)

  for (const a of allees) {
    const dx = a.b.x - a.a.x
    const dz = a.b.z - a.a.z
    const longueur = Math.hypot(dx, dz)
    if (longueur < 1e-6) continue
    // La boîte est créée le long de son X local puis pivotée autour de Y. Une
    // rotation d'angle θ envoie +X sur (cos θ, 0, −sin θ), d'où θ = atan2(−dz, dx).
    // Rallongée d'une largeur : deux segments perpendiculaires qui se touchent
    // exactement laissent un carré manquant à leur coin.
    const g = new THREE.BoxGeometry(longueur + a.largeur, RELIEF_ALLEE, a.largeur)
    g.rotateY(Math.atan2(-dz, dx))
    g.translate((a.a.x + a.b.x) / 2, RELIEF_ALLEE / 2, (a.a.z + a.b.z) / 2)
    morceaux.push(g)
  }

  return fusionner(morceaux)
}

/**
 * Remplace les UV normalisés d'une `BoxGeometry` par des UV en mètres, lus sur
 * la position et l'axe dominant de la normale.
 */
function metriserUv(g: THREE.BufferGeometry): void {
  const position = g.getAttribute('position')
  const normal = g.getAttribute('normal')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i))
    const ay = Math.abs(normal.getY(i))
    const az = Math.abs(normal.getZ(i))
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    if (ay >= ax && ay >= az) {
      uv[i * 2] = x
      uv[i * 2 + 1] = z
    } else if (ax >= az) {
      uv[i * 2] = z
      uv[i * 2 + 1] = y
    } else {
      uv[i * 2] = x
      uv[i * 2 + 1] = y
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

/** Concatène des `BoxGeometry` : mêmes attributs, même ordre, toujours. */
function fusionner(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) metriserUv(p)
  const noms = ['position', 'normal', 'uv'] as const
  const merged = new THREE.BufferGeometry()
  if (parts.length === 0) {
    for (const nom of noms) {
      merged.setAttribute(
        nom,
        new THREE.BufferAttribute(new Float32Array(0), nom === 'uv' ? 2 : 3),
      )
    }
    merged.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    return merged
  }

  for (const nom of noms) {
    const itemSize = parts[0].getAttribute(nom).itemSize
    const total = parts.reduce((s, p) => s + p.getAttribute(nom).count, 0)
    const data = new Float32Array(total * itemSize)
    let offset = 0
    for (const p of parts) {
      const attr = p.getAttribute(nom)
      for (let i = 0; i < attr.count * itemSize; i++) data[offset++] = attr.array[i] as number
    }
    merged.setAttribute(nom, new THREE.BufferAttribute(data, itemSize))
  }

  const total = parts.reduce((s, p) => s + (p.getIndex()?.count ?? 0), 0)
  const indices = new Uint32Array(total)
  let curseur = 0
  let decalage = 0
  for (const p of parts) {
    const idx = p.getIndex()
    if (idx) for (let i = 0; i < idx.count; i++) indices[curseur++] = idx.getX(i) + decalage
    decalage += p.getAttribute('position').count
    p.dispose()
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}

// ── Chargement ───────────────────────────────────────────────────────────

/**
 * Les modèles du parc, chargés une fois.
 *
 * Le musée reste visitable sans ses arbres : l'échec est signalé et le parc
 * sort en pelouse nue, comme le mobilier au lot 4.
 */
function useParkAssets(): ParkAssets | null {
  const [assets, setAssets] = useState<ParkAssets | null>(null)

  useEffect(() => {
    let vivant = true
    void parkAssetsResource().then((a) => {
      // Le composant peut être démonté avant l'arrivée du fichier : sans ce
      // garde, React avertit d'une mise à jour sur un composant démonté à
      // chaque rechargement à chaud.
      if (vivant) setAssets(a)
    })
    return () => {
      vivant = false
    }
  }, [])

  return assets
}
