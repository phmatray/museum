/**
 * Pin `centrer()` (props/parc) contre les VRAIS GLB vendus (#51).
 *
 * #44 a corrigé un bug où les plantes flottaient à côté de leur jardinière et
 * où les arbustes du parc débordaient sur les allées : les pivots livrés par
 * Poly Haven ne sont pas centrés sur leur sujet. Rien ne pinçait ce fichier
 * (`museum-kit.glb`, `plants-lod.glb`) contre `centrer()` : un futur ré-export
 * avec un pivot décalé ne se verrait qu'à l'œil, sur le site publié.
 *
 * Charger ces `.glb` (compressés Draco) hors navigateur pose deux problèmes
 * que ni `propAssetsResource` ni `parkAssetsResource` n'ont à résoudre :
 *
 *  1. `DRACOLoader` décode toujours via un Web Worker, absent de Node/jsdom.
 *     `draco3d` (déjà présent, transitif via `three-stdlib`) est un build
 *     Node/CJS du même décodeur qui n'a besoin d'aucun Worker : on relie
 *     `DRACOLoader.decodeGeometry` dessus, avec le même algorithme que
 *     `DRACOWorker` (three.js, MIT) — recopié plutôt qu'un polyfill de Worker,
 *     bien plus fragile pour reproduire la même chose.
 *  2. jsdom ne décode jamais vraiment une `<img>` (`onload` ne se déclenche
 *     pas) : `ImageLoader` est court-circuité par une image factice, sans
 *     conséquence ici puisque seule la géométrie est vérifiée.
 *
 * `fs.readFileSync` lit dans le royaume d'`ArrayBuffer` de NODE, différent de
 * celui de jsdom : sans le repasser par un `Uint8Array` du royaume courant,
 * le `instanceof ArrayBuffer` de `GLTFLoader` échoue silencieusement et le
 * fichier est pris pour du JSON déjà parsé.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import draco3d from 'draco3d'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { beforeAll, describe, expect, it } from 'vitest'

import { centrer } from '../propAssets'

// ── Décodage Draco en thread principal (surface minimale de draco3d) ──────

interface DracoAttribut {
  num_components(): number
}

interface DracoMaillage {
  ptr: number
  num_faces(): number
  num_points(): number
}

interface DracoStatut {
  ok(): boolean
  error_msg(): string
}

interface DracoDecodeur {
  GetEncodedGeometryType(tableau: Int8Array): number
  DecodeArrayToMesh(tableau: Int8Array, byteLength: number, maillage: DracoMaillage): DracoStatut
  GetAttributeByUniqueId(maillage: DracoMaillage, id: number): DracoAttribut
  GetAttributeId(maillage: DracoMaillage, type: number): number
  GetAttribute(maillage: DracoMaillage, id: number): DracoAttribut
  GetTrianglesUInt32Array(maillage: DracoMaillage, byteLength: number, ptr: number): void
  GetAttributeDataArrayForAllPoints(
    maillage: DracoMaillage,
    attribut: DracoAttribut,
    type: number,
    byteLength: number,
    ptr: number,
  ): void
}

interface DracoModule {
  Decoder: new () => DracoDecodeur
  Mesh: new () => DracoMaillage
  TRIANGULAR_MESH: number
  DT_FLOAT32: number
  DT_INT8: number
  DT_INT16: number
  DT_INT32: number
  DT_UINT8: number
  DT_UINT16: number
  DT_UINT32: number
  HEAPF32: { buffer: ArrayBuffer }
  _malloc(taille: number): number
  _free(ptr: number): void
  destroy(objet: unknown): void
}

interface TacheDecodage {
  attributeIDs: Record<string, number>
  attributeTypes: Record<string, string>
  useUniqueIDs: boolean
}

type ConstructeurTypedArray =
  | Float32ArrayConstructor
  | Int8ArrayConstructor
  | Int16ArrayConstructor
  | Int32ArrayConstructor
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor

const CONSTRUCTEURS_TYPED_ARRAY: Record<string, ConstructeurTypedArray> = {
  Float32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
}

function typeDracoPour(draco: DracoModule, TypedArray: ConstructeurTypedArray): number {
  switch (TypedArray) {
    case Float32Array: return draco.DT_FLOAT32
    case Int8Array: return draco.DT_INT8
    case Int16Array: return draco.DT_INT16
    case Int32Array: return draco.DT_INT32
    case Uint8Array: return draco.DT_UINT8
    case Uint16Array: return draco.DT_UINT16
    case Uint32Array: return draco.DT_UINT32
    default: throw new Error('propAssets.test : type de tableau draco inattendu')
  }
}

/** Reprend `decodeAttribute` de `DRACOWorker` (three.js examples, MIT). */
function decoderAttribut(
  draco: DracoModule,
  decodeur: DracoDecodeur,
  maillage: DracoMaillage,
  nom: string,
  TypedArray: ConstructeurTypedArray,
  attribut: DracoAttribut,
) {
  const count = maillage.num_points()
  const itemSize = attribut.num_components()
  const srcByteStride = itemSize * TypedArray.BYTES_PER_ELEMENT
  const dstByteStride = Math.ceil(srcByteStride / 4) * 4
  const dstStride = dstByteStride / TypedArray.BYTES_PER_ELEMENT
  const srcByteLength = count * srcByteStride
  const dstByteLength = count * dstByteStride

  const ptr = draco._malloc(srcByteLength)
  decodeur.GetAttributeDataArrayForAllPoints(maillage, attribut, typeDracoPour(draco, TypedArray), srcByteLength, ptr)
  const srcArray = new TypedArray(draco.HEAPF32.buffer, ptr, srcByteLength / TypedArray.BYTES_PER_ELEMENT)

  let dstArray
  if (srcByteStride === dstByteStride) {
    dstArray = srcArray.slice()
  } else {
    dstArray = new TypedArray(dstByteLength / TypedArray.BYTES_PER_ELEMENT)
    let dstOffset = 0
    for (let i = 0, il = srcArray.length; i < il; i++) {
      for (let j = 0; j < itemSize; j++) dstArray[dstOffset + j] = srcArray[i * itemSize + j]
      dstOffset += dstStride
    }
  }
  draco._free(ptr)

  return { name: nom, count, itemSize, array: dstArray, stride: dstStride }
}

