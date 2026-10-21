import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'

import { el, observer, svg, themeName } from '../ui/dom'

describe('aides de l’interface', () => {
  it('el pose attributs et enfants, textes compris, sans interpréter le HTML', () => {
    const b = el('button', { type: 'button', 'aria-pressed': false, hidden: true, 'data-x': 2 }, '<b>', el('kbd', {}, 'M'), null)
    expect(b.outerHTML).toBe('<button type="button" hidden="" data-x="2">&lt;b&gt;<kbd>M</kbd></button>')
    expect(svg('circle', { r: 3 }).namespaceURI).toBe('http://www.w3.org/2000/svg')
  })

  it('observer appelle tout de suite puis seulement quand la part choisie change', () => {
    const s = createStore(() => ({ a: 1, b: 1 }))
    const f = vi.fn()
    const fin = observer(s, (e) => [e.a, e.a > 1], f)
    s.setState({ b: 2 })
    s.setState({ a: 2 })
    fin()
    s.setState({ a: 3 })
    expect(f.mock.calls).toEqual([[[1, false]], [[2, true]]])
  })

  it('themeName : le thème de l’accrochage, sinon le repli', () => {
    const acc = { rooms: [{ id: 'r', level: 0, name: 'Rust', placements: [] }] } as never
    expect(themeName(acc, 'r', 0, 'travail')).toBe('Rust')
    expect(themeName(null, 'r', 0, 'travail')).toBe('travail')
  })
})
