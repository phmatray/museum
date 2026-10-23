/**
 * Les spectateurs du cinéma : des visiteurs (les modèles des PNJ, `pnj.ts`) assis dans les
 * fauteuils que le plan leur réserve (`SPECTATEURS`, plan/cinema.ts), qui attendent ou
 * regardent la séance, chacun à son rythme.
 *
 * Comme les PNJ : une seule action (« Chair Sit Idle ») cuite en texture, un lot de thin
 * instances par modèle. Ils sont de la salle : ses lumières seules les éclairent.
 */
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import type { Siege } from '../plan/cinema.ts'
import { MODELES_PNJ } from '../plan/pnj.ts'
import { VIVANTES } from './etat.ts'
import { glbOuRien } from './glb.ts'
import { cuire } from './pnj.ts'

const CADENCE = 30
/** Le dos du spectateur, derrière le centre de la place (m) : contre le dossier du fauteuil (78 cm de fond). */
const DOSSIER = 0.22
const ECHANTILLONS = 40

/**
 * La silhouette assise, mesurée sur le squelette (sur le processeur, une fois) : le dos (le z le plus
 * en arrière de toute l'action) et le bassin en x. Meshy place l'origine où il veut : jusqu'à 80 cm
 * devant le corps, et 17 à 20 cm à côté du bassin (le spectateur chevauchait l'accoudoir).
 * L'action entière est jouée : elle penche le buste et allonge les jambes devant le fauteuil, où le rang
 * laisse la place ; la couper la faisait sauter d'une image à l'autre en boucle.
 */
export function gabarit(maillage: Mesh, groupe: AnimationGroup): { dos: number; cote: number } {
  const avant = maillage.computeBonesUsingShaders
  maillage.computeBonesUsingShaders = false
  const bassin = maillage.skeleton!.bones.find((b) => /hips|pelvis/i.test(b.name))
  let dos = Infinity
  let cote = 0
  for (let k = 0; k <= ECHANTILLONS; k++) {
    const f = groupe.from + ((groupe.to - groupe.from) * k) / ECHANTILLONS
    groupe.start(false, 1, f, f)
    groupe.goToFrame(f)
    groupe.pause()
    maillage.skeleton!.prepare(true)
    maillage.refreshBoundingInfo({ applySkeleton: true, applyMorph: false })
    const b = maillage.getBoundingInfo().boundingBox
    dos = Math.min(dos, b.minimumWorld.z)
    if (k === 0) cote = bassin ? Vector3.TransformCoordinates(bassin.getAbsolutePosition(), maillage.computeWorldMatrix(true)).x : (b.minimumWorld.x + b.maximumWorld.x) / 2
    groupe.stop()
  }
  maillage.computeBonesUsingShaders = avant
  maillage.refreshBoundingInfo()
  return { dos, cote }
}

/** Monte les spectateurs ; rend leurs maillages (à éclairer par la salle). */
export async function monterSpectateurs(scene: Scene, sieges: readonly Siege[]): Promise<Mesh[]> {
  const parModele = MODELES_PNJ.map((_, n) => sieges.filter((_, i) => i % MODELES_PNJ.length === n))
  const conteneurs = await Promise.all(parModele.map((qui, n) => (qui.length ? glbOuRien(scene, `assets/pnj/pnj-${MODELES_PNJ[n]}.glb`) : Promise.resolve(null))))
  const maillages: Mesh[] = []
  conteneurs.forEach((c, n) => {
    const qui = parModele[n]
    if (!c || qui.length === 0) return
    c.addAllToScene()
    const maillage = c.meshes.find((x): x is Mesh => x instanceof Mesh && !!x.skeleton)
    if (!maillage) return
    const assise = c.animationGroups.find((g) => /sit/i.test(g.name))
    const { dos, cote } = assise ? gabarit(maillage, assise) : { dos: 0, cote: 0 }
    const cuit = cuire(scene, maillage, c.animationGroups, { assis: /sit/i })
    for (const g of c.animationGroups) g.dispose()
    if (!cuit) return console.warn(`spectateur ${n} : pas d'action assise`)
    const vat = new BakedVertexAnimationManager(scene)
    vat.texture = cuit.texture
    maillage.bakedVertexAnimationManager = vat
    for (const m of c.materials) {
      m.name = `spectateur-${n}`
      VIVANTES.add(m.name)
    }
    maillage.isPickable = false
    maillage.alwaysSelectAsActiveMesh = true
    // Même composition que les PNJ : la matrice monde porte l'armature au centième (W · T · W⁻¹).
    const W = maillage.computeWorldMatrix(true).clone()
    const Wi = W.clone().invert()
    const matrices = new Float32Array(qui.length * 16)
    const actions = new Float32Array(qui.length * 4)
    const [a, b] = cuit.plages.assis
    // Le dos (z du modèle, qui regarde +z) contre le dossier, le bassin au milieu de la place :
    // le demi-tour envoie l'un derrière la place, l'autre de l'autre côté.
    const recul = DOSSIER + dos
    const t = new Matrix()
    qui.forEach((s, i) => {
      // Face à l'écran (vers −z) : le modèle glTF regarde +z, un demi-tour.
      Matrix.ComposeToRef(Vector3.OneReadOnly, Quaternion.RotationYawPitchRoll(Math.PI, 0, 0), new Vector3(s.x + cote, s.y, s.z + recul), t)
      W.multiply(t).multiply(Wi).copyToArray(matrices, i * 16)
      // Chacun à son rythme : un décalage dans l'action.
      actions.set([a, b, ((i * 37 + n * 11) % (b - a + 1)), CADENCE], i * 4)
    })
    maillage.thinInstanceSetBuffer('matrix', matrices, 16)
    maillage.thinInstanceSetBuffer('bakedVertexAnimationSettingsInstanced', actions, 4)
    scene.onBeforeRenderObservable.add(() => { vat.time += scene.getEngine().getDeltaTime() / 1000 })
    maillages.push(maillage)
  })
  return maillages
}
