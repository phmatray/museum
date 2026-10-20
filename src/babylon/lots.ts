/**
 * Les lots d'instances d'un GLB (les instancedMesh de MobilierLayer, PropsLayer,
 * VitrinesLayer) : une thin instance par pose, un lot par primitive glTF.
 *
 * - `Pose` / `matrices` : des poses (position, lacet autour de +Y, échelle
 *   uniforme ou par axe) en buffers de matrices par modèle. Le lacet envoie le x local
 *   vers (cos, 0, −sin), comme `makeRotationY` de three.
 * - `posesDuMobilier` : les poses de `plan/mobilier.ts` (POSES de
 *   MobilierLayer.tsx), cordon développé en potelets, extincteurs accrochés.
 * - `cacherAuLoin` : retire d'un lot les instances trop loin du visiteur ou
 *   hors du champ (galets du ruisseau, touffes des allées, petits végétaux).
 * - `instancier` : pose un conteneur chargé par lots. UN SEUL appelant par
 *   fichier GLB : un conteneur ne se pose qu'une fois (plantes.glb est à
 *   props.ts, qui y ajoute les Kentia et Lyrata du mobilier).
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Node } from '@babylonjs/core/node'
import type { Scene } from '@babylonjs/core/scene'

import { garniture, MOBILIER } from '../plan/mobilier.ts'
import { brancherLueurs } from './lueurs.ts'

export interface Pose {
  /** Le nœud racine du GLB (Banquette, Lyrata…) ou le nom exact d'un maillage (Lyrata-cuve). */
  piece: string
  x: number
  y: number
  z: number
  lacet: number
  /** Uniforme, ou (sx, sy, sz) dans le repère du modèle (buis et azalées, touffes des allées). */
  echelle?: number | readonly [number, number, number]
}

/** Les poses en buffers de matrices (16 flottants par instance, stockage Babylon), un par pièce. */
export function matrices(poses: readonly Pose[]): Map<string, Float32Array> {
  const parPiece = new Map<string, Pose[]>()
  for (const p of poses) parPiece.set(p.piece, [...(parPiece.get(p.piece) ?? []), p])
  return new Map(
    [...parPiece].map(([piece, ps]) => {
      const buf = new Float32Array(16 * ps.length)
      ps.forEach((p, i) => {
        const s = p.echelle ?? 1
        Matrix.Compose(typeof s === 'number' ? new Vector3(s, s, s) : Vector3.FromArray(s), Quaternion.RotationAxis(Vector3.Up(), p.lacet), new Vector3(p.x, p.y, p.z)).copyToArray(buf, 16 * i)
      })
      return [piece, buf]
    }),
  )
}

/** Les poses de tout le mobilier (intérieur et parc) : le cordon devient ses 7 potelets, l'extincteur monte de son accroche. */
export function posesDuMobilier(): Pose[] {
  return MOBILIER.flatMap((m): Pose[] =>
    m.piece === 'Cordon'
      ? garniture(m).map((g) => ({ piece: g.piece, x: g.x, y: m.y, z: g.z, lacet: g.lacet }))
      : [{ piece: m.piece, x: m.x, y: m.y + (m.accroche ?? 0), z: m.z, lacet: m.lacet }],
  )
}

/** La pièce d'un maillage : son ancêtre posé sous `__root__` (ou sans parent). */
function pieceDe(n: Node): string {
  while (n.parent && n.parent.name !== '__root__') n = n.parent
  return n.name
}

/**
 * Pose un conteneur par lots : chaque maillage (primitive) reçoit le buffer de
 * son nom exact, sinon celui de sa pièce ; sans pose, il est jeté (l'InstancedMesh
 * d'une géométrie partagée aussi : on ne pose pas de thin instances dessus).
 * Les maillages gardés quittent leur parent (transformation monde cuite si elle
 * n'est pas l'identité), reçoivent les ombres, prennent les lueurs (matières non
 * fondues). Rend les porteurs d'ombre : tout sauf le fondu (verre).
 */
