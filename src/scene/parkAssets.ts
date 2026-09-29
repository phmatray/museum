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
import { cartesDeFeuillage, intemperer, saisonnerAzalee, saisonnerErable, saisonnerPetales } from './intemperies'
import { mousser } from './jardinMatieres'

export interface ParkPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** Le même sujet allégé, dessiné de loin avec le même matériau (`erables-loin.glb`). */
  loin?: THREE.BufferGeometry
}

export interface ParkAssets {
  especes: ReadonlyMap<EspeceParc, readonly ParkPiece[]>
  /** Le décor fixe du jardin (`Jardin_*` de jardin.glb) : sol creusé, eau, pont, lanterne. */
  jardin: THREE.Object3D[]
}

/**
 * Les nœuds de chaque essence, tous dans `build-jardin.py`. Les arbres Poly Haven
 * de `park-lod.glb` ne sont plus plantés : ils ne s'accordaient pas au jardin.
 */
const NOEUDS: Record<EspeceParc, [fichier: string, noeud: string]> = {
  'erable-rouge': ['jardin/jardin.glb', 'src_erable_rouge'],
  'erable-vert': ['jardin/jardin.glb', 'src_erable_vert'],
  buis: ['jardin/jardin.glb', 'src_buis'],
  azalee: ['jardin/jardin.glb', 'src_azalee'],
  fougere: ['jardin/jardin.glb', 'src_fougere'],
  petales: ['jardin/jardin.glb', 'src_petales'],
  'rocher-1': ['jardin/jardin.glb', 'src_rocher_1'],
  'rocher-2': ['jardin/jardin.glb', 'src_rocher_2'],
  'rocher-3': ['jardin/jardin.glb', 'src_rocher_3'],
  'rocher-4': ['jardin/jardin.glb', 'src_rocher_4'],
  'rocher-5': ['jardin/jardin.glb', 'src_rocher_5'],
}

/** Les sujets vus de loin (`build-erables-loin.py`) : même nœud, autre fichier. */
const LOIN: Partial<Record<EspeceParc, string>> = { 'erable-rouge': 'src_erable_rouge', 'erable-vert': 'src_erable_vert' }
const FICHIER_LOIN = 'jardin/erables-loin.glb'

let promesse: Promise<ParkAssets> | null = null

/** Chargé une fois, sous `BASE_URL` : le site est servi sous `/museum/`. */
export function parkAssetsResource(base: string = import.meta.env.BASE_URL): Promise<ParkAssets> {
  promesse ??= charger(base).catch((erreur: unknown) => {
    // Le musée reste visitable sans ses arbres : le parc sort en pelouse nue.
    console.error('parc indisponible', erreur)
    return { especes: new Map(), jardin: [] }
  })
  return promesse
}

