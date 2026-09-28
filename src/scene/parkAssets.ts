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
import { centrer } from './propAssets'

export interface ParkPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
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
  const fichiers = [...new Set(Object.values(NOEUDS).map(([f]) => f))]
  const scenes = new Map(await Promise.all(fichiers.map(async (f) => [f, (await gltf.loadAsync(`${base}assets/${f}`)).scene] as const)))
  draco.dispose()
  const especes = new Map<EspeceParc, readonly ParkPiece[]>()
  for (const [id, [fichier, nom]] of Object.entries(NOEUDS) as [EspeceParc, [string, string]][]) {
    const noeud = scenes.get(fichier)?.getObjectByName(nom)
    if (noeud === undefined) console.warn(`${fichier} : nœud « ${nom} » introuvable`)
    else especes.set(id, lotsParMateriau(noeud))
  }
  for (const [id, lots] of especes) if (id.startsWith('rocher')) for (const l of lots) mousser(l.material)
  // La saison et le temps sur chaque essence (`intemperies.ts`) : après la mousse, qu'ils chaînent.
  for (const [id, lots] of especes) {
    for (const l of lots) {
      const feuilles = l.material.name.startsWith('Jardin_Feuillage') && !l.material.name.includes('Fond')
      if (id === 'petales') saisonnerPetales(l.material)
      else if (feuilles && id.startsWith('erable')) {
        cartesDeFeuillage(l.geometry)
        saisonnerErable(l.material, id === 'erable-rouge')
      } else if (feuilles && id === 'azalee') saisonnerAzalee(l.material)
      if (id !== 'petales') intemperer(l.material)
    }
  }
  const jardin = scenes.get('jardin/jardin.glb')?.children.filter((o) => o.name.startsWith('Jardin_')) ?? []
  return { especes, jardin }
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
  // Le pivot d'un arbuste n'est pas son centre (`shrub_01_a` s'étend à 2,45 m
  // d'un côté) : recentré, il tient dans le rayon que `plan/park.ts` lui réserve.
  return centrer(lots)
}
