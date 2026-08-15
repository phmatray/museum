/**
 * LOT 9 — Chargement du décor d'architecture, et sa FUSION en un seul lot.
 *
 * `domain/decor.ts` a décidé OÙ. Ce module dit AVEC QUOI, et surtout il règle la
 * question qui commande tout le reste : comment poser vingt pièces distinctes
 * sans payer vingt draw calls.
 *
 * ── Fusionner, et non instancier ──
 *
 * `PropsLayer` instancie : un `InstancedMesh` par type de prop, une matrice par
 * exemplaire. C'est le bon choix pour un banc posé douze fois. Ce l'est beaucoup
 * moins pour une pièce d'architecture posée une ou deux fois : chaque type
 * coûterait alors son propre appel, sur un compteur relevé à 259 pour un plafond
 * de 150.
 *
 * On applique donc la matrice de chaque exemplaire à un CLONE de sa géométrie et
 * on fusionne tout en un unique `BufferGeometry`. Le nombre de triangles à
 * l'écran est identique — c'est le même nombre d'exemplaires — mais le coût
 * tombe à UN appel pour tout le décor, quel que soit le nombre de pièces.
 *
 * Ce que ça coûte : la géométrie est dupliquée dans le tampon, là où
 * l'instanciation n'aurait stocké qu'une matrice. Le point de bascule se calcule
 * (voir `SURCHARGE_FUSION`), et la plus grosse famille du catalogue est trois
 * ordres de grandeur en dessous.
 *
 * ── Pourquoi c'est possible ici et pas ailleurs ──
 *
 * Parce que `process-meshy.py` cuit la couleur de chaque pièce dans un attribut
 * de sommet et leur donne à toutes le MÊME matériau blanc à `vertexColors`. Sans
 * cette étape, deux pièces de teintes différentes seraient deux matériaux, donc
 * deux lots, et la fusion n'aurait rien à fusionner.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { DecorId, DecorPlacement } from '../domain/decor'
import { DECOR_KIT_PATH, DECOR_PARC_PATH, NOEUDS_DU_DECOR, NOEUDS_DU_PARC } from './kits'
import { DRACO_PATH } from './kits'

export interface DecorLot {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export type DecorAssets = ReadonlyMap<DecorId, THREE.BufferGeometry>

/**
 * Surcharge de triangles qu'on accepte de payer pour économiser UN draw call.
 *
 * Ce n'est pas un goût, c'est un TAUX DE CHANGE entre les deux plafonds du §9,
 * lu sur les mesures du jour : 259 draw calls pour 150 autorisés — chaque appel
 * est donc cher — et 975 919 triangles pour 1 000 000, soit 24 000 de réserve
 * seulement.
 *
 * Fusionner N exemplaires d'une pièce de T triangles coûte (N − 1) × T triangles
 * de plus que de l'instancier, et rend 1 draw call :
 *
 *     (N − 1) × T ≤ 30 000   →   fusion, 0 appel supplémentaire
 *     sinon                  →   instanciation, 1 appel
 *
 * `T` est LU sur la géométrie chargée, jamais déclaré : une pièce qui grossit
 * dans Blender bascule d'elle-même en instances au lieu de crever le budget de
 * triangles en silence.
 */
export const SURCHARGE_FUSION = 30_000

export function doitFusionner(triangles: number, exemplaires: number): boolean {
  return (exemplaires - 1) * triangles <= SURCHARGE_FUSION
}

let promesse: Promise<DecorAssets> | null = null

/**
 * Charge le décor, une fois pour toute la session. Échoue en DOUCEUR : le musée
 * reste visitable sans ses nervures, comme il reste visitable sans ses bancs.
 */
export function decorAssetsResource(base: string = import.meta.env.BASE_URL): Promise<DecorAssets> {
  promesse ??= charger(base).catch((erreur: unknown) => {
    console.error('décor indisponible', erreur)
    return new Map<DecorId, THREE.BufferGeometry>()
  })
  return promesse
}

