/**
 * LOT 3 — L'application du culling par étage (spec §9.3).
 *
 * `domain/culling.ts` DÉCIDE (quel niveau, quelle boîte, quelle portée) ; ce
 * fichier ne fait qu'appliquer, une fois par image, ce qu'il a décidé. Il ne
 * contient donc aucun seuil et aucune géométrie : uniquement du branchement.
 *
 * ── Un seul `useFrame` pour tout le bâtiment ──
 *
 * Chaque plateau pourrait tester sa propre boîte dans son propre `useFrame`.
 * Ce serait quatre extractions de frustum par image au lieu d'une, et surtout
 * quatre états d'hystérésis indépendants pour une seule question — « où est le
 * joueur ? » — dont la réponse doit être la MÊME pour tout le monde, sinon deux
 * plateaux voisins peuvent se croire à des distances différentes du visiteur au
 * même instant.
 *
 * Les plateaux s'inscrivent donc auprès d'un registre, et le registre les
 * parcourt. L'inscription porte des `ref` et non des objets : le nœud n'existe
 * pas encore au moment où React monte l'effet, et il change à chaque
 * rechargement à chaud.
 *
 * ── Ce qui est masqué, et ce qui ne l'est jamais ──
 *
 *   hors frustum (ombre comprise)  →  le plateau ENTIER se saute
 *   au-delà de 2 niveaux d'écart   →  le CONTENU seul (murs, œuvres, cartels)
 *
 * La visibilité three ne touche PAS la physique : les colliders de Rapier
 * vivent dans le monde physique, pas dans le graphe de scène. Masquer un étage
 * ne fait donc traverser ni sa dalle ni ses murs — ce qui serait, autrement, la
 * façon la plus rapide de transformer une optimisation en chute libre.
 */
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import type { Landing } from '../domain/culling'
import { contentVisible, trackLevel } from '../domain/culling'

// Objets de travail alloués UNE fois : le registre tourne à 60 Hz, et un
// `Frustum` par image suffirait à nourrir le ramasse-miettes jusqu'au hoquet.
const frustum = new THREE.Frustum()
const projection = new THREE.Matrix4()

export interface FloorCullingEntry {
  /** Numéro de niveau, pour la portée du contenu. */
  level: number
  /** Volume du plateau, ombre portée comprise, en coordonnées monde. */
  box: THREE.Box3
  /** Le plateau entier : dalle, garde-corps, toiture et contenu. */
  group: RefObject<THREE.Group | null>
  /** Ce qui disparaît au-delà de la portée : murs, œuvres, cartels. */
  content: RefObject<THREE.Group | null>
}

/** État d'un plateau à la dernière image, pour la sonde de développement. */
export interface FloorCullingReport {
  level: number
  inFrustum: boolean
  contentVisible: boolean
}

export interface FloorCullingSnapshot {
  active: boolean
  playerLevel: number | null
  floors: FloorCullingReport[]
}

export interface FloorCulling {
  /** Inscrit un plateau. Rend la fonction de désinscription. */
  register(entry: FloorCullingEntry): () => void
  /**
   * Coupe ou rétablit le culling. Sert à MESURER : sans ce commutateur, le
   * « avant » et l'« après » du budget §9 se compareraient entre deux sessions
   * du navigateur, donc entre deux états de cache et deux positions de caméra.
   */
  setActive(active: boolean): void
  snapshot(): FloorCullingSnapshot
}

/** Fourni par `MuseumScene`, consommé par chaque `FloorMesh`. */
export const FloorCullingContext = createContext<FloorCulling | null>(null)

/**
 * Installe le registre et la boucle qui l'applique.
 *
 * À appeler DANS le canvas — `useFrame` n'existe pas ailleurs — et une seule
 * fois, au niveau du bâtiment.
 */
export function useFloorCullingRegistry(paliers: readonly Landing[]): FloorCulling {
  const entrees = useRef<Set<FloorCullingEntry>>(new Set())
  const rapports = useRef<Map<FloorCullingEntry, FloorCullingReport>>(new Map())
  const niveau = useRef<number | null>(null)
  const actif = useRef(true)

  useFrame(({ camera }) => {
    // La caméra est déplacée par `Player` et par la visite guidée dans d'autres
    // `useFrame` : sa matrice monde n'est recalculée qu'au moment du rendu,
    // c'est-à-dire APRÈS nous. Sans cette remise à jour, le frustum testé est
    // celui de l'image précédente et un demi-tour rapide fait apparaître un
    // plateau avec une image de retard.
    camera.updateMatrixWorld()
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)

    const courant = trackLevel(paliers, camera.position.y, niveau.current)
    niveau.current = courant

    for (const entree of entrees.current) {
      const dansLeChamp = actif.current ? frustum.intersectsBox(entree.box) : true
      const contenu = actif.current
        ? dansLeChamp && contentVisible(courant, entree.level)
        : true

      const plateau = entree.group.current
      if (plateau !== null) plateau.visible = dansLeChamp
      const contenuNoeud = entree.content.current
      if (contenuNoeud !== null) contenuNoeud.visible = contenu

      rapports.current.set(entree, {
        level: entree.level,
        inFrustum: dansLeChamp,
        contentVisible: contenu,
      })
    }
  })

  // Identité stable : le contexte ne doit pas changer de valeur à chaque rendu,
  // sinon chaque `FloorMesh` se désinscrit et se réinscrit pour rien.
  return useMemo<FloorCulling>(
    () => ({
      register(entry) {
        entrees.current.add(entry)
        return () => {
          entrees.current.delete(entry)
          rapports.current.delete(entry)
        }
      },
      setActive(active) {
        // Le rétablissement se fait à la prochaine image, dans la boucle
        // ci-dessus : culling coupé, tout redevient visible. Le faire ici en
        // plus n'avancerait rien — `gl.info.render.calls` ne bouge qu'après un
        // rendu, une mesure doit de toute façon laisser passer une image.
        actif.current = active
      },
      snapshot() {
        return {
          active: actif.current,
          playerLevel: niveau.current,
          floors: [...rapports.current.values()].sort((a, b) => a.level - b.level),
        }
      },
    }),
    [],
  )
}

/**
 * Inscrit un plateau auprès du registre, s'il y en a un.
 *
 * L'absence de registre n'est pas une erreur : `FloorMesh` doit rester
 * montable seul, dans une sonde ou un test, sans traîner tout le bâtiment.
 * Sans registre, rien n'est masqué — ce qui est le comportement du lot 2.
 */
export function useRegisterFloor(entry: FloorCullingEntry): void {
  const culling = useContext(FloorCullingContext)
  const { level, box, group, content } = entry

  useEffect(() => {
    if (culling === null) return
    return culling.register({ level, box, group, content })
  }, [culling, level, box, group, content])
}
