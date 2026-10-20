import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { chargement } from '../chargement'
import { partie } from '../etat'
import { monterEcranChargement } from '../ui/ecranChargement'

const ecran = () => document.querySelector<HTMLElement>('[data-museum-overlay="chargement"]')
const INITIAL = partie.getState()

describe('écran de chargement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    chargement.setState({ faits: 0, total: 0, etape: 'chargement' })
    partie.setState(INITIAL, true)
    delete (window as { __PRET__?: boolean }).__PRET__
    monterEcranChargement(document.body)
  })
  afterEach(() => vi.useRealTimers())

  it('une barre de progression nommée, le compteur et l’étape', () => {
    const barre = document.querySelector('[role="progressbar"]')!
    expect(barre.getAttribute('aria-label')).toBe('Chargement du musée')
    expect(barre.getAttribute('aria-valuemin')).toBe('0')
    expect(barre.getAttribute('aria-valuemax')).toBe('100')
    expect(ecran()!.getAttribute('aria-busy')).toBe('true')
    expect(ecran()!.textContent).toContain('Le musée s’installe')
    expect(document.querySelector('.compteur')!.textContent).toBe('…')
    chargement.setState({ faits: 3, total: 5 })
    expect(document.querySelector('.compteur')!.textContent).toBe('3 / 5')
    chargement.setState({ etape: 'finition' })
    expect(ecran()!.textContent).toContain('Dernières retouches')
    vi.advanceTimersByTime(1000)
    expect(Number(barre.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  })

  it('bloqué 20 s : on ouvre quand même, en le disant', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    chargement.setState({ faits: 1, total: 2 })
    vi.advanceTimersByTime(19999)
    expect(chargement.getState().etape).toBe('chargement')
    vi.advanceTimersByTime(1)
    expect(warn).toHaveBeenCalledWith('museum: chargement bloqué à 1/2 depuis 20 s, on ouvre quand même')
    expect((window as { __PRET__?: boolean }).__PRET__).toBe(true)
    warn.mockRestore()
  })

  it('prêt : aria-busy faux, puis retiré après le fondu', () => {
    chargement.setState({ total: 4, faits: 4, etape: 'pret' })
    expect(ecran()!.getAttribute('aria-busy')).toBe('false')
    expect(localStorage.getItem('musee:total-chargement-babylon')).toBe('4')
    vi.advanceTimersByTime(699)
    expect(ecran()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(ecran()).toBeNull()
  })

  it('escamoté par le pointeur verrouillé ou la reprise de la visite', () => {
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: document.body })
    document.dispatchEvent(new Event('pointerlockchange'))
    expect(ecran()!.hidden).toBe(true)
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
    document.dispatchEvent(new Event('pointerlockchange'))
    expect(ecran()!.hidden).toBe(false)
    partie.setState({ paused: false })
    expect(ecran()!.hidden).toBe(true)
  })
})
