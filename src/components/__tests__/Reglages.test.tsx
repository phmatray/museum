/**
 * Le carton des réglages : il s'ouvre à la roue comme à R, se referme à
 * Échap sans que la visite l'entende, et retient ce qu'on y change.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { BoutonReglages } from '../Reglages'
import { useGameStore } from '../../stores/gameStore'
import { useReglages } from '../../stores/reglagesStore'

describe('BoutonReglages', () => {
  it('s’ouvre, règle, se souvient et se referme à Échap', () => {
    render(<BoutonReglages haut="1rem" />)
    const roue = screen.getByRole('button', { name: 'Réglages' })
    fireEvent.click(roue)
    expect(screen.getByRole('dialog', { name: 'Réglages' })).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Afficher le plan' }))
    expect(useReglages.getState().plan).toBe(false)
    expect(JSON.parse(localStorage.getItem('museum:reglages') ?? '{}').plan).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: 'Choisie' }))
    const heure = useReglages.getState().heure
    expect(heure).not.toBeNull()
    expect(useGameStore.getState().ciel).toBeTruthy()

    const ailleurs = vi.fn()
    window.addEventListener('keydown', ailleurs)
    fireEvent.keyDown(screen.getByRole('switch', { name: 'Afficher le plan' }), { key: 'Escape' })
    window.removeEventListener('keydown', ailleurs)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ailleurs).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { code: 'KeyR' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }))
    expect(useReglages.getState()).toMatchObject({ plan: true, heure: null })
  })
})
