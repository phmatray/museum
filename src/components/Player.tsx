/**
 * LE VISITEUR.
 *
 * Rapier arbitre les collisions ; l'intégration du mouvement est ici, par pas
 * fixes, et le visiteur POSSÈDE sa position. Le pourquoi de ce partage — et le
 * défaut de vitesse dépendante de la cadence d'affichage qu'il corrige — est
 * écrit en tête de `domain/locomotion.ts`, avec les relevés.
 *
 * ── Pourquoi Rapier reste ──
 *
 * Rapier est le moteur physique de référence en WebAssembly, et rien de ce qui
 * n'allait pas ne venait de lui : le contrôleur cinématique franchit les
 * marches, glisse le long des murs et suit les pentes correctement. Tout ce qui
 * était faux — la vitesse perdue entre deux pas, la caméra téléportée d'un
 * giron, la marche sans masse — était dans CE fichier. En changer aurait
 * imposé de réécrire chaque collider du musée (trimesh des dalles, boîtes de
 * l'escalier, capsule du visiteur, capteurs d'embrasure) pour retrouver, au
 * mieux, ce qu'on avait déjà.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import {
  CapsuleCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier'
import {
  ActiveCollisionTypes,
  QueryFilterFlags,
  type KinematicCharacterController,
} from '@dimforge/rapier3d-compat'
import {
  PAS_FIXE,
  TAUX_ACCELERATION,
  VITESSE_HATE,
  VITESSE_MARCHE,
  approcher,
  balancement,
  cadencer,
  chuter,
  directionMarche,
  enfoncementImpact,
  suivreOeil,
} from '../domain/locomotion'
import { useGameStore } from '../stores/gameStore'

const PLAYER_HEIGHT = 1.7
const CAPSULE_RADIUS = 0.3
const CAPSULE_HALF_HEIGHT = 0.5

/**
 * Distance entre le centre du corps rigide et la plante des pieds.
 *
 * La capsule de Rapier est décrite par son demi-segment et son rayon : son
 * point le plus bas est à `demi-segment + rayon` sous le centre. Poser le corps
 * à l'altitude du sol l'enfoncerait donc de 80 cm dans la dalle, ce que le
 * contrôleur cinématique résout en éjectant le joueur — vers le haut si tout va
 * bien, à travers le plancher sinon.
 */
export const FEET_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS

/**
 * Hauteur de l'ŒIL au-dessus des pieds, en mètres.
 *
 * 1,62 m : la hauteur d'œil d'un adulte de 1,75 m. L'ancienne valeur était
 * dérivée de la géométrie de la capsule (`PLAYER_HEIGHT − CAPSULE_HALF_HEIGHT`
 * au-dessus du centre, soit 2,00 m au-dessus des pieds) et faisait donc du
 * visiteur un homme de deux mètres quinze. Ce n'est pas un détail : la hauteur
 * d'œil est l'unique référence d'échelle d'une vue subjective, et 38 cm de trop
 * rapetissent tout le bâtiment — un plafond de 4,20 m se lisait comme 3,50.
 *
 * Exportée parce que `MuseumScene` en a besoin pour rendre la position du
 * VISITEUR (pieds au sol) à partir de celle de la caméra. Elle y était recopiée
 * à la main, et cette duplication a déjà produit un relevé faux de 1,10 m.
 */
export const HAUTEUR_OEIL = 1.62

/** Jeu laissé sous les pieds à l'apparition : on tombe de 2 cm, on ne s'encastre pas. */
const SPAWN_CLEARANCE = 0.02

export interface PlayerProps {
  /**
   * Point du SOL où poser les pieds, en coordonnées monde — typiquement
   * `resolveSpawn(museum).position`. Ce n'est PAS le centre du corps : le
   * décalage de la capsule est un détail du joueur, pas de la disposition.
   */
  spawn?: [number, number, number]
  /** Cap initial du regard, en radians (`museum.spawn.yaw`). */
  yaw?: number
  /**
   * Altitude sous laquelle le joueur est considéré comme tombé hors du
   * bâtiment, et remis au point de départ. Voir `voidFloorY`.
   */
  voidY?: number
}

interface Etat {
  /** Position du CENTRE de la capsule. Le visiteur en est propriétaire. */
  x: number
  y: number
  z: number
  /** Vitesse, en m/s. */
  vx: number
  vy: number
  vz: number
  /** Temps non encore consommé par un pas fixe, en secondes. */
  reste: number
  /** Hauteur de l'œil, en mètres monde. Suit le corps sous limite de vitesse. */
  oeil: number
  /** Distance parcourue au sol, en mètres. Indexe le balancement. */
  distance: number
  auSol: boolean
}

