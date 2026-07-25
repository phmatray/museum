import { create } from 'zustand'

import type { Museum } from '../domain/types'

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
  setPaused: (paused) => set({ paused }),
  setCurrentRoomId: (id) => set({ currentRoomId: id }),
  setTourActive: (active) => set({ tourActive: active }),
  setPointerLocked: (locked) => set({ pointerLocked: locked }),
  setMuseumOverride: (museumOverride) => set({ museumOverride }),
}))