async function charger(base: string): Promise<DecorAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}${DRACO_PATH}`)
  gltf.setDRACOLoader(draco)

  const pieces = new Map<DecorId, THREE.BufferGeometry>()

  // DEUX kits, et le second n'est pas un ajout cosmétique : le parc vit à
  // cinquante mètres du hall. Les fusionner en un seul fichier donnerait une
  // boîte englobante allant de l'entrée au fond de la parcelle, que le culling
  // ne pourrait plus jamais écarter. Voir `DECOR_PARC_PATH` dans `kits.ts`.
  //
  // Les deux se chargent EN PARALLÈLE : ils sont indépendants, et les enchaîner
  // ferait attendre le hall après le parc pour rien.
  const [interieur, parc] = await Promise.all([
    gltf.loadAsync(`${base}${DECOR_KIT_PATH}`),
    gltf.loadAsync(`${base}${DECOR_PARC_PATH}`),
  ])

  const kits: [string, GLTF, Record<string, DecorId>][] = [
    [DECOR_KIT_PATH, interieur, NOEUDS_DU_DECOR],
    [DECOR_PARC_PATH, parc, NOEUDS_DU_PARC],
  ]
  for (const [chemin, kit, table] of kits) {
    for (const [nom, id] of Object.entries(table)) {
      const noeud = kit.scene.getObjectByName(nom)
      if (noeud === undefined) {
        console.warn(`${chemin} : nœud « ${nom} » introuvable`)
        continue
      }
      const geometrie = geometrieDuNoeud(noeud)
      if (geometrie !== null) pieces.set(id, geometrie)
    }
  }

  draco.dispose()
  return pieces
}

/** Ramène un nœud à UNE géométrie, transformations de nœud cuites. */
function geometrieDuNoeud(noeud: THREE.Object3D): THREE.BufferGeometry | null {
  noeud.updateWorldMatrix(true, true)
  const inverse = noeud.matrixWorld.clone().invert()

  const morceaux: THREE.BufferGeometry[] = []
  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const g = (objet.geometry as THREE.BufferGeometry).clone()
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, objet.matrixWorld))
    morceaux.push(canoniser(g))
  })
  if (morceaux.length === 0) return null
  const fusion = morceaux.length === 1 ? morceaux[0] : mergeGeometries(morceaux, false)
  for (const m of morceaux) if (m !== fusion) m.dispose()
  return fusion
}

/**
 * Réduit une géométrie au jeu d'attributs EXACT `position, normal, uv, color`.
 *
 * ⚠️ Sans cette normalisation, `mergeGeometries` rend `null` dès que deux
 * géométries n'ont pas exactement les mêmes attributs — et il le rend en
 * SILENCE, sans lever. Le décor entier disparaîtrait alors de la scène pour un
 * second jeu d'UV que Blender aurait exporté sur une pièce et pas sur l'autre.
 *
 * On jette donc les extras, et on synthétise ce qui manque : une couleur blanche
 * si la pièce n'en porte pas — ce qui la laisse au blanc du matériau au lieu de
 * la faire disparaître — et des UV nuls, qui ne servent à rien ici mais dont
 * l'absence sur une seule pièce suffirait à casser la fusion.
 */
function canoniser(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.attributes.position.count
  const propre = new THREE.BufferGeometry()
  propre.setAttribute('position', g.attributes.position)
  propre.setAttribute(
    'normal',
    g.attributes.normal ?? new THREE.BufferAttribute(new Float32Array(n * 3), 3),
  )
  propre.setAttribute('uv', g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  if (g.attributes.color) {
    // Une couleur peut être RGB ou RGBA selon l'exportateur ; on ramène à RGB,
    // parce que mélanger les deux tailles casse la fusion aussi sûrement qu'un
    // attribut absent.
    const src = g.attributes.color
    if (src.itemSize === 3) {
      propre.setAttribute('color', src)
    } else {
      const rgb = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        rgb[i * 3] = src.getX(i)
        rgb[i * 3 + 1] = src.getY(i)
        rgb[i * 3 + 2] = src.getZ(i)
      }
      propre.setAttribute('color', new THREE.BufferAttribute(rgb, 3))
    }
  } else {
    propre.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3))
  }
  if (g.index) propre.setIndex(g.index)
  return propre
}

/**
 * Fusionne tous les placements en UN lot.
 *
 * ⚠️ La géométrie produite est en coordonnées MONDE. Le maillage qui la porte
 * DOIT rester à l'identité — le glisser dans un groupe décalé déplacerait tout
 * le décor du bâtiment.
 */
export function assemblerLeDecor(
  assets: DecorAssets,
  placements: readonly DecorPlacement[],
): DecorLot | null {
  const morceaux: THREE.BufferGeometry[] = []
  const matrice = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const euler = new THREE.Euler()

  for (const p of placements) {
    const source = assets.get(p.id)
    if (source === undefined) continue
    euler.set(p.rotation.x, p.rotation.y, p.rotation.z, 'XYZ')
    quaternion.setFromEuler(euler)
    matrice.compose(
      new THREE.Vector3(p.position.x, p.position.y, p.position.z),
      quaternion,
      new THREE.Vector3(p.scale.x, p.scale.y, p.scale.z),
    )
    const g = source.clone()
    // `applyMatrix4` transporte les NORMALES par l'inverse-transposée : une
    // échelle non uniforme ne les tord donc pas. C'est la seule raison pour
    // laquelle `scale: Vec3` est jouable dans un lot fusionné.
    g.applyMatrix4(matrice)
    morceaux.push(g)
  }

  if (morceaux.length === 0) return null
  const geometry = morceaux.length === 1 ? morceaux[0] : mergeGeometries(morceaux, false)
  for (const m of morceaux) if (m !== geometry) m.dispose()
  if (geometry === null) {
    // Le mode d'échec que `canoniser` existe pour empêcher. S'il survient quand
    // même, il doit être BRUYANT : sans ce message, tout le décor disparaîtrait
    // de la scène sans une ligne dans la console.
    console.error('décor : fusion impossible, jeux d’attributs incompatibles')
    return null
  }
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()

  return {
    geometry,
    material: new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Le matériau reste BLANC : three multiplie `color` par la couleur de
      // sommet, et une teinte ici multiplierait deux fois.
      color: 0xffffff,
      roughness: 0.82,
      metalness: 0,
    }),
  }
}
