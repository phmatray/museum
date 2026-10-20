import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import chantier from '../../../public/data/chantier.json'
import type { Journal } from '../../domain/journal'
import { partie } from '../etat'
import { monterCarteEtape } from '../ui/carteEtape'

const INITIAL = partie.getState()
const journal = chantier as Journal
const carte = () => document.querySelector('aside')
const touche = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }))

let demonter = () => {}

describe('carte d’étape du journal', () => {
  beforeEach(async () => {
    partie.setState({ ...INITIAL, paused: false }, true)
    document.body.replaceChildren()
    demonter = monterCarteEtape(document.body, Promise.resolve(journal))
    await Promise.resolve()
  })
  afterEach(() => {
    demonter()
    vi.restoreAllMocks()
  })

  it('raconte l’étape regardée, sa PR une seule fois', () => {
    expect(carte()).toBeNull()
    partie.setState({ etape: 't-94' })
    const a = carte()!
    expect(a.textContent).toContain('Étape 94')
    expect(a.textContent).toContain('La vieille souche et les galets de rivière')
    expect(a.textContent).toContain('Jardin & dehors')
    expect(a.textContent!.match(/PR #185/g)).toHaveLength(1)
    expect(a.querySelector('a[href="https://github.com/phmatray/museum/pull/185"]')).not.toBeNull()
    expect(a.querySelector('img')!.getAttribute('src')).toMatch(/journal\/img\/94-souche\.jpg$/)
  })

  it('« Hors série » pour une étape sans numéro', () => {
    partie.setState({ etape: 't-idees' })
    expect(carte()!.textContent).toContain('Hors série')
    expect(carte()!.querySelector('img')).toBeNull()
  })

  it('Entrée ou J ouvre le journal à l’ancre, rien en pause', () => {
    const ouvrir = vi.spyOn(window, 'open').mockReturnValue(null)
    partie.setState({ etape: 't-94' })
    touche('Enter')
    touche('KeyJ')
    expect(ouvrir).toHaveBeenCalledTimes(2)
    expect(ouvrir.mock.calls[0][0]).toMatch(/journal\/#t-94$/)
    partie.setState({ paused: true })
    expect(carte()).toBeNull()
    touche('Enter')
    expect(ouvrir).toHaveBeenCalledTimes(2)
    partie.setState({ paused: false, etape: null })
    expect(carte()).toBeNull()
  })

  it('attend le journal avant de montrer la carte', async () => {
    demonter()
    let livrer!: (j: Journal) => void
    demonter = monterCarteEtape(document.body, new Promise((r) => (livrer = r)))
    partie.setState({ etape: 't-3' })
    expect(carte()).toBeNull()
    livrer(journal)
    await Promise.resolve()
    expect(carte()!.textContent).toContain('Étape 3')
  })
})
