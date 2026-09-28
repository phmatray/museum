import { create } from 'zustand'

import config from '../../museum.config.json'
import { cielA, heureDemandee, type Ciel } from '../domain/soleil'
import type { Museum } from '../domain/types'
import type { Walker } from '../plan/walk'

interface GameState {
  paused: boolean
  currentRoomId: string
  tourActive: boolean
  pointerLocked: boolean
  /**
   * Le musée régénéré par l'éditeur, ou `null` pour celui du disque.
   *
   * Il vit ICI et non dans le magasin de l'éditeur, et ce n'est pas un détail
   * de rangement : `App` doit pouvoir le lire, or `App` est du code de
   * production. Le lire depuis `editor/` obligerait la production à importer
   * l'éditeur — donc `derive()`, les schémas zod et tout le panneau — pour un
   * champ qui y vaut éternellement `null`. Le magasin de jeu est déjà dans le
   * bundle ; y poser une référence ne coûte rien.
   */
  museumOverride: Museum | null
  /** Le visiteur du plan, publié par `PlanPlayer` quand il bouge : la minimap le lit. */
  visiteur: Walker | null
  /** L'arrêt de la visite guidée en cours, dans `buildTourItinerary`. */
  tourEtape: number
  /** La toile que le visiteur regarde (clé du dépôt), publiée par `EveilLayer`. */
  toile: string | null
  /** Le soleil du musée maintenant (ou à l'heure de `?heure=`), tenu à jour par `CycleSolaire`. */
  ciel: Ciel
  setPaused: (paused: boolean) => void
  setCurrentRoomId: (id: string) => void
  setTourActive: (active: boolean) => void
  setPointerLocked: (locked: boolean) => void
  setMuseumOverride: (museum: Museum | null) => void
}

export const useGameStore = create<GameState>((set) => ({
  paused: true,
  currentRoomId: 'room-1',
  tourActive: false,
  pointerLocked: false,
  museumOverride: null,
  visiteur: null,
  tourEtape: 0,
  toile: null,
  ciel: cielDuMoment(),
  setPaused: (paused) => set({ paused }),
  setCurrentRoomId: (id) => set({ currentRoomId: id }),
  setTourActive: (active) => set({ tourActive: active }),
  setPointerLocked: (locked) => set({ pointerLocked: locked }),
  setMuseumOverride: (museumOverride) => set({ museumOverride }),
}))

/**
 * L'entrée tactile du visiteur (#31), écrite par `MobileControlsOverlay` et lue
 * par `PlanPlayer` à chaque image. Un objet mutable plutôt qu'un état zustand :
 * un glissé de doigt émet un événement par image, et le passer par `set`
 * re-rendrait les abonnés à chaque pixel pour une valeur que seul `useFrame` lit.
 *
 * `forward`/`strafe` dans [−1, 1], comme le clavier ; `lookX`/`lookY` sont des
 * pixels de glissé accumulés, que `PlanPlayer` consomme et remet à zéro.
 */
export const toucher = { forward: 0, strafe: 0, lookX: 0, lookY: 0 }

/** Le ciel à l'instant, ou à l'heure demandée par `?heure=HH:MM`, au lieu du musée. */
export function cielDuMoment(): Ciel {
  const maintenant = new Date()
  const quand = (typeof location === 'undefined' ? null : heureDemandee(location.search, maintenant)) ?? maintenant
  return cielA(quand, config.location.latitude, config.location.longitude)
}
