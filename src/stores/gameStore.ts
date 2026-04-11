import { create } from 'zustand'

interface GameState {
  paused: boolean
  currentRoomId: string
  tourActive: boolean
  pointerLocked: boolean
  setPaused: (paused: boolean) => void
  setCurrentRoomId: (id: string) => void
  setTourActive: (active: boolean) => void
  setPointerLocked: (locked: boolean) => void
}

export const useGameStore = create<GameState>((set) => ({
  paused: false,
  currentRoomId: 'room-1',
  tourActive: false,
  pointerLocked: false,
  setPaused: (paused) => set({ paused }),
  setCurrentRoomId: (id) => set({ currentRoomId: id }),
  setTourActive: (active) => set({ tourActive: active }),
  setPointerLocked: (locked) => set({ pointerLocked: locked }),
}))