export function instancier(c: AssetContainer, buffers: ReadonlyMap<string, Float32Array>): Mesh[] {
  c.addAllToScene()
  const gardes: Mesh[] = []
  for (const m of [...c.meshes]) {
    if (!(m instanceof Mesh) || m instanceof InstancedMesh || m.getTotalVertices() === 0) continue
    const buf = buffers.get(m.name) ?? buffers.get(pieceDe(m))
    if (!buf) continue
    m.setParent(null)
    if (!m.computeWorldMatrix(true).isIdentity()) m.bakeCurrentTransformIntoVertices()
    m.thinInstanceSetBuffer('matrix', buf, 16)
    m.isPickable = false
    m.receiveShadows = true
    gardes.push(m)
  }
  // Le reste (nœuds, instances, pièces sans pose), sans toucher aux matières ni aux géométries gardées.
  for (const m of c.meshes) if (!gardes.includes(m as Mesh)) m.dispose(true, false)
  for (const t of c.transformNodes) t.dispose(true, false)
  const opaques = gardes.filter((m) => !m.material?.needAlphaBlending())
  brancherLueurs(new Set(opaques.map((m) => m.material!)))
  return opaques
}

/** Au loin au-delà de `portee`, revenu seulement en deçà de `portee − 3` (hystérésis : pas de clignotement). */
export const auLoin = (d: number, avant: boolean, portee: number): boolean => (avant ? d > portee - 3 : d > portee)

/**
 * Les instances d'un lot au-delà de `portee` m du visiteur (vue de dessus,
 * hystérésis `auLoin`) ou hors du champ de la caméra (sphère du modèle à
 * l'échelle de l'instance) ne sont plus dessinées : à chaque changement, les
 * buffers d'instance (`kind` → [tampon VIVANT passé à thinInstanceSetBuffer,
 * pas]) sont recompactés depuis une copie des originaux. Écart voulu à three
 * (qui dessine tout) : de petits objets, quelques pixels à cette distance.
 * ponytail : la carte d'ombre, redessinée à la demande, prend le lot tel qu'il
 * est compacté à ce moment (une ombre qui entrerait par le bord de l'écran manque
 * jusqu'au redessin suivant, soit au plus un pas ou un quart de tour).
 */
export function cacherAuLoin(scene: Scene, m: Mesh, buffers: Record<string, [Float32Array, number]>, portee: number): void {
  const originaux = Object.entries(buffers).map(([k, [d, pas]]) => [k, d, d.slice(), pas] as const)
  const nb = buffers.matrix[0].length / 16
  // Le centre et le rayon de chaque instance, une fois (les lots ne bougent pas).
  const s = m.getRawBoundingInfo().boundingSphere
  const spheres = new Float32Array(4 * nb)
  const [t, v] = [new Matrix(), new Vector3()]
  for (let i = 0; i < nb; i++) {
    Matrix.FromArrayToRef(buffers.matrix[0], 16 * i, t)
    Vector3.TransformCoordinatesToRef(s.center, t, v)
    const e = (k: number) => Math.hypot(t.m[k], t.m[k + 1], t.m[k + 2])
    spheres.set([v.x, v.y, v.z, s.radius * Math.max(e(0), e(4), e(8))], 4 * i)
  }
  const loin = new Array<boolean>(nb).fill(false)
  const vus = new Uint8Array(nb).fill(1)
  const plans = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0))
  // Les buffers posés statiques (défaut de thinInstanceSetBuffer) refaits modifiables au premier recompactage.
  m.thinInstanceAllowAutomaticStaticBufferRecreation = true
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera
    if (!cam) return
    const c = cam.globalPosition
    Frustum.GetPlanesToRef(cam.getTransformationMatrix(), plans)
    let change = false
    for (let i = 0; i < nb; i++) {
      const [x, y, z, r] = [spheres[4 * i], spheres[4 * i + 1], spheres[4 * i + 2], spheres[4 * i + 3]]
      loin[i] = auLoin(Math.hypot(x - c.x, z - c.z), loin[i], portee)
      let vu = !loin[i]
      for (let k = 0; vu && k < 6; k++) vu = plans[k].normal.x * x + plans[k].normal.y * y + plans[k].normal.z * z + plans[k].d >= -r
      change ||= +vu !== vus[i]
      vus[i] = +vu
    }
    if (!change) return
    let n = 0
    for (let i = 0; i < nb; i++) {
      if (!vus[i]) continue
      for (const [, vivant, orig, pas] of originaux) vivant.set(orig.subarray(pas * i, pas * i + pas), pas * n)
      n++
    }
    m.thinInstanceCount = n
    for (const [k] of originaux) m.thinInstanceBufferUpdated(k)
    // Sans instance, Babylon dessinerait le modèle seul à l'origine.
    m.setEnabled(n > 0)
  })
}
