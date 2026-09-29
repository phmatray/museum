/**
 * Ne dessiner que ce qu'on peut voir (`plan/visibilite.ts`).
 *
 * Chaque fois que le visiteur a fait quelques pas, les zones visibles de là où
 * il est sont recalculées, et tout le reste de la scène est écarté du rendu —
 * sans qu'aucune couche n'ait à le savoir :
 *
 * - un maillage ordinaire l'est d'un bloc, selon les zones que touche sa boîte
 *   englobante. On passe par ses `layers` et pas par `visible`, que certaines
 *   couches pilotent déjà elles-mêmes ;
 * - un lot d'instances est COMPACTÉ : les instances des zones visibles sont
 *   recopiées en tête de tous ses attributs d'instance, et `count` s'arrête
 *   là. Un seul appel de dessin comme avant, mais seulement les toiles, les
 *   projecteurs ou les bancs qu'on peut voir. Les originaux sont gardés à part.
 *
 * Un lot qu'une couche réécrit (les étoiles de la constellation, l'éveil des
 * toiles, à chaque image) n'est jamais compacté : il faut qu'il soit resté
 * tel quel deux passes de suite. Et si une couche réécrit un lot déjà compacté
 * (un escalier qui arrive, par exemple), on le détecte à la version de ses
 * attributs, on remet les originaux et on recommence.
 */
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { MUSEE } from '../plan/musee'
import { RAYON_OEIL, zonesDuVolume, zonesVisibles, type Zone } from '../plan/visibilite'

/** Même sans bouger : de quoi prendre en compte ce qui vient de se charger. */
const PERIODE = 0.5

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

export function VisibiliteLayer() {
  const scene = useThree((s) => s.scene)
  const etat = useRef({ x: NaN, y: NaN, z: NaN, vues: new Set<Zone>(), cle: '', attente: 0 })
  useFrame(({ camera }, dt) => {
    const e = etat.current
    const p = camera.position
    const bouge = !(Math.hypot(p.x - e.x, p.z - e.z) < RAYON_OEIL / 2 && Math.abs(p.y - e.y) < 0.5)
    e.attente -= dt
    if (!bouge && e.attente > 0) return
    e.attente = PERIODE
    if (bouge) {
      Object.assign(e, { x: p.x, y: p.y, z: p.z })
      e.vues = zonesVisibles(MUSEE, zonesDuVolume(MUSEE, p, p, RAYON_OEIL), p)
      e.cle = [...e.vues].sort().join()
    }
    // En développement, `window.__TOUT_VOIR__ = true` rend tout, pour mesurer avant/après.
    if (import.meta.env.DEV && (window as { __TOUT_VOIR__?: boolean }).__TOUT_VOIR__) appliquer(scene, null, 'tout')
    else appliquer(scene, e.vues, e.cle)
  })
  return null
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
    montrer(m, true)
    return
  }
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
  montrer(m, garder.length > 0)
}

function remettre(a: Attr) {
  a.attr.array.set(a.copie)
  a.attr.needsUpdate = true
  a.version = a.attr.version
}
 
