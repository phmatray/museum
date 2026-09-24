import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIsMobile } from '../useIsMobile'

describe('useIsMobile', () => {
  it('returns false when matchMedia does not match', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true when matchMedia matches pointer:coarse', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })
})
