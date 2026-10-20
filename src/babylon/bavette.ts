/**
 * Bavette, vivant (BavetteLayer) : le chat de Philippe se promène dans le musée et le jardin.
 *
 * `plan/promenade.ts` décide où il va et ce qu'il fait ; ici on ne fait que le
 * montrer. Un maillage skinné (`tools/blender/build-bavette-anime.py`, JPEG :
 * `glbOuRien` suffit), neuf actions. Pas d'AnimationGroup joué : un petit
 * mixeur à la three (`Mixeur` : temps, sens, poids et fondus, pur et testé)
 * échantillonne les pistes à la main (`Animation.evaluate`) et les mêle par
 * poids sur les nœuds liés aux os. La marche est calée sur sa vitesse réelle,
 * il suit la pente des volées, tourne la tête vers le visiteur à moins de 3 m.
 *
 * La sieste sur un banc (`Saut`, `Enroule`, `Dort`, `Reveil`, `Descente`) a son
 * déplacement cuit et son temps imposé par la promenade : posé au point d'appel
 * pendant le saut, sur l'assise ensuite, l'écart de hauteur rattrapé en vol.
 *
 * Il ne porte pas dans la carte d'ombre (redessinée seulement quand la boîte
 * glisse, soleil.ts) : une tache de contact floue le suit (OmbresLayer).
 * `BAVETTE` publie de quoi brancher la carte, la minimap et le ronron.
 */
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import type { Animation } from '@babylonjs/core/Animations/animation'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Node } from '@babylonjs/core/node'
import type { Scene } from '@babylonjs/core/scene'

import { MOBILIER } from '../plan/mobilier.ts'
import { MUSEE } from '../plan/musee.ts'
import {
  avancerPromenade, couchettes, lieuxCalmes, poser, posture, promenadeInitiale, rampe, regardeBavette, SIESTE, siesteForcee,
  VITESSE_CHAT, type Lieu, type PhaseSieste, type Promenade,
} from '../plan/promenade.ts'
import { surfaceAt } from '../plan/rules.ts'
import type { Walker } from '../plan/walk.ts'
import { glbOuRien } from './glb.ts'
import { brancherLueurs } from './lueurs.ts'
import { PARC } from './parc.ts'

const ANIMATION = { marche: 'Marche', debout: 'Repos', assis: 'Assis' } as const
const CLIPS_SIESTE = { saut: 'Saut', enroule: 'Enroule', dort: 'Dort', reveil: 'Reveil', descente: 'Descente' } as const
export type Nom = 'Marche' | 'Repos' | 'Sasseoir' | 'Assis' | (typeof CLIPS_SIESTE)[PhaseSieste]
const NOMS: Nom[] = ['Marche', 'Repos', 'Sasseoir', 'Assis', ...Object.values(CLIPS_SIESTE)]
const EN_SIESTE = new Set<Nom>(Object.values(CLIPS_SIESTE))
/** LoopRepeat de three ; les autres sont jouées une fois et figées à la fin. */
const BOUCLES = new Set<Nom>(['Marche', 'Repos', 'Assis', 'Dort'])
/** La tête suit le visiteur à moins de 3 m, jamais au-delà de ces butées. */
const PORTEE_REGARD = 3
const DEG = Math.PI / 180

/** Ce que les interfaces liront (CarteBavette, Minimap, ronron) quand elles viendront côté Babylon. */
export const BAVETTE = { regarde: false, x: 0, z: 0, level: 0 }

// ── Le mixeur, pur ───────────────────────────────────────────────────────────

/** Une action en cours : son temps (s), son sens (timeScale), son poids et la pente de son fondu (poids/s). */
export interface Piste { t: number; vitesse: number; poids: number; vers: number; pas: number }
export interface Mixeur { pistes: Map<Nom, Piste>; courant: Nom; ensuite: Nom | null; durees: Record<Nom, number> }

export const mixeur = (durees: Record<Nom, number>): Mixeur => ({
  pistes: new Map([['Repos', { t: 0, vitesse: 1, poids: 1, vers: 1, pas: 0 }]]), courant: 'Repos', ensuite: null, durees,
})

