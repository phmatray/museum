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

import { brancherKTX2 } from '../io/textures'
import type { EspeceParc } from '../plan/park'
import { balancerHerbes, cartesDeFeuillage, intemperer, saisonnerAzalee, saisonnerErable, saisonnerPetales, varierFeuillage } from './intemperies'
import { mousser } from './jardinMatieres'

export interface ParkPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** Le même sujet allégé, dessiné de loin avec le même matériau (`loin_*` de vegetation.glb). */
  loin?: THREE.BufferGeometry
}

export interface ParkAssets {
  especes: ReadonlyMap<EspeceParc, readonly ParkPiece[]>
  /** Le décor fixe du jardin (`Jardin_*` de jardin.glb) : sol creusé, eau, pont, lanterne. */
  jardin: THREE.Object3D[]
  /** Le lit du ruisseau (`ruisseau.glb`, à l'origine, pied à 0) : la souche, la branche, les sept galets. */
  ruisseau: PiecesDuRuisseau
}

export interface PiecesDuRuisseau {
  souche: ParkPiece[]
  branche: ParkPiece[]
  /** Un lot par modèle de galet ; tous partagent le même matériau (la planche Meshy). */
  galets: ParkPiece[][]
}

/**
 * Les nœuds de chaque essence : la végétation vivante dans `build-vegetation.py`
 * (érables, touffes, lierre, herbes de berge), les pierres, la fougère et les
 * pétales dans `build-jardin.py`. Les arbres Poly Haven de `park-lod.glb` ne
 * sont plus plantés : ils ne s'accordaient pas au jardin.
 */
const VEGETATION = 'jardin/vegetation.glb'
/** Les grands arbres (`build-grands-arbres.py`) : cèdre, ginkgo, pin noir. Des planches photo, comme la végétation. */
const GRANDS = 'jardin/grands-arbres.glb'
const NOEUDS: Record<EspeceParc, [fichier: string, noeud: string]> = {
  'erable-rouge': [VEGETATION, 'src_erable_rouge'],
  'erable-vert': [VEGETATION, 'src_erable_vert'],
  buis: [VEGETATION, 'src_buis'],
  azalee: [VEGETATION, 'src_azalee'],
  lierre: [VEGETATION, 'src_lierre'],
  roseaux: [VEGETATION, 'src_roseaux'],
  herbes: [VEGETATION, 'src_herbes'],
  fougere: ['jardin/jardin.glb', 'src_fougere'],
  petales: ['jardin/jardin.glb', 'src_petales'],
  'rocher-1': ['jardin/jardin.glb', 'src_rocher_1'],
  'rocher-2': ['jardin/jardin.glb', 'src_rocher_2'],
  'rocher-3': ['jardin/jardin.glb', 'src_rocher_3'],
  'rocher-4': ['jardin/jardin.glb', 'src_rocher_4'],
  'rocher-5': ['jardin/jardin.glb', 'src_rocher_5'],
  cedre: [GRANDS, 'src_cedre'],
  ginkgo: [GRANDS, 'src_ginkgo'],
  pin: [GRANDS, 'src_pin'],
}

/** Les sujets vus de loin (`build-vegetation.py`, `build-grands-arbres.py`) : mêmes tirages, une carte sur deux. */
const LOIN: Partial<Record<EspeceParc, [fichier: string, noeud: string]>> = {
  'erable-rouge': [VEGETATION, 'loin_erable_rouge'],
  'erable-vert': [VEGETATION, 'loin_erable_vert'],
  cedre: [GRANDS, 'loin_cedre'],
  ginkgo: [GRANDS, 'loin_ginkgo'],
  pin: [GRANDS, 'loin_pin'],
}
const FICHIER_RUISSEAU = 'jardin/ruisseau.glb'

let promesse: Promise<ParkAssets> | null = null

/** Chargé une fois, sous `BASE_URL` : le site est servi sous `/museum/`. */
export function parkAssetsResource(base: string = import.meta.env.BASE_URL): Promise<ParkAssets> {
  promesse ??= charger(base).catch((erreur: unknown) => {
    // Le musée reste visitable sans ses arbres : le parc sort en pelouse nue.
    console.error('parc indisponible', erreur)
    return { especes: new Map(), jardin: [], ruisseau: { souche: [], branche: [], galets: [] } }
  })
  return promesse
}