/** Reprend `decodeIndex` de `DRACOWorker` (three.js examples, MIT). */
function decoderIndex(draco: DracoModule, decodeur: DracoDecodeur, maillage: DracoMaillage) {
  const numIndices = maillage.num_faces() * 3
  const byteLength = numIndices * 4
  const ptr = draco._malloc(byteLength)
  decodeur.GetTrianglesUInt32Array(maillage, byteLength, ptr)
  const index = new Uint32Array(draco.HEAPF32.buffer, ptr, numIndices).slice()
  draco._free(ptr)
  return { array: index, itemSize: 1 }
}

/** Reprend `decodeGeometry` de `DRACOWorker` (three.js examples, MIT), sur draco3d direct. */
function decoderGeometrieDraco(draco: DracoModule, decodeur: DracoDecodeur, tableau: Int8Array, tache: TacheDecodage) {
  const maillage = new draco.Mesh()
  const type = decodeur.GetEncodedGeometryType(tableau)
  if (type !== draco.TRIANGULAR_MESH) throw new Error('propAssets.test : géométrie non triangulaire inattendue')
  const statut = decodeur.DecodeArrayToMesh(tableau, tableau.byteLength, maillage)
  if (!statut.ok() || maillage.ptr === 0) throw new Error('propAssets.test : décodage draco échoué — ' + statut.error_msg())

  const geometrie: { index: unknown; attributes: unknown[] } = { index: null, attributes: [] }
  for (const nom in tache.attributeIDs) {
    const TypedArray = CONSTRUCTEURS_TYPED_ARRAY[tache.attributeTypes[nom]]
    let attribut: DracoAttribut
    if (tache.useUniqueIDs) {
      attribut = decodeur.GetAttributeByUniqueId(maillage, tache.attributeIDs[nom])
    } else {
      const id = decodeur.GetAttributeId(maillage, tache.attributeIDs[nom])
      if (id === -1) continue
      attribut = decodeur.GetAttribute(maillage, id)
    }
    geometrie.attributes.push(decoderAttribut(draco, decodeur, maillage, nom, TypedArray, attribut))
  }
  geometrie.index = decoderIndex(draco, decodeur, maillage)
  draco.destroy(maillage)
  return geometrie
}

beforeAll(async () => {
  // `as unknown as` : draco3d expose bien plus que `@types/draco3d` ne décrit
  // (ex. `DecodeArrayToMesh`) — la surface ci-dessus est celle que
  // `DRACOWorker` utilise réellement, vérifiée en la faisant tourner.
  const decoderModule = (await draco3d.createDecoderModule({})) as unknown as DracoModule

  // `decodeGeometry` existe sur la classe (c'est le seul point d'entrée que
  // `decodeDracoFile` appelle) mais n'est pas exposé par les types de three :
  // un alias local en donne la vraie signature sans `any`.
  type DracoLoaderInterne = DRACOLoader & {
    decodeGeometry(buffer: ArrayBuffer, taskConfig: TacheDecodage): Promise<THREE.BufferGeometry>
    _createGeometry(geometrie: unknown): THREE.BufferGeometry
  }

  // Pas de Worker sous Node/jsdom : `preload()` ne ferait que tenter (et
  // échouer) un fetch des fichiers du décodeur navigateur, inutiles ici.
  DRACOLoader.prototype.preload = function (this: DRACOLoader) {
    return this
  }
  ;(DRACOLoader.prototype as DracoLoaderInterne).decodeGeometry = function (
    this: DracoLoaderInterne,
    buffer: ArrayBuffer,
    taskConfig: TacheDecodage,
  ) {
    const decodeur = new decoderModule.Decoder()
    try {
      const geometrie = decoderGeometrieDraco(decoderModule, decodeur, new Int8Array(buffer), taskConfig)
      // `_createGeometry` (privé par convention, pas par le langage) construit
      // le `THREE.BufferGeometry` final à partir du même format que le Worker
      // upstream produit — inutile de le reproduire.
      return Promise.resolve(this._createGeometry(geometrie))
    } finally {
      decoderModule.destroy(decodeur)
    }
  }

  THREE.ImageLoader.prototype.load = function (
    _url: string,
    onLoad?: (data: HTMLImageElement) => void,
  ): HTMLImageElement {
    const image = { width: 1, height: 1 } as unknown as HTMLImageElement
    onLoad?.(image)
    return image
  }
})