/** `reset().fadeIn(fondu).play()` de `nom`, les autres s'effacent en `fondu` (coupées net sans fondu). */
export function jouer(m: Mixeur, nom: Nom, fondu: number, vitesse = 1, t = 0): void {
  for (const [n, p] of m.pistes) {
    if (n === nom) continue
    if (fondu > 0) Object.assign(p, { vers: 0, pas: -p.poids / fondu })
    else m.pistes.delete(n)
  }
  m.pistes.set(nom, { t, vitesse, poids: fondu > 0 ? 0 : 1, vers: 1, pas: fondu > 0 ? 1 / fondu : 0 })
  m.courant = nom
  m.ensuite = null
}

/** S'asseoir (sens 1), ou se relever (sens −1) puis `ensuite`. */
export function asseoir(m: Mixeur, sens: 1 | -1, ensuite: Nom = 'Assis'): void {
  jouer(m, 'Sasseoir', 0.3, sens, sens > 0 ? 0 : m.durees.Sasseoir)
  m.ensuite = sens > 0 ? 'Assis' : ensuite
}

/** Hors sieste : l'action voulue, en passant par `Sasseoir` pour s'asseoir ou se relever. */
export function suivre(m: Mixeur, voulue: Nom): void {
  if (m.courant === 'Sasseoir') m.ensuite = voulue === 'Assis' ? (m.pistes.get('Sasseoir')!.vitesse > 0 ? 'Assis' : 'Repos') : voulue
  else if (voulue !== m.courant) {
    if (voulue === 'Assis') asseoir(m, 1)
    else if (m.courant === 'Assis') asseoir(m, -1, voulue)
    else jouer(m, voulue, 0.35)
  }
}

/** `mixer.update(dt)` : temps, fondus, et la fin de `Sasseoir` (l'événement `finished` de three). */
export function avancer(m: Mixeur, dt: number): void {
  let fini = false
  for (const [n, p] of m.pistes) {
    p.poids = p.pas > 0 ? Math.min(p.vers, p.poids + p.pas * dt) : Math.max(p.vers, p.poids + p.pas * dt)
    if (p.vers === 0 && p.poids <= 0) {
      m.pistes.delete(n)
      continue
    }
    const d = m.durees[n]
    p.t += p.vitesse * dt
    if (BOUCLES.has(n)) p.t = ((p.t % d) + d) % d
    else {
      if ((p.vitesse > 0 && p.t >= d) || (p.vitesse < 0 && p.t <= 0)) {
        fini ||= n === 'Sasseoir' && n === m.courant
        p.vitesse = 0 // figée à la fin, l'événement ne part qu'une fois
      }
      p.t = Math.min(d, Math.max(0, p.t))
    }
  }
  if (!fini || !m.ensuite) return
  // Assis alors qu'il fallait repartir : il se relève d'abord.
  const sens = m.pistes.get('Sasseoir')!.t > 0 ? 1 : -1
  if (sens > 0 && m.ensuite !== 'Assis') asseoir(m, -1, m.ensuite)
  else jouer(m, m.ensuite, 0.25)
}