async function charger(base: string): Promise<ParkAssets> {
  const gltf = await brancherKTX2(new GLTFLoader())
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}draco/`)
  gltf.setDRACOLoader(draco)
  const fichiers = [...new Set([...Object.values(NOEUDS).map(([f]) => f), FICHIER_RUISSEAU])]
  const scenes = new Map(await Promise.all(fichiers.map(async (f) => [f, (await gltf.loadAsync(`${base}assets/${f}`)).scene] as const)))
  draco.dispose()
  const especes = new Map<EspeceParc, readonly ParkPiece[]>()
  for (const [id, [fichier, nom]] of Object.entries(NOEUDS) as [EspeceParc, [string, string]][]) {
    const noeud = scenes.get(fichier)?.getObjectByName(nom)
    if (noeud === undefined) {
      console.warn(`${fichier} : nœud « ${nom} » introuvable`)
      continue
    }
    const { lots, cale } = lotsParMateriau(noeud, fichier === VEGETATION || fichier === GRANDS ? 0.45 : 0.15)
    const l = LOIN[id]
    const loin = l === undefined ? undefined : scenes.get(l[0])?.getObjectByName(l[1])
    if (loin !== undefined) accrocherLoin(lots, loin, cale)
    especes.set(id, lots)
  }
  for (const [id, lots] of especes) if (id.startsWith('rocher')) for (const l of lots) mousser(l.material)
  // La saison et le temps sur chaque essence (`intemperies.ts`) : après la mousse, qu'ils chaînent.
  for (const [id, lots] of especes) {
    for (const l of lots) {
      const feuilles = l.material.name.startsWith('Jardin_Feuillage') && !l.material.name.includes('Fond')
      if (id === 'petales') saisonnerPetales(l.material)
      else if (feuilles && (id.startsWith('erable') || id === 'ginkgo')) {
        cartesDeFeuillage(l.geometry)
        if (l.loin) cartesDeFeuillage(l.loin)
        saisonnerErable(l.material, id === 'erable-rouge' ? 'rouge' : id === 'ginkgo' ? 'ginkgo' : 'vert')
        varierFeuillage(l.material, 0.45)
      } else if (feuilles && (id === 'cedre' || id === 'pin')) {
        // Toujours verts : ni saison ni chute, une nuance par sujet, et la neige par-dessus.
        varierFeuillage(l.material, 0.35)
      } else if (feuilles && id === 'azalee') {
        saisonnerAzalee(l.material)
        varierFeuillage(l.material)
      } else if (feuilles && id !== 'lierre') varierFeuillage(l.material)
      else if (feuilles) varierFeuillage(l.material, 0.5)
      if (l.material.name.startsWith('Jardin_Herbe')) balancerHerbes(l.material)
      if (id !== 'petales') intemperer(l.material)
    }
  }
  const jardin = scenes.get('jardin/jardin.glb')?.children.filter((o) => o.name.startsWith('Jardin_')) ?? []
  const lit = scenes.get(FICHIER_RUISSEAU)
  const pieces = (nom: string): ParkPiece[] => {
    const noeud = lit?.getObjectByName(nom)
    return noeud === undefined ? [] : [...fusionParMateriau(noeud)].map(([material, geometry]) => ({ material, geometry }))
  }
  const ruisseau = { souche: pieces('src_souche'), branche: pieces('src_branche'), galets: Array.from({ length: 7 }, (_, k) => pieces(`src_galet_${k + 1}`)) }
  return { especes, jardin, ruisseau }
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
function lotsParMateriau(noeud: THREE.Object3D, seuil: number): { lots: ParkPiece[]; cale: THREE.Vector3 } {
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
    // (des milliers de feuilles instanciées ne se trient pas). L'atlas dessiné
    // de `jardin.glb` sortait en squelette à 0,35 : 0,15 garde sa silhouette.
    // Les photos de rameaux de `vegetation.glb` ont des jours entre leurs
    // feuilles : à 0,15, les mips les bouchaient et le rameau fondait en une
    // tache lisse ; 0,45 garde les feuilles détachées.
    m.side = THREE.DoubleSide
    m.alphaTest = seuil
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
