/**
 * Le visiteur : où il ouvre les yeux (le départ du plan, ou devant la toile de
 * `?p=<repo>`, vitrines comprises), puis la marche (clavier, joystick) et le
 * regard (souris verrouillée, glissé du doigt), ou la visite guidée (plan/tour).
 * La caméra est passive : `walk.ts` décide où va le pied, on y pose l'œil.
 *
 * Rien ne bouge tant que la visite est en pause (`partie.paused`, vrai au départ)
 * ou que le chargement n'est pas fini (chargement.ts). Comme PlanPlayer et
 * PointerLockCamera de three : la perte du pointeur verrouillé met en pause ;
 * pendant la visite guidée, une touche de marche, un clic sur la scène ou le
 * doigt rendent la main sur place.
 *
 * En VR (`brancherVR`, `partie.enVR`) : la marche suit `vrEntree` (vrEntrees.ts) vers
 * où regarde la tête, le gréement de la caméra XR est posé au pied du marcheur, et
 * la FreeCamera recopie la tête à chaque image (les couches qui la lisent, tri par
 * salle compris, voient ce que voit le casque), avec un champ large pour les deux yeux.
 */
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { AU_SOL, PAS_FIXE, VITESSE_VISITE, cadencer, sauter } from '../domain/locomotion.ts'
import { projetDemande, resoudre } from '../domain/lien.ts'
import { arriveeDevant, cibleDe, type Arrivee } from '../plan/arrivee.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { capDuRegard } from '../domain/vr.ts'
import { surfaceAt } from '../plan/rules.ts'
import { VISITE, avancer, capVers, type Curseur } from '../plan/tour.ts'
import type { Plan } from '../plan/types.ts'
import { step, type Walker } from '../plan/walk.ts'

import { pret } from './chargement.ts'
import { partie, publier, reglages, toucher, vrEntree, type Partie } from './etat.ts'
import { signaler } from './succes.ts'
import type { PorteVR } from './vr.ts'

const OEIL = 1.62
/** Radians par pixel, souris (multipliée par le réglage) et doigt (tel quel, comme three). */
const SENSIBILITE = 0.002
/** Secondes d'arrêt au bout de chaque arrêt de la visite. */
const PAUSE_VISITE = 4
/** Vitesse de convergence du regard vers le cap de la visite, en s⁻¹. */
const TAUX_REGARD = 3.5
/** Lissage du doigt, en s⁻¹ : le glissé est rendu sur ~40 ms, la marche du joystick monte sur ~80 ms (les touchmove arrivent hors cadence). */
const TAUX_DOIGT = 25
const TAUX_JOYSTICK = 12
/** Les touches qui font marcher ou sauter : pendant la visite guidée, elles la font cesser. */
const TOUCHES_DE_MARCHE = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'])
/** Champ vertical de la FreeCamera en VR (rad) : il couvre les deux yeux, sinon le tri par salle (visibilite.ts) retire ce que voit l'autre œil. */
const CHAMP_VR = 1.9
const borne = (v: number, a = 1) => Math.max(-a, Math.min(a, v))
/** L'horizontale minimale, en degrés : en portrait, le champ vertical s'ouvre jusqu'à la tenir. */
const CHAMP_HORIZONTAL_MIN = 60

/** Le champ vertical (radians) pour un réglage en degrés et un rapport largeur/hauteur. */
export function champVertical(degres: number, aspect: number): number {
  const reglage = (degres * Math.PI) / 180
  const minimum = 2 * Math.atan(Math.tan((CHAMP_HORIZONTAL_MIN * Math.PI) / 360) / aspect)
  return Math.max(reglage, minimum)
}

/**
 * Le départ du visiteur : devant la toile demandée (accrochée ou en vitrine, `vitrines` = leurs clés),
 * sinon au départ du plan. `rendezVous` : ce que le billet dit de la demande (null sans `?p=`, ou si
 * l'accrochage ou le catalogue (`vitrines` null) manque : on ne peut rien affirmer, comme PlanPlayer).
 */
