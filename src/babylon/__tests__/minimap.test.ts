import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { monterMinimap } from '../ui/minimap'
import { partie, reglages } from '../etat'
import { MUSEE } from '../../plan/musee'
import type { Accrochage } from '../../plan/hang'
import type { Walker } from '../../plan/walk'

// r-o1, rez-de-chaussée : le visiteur au centre de la salle, regard au nord.
const ROOM = MUSEE.levels[0].rooms.find((r) => r.id === 'r-o1')!
const VISITEUR: Walker = { level: 0, surface: `0:${ROOM.id}`, x: ROOM.x + ROOM.width / 2, z: ROOM.z + ROOM.depth / 2, y: 0, yaw: 0 }
const ACCROCHAGE: Accrochage = { generatedAt: '2026-07-25T22:06:37.149Z', rooms: [{ id: ROOM.id, level: 0, name: 'Typescript / Tauri', placements: [] }] }
const INITIAL = partie.getState()

let racine: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  partie.setState({ ...INITIAL, visiteur: VISITEUR }, true)
  reglages.setState({ plan: true })
  racine = document.body.appendChild(document.createElement('div'))
})
afterEach(() => {
  racine.remove()
  vi.useRealTimers()
})

const texte = (e: Element) => e.textContent ?? ''
const etiquette = (l: string) => racine.querySelector<HTMLElement>(`[aria-label="${l}"]`)!
const encart = () => racine.querySelector<HTMLElement>('[title="Agrandir le plan"]')!

describe('minimap', () => {
  it("affiche le thème de l'accrochage, pas le nom de travail de la salle", () => {
    monterMinimap(racine, ACCROCHAGE, () => null)
    expect(texte(encart().querySelector('figcaption')!)).toBe('Typescript / Tauri')
    expect(texte(racine)).not.toContain(ROOM.name)
    expect(encart().querySelector('[role=img]')!.getAttribute('aria-label')).toBe('Vous êtes ici : Typescript / Tauri')
  })

  it("retombe sur le nom de travail sans accrochage", () => {
    monterMinimap(racine, null, () => null)
    expect(texte(encart().querySelector('figcaption')!)).toBe(ROOM.name)
  })

  it('ouvre le plan en plein écran au clic, et le referme', () => {
    monterMinimap(racine, ACCROCHAGE, () => null)
    expect(racine.querySelector('dialog')!.open).toBe(false)
    encart().click()
    const d = racine.querySelector('dialog')!
    expect(d.open).toBe(true)
    expect(d.getAttribute('aria-label')).toBe('Plan du musée : Typescript / Tauri')
    etiquette('Agrandir').click()
    expect(d.querySelector<HTMLElement>('.minimap-contenu')!.style.transform).toContain('scale(1.5)')
    etiquette('Fermer le plan').click()
    expect(racine.querySelector('dialog')!.open).toBe(false)
    // Le cadrage revient au repos à la fermeture.
    expect(d.querySelector<HTMLElement>('.minimap-contenu')!.style.transform).toContain('scale(1)')
  })

  it('dessine le cône vers le nord et Bavette seulement si elle est montée et à cet étage', () => {
    let chat: { x: number; z: number; level: number } | null = null
    monterMinimap(racine, null, () => chat)
    const calque = () => encart().querySelector('svg')!
    const chatVu = () => calque().querySelector('title')!.parentElement!.getAttribute('display') !== 'none'
    expect(chatVu()).toBe(false)
    const [, pointe] = calque().querySelector('polygon')!.getAttribute('points')!.split(' ')
    expect(Number(pointe.split(',')[1])).toBeLessThan(VISITEUR.z * 14)
    chat = { x: 2, z: 3, level: 0 }
    vi.advanceTimersByTime(100)
    expect(calque().querySelector('title')!.textContent).toBe('Bavette')
    expect(chatVu()).toBe(true)
    chat = { x: 2, z: 3, level: 1 }
    vi.advanceTimersByTime(100)
    expect(chatVu()).toBe(false)
  })

  it('masquée si le réglage « plan » est éteint ou sans visiteur', () => {
    monterMinimap(racine, null, () => null)
    expect(encart().hidden).toBe(false)
    reglages.setState({ plan: false })
    expect(encart().hidden).toBe(true)
    reglages.setState({ plan: true })
    partie.setState({ visiteur: null })
    expect(encart().hidden).toBe(true)
  })
})
