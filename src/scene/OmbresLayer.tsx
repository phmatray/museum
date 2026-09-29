/**
 * La lumière du musée, au-delà des sources : les ombres du soleil sur tout ce
 * que les autres couches montent, les ombres de contact sous les meubles, et
 * les reflets (`RefletsLayer`).
 *
 * Chaque couche charge ses modèles à son rythme, sans suspendre : plutôt que de
 * semer `castShadow` dans vingt fichiers, on passe sur la scène une fois par
 * seconde et on règle chaque maillage NEUF une fois pour toutes (`userData`).
 *
 * - Tout ce qui est éclairé REÇOIT l'ombre (le gazon compris).
 * - Tout ce qui est opaque la PORTE : murs, dalles, plafonds, voûte, arbres (le
 *   feuillage découpé par `alphaTest` — three recopie la découpe dans sa passe
 *   de profondeur), bancs, Bavette. C'est ce qui fait enfin de l'intérieur un
 *   intérieur : le soleil ne traverse plus les plafonds.
 * - Le VERRE ne la porte pas : verrière, vitraux, garde-corps, eau sont
 *   transparents — le soleil passe la verrière et pose ses carreaux sur le
 *   terrazzo. Ni le ciel ni les brins d'herbe (`frustumCulled = false`, ils
 *   suivent la caméra), ni les textes, ni les halos (`MeshBasicMaterial`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { regrouperEmprises, type Emprise } from '../domain/ombres'
import { MUSEE } from '../plan/musee'
import { hauteurDuParc } from '../plan/relief'
import type { OmbreBavette } from './BavetteLayer'
import { RefletsLayer } from './RefletsLayer'

const ECLAIRE = (m: THREE.Material) => m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial

function regler(o: THREE.Object3D) {
  if (!(o instanceof THREE.Mesh) || o.userData.ombre !== undefined) return
  const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material | undefined
  if (!m) return
  o.userData.ombre = true
  if (!ECLAIRE(m)) return
  o.receiveShadow = true
  o.castShadow = o.frustumCulled && !m.transparent && m.depthWrite && !/verre|glass|^jardin:eau$/i.test(m.name)
}

export function OmbresLayer() {
  const scene = useThree((s) => s.scene)
  const attente = useRef(0)
  useFrame((_, dt) => {
    attente.current -= dt
    if (attente.current > 0) return
    attente.current = 1
    scene.traverse(regler)
  })
  return (
    <>
      <RefletsLayer />
      <OmbresDeContact />
    </>
  )
}

// ── Les ombres de contact ────────────────────────────────────────────────

/**
 * Sous un banc, une banquette, un pot, un socle, une borne : l'ombre douce que
 * le ciel ne peut pas atteindre, qui POSE l'objet sur le sol. Dedans, le soleil
 * n'entre pas et rien d'autre ne l'aurait dessinée. Une tache de dégradé par
 * meuble (les pièces d'un même meuble fusionnées, `regrouperEmprises`), toutes
 * en un seul appel de dessin ; une de plus sous Bavette, qui la suit.
 */
const MEUBLES = ['mobilier', 'props', 'sculptures', 'vitrines', 'cimaises']
/** La tache déborde l'emprise de tant (m) et d'une fraction, comme une vraie pénombre. */
const DEBORD = { fixe: 0.3, relatif: 0.4 }
const OPACITE = 0.75
const PLANCHERS = MUSEE.levels.map((l) => l.elevation)

/** Un rectangle aux bords flous : plus juste sous un banc qu'une ellipse. */
function tache(): THREE.Texture | null {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  if (ctx === null) return null // jsdom
  // Sur fond noir OPAQUE : `alphaMap` lit le vert, et un flou sur fond
  // transparent garde du blanc pur jusqu'au dernier pixel à peine visible.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 128, 128)
  ctx.filter = 'blur(12px)'
  ctx.fillStyle = '#fff'
  ctx.fillRect(24, 24, 80, 80)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  return t
}

/** Posé au sol : sur un plancher, ou sur le relief du parc. */
function auSol(e: Emprise): boolean {
  const [x, z] = [(e.minX + e.maxX) / 2, (e.minZ + e.maxZ) / 2]
  return PLANCHERS.some((y) => Math.abs(e.minY - y) < 0.12) || Math.abs(e.minY - hauteurDuParc(x, z)) < 0.2
}

