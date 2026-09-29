/**
 * Les modèles des props : les grandes plantes en cuve de pierre de
 * `assets/architecture/plantes.glb` (`tools/blender/build-plantes.py`).
 *
 * Chaque plante devient un lot d'instances par matériau : la cuve, le bois,
 * le feuillage — ses cartes gardent leur découpe d'alpha, qui dessine les feuilles.
 * Le même fichier fournit les plantes du mobilier (`MobilierLayer`) : il est
 * chargé une seule fois pour les deux (`chargerGlb`).
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { brancherKTX2 } from '../io/textures'
import type { PropId } from '../plan/props'

export interface PropPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export type PropAssets = ReadonlyMap<PropId, readonly PropPiece[]>

/** Le nœud de chaque espèce dans `plantes.glb` ; l'origine y est déjà au pied de la cuve. */
const PLANTES: [PropId, string][] = [
  ['lyrata', 'Lyrata'],
  ['olivier', 'Olivier'],
]

const fichiers = new Map<string, Promise<GLTF>>()

/** Un GLB chargé une fois par adresse : deux couches qui lisent le même fichier ne le téléchargent pas deux fois. */
export function chargerGlb(url: string): Promise<GLTF> {
  let p = fichiers.get(url)
  if (p === undefined) {
    const draco = new DRACOLoader()
    draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
    // Le transcodeur KTX2 partagé : un GLB compressé par `tools/compresser-glb.ts` se lit aussi.
    p = brancherKTX2(new GLTFLoader())
      .then((gltf) => gltf.setDRACOLoader(draco).loadAsync(url))
      .finally(() => draco.dispose())
    fichiers.set(url, p)
  }
  return p
}

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
  const { scene } = await chargerGlb(`${base}assets/architecture/plantes.glb`)
  scene.updateMatrixWorld(true)
  const pieces = new Map<PropId, readonly PropPiece[]>()
  for (const [id, nom] of PLANTES) {
    const noeud = scene.getObjectByName(nom)
    if (noeud === undefined) {
      console.warn(`plantes.glb : nœud « ${nom} » introuvable`)
      continue
    }
    const lots = lotsTextures(noeud)
    if (lots.length > 0) pieces.set(id, lots)
  }
  return pieces
}

const premier = (m: THREE.Mesh): THREE.Material | null => (Array.isArray(m.material) ? (m.material[0] ?? null) : m.material)

/** Les maillages d'un nœud, dans son repère, fusionnés par matériau. Sans rien modifier du fichier partagé. */
function lotsTextures(noeud: THREE.Object3D): PropPiece[] {
  const racine = noeud.matrixWorld.clone().invert()
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
    // Un clone : les couches qui patchent leurs matériaux (lumière, intempéries) ne le font pas deux fois sur le même.
    lots.push({ geometry, material: source.clone() })
  }
  return lots
}

/**
 * Recentre un sujet sur l'axe de sa boîte englobante, à l'horizontale : Poly
 * Haven livre des planches de spécimens décalés d'un mètre, et la translation
 * du nœud ne dit pas où est le sujet. Sans ça, la plante tombait à côté de sa
 * jardinière. La hauteur reste celle du fichier : c'est elle qui pose le pot.
 */
export function centrer<T extends { geometry: THREE.BufferGeometry }>(lots: T[]): T[] {
  const boite = new THREE.Box3()
  for (const { geometry } of lots) {
    geometry.computeBoundingBox()
    boite.union(geometry.boundingBox!)
  }
  if (boite.isEmpty()) return lots
  const c = boite.getCenter(new THREE.Vector3())
  for (const { geometry } of lots) {
    geometry.translate(-c.x, 0, -c.z)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
  }
  return lots
}
