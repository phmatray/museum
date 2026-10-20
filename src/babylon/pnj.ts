/**
 * Les visiteurs du musée (PNJ) : `plan/pnj.ts` décide où ils vont et ce qu'ils
 * font ; ici on les montre, au moindre coût.
 *
 * Huit modèles (`tools/generer-pnj.ts` : Meshy, garde-robe tirée au sort), chacun
 * squelette + trois actions (marche, attente, regard). Pas de squelette animé
 * sur le CPU par PNJ : les actions sont CUITES dans une texture (« baked vertex
 * animation », doc Babylon) et chaque modèle est UN lot de thin instances,
 * un PNJ = une instance avec sa matrice et ses paramètres d'animation
 * (`bakedVertexAnimationSettingsInstanced`). Douze PNJ : huit appels de dessin,
 * plus un pour leurs taches de contact.
 *
 * La cuisson est faite ici, pas par `VertexAnimationBaker` : celui-ci fait
 * avancer `scene.beginAnimation(squelette)`, alors qu'un glTF anime ses os par
 * des AnimationGroup sur des nœuds liés. On fait donc pour chaque image
 * `goToFrame` sur le groupe, `skeleton.prepare(true)` (les os recopient leurs
 * nœuds) et l'on range `getTransformMatrices` au format attendu par le shader
 * (une ligne par image, (os + 1) × 4 texels RGBA flottants).
 *
 * Hors carte d'ombre, comme Bavette (ils marchent sans cesse : elle serait
 * redessinée à chaque image) ; une tache floue les suit.
 */
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup'
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager'
import { Constants } from '@babylonjs/core/Engines/constants'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { MUSEE } from '../plan/musee.ts'
import type { Accrochage } from '../plan/hang.ts'
import { avancerPnj, monde, pnjInitiaux, type Activite, type Pnj } from '../plan/pnj.ts'
import { lieuxCalmes } from '../plan/promenade.ts'
import type { Walker } from '../plan/walk.ts'
import { matiereDeTache } from './contact.ts'
import { VIVANTES } from './etat.ts'
import { glbOuRien } from './glb.ts'
import { PARC } from './parc.ts'

/** Combien de modèles (`public/assets/pnj/pnj-<n>.glb`) et de PNJ par zone. */
const MODELES = 8
const COMBIEN = { musee: 8, jardin: 4 }
/** Images par seconde de la cuisson (et de la lecture). */
const CADENCE = 30
/** L'action jouée pour chaque activité, retrouvée par le nom de son groupe (bibliothèque Meshy). */
const ACTIONS: Record<Activite, RegExp> = { marche: /walk/i, attente: /^idle/i, regarde: /look/i }
/** La tache de contact sous chaque PNJ (m). */
const DIAMETRE_TACHE = 0.9

interface Cuisson { texture: RawTexture; plages: Record<Activite, [number, number]> }

/** Cuit les actions du modèle dans une texture de matrices d'os (format du shader `bakedVertexAnimation`). */
export function cuire(scene: Scene, maillage: Mesh, groupes: AnimationGroup[]): Cuisson | null {
  const squelette = maillage.skeleton
  if (!squelette) return null
  const parFrame = (squelette.bones.length + 1) * 16
  const choisis = (Object.keys(ACTIONS) as Activite[]).map((a) => [a, groupes.find((g) => ACTIONS[a].test(g.name))] as const)
  if (choisis.some(([, g]) => !g)) return null
  const images = choisis.map(([, g]) => {
    const fps = g!.targetedAnimations[0]?.animation.framePerSecond ?? 60
    return Math.max(2, Math.round(((g!.to - g!.from) / fps) * CADENCE))
  })
  const donnees = new Float32Array(parFrame * images.reduce((a, b) => a + b, 0))
  const plages = {} as Record<Activite, [number, number]>
  for (const g of groupes) g.stop()
  let ligne = 0
  choisis.forEach(([activite, g], i) => {
    g!.start(false, 1, g!.from, g!.to)
    g!.pause()
    const debut = ligne
    for (let f = 0; f < images[i]; f++) {
      g!.goToFrame(g!.from + ((g!.to - g!.from) * f) / images[i])
      squelette.prepare(true)
      donnees.set(squelette.getTransformMatrices(maillage), ligne * parFrame)
      ligne++
    }
    plages[activite] = [debut, ligne - 1]
    g!.stop()
  })
  const texture = RawTexture.CreateRGBATexture(donnees, (squelette.bones.length + 1) * 4, ligne, scene, false, false, Texture.NEAREST_NEAREST, Constants.TEXTURETYPE_FLOAT)
  texture.name = `pnj:${maillage.name}:actions`
  return { texture, plages }
}

/**
 * Le décalage qui fait partir l'action de sa première image au temps `t` du gestionnaire
 * (la formule du shader : image = floor(mod(fract(t·v/N)·n + décalage, n)), n = N − 1 passé le premier tour).
 */
export function decalage(debut: number, fin: number, t: number, cadence = CADENCE): number {
  const total = fin - debut + 1
  const tour = (t * cadence) / total
  const n = tour < 1 ? total : total - 1
  const ici = (tour - Math.floor(tour)) * n
  return (n - ici) % n
}

