import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../io/visite.ts', () => ({ laVisite: () => Promise.resolve(159) }))

import { partie } from '../etat'
import { monterAccueil } from '../ui/accueil'

const INITIAL = partie.getState()
let fin: () => void
let toile: HTMLCanvasElement
const lock = vi.fn(() => Promise.resolve())
const monter = () => {
  toile = document.createElement('canvas')
  toile.requestPointerLock = lock as unknown as HTMLCanvasElement['requestPointerLock']
  document.body.append(toile)
  fin = monterAccueil(document.body, toile, { accrochage: () => null, base: '/' })
}
const voile = () => document.querySelector<HTMLElement>('[data-museum-overlay="accueil"]')!
const bouton = (t: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith(t))!
const touche = (key: string, cible: EventTarget = window) => cible.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

beforeEach(() => {
  partie.setState(INITIAL, true)
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('hors ligne'))))
  vi.useFakeTimers()
  lock.mockClear()
})
afterEach(() => {
  fin()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('accueil', () => {
  it('affiche le billet et focalise « Composter et entrer »', async () => {
    monter()
    expect(voile().hidden).toBe(false)
    expect(document.querySelector('article.billet')!.getAttribute('aria-labelledby')).toBe('billet-titre')
    expect(document.activeElement).toBe(bouton('Composter'))
    expect(document.querySelector('.numero')!.textContent).toBe('––––––')
    await vi.waitFor(() => expect(document.querySelector('.numero')!.textContent).toBe('000159'))
    expect([...document.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Date', 'Heure'])
  })

  it('« Composter et entrer » verrouille le pointeur puis lève la pause après le tampon', () => {
    monter()
    bouton('Composter').click()
    expect(lock).toHaveBeenCalledOnce()
    expect(voile().hasAttribute('data-sortie')).toBe(true)
    expect(document.querySelector('.billet-tampon')!.textContent).toMatch(/^Composté/)
    bouton('Composter').click() // ignoré : sortie en cours
    vi.advanceTimersByTime(1003)
    expect(partie.getState().paused).toBe(true)
    vi.advanceTimersByTime(1)
    expect(partie.getState()).toMatchObject({ paused: false, tourActive: false })
    expect(voile().hidden).toBe(true)
    expect(voile().hasAttribute('data-sortie')).toBe(false)
    expect(lock).toHaveBeenCalledOnce()
  })

  it('après l’entrée, la pause rouvre le billet composté : « Reprendre la visite », sans nouveau tampon', () => {
    monter()
    bouton('Composter').click()
    vi.advanceTimersByTime(1004)
    partie.setState({ paused: true })
    expect(voile().hidden).toBe(false)
    expect(document.querySelector('article.billet')!.hasAttribute('data-pause')).toBe(true)
    expect(document.activeElement).toBe(bouton('Reprendre la visite'))
    expect(document.querySelector('.billet-accroche')!.textContent).toMatch(/pause/)
    bouton('Reprendre la visite').click()
    expect(document.querySelector('article.billet')!.hasAttribute('data-composte')).toBe(false)
    vi.advanceTimersByTime(260)
    expect(partie.getState().paused).toBe(false)
  })

  it('« Visite guidée » lance la visite sans verrou, Échap la quitte et ramène le billet de la pause focalisé', () => {
    monter()
    bouton('Visite guidée').click()
    expect(document.querySelector('.billet-tampon')!.textContent).toMatch(/^Visite guidée/)
    vi.advanceTimersByTime(1004)
    expect(lock).not.toHaveBeenCalled()
    expect(partie.getState()).toMatchObject({ paused: false, tourActive: true })
    expect(bouton('Quitter la visite').hidden).toBe(false)
    touche('Escape')
    expect(partie.getState()).toMatchObject({ paused: true, tourActive: false })
    expect(bouton('Quitter la visite').hidden).toBe(true)
    expect(document.activeElement).toBe(bouton('Reprendre la visite'))
  })

  it('le bouton « Quitter la visite » remet en pause', () => {
    monter()
    partie.setState({ paused: false, tourActive: true })
    bouton('Quitter la visite').click()
    expect(partie.getState()).toMatchObject({ paused: true, tourActive: false })
  })

  it('Entrée entre, sauf sur un bouton (son clic natif suffit) et hors pause', () => {
    monter()
    touche('Enter', bouton('Visite guidée'))
    expect(voile().hasAttribute('data-sortie')).toBe(false)
    touche('Enter')
    expect(lock).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1004)
    touche('Enter')
    expect(lock).toHaveBeenCalledOnce()
  })

  it('Destination ou message d’absence selon le rendez-vous', () => {
    monter()
    partie.setState({ rendezVous: { demande: 'museum', cle: 'phmatray/museum' } })
    expect(document.querySelector('dd.destination')!.textContent).toBe('museum')
    expect(document.querySelector<HTMLElement>('.billet-absent')!.hidden).toBe(true)
    partie.setState({ rendezVous: { demande: 'inconnu', cle: null } })
    expect(document.querySelector('dd.destination')).toBeNull()
    const absent = document.querySelector<HTMLElement>('.billet-absent')!
    expect(absent.hidden).toBe(false)
    expect(absent.textContent).toBe('« inconnu » n’est pas exposé ici : la visite commence à l’entrée.')
  })

  it('compte la collection quand l’accrochage arrive', () => {
    let acc: unknown = null
    toile = document.createElement('canvas')
    fin = monterAccueil(document.body, toile, { accrochage: () => acc as never, base: '/' })
    acc = { rooms: [{ placements: [1, 2] }, { placements: [] }] }
    partie.setState({ rendezVous: null })
    expect(document.querySelector('dl')!.textContent).toContain('2 œuvres · 1 salle, un jardin, un chat')
  })

  describe('bouton VR', () => {
    const vr = (o: Parameters<typeof monterAccueil>[2]['vr']) => {
      toile = document.createElement('canvas')
      fin = monterAccueil(document.body, toile, { accrochage: () => null, base: '/', vr: o })
    }
    const bVR = () => document.querySelectorAll<HTMLButtonElement>('.billet-actions button')[2]
    const consignesVR = () => document.querySelectorAll<HTMLElement>('.billet-consignes')[0]

    it('absent sans porte ou avec une porte nulle', async () => {
      vr(undefined)
      expect(bVR().hidden).toBe(true)
      fin()
      document.body.replaceChildren()
      vr(Promise.resolve(null))
      await Promise.resolve()
      await Promise.resolve()
      expect(bVR().hidden).toBe(true)
      expect(consignesVR().hidden).toBe(true)
    })

    it('Cardboard : libellé, consignes de three, le clic ouvre la session sans attendre', async () => {
      const entrer = vi.fn(() => Promise.resolve())
      vr(Promise.resolve({ mode: 'cardboard', entrer }))
      await vi.waitFor(() => expect(bVR().hidden).toBe(false))
      expect(bVR().textContent).toBe('Avec un Cardboard')
      expect(consignesVR().hidden).toBe(false)
      expect(consignesVR().textContent).toBe('Dans le Cardboard : un tapotement pour marcher droit devant le regard, un autre pour s’arrêter.')
      bVR().click()
      expect(entrer).toHaveBeenCalledOnce()
    })

    it('casque : « En VR » et ses consignes ; un refus est seulement signalé', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vr(Promise.resolve({ mode: 'natif', entrer: () => Promise.reject(new Error('non')) }))
      await vi.waitFor(() => expect(bVR().textContent).toBe('En VR'))
      expect(consignesVR().textContent).toBe('Au casque : stick gauche pour marcher (enfoncé pour presser le pas), stick droit pour tourner.')
      bVR().click()
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('VR refusée', expect.any(Error)))
      warn.mockRestore()
    })
  })
})
