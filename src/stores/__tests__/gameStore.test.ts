import { describe, it, expect } from 'vitest'
import { useGameStore } from '../gameStore'

describe('gameStore', () => {
  it('initializes with correct defaults', () => {
    const state = useGameStore.getState()
    expect(state.paused).toBe(false)
    expect(state.currentRoomId).toBe('room-1')
    expect(state.tourActive).toBe(false)
    expect(state.pointerLocked).toBe(false)
  })

  it('toggles pause state', () => {
    const { setPaused } = useGameStore.getState()
    setPaused(true)
    expect(useGameStore.getState().paused).toBe(true)
    setPaused(false)
    expect(useGameStore.getState().paused).toBe(false)
  })

  it('sets current room', () => {
    const { setCurrentRoomId } = useGameStore.getState()
    setCurrentRoomId('room-2')
    expect(useGameStore.getState().currentRoomId).toBe('room-2')
  })

  it('toggles tour mode', () => {
    const { setTourActive } = useGameStore.getState()
    setTourActive(true)
    expect(useGameStore.getState().tourActive).toBe(true)
  })
})
