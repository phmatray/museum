/**
 * Les modèles du parc (`public/assets/plants/park-lod.glb`), repris de
 * l'ancien bâtiment (#29).
 *
 * Un fichier, des couples (géométrie, matériau) prêts à porter une matrice par
 * exemplaire. Les matériaux Poly Haven sont gardés : le masque d'alpha est ce
 * qui découpe le feuillage dans ses quads.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { EspeceParc } from '../plan/park'

export interface ParkPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export type ParkAssets = ReadonlyMap<EspeceParc, readonly ParkPiece[]>

/** Les nœuds de chaque essence dans `park-lod.glb` (`GARDES_PARC` de `decimate-plants.py`). */
const NOEUDS: Record<EspeceParc, string> = {
  'arbre-01': 'island_tree_01_LOD0',
  'arbre-02': 'island_tree_02_LOD0',
  'arbuste-01': 'shrub_01_a',
  'arbuste-02': 'shrub_03_a',
}

let promesse: Promise<ParkAssets> | null = null

/** Chargé une fois, sous `BASE_URL` : le site est servi sous `/museum/`. */
export function parkAssetsResource(base: string = import.meta.env.BASE_URL): Promise<ParkAssets> {
  promesse ??= charger(base).catch((erreur: unknown) => {
    // Le musée reste visitable sans ses arbres : le parc sort en pelouse nue.
    console.error('parc indisponible', erreur)
    return new Map()
  })
  return promesse
}

async function charger(base: string): Promise<ParkAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}draco/`)
  gltf.setDRACOLoader(draco)
  const modele = await gltf.loadAsync(`${base}assets/plants/park-lod.glb`)
  draco.dispose()
  const especes = new Map<EspeceParc, readonly ParkPiece[]>()
  for (const [id, nom] of Object.entries(NOEUDS) as [EspeceParc, string][]) {
    const noeud = modele.scene.getObjectByName(nom)
    if (noeud === undefined) console.warn(`park-lod.glb : nœud « ${nom} » introuvable`)
    else especes.set(id, lotsParMateriau(noeud))
  }
  return especes
}

/**
 * Regroupe par matériau, cuit les transformations et ramène le pied à y = 0 :
 * `plan/park.ts` pose les sujets sur le terrain sans connaître le pivot des modèles.
 */
function lotsParMateriau(noeud: THREE.Object3D): ParkPiece[] {
  noeud.updateWorldMatrix(true, true)
  const racine = new THREE.Matrix4().copy(noeud.matrixWorld).invert()
  const parMateriau = new Map<THREE.Material, THREE.BufferGeometry[]>()
  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const materiau = Array.isArray(objet.material) ? objet.material[0] : objet.material
    if (!materiau) return
    const g = (objet.geometry as THREE.BufferGeometry).clone()
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(racine, objet.matrixWorld))
    parMateriau.set(materiau, [...(parMateriau.get(materiau) ?? []), g])
  })
  // Le pied commun, mesuré avant la fusion : tronc et feuillage descendent ensemble.
  let pied = Infinity
  for (const g of [...parMateriau.values()].flat()) {
    g.computeBoundingBox()
    pied = Math.min(pied, g.boundingBox!.min.y)
  }
  if (!Number.isFinite(pied)) pied = 0

  const lots: ParkPiece[] = []
  for (const [materiau, geometries] of parMateriau) {
    const fusion = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
    if (fusion === null) continue
    for (const g of geometries) if (g !== fusion) g.dispose()
    fusion.translate(0, -pied, 0)
    fusion.computeBoundingSphere()
    const m = materiau.clone()
    // Le feuillage se voit des deux côtés ; découpe binaire plutôt que tri
    // (des milliers de feuilles instanciées ne se trient pas). À 0,35 l'arbre
    // sortait en squelette : 0,15 garde la silhouette.
    m.side = THREE.DoubleSide
    m.alphaTest = 0.15
    m.transparent = false
    m.depthWrite = true
    lots.push({ geometry: fusion, material: m })
  }
  return lots
}