export function departDuVisiteur(
  plan: Plan, accrochage: Accrochage | null, recherche: string, hash: string, owners: readonly string[], vitrines: readonly string[] | null = [],
): Arrivee & { rendezVous: Partie['rendezVous'] } {
  const demande = accrochage && vitrines ? projetDemande(recherche, hash) : null
  if (demande && accrochage && vitrines) {
    const cles = [...accrochage.rooms.flatMap((r) => r.placements.map((p) => p.key)), ...vitrines]
    const cle = resoudre(demande, cles, owners)
    const cible = cle ? cibleDe(cle, accrochage, [...vitrines]) : null
    const arrivee = cible ? arriveeDevant(plan, cible) : null
    if (arrivee) return { ...arrivee, rendezVous: { demande, cle } }
  }
  const { level, x, z } = plan.spawn
  const y = plan.levels.find((l) => l.id === level)?.elevation ?? 0
  const surface = surfaceAt(plan, x, z, y)
  if (!surface) throw new Error(`Le départ (${x}, ${z}) n'est sur aucune surface`)
  return { level, surface, x, z, y, yaw: 0, pitch: 0, rendezVous: demande ? { demande, cle: null } : null }
}

/** La visite guidée reprise en main : on continue à pied là où l'on est, sans repasser par l'accueil. */
function reprendreLaMain(toile?: HTMLCanvasElement) {
  if (toile) Promise.resolve(toile.requestPointerLock?.()).catch(() => {})
  partie.setState({ tourActive: false, paused: false })
}

/**
 * La caméra du visiteur, menée par le clavier (codes positionnels : ZQSD en AZERTY), la souris verrouillée,
 * `toucher` (ui/mobile.ts) et la visite guidée. `placer` téléporte le visiteur, même en pause (captures
 * comparées, `tools/comparer-captures.ts`) ; `walker` rend le marcheur courant, surface comprise.
 */
