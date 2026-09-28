/**
 * Bavette, vivant : le chat de Philippe se promène dans le musée et le jardin.
 *
 * `plan/promenade.ts` décide où il va et ce qu'il fait ; ici on ne fait que le
 * montrer. Un seul maillage skinné (`tools/blender/build-bavette-anime.py`),
 * quatre actions : `Marche`, `Repos` (debout), `Sasseoir` (jouée à l'envers,
 * il se relève) et `Assis`. La marche est calée sur sa vitesse réelle — les
 * coussinets ne patinent pas —, il suit la pente des volées, et tourne la tête
 * vers le visiteur qui s'approche à moins de trois mètres.
 */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { MUSEE } from '../plan/musee'
import { parkPlacements } from '../plan/park'
import {
  avancerPromenade, lieuxCalmes, poser, posture, promenadeInitiale, regardeBavette, VITESSE_CHAT, type Lieu, type Promenade,
} from '../plan/promenade'
import { surfaceAt } from '../plan/rules'
import { useGameStore } from '../stores/gameStore'

const LIEUX = lieuxCalmes(MUSEE, parkPlacements(MUSEE))
const ANIMATION = { marche: 'Marche', debout: 'Repos', assis: 'Assis' } as const
/** La tête suit le visiteur à moins de 3 m, jamais au-delà de ces butées. */
const PORTEE_REGARD = 3
const LACET_MAX = THREE.MathUtils.degToRad(70)
const TANGAGE_MAX = THREE.MathUtils.degToRad(30)