function emprisesDe(racine: THREE.Object3D): Emprise[] {
  const out: Emprise[] = []
  const m = new THREE.Matrix4()
  const b = new THREE.Box3()
  racine.updateWorldMatrix(true, true)
  racine.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.material instanceof THREE.MeshBasicMaterial) return
    const g = o.geometry as THREE.BufferGeometry
    if (g.boundingBox === null) g.computeBoundingBox()
    const n = o instanceof THREE.InstancedMesh ? o.count : 1
    for (let i = 0; i < n; i++) {
      if (o instanceof THREE.InstancedMesh) o.getMatrixAt(i, m).premultiply(o.matrixWorld)
      else m.copy(o.matrixWorld)
      b.copy(g.boundingBox!).applyMatrix4(m)
      out.push({ minX: b.min.x, maxX: b.max.x, minY: b.min.y, minZ: b.min.z, maxZ: b.max.z })
    }
  })
  return out
}

function OmbresDeContact() {
  const scene = useThree((s) => s.scene)
  const texture = useMemo(() => tache(), [])
  const materiau = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#000', alphaMap: texture, transparent: true, opacity: OPACITE, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    [texture],
  )
  const plan = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  useEffect(() => () => {
    texture?.dispose()
    materiau.dispose()
    plan.dispose()
  }, [texture, materiau, plan])

  // Les meubles arrivent quand leurs modèles sont chargés : on recompte chaque seconde.
  const [emprises, setEmprises] = useState<Emprise[]>([])
  const releve = useRef<{ attente: number; signature: string; bavette?: THREE.Object3D }>({ attente: 0, signature: '' })
  useFrame((_, dt) => {
    const r = releve.current
    r.attente -= dt
    if (r.attente > 0) return
    r.attente = 1
    r.bavette = scene.getObjectByName('bavette')
    const racines = MEUBLES.flatMap((nom) => scene.getObjectByName(nom) ?? [])
    let signature = ''
    for (const g of racines) g.traverse((o) => { if (o instanceof THREE.Mesh) signature += o instanceof THREE.InstancedMesh ? `${o.count},` : '1,' })
    if (signature === r.signature) return
    r.signature = signature
    setEmprises(regrouperEmprises(racines.flatMap(emprisesDe).filter((e) => e.maxX - e.minX < 6 && e.maxZ - e.minZ < 6)).filter(auSol))
  })

  const taches = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = taches.current
    if (mesh === null) return
    const m = new THREE.Matrix4()
    emprises.forEach((e, i) => {
      const [w, d] = [e.maxX - e.minX, e.maxZ - e.minZ]
      m.makeScale(w * (1 + DEBORD.relatif) + DEBORD.fixe, 1, d * (1 + DEBORD.relatif) + DEBORD.fixe)
      mesh.setMatrixAt(i, m.setPosition((e.minX + e.maxX) / 2, e.minY + 0.012, (e.minZ + e.maxZ) / 2))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [emprises])

  // Bavette, qui se promène : sa tache la suit, dans l'axe de son corps.
  const chat = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const t = chat.current
    const b = releve.current.bavette
    if (t === null) return
    t.visible = b !== undefined
    if (!b) return
    // En sieste, le corps n'est pas à l'aplomb du groupe : `BavetteLayer` dit où tombe l'ombre.
    const o = b.userData.ombre as OmbreBavette | undefined
    if (o) {
      t.position.set(o.x, o.y + 0.012, o.z)
      t.rotation.y = o.yaw + Math.PI
      t.scale.set(o.sx, 1, o.sz)
      return
    }
    t.position.set(b.position.x, b.position.y + 0.012, b.position.z)
    t.rotation.y = b.rotation.y
    t.scale.set(0.34, 1, 0.62)
  })

  if (texture === null) return null
  return (
    <>
      {emprises.length > 0 && <instancedMesh key={emprises.length} ref={taches} args={[plan, undefined, emprises.length]} material={materiau} renderOrder={1} />}
      <mesh ref={chat} geometry={plan} material={materiau} scale={[0.34, 1, 0.62]} renderOrder={1} />
    </>
  )
}
