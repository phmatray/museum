/**
 * La géométrie statique fusionnée : un appel de dessin par matière et par zone,
 * au lieu d'un par pièce.
 *
 * Les modèles Blender posés tels quels (la nef, le vitrail Batlló, la salle
 * d'honneur, le jardin…) arrivent en autant de maillages que d'objets Blender :
 * dix-huit pièces de chêne dans le vitrail, cinq fontes dans la nef. Chacune
 * coûte un appel de dessin à chaque passe — l'image, l'occlusion ambiante,
 * l'ombre. `fusionnerParMatiere` les réunit, matière par matière, sans rien
 * changer à l'image :
 *
 * - seulement ce qui partage la MÊME matière (l'objet three, donc ses
 *   uniformes, ses greffes, ses réglages par nom restent justes), les mêmes
 *   attributs, les mêmes réglages d'ombre et d'ordre de rendu ;
 * - jamais par-dessus deux zones du tri des salles (`VisibiliteLayer`) : un
 *   morceau de la salle d'à côté ne ressortirait plus avec elle ;
 * - jamais ce que le code retrouve par son nom (les aiguilles de l'horloge,
 *   le parquet de la salle d'honneur) : `garder` les épargne.
 *
 * `unePasse` fait dessiner en une passe les verres PLANS : three dessine un
 * transparent double face en deux passes (le dos, puis la face) pour qu'un
 * volume se recouvre dans le bon ordre ; sur un plan, les deux faces ne se
 * recouvrent jamais, la seconde passe ne dessine que du vide.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { MUSEE } from '../plan/musee'
import { zonesDuVolume } from '../plan/visibilite'

const boite = new THREE.Box3()

/** La signature des attributs : on ne fusionne que des géométries de même forme. */
function forme(g: THREE.BufferGeometry): string {
  const attrs = Object.entries(g.attributes).map(([n, a]) => `${n}:${a.itemSize}:${(a as THREE.BufferAttribute).normalized ? 1 : 0}`).sort()
  return `${g.index ? 'i' : 'n'}|${attrs.join(',')}`
}

/**
 * Réunit les maillages de `racine` qui partagent une matière, dans le repère
 * de `racine`. Rend le nombre de maillages retirés.
 */
export function fusionnerParMatiere(racine: THREE.Object3D, garder: (o: THREE.Object3D) => boolean = () => false): number {
  racine.updateWorldMatrix(true, true)
  const versRacine = new THREE.Matrix4().copy(racine.matrixWorld).invert()
  const groupes = new Map<string, THREE.Mesh[]>()
  racine.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return
    if (Array.isArray(m.material) || !m.visible || garder(m)) return
    const g = m.geometry
    if (Object.keys(g.morphAttributes).length > 0 || g.groups.length > 0) return
    // Un parent caché ou écarté cache aussi : on ne touche qu'à ce qui se voit.
    for (let p = m.parent; p && p !== racine; p = p.parent) if (!p.visible || garder(p)) return
    if (g.boundingBox === null) g.computeBoundingBox()
    boite.copy(g.boundingBox!).applyMatrix4(m.matrixWorld)
    const zones = typeof m.userData.zone === 'string' ? m.userData.zone : zonesDuVolume(MUSEE, boite.min, boite.max).join(',')
    const cle = [m.material.uuid, forme(g), m.castShadow, m.receiveShadow, m.renderOrder, m.frustumCulled, m.layers.mask, zones].join('|')
    groupes.set(cle, [...(groupes.get(cle) ?? []), m])
  })
  let retires = 0
  for (const maillages of groupes.values()) {
    if (maillages.length < 2) continue
    const geometries = maillages.map((m) => m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(versRacine, m.matrixWorld)))
    const fusion = mergeGeometries(geometries, false)
    for (const g of geometries) g.dispose()
    if (fusion === null) continue
    const modele = maillages[0]
    const m = new THREE.Mesh(fusion, modele.material)
    m.name = `${modele.name}+${maillages.length - 1}`
    Object.assign(m, { castShadow: modele.castShadow, receiveShadow: modele.receiveShadow, renderOrder: modele.renderOrder, frustumCulled: modele.frustumCulled })
    m.layers.mask = modele.layers.mask
    m.userData = { ...modele.userData }
    fusion.computeBoundingBox()
    fusion.computeBoundingSphere()
    racine.add(m)
    for (const o of maillages) o.removeFromParent()
    retires += maillages.length - 1
  }
  return retires
}

