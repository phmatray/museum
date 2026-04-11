import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePointerLock } from '../usePointerLock'

describe('usePointerLock', () => {
  beforeEach(() => {
    document.exitPointerLock = vi.fn()
    Object.defineProperty(document, 'pointerLockElement', {
      writable: true,
      value: null,
    })
  })

  it('returns isLocked false initially', () => {
    const { result } = renderHook(() => usePointerLock())
    expect(result.current.isLocked).toBe(false)
  })

  it('calls requestPointerLock on lock()', () => {
    const mockRequestPointerLock = vi.fn()
    const { result } = renderHook(() => usePointerLock())

    const canvas = document.createElement('canvas')
    canvas.requestPointerLock = mockRequestPointerLock

    act(() => {
      result.current.lock(canvas)
    })

    expect(mockRequestPointerLock).toHaveBeenCalled()
  })

  it('calls exitPointerLock on unlock()', () => {
    const { result } = renderHook(() => usePointerLock())

    act(() => {
      result.current.unlock()
    })

    expect(document.exitPointerLock).toHaveBeenCalled()
  })
})
