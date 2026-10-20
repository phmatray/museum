/**
 * Les lots d'instances d'un GLB (les instancedMesh de MobilierLayer, PropsLayer,
 * VitrinesLayer) : une thin instance par pose, un lot par primitive glTF.
 *
 * - `Pose` / `matrices` : des poses (position, lacet autour de +Y, échelle
 *   uniforme) en buffers de matrices par modèle. Le lacet envoie le x local
 *   vers (cos, 0, −sin), comme `makeRotationY` de three.
 * - `posesDuMobilier` : les poses de `plan/mobilier.ts` (POSES de
 *   MobilierLayer.tsx), cordon développé en potelets, extincteurs accrochés.
 * - `instancier` : pose un conteneur chargé par lots. UN SEUL appelant par
 *   fichier GLB : un conteneur ne se pose qu'une fois (plantes.glb est à
 *   props.ts, qui y ajoute les Kentia et Lyrata du mobilier).
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Node } from '@babylonjs/core/node'

import { garniture, MOBILIER } from '../plan/mobilier.ts'
import { brancherLueurs } from './lueurs.ts'

export interface Pose {
  /** Le nœud racine du GLB (Banquette, Lyrata…) ou le nom exact d'un maillage (Lyrata-cuve). */
  piece: string
  x: number
  y: number
  z: number
  lacet: number
  echelle?: number
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
        Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationAxis(Vector3.Up(), p.lacet), new Vector3(p.x, p.y, p.z)).copyToArray(buf, 16 * i)
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
