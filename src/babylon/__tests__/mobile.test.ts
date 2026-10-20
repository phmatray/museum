import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { partie, toucher } from '../etat'
import { inclinaison, monterMobile } from '../ui/mobile'

const INITIAL = partie.getState()
let ecouteur: ((e: { matches: boolean }) => void) | null = null

function media(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: (_: string, f: typeof ecouteur) => { ecouteur = f },
    removeEventListener: () => { ecouteur = null },
  }))
}

function doigt(type: string, cible: Element, id: number, x: number, y: number) {
  const e = new Event(type, { bubbles: true })
  Object.defineProperty(e, 'changedTouches', { value: [{ identifier: id, clientX: x, clientY: y }] })
  cible.dispatchEvent(e)
}

describe('commandes tactiles', () => {
  beforeEach(() => {
    partie.setState(INITIAL, true)
    document.body.replaceChildren()
    Object.assign(toucher, { forward: 0, strafe: 0, lookX: 0, lookY: 0 })
    window.innerWidth = 1000
  })
  afterEach(() => vi.unstubAllGlobals())

  const couche = () => document.body.firstElementChild as HTMLElement

  it('masquée sans pointeur grossier, puis suit la media query', () => {
    media(false)
    monterMobile()
    expect(couche().hidden).toBe(true)
    ecouteur!({ matches: true })
    expect(couche().hidden).toBe(false)
  })

  it('joystick à gauche : forward 1 en montant de 100 px, 0 au lâcher', () => {
    media(true)
    monterMobile()
    doigt('touchstart', couche(), 1, 200, 500)
    doigt('touchmove', couche(), 1, 200, 400)
    expect(toucher.forward).toBe(1)
    expect(toucher.strafe).toBeCloseTo(0)
    // La base a suivi le pouce (origine en 200, 450) : un pas à droite dans la zone morte ne bouge rien.
    doigt('touchmove', couche(), 1, 205, 450)
    expect(toucher.forward).toBe(0)
    expect(toucher.strafe).toBe(0)
    doigt('touchmove', couche(), 1, 250, 450)
    expect(toucher.strafe).toBe(1)
    doigt('touchend', couche(), 1, 225, 500)
    expect(toucher.forward).toBe(0)
    expect(toucher.strafe).toBe(0)
  })

  it('glissé à droite : deltas accumulés dans lookX/lookY', () => {
    media(true)
    monterMobile()
    doigt('touchstart', couche(), 2, 800, 300)
    doigt('touchmove', couche(), 2, 830, 290)
    doigt('touchmove', couche(), 2, 850, 290)
    expect(toucher.lookX).toBe(50)
    expect(toucher.lookY).toBe(-10)
    expect(toucher.forward).toBe(0)
  })

  it('démontage, bascule de la media query ou VR relâchent le joystick', () => {
    media(true)
    const demonter = monterMobile()
    doigt('touchstart', couche(), 1, 200, 500)
    doigt('touchmove', couche(), 1, 200, 400)
    ecouteur!({ matches: false })
    expect(toucher.forward).toBe(0)
    ecouteur!({ matches: true })
    doigt('touchstart', couche(), 1, 200, 500)
    doigt('touchmove', couche(), 1, 200, 400)
    demonter()
    expect(toucher.forward).toBe(0)
    expect(document.body.children.length).toBe(0)
  })

  it('inclinaison : zone morte, courbe douce, pleine à fond', () => {
    expect(inclinaison(0.1, 0)).toEqual({ strafe: 0, forward: 0 })
    const mi = inclinaison(0.5, 0).strafe
    expect(mi).toBeGreaterThan(0.2)
    expect(mi).toBeLessThan(0.5)
    expect(inclinaison(0, -1).forward).toBeCloseTo(1)
  })
})
