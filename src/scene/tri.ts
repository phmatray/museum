/**
 * Le tri des salles appliqué à la scène three (voir `VisibiliteLayer`) : les
 * maillages écartés par leurs calques, les lots d'instances compactés.
 */
import * as THREE from 'three'

import { MUSEE } from '../plan/musee'
import { zonesDuVolume, type Zone } from '../plan/visibilite'

type Tableau = THREE.TypedArray
interface Attr {
  attr: THREE.InstancedBufferAttribute
  copie: Tableau
  version: number
}
interface Lot {
  n: number
  attrs: Attr[]
  zones: Zone[][]
  stable: number
  cle: string
  compacte: boolean
}

const lots = new WeakMap<THREE.InstancedMesh, Lot>()
const masques = new WeakMap<THREE.Object3D, number>()
const boite = new THREE.Box3()
const m4 = new THREE.Matrix4()

let courant: { scene: THREE.Scene; vues: Set<Zone> | null; cle: string } | null = null

/** Ne laisse dans `scene` que les zones `vues` (`null` : tout). `cle` résume `vues`. */
export function trier(scene: THREE.Scene, vues: Set<Zone> | null, cle: string) {
  courant = { scene, vues, cle }
  appliquer(scene, vues, cle)
}

/**
 * Rend `f` sur la scène entière, tri suspendu : pour un rendu qui ne part pas
 * de l'œil du visiteur — une sonde de reflets au centre d'une autre salle.
 */
export function sansTri<T>(f: () => T): T {
  const c = courant
  if (c === null || c.vues === null) return f()
  appliquer(c.scene, null, 'tout')
  try {
    return f()
  } finally {
    appliquer(c.scene, c.vues, c.cle)
  }
}

function zonesDe(min: THREE.Vector3, max: THREE.Vector3): Zone[] {
  return zonesDuVolume(MUSEE, min, max)
}

function montrer(o: THREE.Object3D, oui: boolean) {
  if (!masques.has(o)) masques.set(o, o.layers.mask)
  const d = masques.get(o) ?? 1
  o.layers.mask = oui ? d : 0
}

function appliquer(scene: THREE.Scene, vues: Set<Zone> | null, cle: string) {
  const vu = (zones: Zone[]) => vues === null || zones.length === 0 || zones.some((z) => vues.has(z))
  // Une géométrie partagée entre deux lots ne se compacte pas : leurs attributs se marcheraient dessus.
  const partages = new Map<THREE.BufferGeometry, number>()
  scene.traverse((o) => {
    const m = o as THREE.InstancedMesh
    if (m.isInstancedMesh) partages.set(m.geometry, (partages.get(m.geometry) ?? 0) + 1)
  })
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return
    const g = m.geometry
    // Une zone déclarée (`userData.zone`, l'herbe qui suit le visiteur) prime sur la boîte.
    if (typeof m.userData.zone === 'string') return montrer(m, vu([m.userData.zone]))
    // Hors du tri par le cône de vue (le ciel, la pluie) : sa boîte ne dit pas où il est.
    if (g === undefined || !m.frustumCulled) return
    if (g.boundingBox === null) g.computeBoundingBox()
    if ((m as THREE.InstancedMesh).isInstancedMesh) {
      instances(m as THREE.InstancedMesh, vu, cle, (partages.get(g) ?? 0) > 1)
      return
    }
    boite.copy(g.boundingBox!).applyMatrix4(m.matrixWorld)
    montrer(m, boite.isEmpty() || vu(zonesDe(boite.min, boite.max)))
  })
}

function attributsDInstance(m: THREE.InstancedMesh, partagee: boolean): THREE.InstancedBufferAttribute[] {
  const liste: THREE.InstancedBufferAttribute[] = [m.instanceMatrix]
  if (m.instanceColor) liste.push(m.instanceColor)
  for (const a of Object.values(m.geometry.attributes)) if ((a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) liste.push(a as THREE.InstancedBufferAttribute)
  // Les attributs d'une géométrie partagée ne sont pas à nous : on laisse le lot entier.
  return partagee && liste.length > (m.instanceColor ? 2 : 1) ? [] : liste
}

function instances(m: THREE.InstancedMesh, vu: (z: Zone[]) => boolean, cle: string, partagee: boolean) {
  const attrs = attributsDInstance(m, partagee)
  if (attrs.length === 0) return
  let lot = lots.get(m)
  const touche = lot !== undefined && (lot.attrs.length !== attrs.length || lot.attrs.some((a, i) => a.attr !== attrs[i] || a.attr.version !== a.version))
  if (lot === undefined || touche) {
    // Une couche a réécrit le lot : on rend leurs originaux aux attributs qu'elle n'a pas touchés.
    if (lot?.compacte) for (const a of lot.attrs) if (attrs.includes(a.attr) && a.attr.version === a.version) remettre(a)
    const n = lot?.n ?? m.count
    const g = m.geometry.boundingBox!
    m.updateWorldMatrix(true, false)
    const zones: Zone[][] = []
    for (let i = 0; i < n; i++) {
      m.getMatrixAt(i, m4)
      boite.copy(g).applyMatrix4(m4).applyMatrix4(m.matrixWorld)
      zones.push(boite.isEmpty() ? [] : zonesDe(boite.min, boite.max))
    }
    lot = { n, attrs: attrs.map((attr) => ({ attr, copie: attr.array.slice() as Tableau, version: attr.version })), zones, stable: 0, cle: '', compacte: false }
    lots.set(m, lot)
    m.count = n
    m.computeBoundingSphere()
    montrer(m, true)
    return
  }
  // Un lot qu'une couche réécrit à chaque passe n'arrive jamais ici : il n'est jamais compacté.
  if (++lot.stable < 2 || lot.cle === cle) return
  lot.cle = cle
  const garder: number[] = []
  for (let i = 0; i < lot.n; i++) if (vu(lot.zones[i])) garder.push(i)
  if (garder.length === lot.n) {
    if (lot.compacte) for (const a of lot.attrs) remettre(a)
    lot.compacte = false
  } else {
    for (const a of lot.attrs) {
      const t = a.attr.itemSize
      garder.forEach((i, k) => a.attr.array.set(a.copie.subarray(i * t, (i + 1) * t), k * t))
      a.attr.needsUpdate = true
      a.version = a.attr.version
    }
    lot.compacte = true
  }
  m.count = garder.length
  // La sphère englobante suit les instances gardées : calculée sur un lot
  // compacté (par une couche qui la recalcule après coup), elle oublierait
  // celles qu'on remet en tête ici, et le cône de vue les écarterait.
  m.computeBoundingSphere()
  montrer(m, garder.length > 0)
}

function remettre(a: Attr) {
  a.attr.array.set(a.copie)
  a.attr.needsUpdate = true
  a.version = a.attr.version
}
