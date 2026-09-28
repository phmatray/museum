/**
 * Le bouton du son : éteint par défaut, basculé au clic comme à la touche M,
 * retenu dans localStorage. jsdom n'a pas d'`AudioContext` : aucun moteur ne
 * doit naître, et rien ne doit lever.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { BoutonSon } from '../BoutonSon'
import { moteurCourant } from '../../audio/etat'

describe('BoutonSon', () => {
  it('s’allume au clic, s’éteint à la touche M, et s’en souvient', () => {
    render(<BoutonSon />)
    const bouton = screen.getByRole('button', { name: 'Son' })
    expect(bouton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(bouton)
    expect(bouton.getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem('museum:son')).toBe('1')
    expect(moteurCourant()).toBeNull()

    fireEvent.keyDown(window, { code: 'KeyM' })
    expect(bouton.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('museum:son')).toBe('0')
  })
})