/** Monte les PNJ ; `visiteur` : où est le joueur (ils s'en écartent). Rend une promesse résolue une fois posés. */
export async function monterPnj(scene: Scene, accrochage: Accrochage | null, visiteur: () => Walker): Promise<void> {
  const m = monde(MUSEE, accrochage, lieuxCalmes(MUSEE, PARC))
  const pnj = pnjInitiaux(m, COMBIEN, MODELES, Math.floor(Math.random() * 2 ** 32))
  const conteneurs = await Promise.all(Array.from({ length: MODELES }, (_, n) => glbOuRien(scene, `assets/pnj/pnj-${n}.glb`)))

  /** Par modèle : le lot, son gestionnaire (sa texture, son temps), ses PNJ, ses tampons, ses plages d'actions. */
  const lots: { maillage: Mesh; monde: Matrix; inverse: Matrix; vat: BakedVertexAnimationManager; qui: Pnj[]; matrices: Float32Array; actions: Float32Array; plages: Record<Activite, [number, number]>; jouee: (Activite | null)[] }[] = []
  conteneurs.forEach((c, n) => {
    if (!c) return
    const qui = pnj.filter((p) => p.modele === n)
    if (qui.length === 0) return
    c.addAllToScene()
    const maillage = c.meshes.find((x): x is Mesh => x instanceof Mesh && !!x.skeleton)
    if (!maillage) return console.warn(`pnj-${n} : pas de maillage animé`)
    const cuit = cuire(scene, maillage, c.animationGroups)
    if (!cuit) return console.warn(`pnj-${n} : actions manquantes`, c.animationGroups.map((g) => g.name))
    // Les groupes du chargeur ne jouent plus jamais : tout passe par la texture.
    for (const g of c.animationGroups) g.dispose()
    const vat = new BakedVertexAnimationManager(scene)
    vat.texture = cuit.texture
    maillage.bakedVertexAnimationManager = vat
    for (const mat of c.materials) {
      mat.name = `pnj-${n}`
      // Le temps de l'animation est lié à chaque image : la matière ne se fige pas.
      VIVANTES.add(mat.name)
    }
    maillage.isPickable = false
    // Toujours dessiné : les instances bougent (le tri des salles les laisse, visibilite.ts).
    maillage.alwaysSelectAsActiveMesh = true
    // Sa matrice monde porte l'armature (échelle 0,01 : modèle en cm) : une instance compose
    // W · T · W⁻¹, pour que le placement T s'applique APRÈS (sinon il serait lui aussi réduit au centième).
    const repere = maillage.computeWorldMatrix(true).clone()
    lots.push({ maillage, monde: repere, inverse: repere.clone().invert(), vat, qui, matrices: new Float32Array(qui.length * 16), actions: new Float32Array(qui.length * 4), plages: cuit.plages, jouee: qui.map(() => null) })
  })
  if (lots.length === 0) return

  // Les taches de contact : un lot pour tous.
  const tache = CreateGround('pnj:taches', { width: DIAMETRE_TACHE, height: DIAMETRE_TACHE }, scene)
  tache.material = matiereDeTache('pnj:tache', scene)
  tache.isPickable = false
  tache.alwaysSelectAsActiveMesh = true
  const sous = new Float32Array(pnj.length * 16)

  const q = new Quaternion()
  const echelle = new Vector3(1, 1, 1)
  const ou = new Vector3()
  const mat = new Matrix()
  const tmp = new Matrix()
  const poser = (premiere: boolean) => {
    let k = 0
    for (const lot of lots) {
      const t = lot.vat.time
      lot.qui.forEach((p, i) => {
        // Le modèle regarde +z (glTF) ; le cap 0 du marcheur regarde −z.
        Quaternion.RotationYawPitchRollToRef(p.w.yaw + Math.PI, 0, 0, q)
        ou.set(p.w.x, p.w.y + 0.005, p.w.z)
        Matrix.ComposeToRef(echelle, q, ou, mat)
        lot.monde.multiplyToRef(mat, tmp)
        tmp.multiplyToRef(lot.inverse, mat)
        mat.copyToArray(lot.matrices, i * 16)
        if (lot.jouee[i] !== p.activite) {
          const [a, b] = lot.plages[p.activite]
          lot.actions.set([a, b, decalage(a, b, t), CADENCE], i * 4)
          lot.jouee[i] = p.activite
        }
        Matrix.TranslationToRef(p.w.x, p.w.y + 0.01, p.w.z, mat)
        mat.copyToArray(sous, k++ * 16)
      })
      if (premiere) {
        lot.maillage.thinInstanceSetBuffer('matrix', lot.matrices, 16, false)
        lot.maillage.thinInstanceSetBuffer('bakedVertexAnimationSettingsInstanced', lot.actions, 4, false)
      } else {
        lot.maillage.thinInstanceBufferUpdated('matrix')
        lot.maillage.thinInstanceBufferUpdated('bakedVertexAnimationSettingsInstanced')
      }
    }
    if (premiere) tache.thinInstanceSetBuffer('matrix', sous, 16, false)
    else tache.thinInstanceBufferUpdated('matrix')
  }
  poser(true)

  const tous = lots.flatMap((l) => l.qui)
  // Les autres de chaque PNJ : le visiteur et tous les PNJ (lui compris : `gene` ignore la distance nulle).
  const autres = [{ x: 0, z: 0, level: 0 }, ...tous.map(() => ({ x: 0, z: 0, level: 0 }))]
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)
    for (const l of lots) l.vat.time += dt
    const v = visiteur()
    const lui = autres[0]
    lui.x = v.x
    lui.z = v.z
    lui.level = v.level
    for (const p of tous) {
      for (let i = 0; i < tous.length; i++) {
        const a = autres[i + 1]
        a.x = tous[i].w.x
        a.z = tous[i].w.z
        a.level = tous[i].w.level
      }
      avancerPnj(m, p, dt, autres)
    }
    poser(false)
  })

  if (import.meta.env.DEV) (window as unknown as { __PNJ__?: unknown }).__PNJ__ = { pnj: tous, monde: m }
}