type Nom = 'Marche' | 'Repos' | 'Sasseoir' | 'Assis'
interface Forcage { gel: boolean; anim: Nom | null }
interface Anim { mixer: THREE.AnimationMixer; actions: Record<Nom, THREE.AnimationAction>; courant: Nom; ensuite: Nom | null }

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function BavetteLayer() {
  const gltf = useBavette()
  const { camera } = useThree()
  const groupe = useRef<THREE.Group>(null)
  const promenade = useRef<Promenade | null>(null)
  const forcage = useRef<Forcage>({ gel: false, anim: null })
  const lisse = useRef({ yaw: 0, tangage: 0, regard: 0, publie: 0 })
  const anim = useRef<Anim | null>(null)

  // Le mixeur, une fois le modèle arrivé. Une promenade par session : Math.random suffit à la graine.
  useEffect(() => {
    if (!gltf) return
    const mixer = new THREE.AnimationMixer(gltf.scene)
    const actions = Object.fromEntries(gltf.animations.map((c) => [c.name, mixer.clipAction(c)])) as Record<Nom, THREE.AnimationAction>
    if (!actions.Marche || !actions.Repos || !actions.Sasseoir || !actions.Assis) {
      console.warn('Bavette : actions manquantes', Object.keys(actions))
      return
    }
    actions.Sasseoir.setLoop(THREE.LoopOnce, 1)
    actions.Sasseoir.clampWhenFinished = true
    const fini = (e: { action: THREE.AnimationAction }) => {
      const a = anim.current
      if (!a || e.action !== a.actions.Sasseoir || !a.ensuite) return
      // Assis alors qu'il fallait repartir : il se relève d'abord.
      if (e.action.timeScale > 0 && a.ensuite !== 'Assis') asseoir(a, -1, a.ensuite)
      else jouer(a, a.ensuite, 0.25)
    }
    mixer.addEventListener('finished', fini)
    promenade.current ??= promenadeInitiale(MUSEE, LIEUX, Math.floor(Math.random() * 2 ** 32))
    anim.current = { mixer, actions, courant: 'Repos', ensuite: null }
    actions.Repos.play()
    return () => {
      mixer.removeEventListener('finished', fini)
      mixer.stopAllAction()
      anim.current = null
    }
  }, [gltf])

  // En développement seulement : de quoi photographier Bavette de façon reproductible.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __BAVETTE__?: unknown }
    w.__BAVETTE__ = {
      etat: () => promenade.current,
      /** Le pose en (x, z) sur `surface` (déduite au sol sinon), tourné vers `yaw`, arrêté. */
      placer: (x: number, z: number, surface?: string, yaw = 0) => {
        const s = surface ?? surfaceAt(MUSEE, x, z, 0) ?? '0:hall'
        const lieu: Lieu = { surface: s, x, z, cap: yaw, genre: 'hall' }
        promenade.current = poser(MUSEE, lieu, 1, 1e9)
        lisse.current.yaw = yaw
      },
      /** Force une action ; avec `t`, fige l'image à `t` secondes. */
      jouer: (nom: Nom | null, t?: number) => {
        forcage.current = { gel: t !== undefined, anim: nom }
        const a = anim.current
        if (!a || !nom) return
        for (const act of Object.values(a.actions)) act.stop()
        const act = a.actions[nom]
        act.reset().setEffectiveWeight(1).play()
        act.timeScale = 1
        if (t !== undefined) act.time = t
        a.courant = nom
        a.ensuite = null
        a.mixer.update(0)
      },
      figer: (gel: boolean) => { forcage.current = { ...forcage.current, gel } },
      liberer: () => { forcage.current = { gel: false, anim: null } },
    }
    return () => { delete w.__BAVETTE__ }
  }, [])

  const tete = useRef<{ cou: THREE.Object3D | null; tete: THREE.Object3D | null }>({ cou: null, tete: null })
  useEffect(() => {
    tete.current = { cou: gltf?.scene.getObjectByName('Cou') ?? null, tete: gltf?.scene.getObjectByName('Tete') ?? null }
  }, [gltf])

  useFrame((_, delta) => {
    const g = groupe.current
    const a = anim.current
    let p = promenade.current
    if (!g || !a || !p) return
    const dt = Math.min(delta, 0.1)
    const { gel, anim: force } = forcage.current
    const visiteur = useGameStore.getState().visiteur
    if (!gel) p = promenade.current = avancerPromenade(MUSEE, LIEUX, p, dt, visiteur?.surface)

    // L'action voulue, et le passage par `Sasseoir` pour s'asseoir ou se relever.
    if (!force) {
      const voulue = ANIMATION[posture(p)]
      if (a.courant === 'Sasseoir') a.ensuite = voulue === 'Assis' ? (a.actions.Sasseoir.timeScale > 0 ? 'Assis' : 'Repos') : voulue
      else if (voulue !== a.courant) {
        if (voulue === 'Assis') asseoir(a, 1)
        else if (a.courant === 'Assis') asseoir(a, -1, voulue)
        else jouer(a, voulue, 0.35)
      }
      // `Marche` est cuite au pas de promenade : ses coussinets suivent le sol.
      a.actions.Marche.timeScale = THREE.MathUtils.clamp(p.vitesse / VITESSE_CHAT, 0.4, 2)
    }
    a.mixer.update(gel ? 0 : dt)

    // Le corps : posé sur la surface, tourné en douceur, incliné sur les volées.
    const w = p.walker
    const l = lisse.current
    const k = 1 - Math.exp(-6 * dt)
    l.yaw += angle(w.yaw - l.yaw) * (gel ? 1 : k)
    const f = w.surface.startsWith('volee:') ? MUSEE.flights.find((v) => `volee:${v.id}` === w.surface) : undefined
    let pente = 0
    if (f) {
      const [ux, uz] = ({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] } as const)[f.direction]
      const long = f.direction === 'north' || f.direction === 'south' ? f.depth : f.width
      // Le museau vers le haut quand il monte : pente × cos(écart entre son cap et la montée).
      pente = Math.atan(((f.top - f.bottom) / long) * (-Math.sin(w.yaw) * ux - Math.cos(w.yaw) * uz))
    }
    l.tangage += (pente - l.tangage) * (gel ? 1 : k)
    g.position.set(w.x, w.y, w.z)
    g.rotation.set(-l.tangage, l.yaw + Math.PI, 0, 'YXZ')
    g.updateMatrixWorld()

    orienterTete(tete.current, g, camera, l, dt, posture(p) === 'marche' && !force)

    // La carte, quand on le regarde ; la minimap, quatre fois par seconde.
    const tetePos = tete.current.tete?.getWorldPosition(new THREE.Vector3()) ?? g.position
    const regard = camera.getWorldDirection(new THREE.Vector3())
    const vu = regardeBavette(camera.position, regard, tetePos)
    const etat = useGameStore.getState()
    if (etat.bavetteRegarde !== vu) useGameStore.setState({ bavetteRegarde: vu })
    l.publie -= dt
    if (l.publie <= 0) {
      l.publie = 0.25
      useGameStore.setState({ bavette: { x: w.x, z: w.z, level: w.level } })
    }
  })

  if (!gltf) return null
  return (
    <group ref={groupe} name="bavette">
      <primitive object={gltf.scene} />
    </group>
  )
}

