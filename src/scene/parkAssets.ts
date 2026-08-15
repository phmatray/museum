/**
 * Chargement des modèles du parc.
 *
 * Même contrat que `propAssets.ts`, et pour les mêmes raisons — un fichier, des
 * couples (géométrie, matériau) prêts à porter une matrice par exemplaire — mais
 * dans un module SÉPARÉ, ce qui n'est pas cosmétique : mêler les arbres aux
 * plantes d'intérieur dans un seul GLB forcerait le navigateur à décoder deux
 * mégaoctets d'arbres pour afficher une salle, et réciproquement.
 *
 * ── Ce que Poly Haven livre, et ce qu'on en garde ──
 *
 * Des modèles de rendu hors ligne : `island_tree_01` pèse 1 599 403 triangles,
 * `jacaranda_tree` 3 863 832. `tools/blender/decimate-plants.py` les ramène à
 * **22 000 par arbre et 4 000 par arbuste** (`BUDGET_ARBRE`, `BUDGET_ARBUSTE`),
 * cartes à 512.
 *
 * ⚠️ Ce paragraphe a annoncé « 6 000 par arbre et 2 000 par arbuste » pendant
 * toute la durée de vie du fichier, et c'était FAUX depuis le correctif qui a
 * relevé les budgets : à 6 000, les cartes de feuilles — deux triangles chacune —
 * étaient les premières effondrées par COLLAPSE et l'arbre sortait en SQUELETTE.
 * Le chiffre a été corrigé dans `decimate-plants.py`, pas ici.
 *
 * Ce n'était pas une coquille, c'était un piège actif : ce commentaire a servi de
 * mesure, et il a fait sous-estimer le parc d'un facteur 2,4 lors d'un
 * dimensionnement de budget. Le parc réel pèse **610 855 triangles à l'écran, soit
 * 64 % de toute la scène** — et non ~250 000. La source de vérité est le fichier
 * Python ; le relevé se rejoue par `node tools/measure-props.ts`, qui compte sur
 * les GLB eux-mêmes et n'a aucun commentaire à croire.
 *
 * On garde leurs matériaux tels quels : le masque d'alpha est ce qui découpe le
 * feuillage dans ses quads, et le fusionner comme on fusionne le mobilier
 * reviendrait à jeter les feuilles pour ne garder que des rectangles.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { EspeceParc } from '../domain/park'

// ── Contrat public ───────────────────────────────────────────────────────

export interface ParkPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

export type ParkAssets = ReadonlyMap<EspeceParc, readonly ParkPiece[]>

// Chemins et noms de nœuds vivent dans `kits.ts`, qui n'importe ni `three` ni
// Vite — voir l'en-tête de ce fichier-là. Réexportés pour que rien ne change
// d'import.
export { DRACO_PATH, ESPECES_PARK_GLB, PARK_LOD } from './kits'

import { ESPECES_PARK_GLB, PARK_LOD, DRACO_PATH } from './kits'

// ── Chargement ───────────────────────────────────────────────────────────

let promesse: Promise<ParkAssets> | null = null

export function parkAssetsResource(base: string = import.meta.env.BASE_URL): Promise<ParkAssets> {
  promesse ??= charger(base).catch((erreur: unknown) => {
    // Le musée reste visitable sans ses arbres : le parc sort en pelouse nue.
    // Même parti que le mobilier et que l'atlas des œuvres.
    console.error('parc indisponible', erreur)
    return new Map<EspeceParc, readonly ParkPiece[]>()
  })
  return promesse
}

async function charger(base: string): Promise<ParkAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}${DRACO_PATH}`)
  gltf.setDRACOLoader(draco)

  const modele = await gltf.loadAsync(`${base}${PARK_LOD}`)
  const especes = new Map<EspeceParc, readonly ParkPiece[]>()

  for (const { id, noeuds } of ESPECES_PARK_GLB) {
    const pieces: ParkPiece[] = []
    for (const nom of noeuds) {
      const noeud = modele.scene.getObjectByName(nom)
      if (noeud === undefined) {
        console.warn(`park-lod.glb : nœud « ${nom} » introuvable`)
        continue
      }
      pieces.push(...lotsParMateriau(noeud))
    }
    if (pieces.length > 0) especes.set(id, pieces)
  }

  draco.dispose()
  return especes
}

/**
 * Regroupe par matériau et cuit les transformations dans les positions.
 *
 * ── Pourquoi cuire ──
 *
 * Le glTF pose l'arbre à une hauteur et une échelle qui lui sont propres. Sans
 * cuisson, l'origine d'une instance n'est pas le PIED de l'arbre, et le parc
 * sort avec des troncs enterrés ou flottants — un décalage que seul un aller-
 * retour dans Blender permettrait de deviner.
 *
 * ── Pourquoi ramener le pied à y = 0 ──
 *
 * `domain/park.ts` place les sujets sur le terrain, en `y = 0`. Il ne peut pas
 * connaître la hauteur du pivot d'un modèle qu'il ne lit pas : c'est donc au
 * chargement de garantir que l'origine d'un sujet est le point où il touche le
 * sol.
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
    const liste = parMateriau.get(materiau)
    if (liste === undefined) parMateriau.set(materiau, [g])
    else liste.push(g)
  })

  // Le pied commun à toutes les pièces du sujet : on mesure AVANT de fusionner,
  // pour que tronc et feuillage descendent du même décalage.
  let piedY = Infinity
  for (const geometries of parMateriau.values()) {
    for (const g of geometries) {
      g.computeBoundingBox()
      piedY = Math.min(piedY, g.boundingBox!.min.y)
    }
  }
  if (!Number.isFinite(piedY)) piedY = 0

  const lots: ParkPiece[] = []
  for (const [materiau, geometries] of parMateriau) {
    const fusion =
      geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
    if (fusion === null) continue
    for (const g of geometries) if (g !== fusion) g.dispose()
    fusion.translate(0, -piedY, 0)
    fusion.computeBoundingBox()
    fusion.computeBoundingSphere()

    const m = (materiau as THREE.MeshStandardMaterial).clone()
    // Le feuillage est vu des DEUX côtés : sans `DoubleSide`, la moitié des
    // feuilles disparaît selon l'angle.
    m.side = THREE.DoubleSide

    /*
      LE SEUIL D'ALPHA, ET POURQUOI IL EST BAS.

      Poly Haven publie ses feuillages en `alphaMode: BLEND`. Rendus tels quels,
      ils exigeraient un tri par profondeur que des dizaines de milliers de
      feuilles instanciées rendent impossible — le résultat scintille et les
      feuilles proches s'effacent derrière les lointaines.

      On passe donc en découpe binaire, ce qui est la pratique standard pour de
      la végétation. Mais le seuil compte : à 0,35, la frange semi-transparente
      qui borde chaque feuille tombe entière, et l'arbre sort en SQUELETTE —
      constaté à l'écran, des branches nues sur toute la parcelle. À 0,15, la
      feuille garde sa silhouette et seul le halo de compression disparaît.
    */
    m.alphaTest = 0.15
    m.transparent = false
    // `depthWrite` doit rester vrai : en découpe binaire il n'y a plus rien à
    // trier, et l'écriture de profondeur est ce qui fait qu'une feuille proche
    // cache bien celle qui est derrière.
    m.depthWrite = true
    lots.push({ geometry: fusion, material: m })
  }
  return lots
}
