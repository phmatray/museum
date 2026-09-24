/**
 * Les modèles des props : la jardinière du kit (`assets/props/museum-kit.glb`)
 * et les plantes (`assets/plants/plants-lod.glb`). Repris de l'ancien bâtiment (#29).
 *
 * La jardinière est fusionnée en une géométrie à couleurs de sommet : un lot
 * d'instances au lieu d'un par matériau. Les plantes gardent leurs cartes — le
 * masque d'alpha est ce qui découpe les feuilles.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { PropId } from '../plan/props'

export interface PropPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export type PropAssets = ReadonlyMap<PropId, readonly PropPiece[]>

/** Les nœuds de chaque sujet dans `plants-lod.glb` (`GARDES` de `decimate-plants.py`). */
const PLANTES: [PropId, string[]][] = [
  ['plante-01', ['anthurium_botany_01_a']],
  ['plante-02', ['calathea_orbifolia_01_a']],
  ['plante-03', ['potted_plant_02_leaves', 'potted_plant_02_pot']],
  ['plante-04', ['potted_plant_04_pot', 'potted_plant_04_plant', 'potted_plant_04_ground']],
]

let promesse: Promise<PropAssets> | null = null

/** Chargé une fois, sous `BASE_URL` : le site est servi sous `/museum/`. */
export function propAssetsResource(base: string = import.meta.env.BASE_URL): Promise<PropAssets> {
  promesse ??= charger(base).catch((erreur: unknown) => {
    // Le musée reste visitable sans ses plantes.
    console.error('props indisponibles', erreur)
    return new Map()
  })
  return promesse
}

async function charger(base: string): Promise<PropAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}draco/`)
  gltf.setDRACOLoader(draco)
  const [kit, flore] = await Promise.all([
    gltf.loadAsync(`${base}assets/props/museum-kit.glb`),
    gltf.loadAsync(`${base}assets/plants/plants-lod.glb`),
  ])
  draco.dispose()

  const pieces = new Map<PropId, readonly PropPiece[]>()
  const jardiniere = kit.scene.getObjectByName('Jardiniere')
  const lot = jardiniere && fusionnerEnUnLot(jardiniere)
  if (lot) pieces.set('jardiniere', [lot])
  for (const [id, noeuds] of PLANTES) {
    // Les nœuds d'un sujet sous un porteur commun, transformation monde gardée :
    // sinon le pot se sépare de son feuillage.
    const porteur = new THREE.Group()
    for (const nom of noeuds) {
      const noeud = flore.scene.getObjectByName(nom)
      if (noeud === undefined) {
        console.warn(`plants-lod.glb : nœud « ${nom} » introuvable`)
        continue
      }
      noeud.updateWorldMatrix(true, false)
      porteur.add(noeud)
    }
    const lots = lotsTextures(porteur)
    if (lots.length > 0) pieces.set(id, lots)
  }
  return pieces
}

/**
 * Le repère d'ancrage : recentré à l'horizontale (Poly Haven livre des planches
 * de spécimens sur une grille d'un mètre), INTACT en hauteur (la translation du
 * nœud est ce qui pose l'objet sur le sol).
 */
function repereDAncrage(noeud: THREE.Object3D): THREE.Matrix4 {
  noeud.updateWorldMatrix(true, true)
  const c = new THREE.Vector3().setFromMatrixPosition(noeud.matrixWorld)
  return new THREE.Matrix4().makeTranslation(-c.x, 0, -c.z)
}

const premier = (m: THREE.Mesh): THREE.Material | null => (Array.isArray(m.material) ? (m.material[0] ?? null) : m.material)

function fusionnerEnUnLot(noeud: THREE.Object3D): PropPiece | null {
  const racine = repereDAncrage(noeud)
  const morceaux: THREE.BufferGeometry[] = []
  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const g = (objet.geometry as THREE.BufferGeometry).clone()
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(racine, objet.matrixWorld))
    const m = premier(objet)
    const c = m instanceof THREE.MeshStandardMaterial ? m.color : new THREE.Color(1, 1, 1)
    const n = g.attributes.position.count
    g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3))
    morceaux.push(g)
  })
  const geometry = morceaux.length === 1 ? morceaux[0] : mergeGeometries(morceaux, false)
  if (geometry === null || morceaux.length === 0) return null
  for (const g of morceaux) if (g !== geometry) g.dispose()
  return { geometry, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }) }
}

function lotsTextures(noeud: THREE.Object3D): PropPiece[] {
  const racine = repereDAncrage(noeud)
  const parMateriau = new Map<THREE.Material, THREE.BufferGeometry[]>()
  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const m = premier(objet)
    if (m === null) return
    const g = (objet.geometry as THREE.BufferGeometry).clone()
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(racine, objet.matrixWorld))
    parMateriau.set(m, [...(parMateriau.get(m) ?? []), g])
  })
  const lots: PropPiece[] = []
  for (const [source, geometries] of parMateriau) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
    if (geometry === null) continue
    for (const g of geometries) if (g !== geometry) g.dispose()
    // Feuilles vues des deux côtés, découpe binaire : des instances ne se trient pas.
    const material = source.clone()
    material.side = THREE.DoubleSide
    if (material.transparent || material.alphaTest > 0) {
      material.transparent = false
      material.alphaTest = Math.max(material.alphaTest, 0.4)
    }
    material.depthWrite = true
    lots.push({ geometry, material })
  }
  return lots
}
