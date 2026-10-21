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
import { VIVANTES } from './etat.ts'
import { glbOuRien } from './glb.ts'
import { cuire } from './pnj.ts'

const MODELES = 8
const CADENCE = 30
/** Le dos du spectateur, derrière le centre de la place (m) : contre le dossier du fauteuil (78 cm de fond). */
const DOSSIER = 0.22
/** Ce que la silhouette peut bouger (m) sans traverser un fauteuil : au-delà, la boucle s'arrête. */
const TOLERANCE = 0.05
const ECHANTILLONS = 40

/**
 * La silhouette assise, mesurée sur le squelette (sur le processeur, une fois) : le dos et la part
 * de l'action qui reste dans le gabarit de la première image. Meshy place l'origine où il veut
 * (jusqu'à 80 cm devant le corps), et l'action allonge les jambes ou penche le buste en son milieu.
 */
export function gabarit(maillage: Mesh, groupe: AnimationGroup): { dos: number; part: number } {
  const avant = maillage.computeBonesUsingShaders
  maillage.computeBonesUsingShaders = false
  const mesures: [number, number][] = []
  for (let k = 0; k <= ECHANTILLONS; k++) {
    const f = groupe.from + ((groupe.to - groupe.from) * k) / ECHANTILLONS
    groupe.start(false, 1, f, f)
    groupe.goToFrame(f)
    groupe.pause()
    maillage.skeleton!.prepare(true)
    maillage.refreshBoundingInfo({ applySkeleton: true, applyMorph: false })
    const b = maillage.getBoundingInfo().boundingBox
    mesures.push([b.minimumWorld.z, b.maximumWorld.z])
    groupe.stop()
  }
  maillage.computeBonesUsingShaders = avant
  maillage.refreshBoundingInfo()
  const [z0, z1] = mesures[0]
  const k = mesures.findIndex(([a, b]) => Math.abs(a - z0) > TOLERANCE || Math.abs(b - z1) > TOLERANCE)
  return { dos: z0, part: k < 0 ? 1 : Math.max(1, k - 1) / ECHANTILLONS }
}

/** Monte les spectateurs ; rend leurs maillages (à éclairer par la salle). */
export async function monterSpectateurs(scene: Scene, sieges: readonly Siege[]): Promise<Mesh[]> {
  const parModele = Array.from({ length: MODELES }, (_, n) => sieges.filter((_, i) => i % MODELES === n))
  const conteneurs = await Promise.all(parModele.map((qui, n) => (qui.length ? glbOuRien(scene, `assets/pnj/pnj-${n}.glb`) : Promise.resolve(null))))
  const maillages: Mesh[] = []
  conteneurs.forEach((c, n) => {
    const qui = parModele[n]
    if (!c || qui.length === 0) return
    c.addAllToScene()
    const maillage = c.meshes.find((x): x is Mesh => x instanceof Mesh && !!x.skeleton)
    if (!maillage) return
    const assise = c.animationGroups.find((g) => /sit/i.test(g.name))
    const { dos, part } = assise ? gabarit(maillage, assise) : { dos: 0, part: 1 }
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
    const [a, fin] = cuit.plages.assis
    const b = a + Math.round((fin - a) * part)
    // Le dos (z du modèle, qui regarde +z) contre le dossier : le demi-tour l'envoie derrière la place.
    const recul = DOSSIER + dos
    const t = new Matrix()
    qui.forEach((s, i) => {
      // Face à l'écran (vers −z) : le modèle glTF regarde +z, un demi-tour.
      Matrix.ComposeToRef(Vector3.OneReadOnly, Quaternion.RotationYawPitchRoll(Math.PI, 0, 0), new Vector3(s.x, s.y, s.z + recul), t)
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
