/**
 * Le bouton du son (BoutonSon.test.tsx sans React) : éteint par défaut, basculé
 * au clic comme à la touche M, retenu dans localStorage. jsdom n'a pas
 * d'`AudioContext` : aucun moteur ne doit naître, et rien ne doit lever.
 */
import { describe, expect, it, vi } from 'vitest'

import { partie } from '../etat'
import { eveillerSon, froisser, monterBoutonSon, sonVolets } from '../son'

// Un moteur de papier : seul compte ce que devient son contexte.
vi.mock('../../audio/moteur.ts', () => ({ Moteur: class { ctx: unknown; constructor(ctx: unknown) { this.ctx = ctx } volume() {} } }))

const touche = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', init))

describe('bouton du son', () => {
  it('s’allume au clic, s’éteint à la touche M, et s’en souvient', () => {
    const bouton = monterBoutonSon()
    document.body.replaceChildren(bouton)
    expect(bouton.getAttribute('aria-label')).toBe('Son')
    expect(bouton.getAttribute('aria-pressed')).toBe('false')
    expect(bouton.title).toBe('Activer le son (M)')

    bouton.click()
    expect(bouton.getAttribute('aria-pressed')).toBe('true')
    expect(bouton.title).toBe('Couper le son (M)')
    expect(bouton.querySelectorAll('path[stroke="#e0b060"]')).toHaveLength(2)
    expect(localStorage.getItem('museum:son')).toBe('1')
    expect(eveillerSon()).toBeNull()

    // Ni répétition ni raccourci : M seul.
    touche({ code: 'KeyM', repeat: true })
    touche({ code: 'KeyM', ctrlKey: true })
    expect(bouton.getAttribute('aria-pressed')).toBe('true')

    touche({ code: 'KeyM' })
    expect(bouton.getAttribute('aria-pressed')).toBe('false')
    expect(localStorage.getItem('museum:son')).toBe('0')
    expect(bouton.querySelectorAll('path')).toHaveLength(2)

    // Sans moteur, les bruits de la scène ne font rien.
    expect(() => { sonVolets(1200); froisser(10, 10, 1, 0) }).not.toThrow()
  })
})

describe('son en pause', () => {
  it('allumé sous le billet, il reste muet jusqu’à l’entrée dans la visite', async () => {
    const etats: string[] = []
    vi.stubGlobal('AudioContext', class {
      state = 'suspended'
      resume = async () => { etats.push((this.state = 'running')) }
      suspend = async () => { etats.push((this.state = 'suspended')) }
    })
    partie.setState({ paused: true })
    const bouton = monterBoutonSon()
    if (bouton.getAttribute('aria-pressed') === 'true') bouton.click()
    bouton.click()
    const m = eveillerSon()!
    expect(m.ctx.state).toBe('suspended')
    expect(etats).not.toContain('running')
    partie.setState({ paused: false })
    expect(eveillerSon()!.ctx.state).toBe('running')
    vi.unstubAllGlobals()
  })
})
