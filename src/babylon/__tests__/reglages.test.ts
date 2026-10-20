/**
 * Le carton des réglages natif : il s'ouvre à la roue comme à R, se referme à
 * Échap sans que la visite l'entende, et retient ce qu'on y change.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/dom'

import { DEFAUTS } from '../../domain/reglages'
import { partie, reglages } from '../etat'
import { monterReglages } from '../ui/reglages'

const INITIAL = partie.getState()

describe('monterReglages', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    partie.setState(INITIAL, true)
    reglages.setState(DEFAUTS)
  })

  const monter = () => {
    const son = { actif: true, abonnes: [] as (() => void)[] }
    const basculer = vi.fn(() => {
      son.actif = !son.actif
      son.abonnes.forEach((f) => f())
    })
    monterReglages(document.body, {
      toile: document.createElement('canvas'),
      son: { bouton: document.createElement('button'), actif: () => son.actif, basculer, abonner: (f) => (son.abonnes.push(f), () => {}) },
    })
    return basculer
  }

  it('s’ouvre, règle, se souvient et se referme à Échap', () => {
    monter()
    const roue = screen.getByRole('button', { name: 'Réglages' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(roue)
    expect(screen.getByRole('dialog', { name: 'Réglages' })).toBeTruthy()
    expect(roue.getAttribute('aria-expanded')).toBe('true')
    // Le premier champ prend le focus : l'interrupteur du son.
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: /Son de l’ambiance/ }))

    fireEvent.click(screen.getByRole('switch', { name: 'Afficher le plan' }))
    expect(reglages.getState().plan).toBe(false)
    expect(JSON.parse(localStorage.getItem('museum:reglages') ?? '{}').plan).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: 'Choisie' }))
    expect(reglages.getState().heure).not.toBeNull()
    expect(screen.getByRole('slider', { name: 'À l’heure de' })).toBeTruthy()

    const ailleurs = vi.fn()
    window.addEventListener('keydown', ailleurs)
    fireEvent.keyDown(screen.getByRole('switch', { name: 'Afficher le plan' }), { key: 'Escape' })
    window.removeEventListener('keydown', ailleurs)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ailleurs).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(roue)

    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }))
    expect(reglages.getState()).toMatchObject({ plan: true, heure: null })
    expect(screen.queryByRole('slider', { name: 'À l’heure de' })).toBeNull()
  })

  it('glissières, son et visite guidée', () => {
    const basculer = monter()
    fireEvent.click(screen.getByRole('button', { name: 'Réglages' }))
    const champ = screen.getByRole('slider', { name: 'Champ de vision' })
    fireEvent.input(champ, { target: { value: '82' } })
    expect(reglages.getState().champ).toBe(82)
    expect(champ.getAttribute('aria-valuetext')).toBe('82°')

    const son = screen.getByRole('switch', { name: /Son de l’ambiance/ }) as HTMLInputElement
    expect(son.checked).toBe(true)
    fireEvent.click(son)
    expect(basculer).toHaveBeenCalledOnce()
    expect(son.checked).toBe(false)

    fireEvent.change(screen.getByRole('combobox', { name: 'Temps' }), { target: { value: 'neige' } })
    expect(reglages.getState().meteo).toBe('neige')

    const groupe = document.querySelector<HTMLElement>('.reglages-groupe')!
    expect(groupe.style.top).toBe('1rem')
    partie.setState({ tourActive: true })
    expect(groupe.style.top).toBe('4rem')
  })

  it('refermé d’un clic après la marche, reprend la souris et la visite', () => {
    const toile = document.createElement('canvas')
    const lock = vi.fn()
    toile.requestPointerLock = lock as never
    monterReglages(document.body, { toile, son: { bouton: document.createElement('button'), actif: () => false, basculer() {}, abonner: () => () => {} } })
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => toile })
    document.exitPointerLock = vi.fn()
    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(document.exitPointerLock).toHaveBeenCalled()
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null })
    fireEvent.click(screen.getByRole('button', { name: 'Fermer les réglages' }))
    expect(lock).toHaveBeenCalled()
    expect(partie.getState().paused).toBe(false)
  })
})
