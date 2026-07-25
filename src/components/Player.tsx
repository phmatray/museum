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
import { computeMovement } from '../hooks/usePlayerMovement'
import { useGameStore } from '../stores/gameStore'

const PLAYER_SPEED = 4 // m/s
const PLAYER_HEIGHT = 1.7
const CAPSULE_RADIUS = 0.3
const CAPSULE_HALF_HEIGHT = 0.5
const GRAVITY = -9.81

/**
 * Distance entre le centre du corps rigide et la plante des pieds.
 *
 * La capsule de Rapier est décrite par son demi-segment et son rayon : son
 * point le plus bas est à `demi-segment + rayon` sous le centre. Poser le corps
 * à l'altitude du sol l'enfoncerait donc de 80 cm dans la dalle, ce que le
 * contrôleur cinématique résout en éjectant le joueur — vers le haut si tout va
 * bien, à travers le plancher sinon.
 */
const FEET_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS

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

export function Player({ spawn = [0, 0, 0], yaw = 0, voidY }: PlayerProps) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const tourActive = useGameStore((s) => s.tourActive)
  const { world } = useRapier()
  const characterControllerRef = useRef<KinematicCharacterController | null>(null)
  const verticalVelocity = useRef(0)

  // Mémorisé sur les COMPOSANTES et non sur le tableau : un appelant qui
  // reconstruit `[x, y, z]` à chaque rendu — le cas normal en JSX — recalerait
  // sinon la caméra à chaque image, c'est-à-dire annulerait tout mouvement de
  // souris.
  const [spawnX, spawnY, spawnZ] = spawn
  const bodySpawn = useMemo<[number, number, number]>(
    () => [spawnX, spawnY + FEET_OFFSET + SPAWN_CLEARANCE, spawnZ],
    [spawnX, spawnY, spawnZ],
  )

  // Create character controller once the physics world is available
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
      bodySpawn[1] + PLAYER_HEIGHT - CAPSULE_HALF_HEIGHT,
      bodySpawn[2],
    )
    /* eslint-enable react-hooks/immutability */
  }, [camera, yaw, bodySpawn])

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current
    const cc = characterControllerRef.current
    if (!rb || !cc) return
    if (paused || tourActive) return

    const collider = rb.collider(0)
    if (!collider) return

    // Filet anti-chute infinie. L'enveloppe du bâtiment n'est pas encore fermée
    // sur tous les côtés (spec §7.2, invariant d'enveloppe non tenu au
    // rez-de-chaussée) : sortir par un bord de dalle nu est possible, et sans
    // ce garde-fou la chute n'a pas de fin — la partie serait perdue sans le
    // moindre message. Le seuil est à 20 m sous le plancher le plus bas, soit
    // plus qu'aucune chute d'un étage à l'autre.
    if (voidY !== undefined && rb.translation().y < voidY) {
      rb.setTranslation({ x: bodySpawn[0], y: bodySpawn[1], z: bodySpawn[2] }, true)
      verticalVelocity.current = 0
      return
    }

    const keys = getKeys() as {
      forward: boolean
      backward: boolean
      left: boolean
      right: boolean
    }
    const horizontal = computeMovement(keys, camera, delta, PLAYER_SPEED)

    // Apply simple gravity for vertical movement
    verticalVelocity.current += GRAVITY * delta
    const desired = {
      x: horizontal.x,
      y: verticalVelocity.current * delta,
      z: horizontal.z,
    }

    // Exclude sensors (like doorway triggers) so they don't block movement.
    cc.computeColliderMovement(collider, desired, QueryFilterFlags.EXCLUDE_SENSORS)
    const corrected = cc.computedMovement()

    const current = rb.translation()
    const next = {
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    }
    rb.setNextKinematicTranslation(next)

    // Reset vertical velocity when grounded
    if (cc.computedGrounded()) {
      verticalVelocity.current = 0
    }

    // Sync camera to player position (eye level = top of capsule)
    camera.position.set(next.x, next.y + PLAYER_HEIGHT - CAPSULE_HALF_HEIGHT, next.z)
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
