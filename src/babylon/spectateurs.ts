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
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Space } from '@babylonjs/core/Maths/math.axis'
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
/**
 * Le fauteuil (`assets/cinema/fauteuil.glb` ramené à 1 m, mesuré) : l'avant de l'assise est à 0,38 m devant
 * le centre de la place, son dessus à 0,41 m. Le genou (l'articulation) passe 6 cm devant ce bord, le creux
 * du genou et le mollet hors du coussin, et 6 cm au-dessus : la cuisse s'y pose.
 */
const GENOU = { avant: 0.44, haut: 0.47 }
/** Ce que la place peut baisser un spectateur (m) pour poser ses cuisses : jamais les pieds sous le sol. */
const HAUSSE_MAX = 0.04
/** Le tibia d'aplomb, un peu en avant (pente horizontale par mètre de descente) : les pieds devant le fauteuil. */
const PENTE_TIBIA = 0.15
const ECHANTILLONS = 40

/** La position d'un nœud, ses parents recalculés d'abord (la pose vient d'être posée par l'action). */
function monde(n: TransformNode): Vector3 {
  if (n.parent instanceof TransformNode) monde(n.parent)
  n.computeWorldMatrix(true)
  return n.getAbsolutePosition()
}

/**
 * Les tibias redressés, à appeler à chaque image de l'action : « Chair Sit Idle » replie les pieds sous
 * une chaise, et dans un fauteuil de cinéma (une assise pleine jusqu'à 20 cm du sol) les tibias
 * traversaient l'avant de l'assise. Le genou tourne le tibia d'aplomb ; la cheville tourne d'autant
 * en sens inverse, le pied reste à plat.
 */
export function redresseur(maillage: Mesh): () => void {
  const noeud = (nom: string) => maillage.skeleton?.bones.find((b) => b.name === nom)?.getTransformNode() ?? null
  const jambes = ['Left', 'Right'].map((c) => [noeud(`${c}Leg`), noeud(`${c}Foot`)]).filter((j): j is TransformNode[] => !!j[0] && !!j[1])
  // Le modèle glTF regarde +z.
  const avant = Vector3.TransformNormal(new Vector3(0, 0, 1), maillage.computeWorldMatrix(true)).normalize()
  const voulu = new Vector3(0, -1, 0).addInPlace(avant.scale(PENTE_TIBIA)).normalize()
  return () => {
    for (const [genou, cheville] of jambes) {
      const k = monde(genou).clone()
      const tibia = monde(cheville).subtract(k).normalize()
      const axe = Vector3.Cross(tibia, voulu)
      const s = axe.length()
      if (s < 1e-4) continue
      const angle = Math.atan2(s, Vector3.Dot(tibia, voulu))
      axe.scaleInPlace(1 / s)
      genou.rotate(axe, angle, Space.WORLD)
      monde(cheville)
      cheville.rotate(axe, -angle, Space.WORLD)
    }
  }
}

/**
 * La silhouette assise, mesurée sur le squelette (sur le processeur, une fois), tibias redressés : le dos
 * (le z le plus en arrière de toute l'action), le bassin en x, et les genoux (le plus en arrière, le plus bas
 * de toute l'action). Meshy place l'origine où il veut : jusqu'à 80 cm devant le corps, et 17 à 20 cm à côté
 * du bassin (le spectateur chevauchait l'accoudoir). L'action entière est jouée : la couper la faisait sauter
 * d'une image à l'autre en boucle.
 */
export interface Gabarit {
  /** Le z le plus en arrière de toute l'action (le dos), dans le repère du modèle (qui regarde +z). */
  dos: number
  /** Le bassin en x. */
  cote: number
  /** Le genou le plus en arrière et le plus bas de toute l'action. */
  genou: { z: number; y: number }
  /** Le point le plus bas de toute l'action (les pieds). */
  pied: number
}

/**
 * Où poser le modèle dans sa place, en mètres : `avance` vers l'écran depuis le dos contre le dossier (des
 * cuisses courtes avancent le spectateur jusqu'à ce que ses genoux passent le bord de l'assise), `hausse`
 * pour poser ses cuisses sur l'assise, sans que ses pieds quittent le sol de plus de 4 cm ni s'y enfoncent.
 */
export function placement(g: Gabarit): { avance: number; hausse: number } {
  const avance = Math.max(0, GENOU.avant - (g.genou.z - g.dos - DOSSIER))
  const hausse = Math.min(HAUSSE_MAX, Math.max(-g.pied, GENOU.haut - g.genou.y))
  return { avance, hausse }
}

export function gabarit(maillage: Mesh, groupe: AnimationGroup, retouche: () => void = () => {}): Gabarit {
  const avant = maillage.computeBonesUsingShaders
  maillage.computeBonesUsingShaders = false
  const W = maillage.computeWorldMatrix(true)
  const os = (re: RegExp) => maillage.skeleton!.bones.find((b) => re.test(b.name))
  const bassin = os(/hips|pelvis/i)
  const genoux = [os(/^LeftLeg$/), os(/^RightLeg$/)].filter((b) => !!b)
  let dos = Infinity
  let cote = 0
  let pied = Infinity
  const genou = { z: Infinity, y: Infinity }
  for (let k = 0; k <= ECHANTILLONS; k++) {
    const f = groupe.from + ((groupe.to - groupe.from) * k) / ECHANTILLONS
    groupe.start(false, 1, f, f)
    groupe.goToFrame(f)
    groupe.pause()
    retouche()
    maillage.skeleton!.prepare(true)
    maillage.refreshBoundingInfo({ applySkeleton: true, applyMorph: false })
    const b = maillage.getBoundingInfo().boundingBox
    dos = Math.min(dos, b.minimumWorld.z)
    pied = Math.min(pied, b.minimumWorld.y)
    if (k === 0) cote = bassin ? Vector3.TransformCoordinates(bassin.getAbsolutePosition(), W).x : (b.minimumWorld.x + b.maximumWorld.x) / 2
    for (const g of genoux) {
      const p = Vector3.TransformCoordinates(g.getAbsolutePosition(), W)
      genou.z = Math.min(genou.z, p.z)
      genou.y = Math.min(genou.y, p.y)
    }
    groupe.stop()
  }
  maillage.computeBonesUsingShaders = avant
  maillage.refreshBoundingInfo()
  return { dos, cote, pied, genou: genoux.length ? genou : { z: dos + DOSSIER + GENOU.avant, y: GENOU.haut } }
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
    const redresser = redresseur(maillage)
    const mesure: Gabarit = assise ? gabarit(maillage, assise, redresser) : { dos: 0, cote: 0, pied: 0, genou: { z: DOSSIER + GENOU.avant, y: GENOU.haut } }
    const { dos, cote } = mesure
    const { avance, hausse } = placement(mesure)
    const cuit = cuire(scene, maillage, c.animationGroups, { assis: /sit/i }, redresser)
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
    // le demi-tour envoie l'un derrière la place, l'autre de l'autre côté (`placement` pour le reste).
    const recul = DOSSIER + dos - avance
    const t = new Matrix()
    qui.forEach((s, i) => {
      // Face à l'écran (vers −z) : le modèle glTF regarde +z, un demi-tour.
      Matrix.ComposeToRef(Vector3.OneReadOnly, Quaternion.RotationYawPitchRoll(Math.PI, 0, 0), new Vector3(s.x + cote, s.y + hausse, s.z + recul), t)
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
