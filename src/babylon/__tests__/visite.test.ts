import { beforeEach, describe, expect, it } from 'vitest'

import accrochage from '../../../public/data/accrochage.json'
import type { Accrochage } from '../../plan/hang'
import { VISITE } from '../../plan/tour'
import { partie } from '../etat'
import { themeName } from '../ui/dom'
import { monterVisite } from '../ui/visite'

const INITIAL = partie.getState()

describe('cartouche de la visite guidée', () => {
  beforeEach(() => {
    partie.setState(INITIAL, true)
    document.body.replaceChildren()
  })

  it('masqué hors visite, puis le thème de la salle et l’avancement', () => {
    const a = accrochage as unknown as Accrochage
    monterVisite(document.body, a)
    const c = document.querySelector<HTMLElement>('[role=status]')!
    expect(c.hidden).toBe(true)
    partie.setState({ tourActive: true })
    expect(c.hidden).toBe(false)
    const s = VISITE[0]
    expect(c.textContent).toBe(`Visite guidée · ${themeName(a, s.roomId, s.level, s.name)} (1/${VISITE.length})`)
    partie.setState({ tourEtape: 2 })
    expect(c.textContent).toContain(`(3/${VISITE.length})`)
    partie.setState({ tourActive: false })
    expect(c.hidden).toBe(true)
  })

  it('sans accrochage, le nom de travail de l’arrêt', () => {
    monterVisite(document.body, null)
    partie.setState({ tourActive: true })
    expect(document.querySelector('[role=status]')!.textContent).toBe(`Visite guidée · ${VISITE[0].name} (1/${VISITE.length})`)
  })
})