export function Player({ spawn = [0, 0, 0], yaw = 0, voidY }: PlayerProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const tourActive = useGameStore((s) => s.tourActive)
  const { world } = useRapier()
  const characterControllerRef = useRef<KinematicCharacterController | null>(null)

  // Mémorisé sur les COMPOSANTES et non sur le tableau : un appelant qui
  // reconstruit `[x, y, z]` à chaque rendu — le cas normal en JSX — recalerait
  // sinon la caméra à chaque image, c'est-à-dire annulerait tout mouvement de
  // souris.
  const [spawnX, spawnY, spawnZ] = spawn
  const bodySpawn = useMemo<[number, number, number]>(
    () => [spawnX, spawnY + FEET_OFFSET + SPAWN_CLEARANCE, spawnZ],
    [spawnX, spawnY, spawnZ],
  )

  const etat = useRef<Etat>({
    x: bodySpawn[0],
    y: bodySpawn[1],
    z: bodySpawn[2],
    vx: 0,
    vy: 0,
    vz: 0,
    reste: 0,
    oeil: bodySpawn[1] - FEET_OFFSET + HAUTEUR_OEIL,
    distance: 0,
    auSol: false,
  })

  /*
    Le balancement de marche est un MOUVEMENT INVOLONTAIRE de la caméra, et
    c'est exactement ce que `prefers-reduced-motion` demande de supprimer : il
    déclenche le mal des transports chez une part non négligeable des visiteurs,
    et c'est la seule chose de ce contrôleur qu'on ne peut pas éviter en jouant
    autrement. Lu une fois, sans abonnement : personne ne bascule ce réglage
    pendant une visite, et un `matchMedia` écouté en continu pour ça coûterait
    plus de code que la valeur qu'il porte.
  */
  const amplitudeBalancement = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return 1
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1
  }, [])

  useEffect(() => {
    const cc = world.createCharacterController(0.05)
    // 45° laisse passer largement les rampes hélicoïdales du bâtiment : la
    // règle de disposition (spec §7.5) les maintient sous 40°, et le musée réel
    // est actuellement à 17,3°. La marge est là pour les rampes courtes d'un
    // bâtiment à petit atrium, pas pour le cas nominal.
    cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180)
    cc.setMinSlopeSlideAngle((30 * Math.PI) / 180)
    // 0,35 m de marche franchissable : au-dessus du plus grand ressaut que le
    // bâtiment procédural produise (le raccord d'une rampe sur une dalle, et
    // les ~2 cm d'écart entre la face plane d'un collider de rampe et
    // l'hélicoïde vrillé qu'il approche), et bien en dessous du garde-corps de
    // 1,1 m, qu'il ne faut surtout pas pouvoir enjamber.
    cc.enableAutostep(0.35, 0.1, true)
    cc.enableSnapToGround(0.3)
    cc.setApplyImpulsesToDynamicBodies(false)
    characterControllerRef.current = cc

    return () => {
      world.removeCharacterController(cc)
      characterControllerRef.current = null
    }
  }, [world])

  // Cadrage initial. `PointerLockCamera` mute directement la rotation de la
  // caméra (c'est le contrat de R3F) : on s'aligne sur la même convention
  // plutôt que d'introduire un second propriétaire de cet état.
  //
  // La POSITION compte autant que le cap : la boucle de rendu ne recale la
  // caméra que lorsque la partie n'est pas en pause, or l'écran d'accueil
  // s'affiche justement en pause. Sans ce recalage, le premier plan que voit le
  // visiteur est celui de la caméra par défaut de R3F — (0, 0, 5), c'est-à-dire
  // suspendue en l'air au milieu du vide de l'atrium.
  useEffect(() => {
    /* eslint-disable react-hooks/immutability */
    camera.rotation.order = 'YXZ'
    camera.rotation.y = yaw
    camera.position.set(
      bodySpawn[0],
      bodySpawn[1] - FEET_OFFSET + HAUTEUR_OEIL,
      bodySpawn[2],
    )
    /* eslint-enable react-hooks/immutability */
    const e = etat.current
    e.x = bodySpawn[0]
    e.y = bodySpawn[1]
    e.z = bodySpawn[2]
    e.vx = e.vy = e.vz = 0
    e.oeil = bodySpawn[1] - FEET_OFFSET + HAUTEUR_OEIL
  }, [camera, yaw, bodySpawn])

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current
    const cc = characterControllerRef.current
    if (!rb || !cc) return
    if (paused || tourActive) return

    const collider = rb.collider(0)
    if (!collider) return

    const e = etat.current

    // Filet anti-chute infinie. L'enveloppe du bâtiment n'est pas encore fermée
    // sur tous les côtés (spec §7.2, invariant d'enveloppe non tenu au
    // rez-de-chaussée) : sortir par un bord de dalle nu est possible, et sans
    // ce garde-fou la chute n'a pas de fin — la partie serait perdue sans le
    // moindre message. Le seuil est à 20 m sous le plancher le plus bas, soit
    // plus qu'aucune chute d'un étage à l'autre.
    if (voidY !== undefined && e.y < voidY) {
      e.x = bodySpawn[0]
      e.y = bodySpawn[1]
      e.z = bodySpawn[2]
      e.vx = e.vy = e.vz = 0
      e.oeil = e.y - FEET_OFFSET + HAUTEUR_OEIL
      rb.setTranslation({ x: e.x, y: e.y, z: e.z }, true)
      return
    }

    const touches = getKeys() as {
      forward: boolean
      backward: boolean
      left: boolean
      right: boolean
      hate?: boolean
    }
    const vitesseVoulue = touches.hate ? VITESSE_HATE : VITESSE_MARCHE

    const { pas, reste } = cadencer(e.reste, delta)
    e.reste = reste

    for (let i = 0; i < pas; i += 1) {
      const dir = directionMarche(touches, camera.rotation.y)
      e.vx = approcher(e.vx, dir.x * vitesseVoulue, TAUX_ACCELERATION, PAS_FIXE)
      e.vz = approcher(e.vz, dir.z * vitesseVoulue, TAUX_ACCELERATION, PAS_FIXE)
      e.vy = chuter(e.vy, PAS_FIXE)

      cc.computeColliderMovement(
        collider,
        { x: e.vx * PAS_FIXE, y: e.vy * PAS_FIXE, z: e.vz * PAS_FIXE },
        // On exclut les capteurs (les embrasures qui pilotent la minimap) :
        // sans ça ils arrêteraient le visiteur au lieu de le compter.
        QueryFilterFlags.EXCLUDE_SENSORS,
      )
      const corrige = cc.computedMovement()
      const auSol = cc.computedGrounded()

      /*
        La vitesse suit ce qui a RÉELLEMENT été parcouru.

        Sans ça, marcher contre un mur laisse la vitesse monter jusqu'au maximum
        pendant qu'on n'avance pas — et au premier pas où l'obstacle disparaît,
        le visiteur part d'un coup à pleine vitesse. On rabat donc la vitesse sur
        le déplacement obtenu, en gardant la DIRECTION voulue : c'est le glissement
        le long du mur qui doit décider du cap, pas ce facteur d'échelle.

        Pas pendant un franchissement de marche : le contrôleur y réduit
        légitimement l'avance horizontale le temps de monter, et s'aligner
        dessus ferait caler dans l'escalier.
      */
      const monte = corrige.y > 0.01 && auSol
      if (!monte) {
        const voulue = Math.hypot(e.vx, e.vz)
        const obtenue = Math.hypot(corrige.x, corrige.z) / PAS_FIXE
        if (voulue > 1e-4 && obtenue < voulue) {
          const k = obtenue / voulue
          e.vx *= k
          e.vz *= k
        }
      }

      e.x += corrige.x
      e.y += corrige.y
      e.z += corrige.z
      e.distance += Math.hypot(corrige.x, corrige.z)

      // L'œil suit le corps sous limite de vitesse : c'est ce qui écrête les
      // à-coups du franchissement de marche, dans les deux sens.
      e.oeil = suivreOeil(e.oeil, e.y - FEET_OFFSET + HAUTEUR_OEIL, PAS_FIXE)
      if (auSol) {
        // L'atterrissage, lui, est un mouvement VOULU : on abaisse l'œil d'un
        // coup et la limite de vitesse le remonte, ce qui donne la flexion.
        if (!e.auSol) e.oeil -= enfoncementImpact(e.vy)
        e.vy = 0
      } else if (corrige.y > e.vy * PAS_FIXE + 1e-6 && e.vy > 0) {
        // Plafond touché en montant : garder la vitesse ferait « coller » le
        // visiteur sous la sous-face de dalle jusqu'à ce qu'il en sorte.
        e.vy = 0
      }
      e.auSol = auSol
    }

    if (pas > 0) {
      // On POUSSE la position au corps, on ne la relit jamais. C'est tout le
      // remède : la translation d'un corps cinématique n'est publiée qu'au pas
      // de physique, et la relire revenait à jeter le mouvement des images
      // intermédiaires.
      rb.setNextKinematicTranslation({ x: e.x, y: e.y, z: e.z })
    }

    const vitesseSol = Math.hypot(e.vx, e.vz)
    const bob = balancement(e.distance, vitesseSol, amplitudeBalancement)
    // Le décalage latéral est dans le repère de la caméra : à droite du regard.
    const cos = Math.cos(camera.rotation.y)
    const sin = Math.sin(camera.rotation.y)
    camera.position.set(
      e.x + bob.lateral * cos,
      e.oeil + bob.y,
      e.z - bob.lateral * sin,
    )
  })

  return (
    <RigidBody
      ref={rigidBodyRef}
      type="kinematicPosition"
      position={bodySpawn}
      colliders={false}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider
        args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]}
        // The default activeCollisionTypes (DEFAULT = 15) only covers
        // DYNAMIC_* pairs. Since the player is kinematic and doorway sensors
        // are fixed (standalone) colliders, we need KINEMATIC_FIXED enabled
        // for Rapier to process the pair and fire intersection events.
        activeCollisionTypes={ActiveCollisionTypes.ALL}
      />
    </RigidBody>
  )
}

export { PLAYER_HEIGHT }
