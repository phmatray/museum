import * as THREE from 'three'

import { ecartDeMatrice } from '../domain/ombres'

interface Porteur {
  o: THREE.Mesh
  /** Le maillage, et les os d'un maillage animé (Bavette). */
  suivis: THREE.Object3D[]
  rayon: number
  /** L'état du porteur quand la carte a été dessinée : ses matrices à plat, puis visibilité, calques, instances. */
  dessine: Float64Array
}

const DISCRETS = 4
/** Le sol le plus bas où tombe une ombre (m), et la plus longue ombre qu'on suit. */
const SOL = -2
const PORTEE = 60
const M = new THREE.Matrix4()

/**
 * Les porteurs d'ombre, face à la carte du soleil qui n'est plus redessinée à
 * chaque image (`LumiereDuJour`) : lequel s'est écarté de la place où la carte
 * le montre ? Qu'il bouge (sa matrice, les os de Bavette), apparaisse ou
 * disparaisse (`visible`, les calques du tri des salles), ou que ses instances
 * soient réécrites. Un mouvement plus fin que `seuil` — moins d'un texel de la
 * carte — ne s'y verrait pas : il attend d'avoir grandi. La liste des porteurs
 * est relevée une fois par seconde ; qu'elle change, et tout est à redessiner.
 */
export class VeilleDesPorteurs {
  private porteurs: Porteur[] = []
  private attente = 0
  private readonly sphere = new THREE.Sphere()
  private readonly vue = new THREE.Frustum()

  /**
   * La distance au visiteur du plus proche porteur à redessiner ; `Infinity`
   * si aucun, 0 si la liste a changé ou si l'un a paru ou disparu. Un porteur
   * qui bouge hors de la vue, lui ET son ombre (vers `-d`, jusqu'au sol le plus
   * bas), attend : on le redessinera à sa place dès qu'on pourra le voir.
   */
  bouge(scene: THREE.Scene, oeil: THREE.Camera, d: readonly number[], dt: number, seuil: number): number {
    this.attente -= dt
    if (this.attente <= 0) {
      this.attente = 1
      if (this.relever(scene)) return 0
    }
    this.vue.setFromProjectionMatrix(M.multiplyMatrices(oeil.projectionMatrix, oeil.matrixWorldInverse))
    let min = Infinity
    for (const p of this.porteurs) {
      const e = ecart(p)
      if (e === Infinity) return 0
      if (e <= seuil) continue
      const o = p.o
      const b = (o instanceof THREE.InstancedMesh ? o.boundingSphere : null) ?? o.geometry.boundingSphere
      if (b === null) return 0
      const s = this.sphere.copy(b).applyMatrix4(o.matrixWorld)
      const distance = Math.max(0, s.center.distanceTo(oeil.position) - s.radius)
      // La sphère qui tient le porteur et son ombre portée.
      const t = Math.min(PORTEE, (s.center.y + s.radius - SOL) / Math.max(d[1], 1e-3)) / 2
      s.center.x -= d[0] * t
      s.center.y -= d[1] * t
      s.center.z -= d[2] * t
      s.radius += t
      if (this.vue.intersectsSphere(s)) min = Math.min(min, distance)
    }
    return min
  }

  /** La carte vient d'être redessinée : chacun y est à sa place d'à présent. */
  dessinee() {
    for (const p of this.porteurs) lire(p, p.dessine)
  }

  private relever(scene: THREE.Scene): boolean {
    const avant = this.porteurs
    const apres: THREE.Mesh[] = []
    scene.traverse((o) => { if (o instanceof THREE.Mesh && o.castShadow) apres.push(o) })
    if (apres.length === avant.length && apres.every((o, i) => o === avant[i].o)) return false
    this.porteurs = apres.map((o) => {
      const suivis = o instanceof THREE.SkinnedMesh ? [o, ...o.skeleton.bones] : [o]
      if (o.geometry.boundingSphere === null) o.geometry.computeBoundingSphere()
      const rayon = (o.geometry.boundingSphere?.radius ?? 0) * o.matrixWorld.getMaxScaleOnAxis()
      return { o, suivis, rayon, dessine: new Float64Array(suivis.length * 16 + DISCRETS) }
    })
    return true
  }
}

/** Ce qu'un porteur a de discret : visible, ses calques, ses instances. */
function discrets(o: THREE.Mesh, out: Float64Array | number[], k: number) {
  let vu = 1
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) vu = 0
  out[k] = vu
  out[k + 1] = o.layers.mask
  out[k + 2] = o instanceof THREE.InstancedMesh ? o.count : 1
  out[k + 3] = o instanceof THREE.InstancedMesh ? o.instanceMatrix.version : 0
}

function lire(p: Porteur, out: Float64Array) {
  p.suivis.forEach((s, i) => out.set(s.matrixWorld.elements, i * 16))
  discrets(p.o, out, p.suivis.length * 16)
}

const D: number[] = []

/** De combien (m) le porteur s'est écarté de sa place sur la carte ; `Infinity` pour un changement discret. */
function ecart(p: Porteur): number {
  const n = p.suivis.length * 16
  discrets(p.o, D, 0)
  for (let i = 0; i < DISCRETS; i++) if (D[i] !== p.dessine[n + i]) return Infinity
  let e = 0
  for (let i = 0; i < p.suivis.length; i++) e = Math.max(e, ecartDeMatrice(p.dessine, i * 16, p.suivis[i].matrixWorld.elements, p.rayon))
  return e
}