function jouer(a: Anim, nom: Nom, fondu: number) {
  const suivante = a.actions[nom]
  suivante.reset().setEffectiveWeight(1).fadeIn(fondu).play()
  if (a.courant !== nom) a.actions[a.courant].fadeOut(fondu)
  a.courant = nom
  a.ensuite = null
}

/** S'asseoir (sens 1), ou se relever (sens −1) puis `ensuite`. */
function asseoir(a: Anim, sens: 1 | -1, ensuite: Nom = 'Assis') {
  const s = a.actions.Sasseoir
  s.reset()
  s.timeScale = sens
  s.time = sens > 0 ? 0 : s.getClip().duration
  s.setEffectiveWeight(1).fadeIn(0.3).play()
  a.actions[a.courant].fadeOut(0.3)
  a.courant = 'Sasseoir'
  a.ensuite = sens > 0 ? 'Assis' : ensuite
}

const HAUT = new THREE.Vector3()
const DROITE = new THREE.Vector3()
const VERS = new THREE.Vector3()
const Q = new THREE.Quaternion()
const QP = new THREE.Quaternion()
const QG = new THREE.Quaternion()

/**
 * Après le mixeur : le cou et la tête pivotent vers le visiteur proche, en
 * douceur et dans des butées. Une rotation autour d'un axe du MONDE, ramenée
 * dans le repère du parent de l'os.
 */
function orienterTete(os: { cou: THREE.Object3D | null; tete: THREE.Object3D | null }, g: THREE.Group, camera: THREE.Camera, l: { regard: number }, dt: number, enMarche: boolean) {
  if (!os.cou || !os.tete) return
  os.tete.getWorldPosition(VERS)
  VERS.subVectors(camera.position, VERS)
  const d = VERS.length()
  g.getWorldQuaternion(QG)
  const local = VERS.clone().applyQuaternion(QG.clone().invert())
  const lacet = Math.atan2(local.x, local.z)
  const tangage = Math.atan2(local.y, Math.hypot(local.x, local.z))
  const cible = d < PORTEE_REGARD && Math.abs(lacet) < THREE.MathUtils.degToRad(115) ? (enMarche ? 0.5 : 1) : 0
  l.regard += (cible - l.regard) * (1 - Math.exp(-2.5 * dt))
  if (l.regard < 1e-3) return
  HAUT.set(0, 1, 0).applyQuaternion(QG)
  DROITE.set(1, 0, 0).applyQuaternion(QG)
  const y = THREE.MathUtils.clamp(lacet, -LACET_MAX, LACET_MAX) * l.regard
  const t = THREE.MathUtils.clamp(tangage, 0, TANGAGE_MAX) * l.regard
  for (const [o, part] of [[os.cou, 0.4], [os.tete, 0.6]] as const) {
    // Le museau regarde +Z ; le lever, c'est tourner autour de +X dans le sens négatif.
    Q.setFromAxisAngle(HAUT, y * part).multiply(QP.setFromAxisAngle(DROITE, -t * part))
    o.parent!.getWorldQuaternion(QP)
    const parentInv = QP.clone().invert()
    o.quaternion.premultiply(parentInv.multiply(Q).multiply(QP))
    o.updateMatrixWorld()
  }
}

/** Le modèle, sans suspendre : le musée apparaît d'abord, le chat ensuite. */
let promesse: Promise<GLTF | null> | null = null
function useBavette(): GLTF | null {
  const [gltf, setGltf] = useState<GLTF | null>(null)
  useEffect(() => {
    let vivant = true
    promesse ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/sculptures/bavette-anime.glb`).catch((e: unknown) => {
      console.warn('Bavette indisponible', e)
      return null
    })
    void promesse.then((g) => vivant && setGltf(g))
    return () => { vivant = false }
  }, [])
  return gltf
}
