/**
 * LOT 3 — Le suivi du visiteur.
 *
 * Une seule question, posée à chaque image : où est-il ? La réponse alimente
 * `gameStore.currentRoomId` (le surlignage du plan, et le culling par salle du
 * spec §9.3) et la flèche du plan.
 *
 * ── Ce que ce fichier ne fait pas ──
 *
 * Il ne DÉCIDE rien. Toute la géométrie — quel niveau porte cette altitude,
 * quelle salle contient ce point — vit dans `domain/visitor.ts`, qui se teste
 * sans canvas. Ici il ne reste que le branchement : lire la caméra, cadencer,
 * et n'écrire dans le magasin que ce qui a changé.
 *
 * ── Pourquoi la caméra, et pas le corps du joueur ──
 *
 * Parce que le visiteur, c'est le point de vue. Pendant une visite guidée le
 * corps rigide reste planté là où le joueur l'a laissé (le `Player` se coupe sur
 * `tourActive`) : suivre le corps ferait mentir le plan pendant toute la visite,
 * alors que suivre la caméra le fait avancer avec elle. Le contrôleur recale la
 * caméra sur le corps à chaque image le reste du temps, les deux coïncident donc
 * partout ailleurs.
 *
 * ── Pourquoi une cadence, et pas chaque image ──
 *
 * Écrire la position dans un magasin zustand à 60 Hz re-rend le plan 60 fois par
 * seconde pour des déplacements sous-pixel. Douze fois par seconde suffisent
 * largement à l'œil sur un plan de 150 px, et le seuil de déplacement fait qu'un
 * visiteur immobile n'écrit rien du tout.
 */
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { create } from 'zustand'

import type { Museum } from '../domain/types'
import { locateVisitor } from '../domain/visitor'
import { useGameStore } from '../stores/gameStore'

// ── Le magasin ───────────────────────────────────────────────────────────

export interface VisitorState {
  /** Position de l'œil, en coordonnées monde. `null` avant la première image. */
  position: { x: number; y: number; z: number } | null
  /** Cap du regard en radians, mesuré comme un lacet : 0 = vers −Z. */
  yaw: number
  /** Niveau courant, ou `null` hors du bâtiment. */
  floorId: string | null
  /** Salle courante, ou `null` dans l'atrium, sur une rampe, ou dehors. */
  roomId: string | null
}

/**
 * La position du visiteur, hors du canvas.
 *
 * Un magasin distinct de `gameStore` : celui-ci change douze fois par seconde et
 * n'intéresse que le plan, tandis que `gameStore` porte des états rares (pause,
 * visite) que tout l'écran observe. Les fondre ferait re-rendre l'ensemble de
 * l'interface à chaque pas.
 */
export const useVisitorStore = create<VisitorState>(() => ({
  position: null,
  yaw: 0,
  floorId: null,
  roomId: null,
}))

/** Valeur écrite dans `gameStore.currentRoomId` quand on n'est dans aucune salle. */
export const NO_ROOM = ''

// ── Cadence et seuils ────────────────────────────────────────────────────

/** Douze relevés par seconde : invisible à l'œil, cinq fois moins de rendus. */
const INTERVALLE = 1 / 12

/** En deçà, le plan ne bougerait pas d'un pixel. */
const SEUIL_DEPLACEMENT = 0.05

/** ~1,7° : en deçà, la flèche du plan ne tourne pas visiblement. */
const SEUIL_CAP = 0.03

// ── Le suivi ─────────────────────────────────────────────────────────────

const _direction = new THREE.Vector3()

/**
 * Suit le visiteur et tient les magasins à jour. À appeler DANS le canvas.
 *
 * Ne rend rien et ne re-rend rien : tout passe par `setState` hors du cycle de
 * rendu de ce composant, si bien que le suivi ne coûte pas un rendu React par
 * image.
 */
export function useRoomTransition(museum: Museum): void {
  const { camera } = useThree()
  const horloge = useRef(0)

  useFrame((_, delta) => {
    horloge.current += delta
    if (horloge.current < INTERVALLE) return
    horloge.current = 0

    const p = camera.position
    // Le cap se lit sur la matrice monde, pas sur `rotation.y` : la visite
    // guidée oriente la caméra par quaternion, et l'ordre d'Euler n'est pas le
    // même partout. La direction, elle, ne ment jamais.
    camera.getWorldDirection(_direction)
    const yaw = Math.atan2(-_direction.x, -_direction.z)

    const lieu = locateVisitor(museum, { x: p.x, y: p.y, z: p.z })
    const floorId = lieu?.floorId ?? null
    const roomId = lieu?.roomId ?? null

    const etat = useVisitorStore.getState()
    const bouge =
      etat.position === null ||
      Math.abs(etat.position.x - p.x) > SEUIL_DEPLACEMENT ||
      Math.abs(etat.position.y - p.y) > SEUIL_DEPLACEMENT ||
      Math.abs(etat.position.z - p.z) > SEUIL_DEPLACEMENT

    const change =
      bouge ||
      Math.abs(etat.yaw - yaw) > SEUIL_CAP ||
      etat.floorId !== floorId ||
      etat.roomId !== roomId

    if (!change) return

    useVisitorStore.setState({ position: { x: p.x, y: p.y, z: p.z }, yaw, floorId, roomId })

    // `gameStore` n'est touché QUE sur changement de salle : c'est lui que le
    // reste de l'interface observe, il n'a pas à s'agiter parce qu'on a fait
    // trois pas dans la même pièce.
    const jeu = useGameStore.getState()
    const cible = roomId ?? NO_ROOM
    if (jeu.currentRoomId !== cible) jeu.setCurrentRoomId(cible)
  })
}

/**
 * Le suivi sous forme de composant, à poser dans le canvas.
 *
 * Un hook a besoin d'un hôte, et aucun composant existant n'a de raison de
 * porter cette responsabilité — le joueur ne bouge pas pendant une visite, la
 * scène ne connaît pas le plan. D'où ce composant vide, qui ne rend rien.
 */
export function VisitorTracker({ museum }: { museum: Museum }): null {
  useRoomTransition(museum)
  return null
}