/** Le tangage du corps sur une volée : le museau vers le haut quand il monte. */
export function pente(w: Walker): number {
  const f = w.surface.startsWith('volee:') ? MUSEE.flights.find((v) => `volee:${v.id}` === w.surface) : undefined
  if (!f) return 0
  const [ux, uz] = ({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const)[f.direction]
  const long = f.direction === 'north' || f.direction === 'south' ? f.depth : f.width
  return Math.atan(((f.top - f.bottom) / long) * (-Math.sin(w.yaw) * ux - Math.cos(w.yaw) * uz))
}

// ── La couche ────────────────────────────────────────────────────────────────

/** La tache de OmbresLayer : un rectangle 80/128 flouté de 12 px, sur fond noir opaque (lue au vert). */
function tache(scene: Scene): DynamicTexture {
  const dt = new DynamicTexture('bavette:tache', { width: 128, height: 128 }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  g.fillStyle = '#000'
  g.fillRect(0, 0, 128, 128)
  g.filter = 'blur(12px)'
  g.fillStyle = '#fff'
  g.fillRect(24, 24, 80, 80)
  dt.gammaSpace = false
  dt.getAlphaFromRGB = true
  dt.update()
  return dt
}

/** La matrice monde de `n`, ses parents recalculés d'abord (le mixeur vient de bouger les os). */
const monde = (n: Node) => {
  if (n.parent) monde(n.parent)
  return (n as TransformNode).computeWorldMatrix(true)
}

type Prop = 'position' | 'rotationQuaternion' | 'scaling'
interface Canal { cible: TransformNode; prop: Prop; pistes: Partial<Record<Nom, Animation>>; acc: Vector3 | Quaternion }
/** Au-delà (m), ou masqué (visibilite.ts), les os ne sont plus mêlés : la promenade avance seule. */
const LOIN_OS = 40

export async function monterBavette(scene: Scene, camera: FreeCamera & { walker(): Walker }): Promise<void> {
  const c = await glbOuRien(scene, 'assets/sculptures/bavette-anime.glb')
  if (!c) return
  c.addAllToScene()
  const groupe = new TransformNode('bavette', scene)
  for (const r of c.rootNodes) r.parent = groupe
  for (const m of c.meshes) m.isPickable = false
  brancherLueurs(c.materials)

  // Les pistes, rangées par nœud et propriété ; les groupes du chargeur ne jouent jamais.
  const canaux = new Map<string, Canal>()
  const durees = {} as Record<Nom, number>
  for (const g of c.animationGroups) {
    g.stop()
    const nom = g.name as Nom
    for (const { target, animation } of g.targetedAnimations) {
      const cle = `${target.uniqueId}:${animation.targetProperty}`
      const prop = animation.targetProperty as Prop
      const canal = canaux.get(cle) ?? { cible: target, prop, pistes: {} as Canal['pistes'], acc: prop === 'rotationQuaternion' ? new Quaternion() : new Vector3() }
      canal.pistes[nom] = animation
      canaux.set(cle, canal)
    }
    durees[nom] = g.to / (g.targetedAnimations[0]?.animation.framePerSecond ?? 60)
  }
  if (NOMS.some((n) => !durees[n])) {
    console.warn('Bavette : actions manquantes', Object.keys(durees))
    return
  }
  const os = (n: string) => c.transformNodes.find((t) => t.name === n)
  const [cou, tete] = [os('Cou'), os('Tete')]

  const ombre = CreateGround('bavette:ombre', { width: 1, height: 1 }, scene)
  const noir = new StandardMaterial('bavette:ombre', scene)
  noir.diffuseColor = noir.specularColor = Color3.Black()
  noir.disableLighting = true
  noir.opacityTexture = tache(scene)
  noir.alpha = 0.75
  noir.disableDepthWrite = true
  noir.zOffset = -2
  noir.backFaceCulling = false
  ombre.material = noir
  ombre.isPickable = false

  // Une promenade par session : Math.random suffit à la graine.
  const lieux = lieuxCalmes(MUSEE, PARC)
  let p: Promenade = promenadeInitiale(MUSEE, lieux, Math.floor(Math.random() * 2 ** 32))
  const m = mixeur(durees)
  const l = { yaw: 0, tangage: 0, regard: 0, sieste: false }
  let forcage: { gel: boolean; anim: Nom | null } = { gel: false, anim: null }

  if (import.meta.env.DEV) {
    ;(window as unknown as { __BAVETTE__?: unknown }).__BAVETTE__ = {
      etat: () => p,
      /** Le pose en (x, z) sur `surface` (déduite au sol sinon), tourné vers `yaw`, arrêté. */
      placer: (x: number, z: number, surface?: string, yaw = 0) => {
        const lieu: Lieu = { surface: surface ?? surfaceAt(MUSEE, x, z, 0) ?? '0:hall', x, z, cap: yaw, genre: 'hall' }
        p = poser(MUSEE, lieu, 1, 1e9)
        l.yaw = yaw
      },
      /** Force une action ; avec `t`, fige l'image à `t` secondes. */
      jouer: (nom: Nom | null, t?: number) => {
        forcage = { gel: t !== undefined, anim: nom }
        if (nom) jouer(m, nom, 0, 1, t ?? 0)
      },
      figer: (gel: boolean) => { forcage = { ...forcage, gel } },
      couchettes: () => couchettes(MUSEE).map((k, i) => ({ i, piece: MOBILIER[k.banc].piece, surface: k.surface, x: k.x, z: k.z })),
      /** L'envoie dormir sur la couchette `i` ; `phase` donnée, il y est tout de suite, `t` secondes dedans. */
      sieste: (i: number, phase?: PhaseSieste, t = 0) => {
        const k = couchettes(MUSEE)[i]
        if (k) p = siesteForcee(MUSEE, p, k, phase, t)
        forcage = { gel: false, anim: null }
      },
      liberer: () => { forcage = { gel: false, anim: null } },
    }
  }

  const qg = new Quaternion()
  const qp = new Quaternion()
  const qi = new Quaternion()
  const haut = new Vector3()
  const droite = new Vector3()
  const vers = new Vector3()
  const loc = new Vector3()
  const corps = c.meshes.filter((m) => m.getTotalVertices() > 0)
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1)
    const { gel, anim: force } = forcage
    if (!gel) p = avancerPromenade(MUSEE, lieux, p, dt, camera.walker())
    const s = p.sieste

    // La sieste : l'action de la phase, à l'instant de la promenade, raccordée sans fondu d'une phase à l'autre.
    if (!force && s) {
      const nom = CLIPS_SIESTE[s.phase]
      if (m.courant !== nom) jouer(m, nom, gel || EN_SIESTE.has(m.courant) ? 0 : 0.25, 0)
      m.pistes.get(nom)!.t = s.phase === 'dort' ? s.t % SIESTE.souffle : Math.min(s.t, durees[nom])
    } else if (!force) {
      suivre(m, ANIMATION[posture(p) as keyof typeof ANIMATION])
      // `Marche` est cuite au pas de promenade : ses coussinets suivent le sol.
      const marche = m.pistes.get('Marche')
      if (marche) marche.vitesse = Math.min(2, Math.max(0.4, p.vitesse / VITESSE_CHAT))
    }
    avancer(m, gel ? 0 : dt)
    const w = p.walker
    const vu = Math.hypot(w.x - camera.position.x, w.z - camera.position.z) < LOIN_OS && corps.some((x) => (x.layerMask & camera.layerMask) !== 0)

    // Les pistes mêlées par poids (nlerp des quaternions, comme le PropertyMixer de three à poids normalisés), dans l'accumulateur du canal.
    if (vu)
      for (const { cible, prop, pistes, acc } of canaux.values()) {
        let total = 0
        for (const [nom, pi] of m.pistes) {
          const a = pistes[nom]
          if (!a || pi.poids <= 0) continue
          const v = a.evaluate(pi.t * a.framePerSecond) as Vector3 | Quaternion
          if (v instanceof Quaternion) {
            const q = acc as Quaternion
            if (total === 0) v.scaleToRef(pi.poids, q)
            else v.scaleAndAddToRef(Quaternion.Dot(q, v) < 0 ? -pi.poids : pi.poids, q)
          } else if (total === 0) v.scaleToRef(pi.poids, acc as Vector3)
          else v.scaleAndAddToRef(pi.poids, acc as Vector3)
          total += pi.poids
        }
        if (total === 0) continue
        if (acc instanceof Quaternion) (cible.rotationQuaternion ??= new Quaternion()).copyFrom(acc).normalize()
        else cible[prop as 'position' | 'scaling'].copyFrom(acc).scaleInPlace(1 / total)
      }

    // Le corps : posé sur la surface, tourné en douceur, incliné sur les volées.
    const k = gel ? 1 : 1 - Math.exp(-6 * dt)
    // En sieste le cap est celui du banc, et au sol il repart d'aplomb, dos au banc : sans lissage.
    if (s) l.yaw = s.couchette.cap
    else if (l.sieste) l.yaw = w.yaw
    else l.yaw += Math.atan2(Math.sin(w.yaw - l.yaw), Math.cos(w.yaw - l.yaw)) * k
    l.sieste = !!s
    l.tangage += (pente(w) - l.tangage) * k
    ombre.rotation.y = l.yaw + Math.PI
    if (s) {
      const b = s.couchette
      if (s.phase === 'saut') groupe.position.set(b.appel.x, b.appel.y + (b.y - b.appel.y - SIESTE.hauteur) * rampe(s.t / SIESTE.saut.duree, SIESTE.saut.vol), b.appel.z)
      else if (s.phase === 'descente') groupe.position.set(b.x, b.y + (b.appel.y - b.y + SIESTE.hauteur) * rampe(s.t / SIESTE.descente.duree, SIESTE.descente.vol), b.z)
      else groupe.position.set(b.x, b.y, b.z)
      // L'ombre sous le corps (w suit le corps cuit), sur l'assise dès qu'il la surplombe ; ronde quand il est enroulé.
      const surAssise = Math.hypot(w.x - b.appel.x, w.z - b.appel.z) > SIESTE.elan - SIESTE.bord
      const rond = s.phase === 'enroule' || s.phase === 'dort' || s.phase === 'reveil'
      ombre.position.set(w.x, (surAssise ? b.y : b.appel.y) + 0.012, w.z)
      ombre.scaling.set(rond ? 0.46 : 0.34, 1, rond ? 0.46 : 0.62)
    } else {
      groupe.position.set(w.x, w.y, w.z)
      ombre.position.set(w.x, w.y + 0.012, w.z)
      ombre.scaling.set(0.34, 1, 0.62)
    }
    // Euler YXZ (-tangage, yaw + π, 0) de three : le museau du modèle regarde +Z, yaw 0 regarde −Z.
    Quaternion.RotationYawPitchRollToRef(l.yaw + Math.PI, -l.tangage, 0, qg)
    groupe.rotationQuaternion = qg

    // Après le mixeur : le cou et la tête pivotent vers le visiteur proche, autour d'axes du MONDE ramenés chez le parent.
    if (vu && cou && tete) {
      monde(tete)
      camera.position.subtractToRef(tete.getAbsolutePosition(), vers)
      Quaternion.InverseToRef(qg, qi)
      vers.applyRotationQuaternionToRef(qi, loc)
      const lacet = Math.atan2(loc.x, loc.z)
      const cible = !s && vers.length() < PORTEE_REGARD && Math.abs(lacet) < 115 * DEG ? (posture(p) === 'marche' && !force ? 0.5 : 1) : 0
      l.regard += (cible - l.regard) * (1 - Math.exp(-2.5 * dt))
      if (l.regard >= 1e-3) {
        Vector3.UpReadOnly.applyRotationQuaternionToRef(qg, haut)
        Vector3.RightReadOnly.applyRotationQuaternionToRef(qg, droite)
        const y = Math.min(70 * DEG, Math.max(-70 * DEG, lacet)) * l.regard
        const t = Math.min(30 * DEG, Math.max(0, Math.atan2(loc.y, Math.hypot(loc.x, loc.z)))) * l.regard
        for (const [o, part] of [[cou, 0.4], [tete, 0.6]] as const) {
          // Le museau regarde +Z ; le lever, c'est tourner autour de +X dans le sens négatif.
          const q = Quaternion.RotationAxis(haut, y * part).multiply(Quaternion.RotationAxis(droite, -t * part))
          monde(o.parent!).decompose(undefined, qp)
          o.rotationQuaternion = Quaternion.Inverse(qp).multiply(q).multiply(qp).multiply(o.rotationQuaternion!)
        }
        monde(tete)
      }
    }

    // Ce que liront la carte (quand on le regarde) et la minimap.
    const [yaw, pitch] = [camera.rotation.y, camera.rotation.x]
    const regard = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }
    BAVETTE.regarde = regardeBavette(camera.position, regard, tete ? tete.getAbsolutePosition() : groupe.position)
    Object.assign(BAVETTE, { x: w.x, z: w.z, level: w.level })
  })
}