/**
 * Une famille de matières qui ne diffèrent que par leur couleur — les cives du
 * vitrail, chacune sa teinte, la même opacité, le même poli, une lueur
 * proportionnelle à sa couleur — devient UNE matière : la couleur passe dans
 * les sommets, la lueur la suit (`émission × couleur du sommet`). La première
 * de la famille sert de modèle et garde son nom : ce qui la règle par son nom
 * règle toute la famille. `fusionnerParMatiere` réunit ensuite les maillages.
 * Rend le nombre de matières remplacées.
 */
export function unifierParCouleur(racine: THREE.Object3D, prefixe: string): number {
  const familles: THREE.Mesh[] = []
  racine.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && !Array.isArray(m.material) && m.material.name.startsWith(prefixe) && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) familles.push(m)
  })
  const matieres = [...new Set(familles.map((m) => m.material as THREE.MeshStandardMaterial))]
  if (matieres.length < 2) return 0
  const modele = matieres[0]
  // La lueur, rapportée à la couleur : la même pour toute la famille (on prend la moyenne).
  const part = matieres.reduce((s, m) => s + (m.emissive.r + m.emissive.g + m.emissive.b) / Math.max(1e-6, m.color.r + m.color.g + m.color.b), 0) / matieres.length
  const unie = modele.clone()
  unie.color.setRGB(1, 1, 1)
  unie.emissive.setRGB(part, part, part)
  unie.vertexColors = true
  const avant = unie.onBeforeCompile.bind(unie)
  const cle = unie.customProgramCacheKey()
  unie.onBeforeCompile = (s, r) => {
    avant(s, r)
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;')
  }
  unie.customProgramCacheKey = () => `${cle}|lueur-sommets`
  for (const m of familles) {
    const c = (m.material as THREE.MeshStandardMaterial).color
    const n = m.geometry.getAttribute('position').count
    m.geometry = m.geometry.clone()
    m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3))
    m.material = unie
  }
  for (const m of matieres) m.dispose()
  return matieres.length
}

/**
 * Toutes les normales d'une géométrie dans le MÊME sens ? Une vitre, ou des
 * pièces de verre côte à côte dans un même vitrail. Pas une vitre épaisse (deux
 * faces opposées) : là, les deux passes remettent le dos avant la face.
 */
function plane(g: THREE.BufferGeometry): boolean {
  const n = g.getAttribute('normal')
  if (n === undefined || n.count === 0) return false
  const a = new THREE.Vector3().fromBufferAttribute(n, 0).normalize()
  const b = new THREE.Vector3()
  for (let i = 1; i < n.count; i++) if (b.fromBufferAttribute(n, i).normalize().dot(a) < 0.999) return false
  return true
}

/**
 * Passe en une seule passe chaque matière transparente double face dont TOUS
 * les maillages, sous `racine`, sont plans. Rend le nombre de matières réglées.
 */
export function unePasse(racine: THREE.Object3D): number {
  const plans = new Map<THREE.Material, boolean>()
  racine.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || Array.isArray(m.material)) return
    const mat = m.material
    if (!mat.transparent || mat.side !== THREE.DoubleSide) return
    // Un maillage plan dans une matière partagée avec un volume ne suffit pas.
    plans.set(mat, (plans.get(mat) ?? true) && plane(m.geometry))
  })
  let n = 0
  for (const [mat, oui] of plans) {
    if (!oui || mat.forceSinglePass) continue
    mat.forceSinglePass = true
    n++
  }
  return n
}
