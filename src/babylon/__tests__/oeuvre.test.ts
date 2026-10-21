import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { partie } from '../etat'

const partager = vi.fn()
vi.mock('../ui/partage.ts', () => ({ partager: (...a: unknown[]) => partager(...a) }))

const oeuvre = (key: string, site: string | null) => ({
  key, owner: key.split('/')[0], name: key.split('/')[1], url: `https://github.com/${key}`, site,
  description: `Le projet ${key}`, languages: { TypeScript: 3, CSS: 1 }, forks: 1234, stars: 5678, pushedAt: new Date().toISOString(),
})
const CATALOGUE = { owners: ['moi'], artworks: [oeuvre('moi/toile', null), oeuvre('moi/borne', 'https://borne.example')] }
const README = '# borne\n\nUn paragraphe.\n\n## Usage\n\n- [x] fait\n'

const INITIAL = partie.getState()
const attendre = () => new Promise((r) => setTimeout(r, 0))

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('catalogue.json')) return new Response(JSON.stringify(CATALOGUE))
    if (url.endsWith('captures.json')) return new Response(JSON.stringify({ 'moi/toile': { source: 'site', file: 'captures/moi__toile.webp' } }))
    if (url.endsWith('moi__borne.md')) return new Response(README)
    return new Response('', { status: 404 })
  }))
  const { monterOeuvre } = await import('../ui/oeuvre')
  monterOeuvre(document.body, '/b/')
  await attendre()
})

beforeEach(() => {
  partie.setState(INITIAL, true)
  partager.mockClear()
})

describe('l’œuvre regardée', () => {
  it('une toile regardée ouvre sa carte : nom, propriétaire, forks, étoile, QR, capture', () => {
    partie.setState({ paused: false, toile: 'moi/toile' })
    const a = document.querySelector('aside.carte-oeuvre')!
    expect(a.getAttribute('aria-live')).toBe('polite')
    expect(a.querySelector('.nom')!.textContent).toBe('toile')
    expect(a.querySelector('.proprio')!.textContent).toBe('moi')
    expect(a.textContent).toContain(`⑂ ${(1234).toLocaleString('fr-FR')} · poussé aujourd’hui`)
    expect(a.textContent).toContain('★ Mettre une étoile')
    expect(a.querySelector('svg[role=img]')!.getAttribute('aria-label')).toBe('QR code : https://github.com/moi/toile')
    expect(a.querySelector('img')!.getAttribute('src')).toBe('/b/media/captures/moi__toile.webp')
    expect(a.querySelector('.legende')!.textContent).toBe('TypeScript 75 %CSS 25 %')
    expect(a.textContent).not.toContain('visiter le site')
  })

  it('la borne l’emporte, son README en h3, puces et paragraphes, sans le titre de niveau 1', async () => {
    partie.setState({ paused: false, toile: 'moi/toile', borne: 'moi/borne' })
    expect(document.querySelectorAll('aside')).toHaveLength(1)
    const a = document.querySelector('aside[data-borne]')!
    expect(a.querySelector('h2')!.textContent).toBe('borne')
    expect(a.querySelector('.defile')!.textContent).toBe('Le README arrive…')
    await attendre()
    await attendre()
    expect([...a.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['Usage'])
    expect(a.querySelector('.defile p')!.textContent).toBe('Un paragraphe.')
    expect(a.querySelector('.puce')!.textContent).toBe('•fait')
    expect(a.textContent).toContain('visiter le site')
  })

  it('en pause, tout se masque', () => {
    partie.setState({ paused: false, toile: 'moi/toile' })
    partie.setState({ paused: true })
    expect(document.querySelector('aside')).toBeNull()
  })

  it('Bavette seule : son cartel ; une toile regardée la remplace', () => {
    partie.setState({ paused: false, bavette: true })
    expect(document.querySelector('aside .nom')!.textContent).toBe('Bavette')
    expect(document.querySelector('aside')!.textContent).toContain('Philippe Matray, 2026')
    partie.setState({ toile: 'moi/toile' })
    expect(document.querySelector('aside .nom')!.textContent).toBe('toile')
  })

  it('clavier : E ouvre le dépôt, P partage, Entrée sans site ne fait rien, repeat ignoré', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    partie.setState({ paused: false, toile: 'moi/toile' })
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }))
    expect(open).not.toHaveBeenCalled()
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', repeat: true }))
    expect(open).not.toHaveBeenCalled()
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))
    expect(open).toHaveBeenCalledWith('https://github.com/moi/toile', '_blank', 'noopener')
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }))
    expect(partager).toHaveBeenCalledWith('moi/toile', 'toile', ['moi/toile', 'moi/borne'])
    open.mockClear()
    partie.setState({ borne: 'moi/borne' })
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH' }))
    expect(open).toHaveBeenCalledWith('https://borne.example', '_blank', 'noopener')
    open.mockClear()
    partie.setState({ paused: true })
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('le bouton Partager appelle partager', () => {
    partie.setState({ paused: false, toile: 'moi/toile' })
    document.querySelector<HTMLButtonElement>('aside button')!.click()
    expect(partager).toHaveBeenCalledWith('moi/toile', 'toile', ['moi/toile', 'moi/borne'])
  })
})
