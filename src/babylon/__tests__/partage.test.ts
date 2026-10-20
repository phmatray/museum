// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { partager } from '../ui/partage.ts'

const boite = () => document.querySelector<HTMLElement>('[role=status][data-partage]')
const media = (coarse: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }))

describe('partage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    media(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('copie le lien et dit « ✓ Lien copié » deux secondes et demie', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    partager('phmatray/museum', 'museum', ['phmatray/museum', 'phmatray/autre'])
    await vi.advanceTimersByTimeAsync(0)
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\?p=museum$/))
    expect(boite()!.hidden).toBe(false)
    expect(boite()!.textContent).toContain('✓ Lien copié')
    expect(boite()!.textContent).toContain('?p=museum')
    await vi.advanceTimersByTimeAsync(2499)
    expect(boite()!.hidden).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(boite()!.hidden).toBe(true)
  })

  it('sans presse-papiers : « Copiez ce lien », huit secondes, un seul nœud réutilisé', async () => {
    partager('a/x', 'x', ['a/x', 'b/x'])
    await vi.advanceTimersByTimeAsync(0)
    expect(boite()!.textContent).toContain('Copiez ce lien')
    expect(boite()!.textContent).toContain('?p=a/x')
    await vi.advanceTimersByTimeAsync(7999)
    expect(boite()!.hidden).toBe(false)
    partager('a/x', 'x', ['a/x'])
    await vi.advanceTimersByTimeAsync(7999)
    expect(boite()!.hidden).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(boite()!.hidden).toBe(true)
    expect(document.querySelectorAll('[data-partage]')).toHaveLength(1)
  })

  it('au doigt, la feuille de partage du téléphone, sans message', async () => {
    media(true)
    const share = vi.fn<(d: ShareData) => Promise<void>>(() => Promise.reject(new Error('refermée')))
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const avant = boite()?.hidden ?? true
    partager('a/x', 'x', ['a/x'])
    await vi.advanceTimersByTimeAsync(0)
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Venez voir x dans mon musée', url: expect.stringMatching(/\?p=x$/) }))
    expect(share.mock.calls[0]![0].title).toMatch(/^x · /)
    expect(boite()?.hidden ?? true).toBe(avant)
  })
})