export function monterVisiteur(
  scene: Scene, toile: HTMLCanvasElement, depart: Arrivee,
): FreeCamera & { placer(a: Arrivee): void; walker(): Walker; brancherVR(p: PorteVR): void; asseoir(a: Arrivee, oeil: number): void } {
  const camera = new FreeCamera('visiteur', new Vector3(depart.x, depart.y + OEIL, depart.z), scene)
  camera.inputs.clear()
  camera.minZ = 0.1
  camera.maxZ = 1000
  // Le champ de vision du réglage (vertical, comme three), suivi en direct ; large en VR ; en portrait, élargi pour
  // garder CHAMP_HORIZONTAL_MIN à l'horizontale (sinon un téléphone debout voit le monde par une fente).
  const champ = () => (camera.fov = partie.getState().enVR ? CHAMP_VR : champVertical(reglages.getState().champ, scene.getEngine().getAspectRatio(camera)))
  champ()
  reglages.subscribe((r, a) => r.champ !== a.champ && champ())
  scene.getEngine().onResizeObservable.add(champ)

  const enfoncees = new Set<string>()
  addEventListener('keydown', (e) => {
    enfoncees.add(e.code)
    if (partie.getState().tourActive && TOUCHES_DE_MARCHE.has(e.code)) reprendreLaMain(toile)
  })
  addEventListener('keyup', (e) => enfoncees.delete(e.code))
  addEventListener('blur', () => enfoncees.clear())
  const touche = (...codes: string[]) => Number(codes.some((c) => enfoncees.has(c)))
  toile.addEventListener('pointerdown', () => partie.getState().tourActive && reprendreLaMain(toile))

  let { pitch } = depart
  /** Le cap du regard : celui de la marche hors visite, qui rattrape celui de la visite pendant. */
  let regard = depart.yaw
  let w: Walker = { level: depart.level, surface: depart.surface, x: depart.x, z: depart.z, y: depart.y, yaw: depart.yaw }
  let saut = AU_SOL
  let porte: PorteVR | null = null
  // Où regarde la tête : un seul vecteur, relu à chaque image en VR.
  const devant = Vector3.Forward(true)
  const regardTete = new Vector3()
  /** La caméra XR (la tête), seulement en VR. */
  const tete = () => (partie.getState().enVR ? porte?.xr()?.camera : null) ?? null
  const poser = (publie = true) => {
    const xr = tete()
    if (xr && porte) {
      // La hauteur vient du casque en local-floor ; sans sol (Cardboard), le gréement porte l'œil.
      porte.gree.position.set(w.x, w.y + (vrEntree.sansSol ? OEIL : 0), w.z)
      porte.gree.computeWorldMatrix(true)
      xr.getViewMatrix(true)
      camera.position.copyFrom(xr.globalPosition)
      xr.getDirectionToRef(devant, regardTete)
      const d = regardTete
      regard = capDuRegard(d.x, d.z)
      pitch = Math.asin(borne(d.y))
    } else camera.position.set(w.x, w.y + OEIL + saut.h, w.z)
    // En main droite, yaw 0 regarde −z et un pitch positif lève les yeux, comme three.
    camera.rotation.set(pitch, regard, 0)
    // Publié seulement s'il a bougé ou tourné : à l'arrêt, la minimap ne se redessine pas.
    const v = partie.getState().visiteur
    if (publie && (!v || v.x !== w.x || v.z !== w.z || v.yaw !== w.yaw || v.surface !== w.surface)) partie.setState({ visiteur: w })
  }

  // Le regard à la souris verrouillée ; Échap (le verrou tombe) met en pause.
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== toile) return
    const { sensibilite, inverserY } = reglages.getState()
    regard -= e.movementX * SENSIBILITE * sensibilite
    pitch = borne(pitch - e.movementY * SENSIBILITE * sensibilite * (inverserY ? -1 : 1), Math.PI / 2)
  })
  document.addEventListener('pointerlockchange', () => {
    // En VR, le verrou tombe (plein écran du polyfill, focus du casque) sans que la visite s'arrête.
    if (document.pointerLockElement !== toile && !partie.getState().enVR) partie.setState({ paused: true })
  })
  // Sortie de VR : on garde le cap de la tête, les yeux à l'horizon, au champ du réglage.
  partie.subscribe((s, a) => {
    if (s.enVR === a.enVR) return
    if (!s.enVR) pitch = 0
    champ()
    poser()
  })

  // La visite guidée : chaque visite repart du départ du plan, où commence son itinéraire.
  const DEPART = departDuVisiteur(MUSEE, null, '', '', [])
  let curseur: Curseur | null = null
  let attente = 0
  partie.subscribe((s, a) => {
    if (s.tourActive === a.tourActive) return
    curseur = null
    attente = 0
    if (s.tourActive) {
      w = { level: DEPART.level, surface: DEPART.surface, x: DEPART.x, z: DEPART.z, y: DEPART.y, yaw: 0 }
      partie.setState({ tourEtape: 0 })
    }
  })
  /** L'entrée d'un pas de visite : marcher vers le prochain point de l'arrêt, puis s'y arrêter. `null` : visite finie. */
  const guider = (w: Walker, dt: number) => {
    const c = avancer(VISITE, curseur ?? { stop: 0, point: 0 }, w)
    curseur = c
    publier(partie, { tourEtape: c.stop })
    const pts = VISITE[c.stop].points
    if (c.point < pts.length) return { forward: 1, strafe: 0, yaw: capVers(w, ...pts[c.point]), vitesse: VITESSE_VISITE }
    attente += dt
    if (attente >= PAUSE_VISITE) {
      attente = 0
      if (c.stop + 1 >= VISITE.length) return null
      curseur = { stop: c.stop + 1, point: 0 }
    }
    return { forward: 0, strafe: 0, yaw: w.yaw }
  }

  /** Assis (`asseoir`) : le marcheur d'où l'on s'est assis, rendu en se levant. */
  let debout: Walker | null = null
  let reste = 0
  /** La marche du joystick, lissée vers `toucher`. */
  const pouce = { forward: 0, strafe: 0 }
  scene.onBeforeRenderObservable.add(() => {
    // En pause, rien n'avance, pas même le cadenceur (les glissés du doigt attendent la reprise).
    if (partie.getState().paused || !pret()) return
    const dt = scene.getEngine().getDeltaTime() / 1000
    const { pas, reste: r } = cadencer(reste, dt)
    reste = r
    if (toucher.lookX || toucher.lookY) {
      if (partie.getState().tourActive) reprendreLaMain()
      // Le glissé est consommé en douceur ; le reliquat (sous le demi-pixel) est soldé d'un coup.
      const k = 1 - Math.exp(-TAUX_DOIGT * dt)
      const lx = Math.abs(toucher.lookX) < 0.5 ? toucher.lookX : toucher.lookX * k
      const ly = Math.abs(toucher.lookY) < 0.5 ? toucher.lookY : toucher.lookY * k
      regard -= lx * SENSIBILITE
      pitch = borne(pitch - ly * SENSIBILITE, Math.PI / 2)
      toucher.lookX -= lx
      toucher.lookY -= ly
    }
    const kj = 1 - Math.exp(-TAUX_JOYSTICK * dt)
    pouce.forward += (toucher.forward - pouce.forward) * kj
    pouce.strafe += (toucher.strafe - pouce.strafe) * kj
    if (Math.abs(pouce.forward) < 1e-3 && !toucher.forward) pouce.forward = 0
    if (Math.abs(pouce.strafe) < 1e-3 && !toucher.strafe) pouce.strafe = 0
    if (partie.getState().tourActive && (toucher.forward || toucher.strafe)) reprendreLaMain()
    const visite = partie.getState().tourActive
    const xr = tete()
    xr?.getDirectionToRef(devant, regardTete)
    const d = xr ? regardTete : null
    // En VR, les manettes ou le Cardboard (vrEntrees.ts), vers où regarde la tête. Sinon,
    // clavier et joystick s'additionnent, bornés à [−1, 1] comme l'attend `step`.
    const input = d ? { forward: vrEntree.avance, strafe: vrEntree.cote, yaw: capDuRegard(d.x, d.z), hate: vrEntree.hate } : {
      forward: borne(touche('KeyW', 'ArrowUp') - touche('KeyS', 'ArrowDown') + pouce.forward),
      strafe: borne(touche('KeyD', 'ArrowRight') - touche('KeyA', 'ArrowLeft') + pouce.strafe),
      yaw: regard,
      hate: touche('ShiftLeft', 'ShiftRight') > 0,
    }
    // Assis : le regard tourne, les pieds restent ; une touche de marche relève, à la place d'où l'on s'est assis.
    if (debout) {
      if (!(input.forward || input.strafe) || visite) return poser()
      w = debout
      debout = null
      partie.setState({ assis: false })
    }
    for (let i = 0; i < pas; i++) {
      const entree = visite ? guider(w, PAS_FIXE) : input
      if (!entree) {
        // Fin de visite : retour au billet d'accueil.
        curseur = null
        signaler('visite')
        partie.setState({ tourActive: false, paused: true })
        break
      }
      // Toujours le même objet MUSEE : `walk.ts` y accroche son cache de murs.
      w = step(MUSEE, w, entree, PAS_FIXE)
      saut = sauter(saut, !visite && !xr && touche('Space') > 0, PAS_FIXE)
    }
    if (visite) {
      // Le regard rejoint le cap de la marche, amorti et indépendant de la cadence.
      const k = 1 - Math.exp(-TAUX_REGARD * dt)
      regard += Math.atan2(Math.sin(w.yaw - regard), Math.cos(w.yaw - regard)) * k
      pitch -= pitch * k
    }
    poser()
  })
  // Comme three : au départ, publié seulement devant le tableau d'un rendez-vous (la minimap attend sinon le premier pas).
  poser(Boolean(partie.getState().rendezVous?.cle))
  return Object.assign(camera, {
    placer: (a: Arrivee) => {
      ;({ pitch, ...w } = a)
      regard = w.yaw
      poser()
    },
    walker: () => w,
    /** S'assied : l'œil à `oeil` m au-dessus du sol du plan, tourné vers `yaw` ; avancer relève. */
    asseoir: (a: Arrivee, oeil: number) => {
      debout ??= { ...w }
      w = { level: a.level, surface: a.surface, x: a.x, z: a.z, y: oeil - OEIL, yaw: a.yaw }
      regard = a.yaw
      pitch = a.pitch
      partie.setState({ assis: true })
      poser()
    },
    brancherVR: (p: PorteVR) => void (porte = p),
  })
}
