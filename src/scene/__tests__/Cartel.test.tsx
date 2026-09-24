/**
 * `Cartel` doit passer une police vendorisée à son `<Text>` — jamais laisser
 * troika retomber sur son défaut CDN (#52). `<Text>` est mocké : le monter
 * pour de vrai déclencherait le chargement réel d'une police par troika, ce
 * que le test n'a pas à observer (voir la note de tests de l'issue).
 */
import { describe, expect, it, vi } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'

const { texteVu } = vi.hoisted(() => ({ texteVu: [] as { font?: unknown }[] }))

vi.mock('@react-three/drei', () => ({
  Text: (props: { font?: unknown }) => {
    texteVu.push(props)
    return null
  },
}))

import { Cartel } from '../Cartel'
import type { CartelPlacement } from '../../plan/cartels'

const placement: CartelPlacement = { key: 'salle/oeuvre', x: 0, y: 0, z: 0, rotation: 0 }

describe('Cartel', () => {
  it('passe à son <Text> une police vendorisée sous BASE_URL', async () => {
    texteVu.length = 0
    await ReactThreeTestRenderer.create(<Cartel placement={placement} texte="Titre, Auteur, 1900" />)

    expect(texteVu).toHaveLength(1)
    expect(texteVu[0].font).toBe(`${import.meta.env.BASE_URL}assets/fonts/PTSans-Regular.ttf`)
  })
})