// ── Chargement des vrais GLB ───────────────────────────────────────────────

async function chargerGLTF(cheminRelatif: string) {
  const octets = readFileSync(resolve(process.cwd(), cheminRelatif))
  // `.buffer` type en `ArrayBufferLike` (il couvre aussi `SharedArrayBuffer`) ;
  // celui d'un `Uint8Array` fraîchement construit ici est toujours un vrai
  // `ArrayBuffer`, jamais partagé.
  const tampon = new Uint8Array(octets).buffer as ArrayBuffer
  const loader = new GLTFLoader()
  loader.setDRACOLoader(new DRACOLoader())
  return loader.parseAsync(tampon, '')
}

/** Les géométries de chaque maillage sous `noeud`, ramenées dans l'espace monde. */
function geometriesMonde(noeud: THREE.Object3D): THREE.BufferGeometry[] {
  noeud.updateWorldMatrix(true, true)
  const geometries: THREE.BufferGeometry[] = []
  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const g = (objet.geometry as THREE.BufferGeometry).clone()
    g.applyMatrix4(objet.matrixWorld)
    geometries.push(g)
  })
  return geometries
}

/**
 * Fusionne des géométries en une seule, positions uniquement — tout ce dont
 * `centrer()` a besoin — pour couvrir le lot à une seule pièce (la
 * jardinière, fusionnée en production par `fusionnerEnUnLot`).
 */
function fusionnerPositions(geometries: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const g of geometries) {
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i))
  }
  const fusion = new THREE.BufferGeometry()
  fusion.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return fusion
}

function centreXZ(pieces: readonly { geometry: THREE.BufferGeometry }[]): THREE.Vector3 {
  const boite = new THREE.Box3()
  for (const { geometry } of pieces) {
    geometry.computeBoundingBox()
    boite.union(geometry.boundingBox!)
  }
  return boite.getCenter(new THREE.Vector3())
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('centrer() sur les GLB réels (#51)', () => {
  it('recentre la jardinière de museum-kit.glb sur X/Z (lot à une pièce)', async () => {
    const gltf = await chargerGLTF('public/assets/props/museum-kit.glb')
    const jardiniere = gltf.scene.getObjectByName('Jardiniere')
    expect(jardiniere).toBeDefined()

    const geometries = geometriesMonde(jardiniere!)
    expect(geometries.length).toBeGreaterThan(0)

    const lots = [{ geometry: fusionnerPositions(geometries) }]
    centrer(lots)

    const centre = centreXZ(lots)
    expect(Math.abs(centre.x)).toBeLessThan(1e-4)
    expect(Math.abs(centre.z)).toBeLessThan(1e-4)
  })

  it('recentre une plante multi-nœuds de plants-lod.glb sur X/Z, sans toucher à Y', async () => {
    const gltf = await chargerGLTF('public/assets/plants/plants-lod.glb')
    const feuilles = gltf.scene.getObjectByName('potted_plant_02_leaves')
    const pot = gltf.scene.getObjectByName('potted_plant_02_pot')
    expect(feuilles).toBeDefined()
    expect(pot).toBeDefined()

    const geometries = [...geometriesMonde(feuilles!), ...geometriesMonde(pot!)]
    expect(geometries.length).toBeGreaterThanOrEqual(2)

    const avant = new THREE.Box3()
    for (const g of geometries) {
      g.computeBoundingBox()
      avant.union(g.boundingBox!)
    }
    const yMinAvant = avant.min.y
    const yMaxAvant = avant.max.y

    const lots = geometries.map((geometry) => ({ geometry }))
    centrer(lots)

    const centre = centreXZ(lots)
    expect(Math.abs(centre.x)).toBeLessThan(1e-4)
    expect(Math.abs(centre.z)).toBeLessThan(1e-4)

    const apres = new THREE.Box3()
    for (const g of geometries) {
      g.computeBoundingBox()
      apres.union(g.boundingBox!)
    }
    expect(apres.min.y).toBe(yMinAvant)
    expect(apres.max.y).toBe(yMaxAvant)
  })
})
