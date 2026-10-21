import { beforeAll, describe, expect, it, vi } from 'vitest'

import { partie, vivant } from '../etat'
import { carnet, monterSucces, signaler } from '../succes'
import { monterCarnet } from '../ui/carnet'

describe('carnet de tampons', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    // jsdom : <dialog> sans showModal selon les versions.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
    // Plein jour, temps sec : seul le compostage frappe (sinon « Noctambule » le suivrait, selon l'heure du test).
    const v = vivant.getState()
    vivant.setState({ ciel: { ...v.ciel, jour: 1 }, meteo: { ...v.meteo, pluie: 0, neige: 0 } })
    monterSucces(null, 0)
    document.body.append(monterCarnet(document.body, document.createElement('canvas')))
  })

  it('rien n’est noté avant le compostage', () => {
    signaler('etoile')
    expect(carnet.getState().carnet.gestes).toEqual([])
  })

  it('composter frappe le premier tampon et l’annonce', () => {
    partie.setState({ paused: false })
    expect(carnet.getState().carnet.tampons.composte).toBeTruthy()
    const annonce = document.querySelector<HTMLElement>('.tampon-annonce')!
    expect(annonce.hidden).toBe(false)
    expect(annonce.textContent).toContain('Billet composté')
    vi.advanceTimersByTime(4200)
    expect(annonce.hidden).toBe(true)
  })

  it('le bouton ouvre le carnet : tampon obtenu, indices des manquants, avancée chiffrée', () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Carnet de visite"]')!.click()
    const d = document.querySelector('dialog.carnet') as HTMLDialogElement
    expect(d.open).toBe(true)
    expect(d.querySelector('.carnet-compte')!.textContent).toMatch(/^1 \/ \d+ tampons$/)
    expect(d.querySelectorAll('.case.obtenue')).toHaveLength(1)
    expect(d.textContent).toContain('Le grand escalier mène quelque part.')
    expect(d.textContent).toContain('0 / 5')
    d.querySelector<HTMLButtonElement>('.carnet-fermer')!.click()
    expect(d.open).toBe(false)
  })
})