async function charger(base: string): Promise<ParkAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}draco/`)
  gltf.setDRACOLoader(draco)
  const fichiers = [...new Set([...Object.values(NOEUDS).map(([f]) => f), FICHIER_LOIN])]
  const scenes = new Map(await Promise.all(fichiers.map(async (f) => [f, (await gltf.loadAsync(`${base}assets/${f}`)).scene] as const)))
  draco.dispose()
  const especes = new Map<EspeceParc, readonly ParkPiece[]>()
  for (const [id, [fichier, nom]] of Object.entries(NOEUDS) as [EspeceParc, [string, string]][]) {
    const noeud = scenes.get(fichier)?.getObjectByName(nom)
    if (noeud === undefined) {
      console.warn(`${fichier} : nœud « ${nom} » introuvable`)
      continue
    }
    const { lots, cale } = lotsParMateriau(noeud)
    const loin = LOIN[id] === undefined ? undefined : scenes.get(FICHIER_LOIN)?.getObjectByName(LOIN[id])
    if (loin !== undefined) accrocherLoin(lots, loin, cale)
    especes.set(id, lots)
  }
  for (const [id, lots] of especes) if (id.startsWith('rocher')) for (const l of lots) mousser(l.material)
  // La saison et le temps sur chaque essence (`intemperies.ts`) : après la mousse, qu'ils chaînent.
  for (const [id, lots] of especes) {
    for (const l of lots) {
      const feuilles = l.material.name.startsWith('Jardin_Feuillage') && !l.material.name.includes('Fond')
      if (id === 'petales') saisonnerPetales(l.material)
      else if (feuilles && id.startsWith('erable')) {
        cartesDeFeuillage(l.geometry)
        if (l.loin) cartesDeFeuillage(l.loin)
        saisonnerErable(l.material, id === 'erable-rouge')
      } else if (feuilles && id === 'azalee') saisonnerAzalee(l.material)
      if (id !== 'petales') intemperer(l.material)
    }
  }
  const jardin = scenes.get('jardin/jardin.glb')?.children.filter((o) => o.name.startsWith('Jardin_')) ?? []
  return { especes, jardin }
}

/** Les maillages de `noeud` fusionnés par matériau, transformations cuites dans son repère. */
function fusionParMateriau(noeud: THREE.Object3D): Map<THREE.Material, THREE.BufferGeometry> {
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
  const fusions = new Map<THREE.Material, THREE.BufferGeometry>()
  for (const [materiau, geometries] of parMateriau) {
    const fusion = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
    for (const g of geometries) if (g !== fusion) g.dispose()
    if (fusion !== null) fusions.set(materiau, fusion)
  }
  return fusions
}

/**
 * Regroupe par matériau et ramène le pied à y = 0, centré en x et z :
 * `plan/park.ts` pose les sujets sur le terrain sans connaître le pivot des
 * modèles. Tronc et feuillage bougent ensemble (une seule boîte pour tous) ;
 * `cale` est ce déplacement, que la géométrie de loin reprend.
 */
function lotsParMateriau(noeud: THREE.Object3D): { lots: ParkPiece[]; cale: THREE.Vector3 } {
  const fusions = fusionParMateriau(noeud)
  const boite = new THREE.Box3()
  for (const g of fusions.values()) {
    g.computeBoundingBox()
    boite.union(g.boundingBox!)
  }
  const cale = boite.isEmpty() ? new THREE.Vector3() : boite.getCenter(new THREE.Vector3()).setY(boite.min.y).negate()
  const lots: ParkPiece[] = []
  for (const [materiau, g] of fusions) {
    g.translate(cale.x, cale.y, cale.z)
    g.computeBoundingBox()
    g.computeBoundingSphere()
    const m = materiau.clone()
    // Le feuillage se voit des deux côtés ; découpe binaire plutôt que tri
    // (des milliers de feuilles instanciées ne se trient pas). À 0,35 l'arbre
    // sortait en squelette : 0,15 garde la silhouette.
    m.side = THREE.DoubleSide
    m.alphaTest = 0.15
    m.transparent = false
    m.depthWrite = true
    lots.push({ geometry: g, material: m })
  }
  return { lots, cale }
}

/**
 * Accroche à chaque lot sa géométrie de loin (celle du matériau de même nom),
 * calée comme la proche : l'arbre ne bouge pas d'un centimètre quand l'une
 * remplace l'autre. Les deux partagent une sphère englobante qui les couvre.
 */
function accrocherLoin(lots: ParkPiece[], noeud: THREE.Object3D, cale: THREE.Vector3) {
  for (const [materiau, g] of fusionParMateriau(noeud)) {
    const lot = lots.find((l) => l.material.name === materiau.name)
    if (lot === undefined) {
      g.dispose()
      continue
    }
    g.translate(cale.x, cale.y, cale.z)
    g.computeBoundingSphere()
    lot.geometry.boundingSphere!.union(g.boundingSphere!)
    g.boundingSphere = lot.geometry.boundingSphere!.clone()
    lot.loin = g
  }
}
