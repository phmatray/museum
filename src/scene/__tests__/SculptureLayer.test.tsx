/**
 * `SculptureLayer` doit passer la même police vendorisée que `Cartel` et
 * `PlanToiles` à son `<Text>` de cartel de socle — trouvaille de revue sur
 * #52 : les deux autres composants avaient chacun leur test, celui-ci non,
 * alors que c'est le même changement (`font={CARTEL_FONT}`) sur le même
 * risque (retomber sur le défaut CDN de troika sans qu'aucun test ne le voie).
 * `<Text>` est mocké comme dans `Cartel.test.tsx`, même raison : monter le
 * vrai `<Text>` de troika déclencherait un chargement de police réel.
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

import { SculptureLayer } from '../SculptureLayer'
import type { SculpturePlacement } from '../../plan/sculptures'

const placement: SculpturePlacement = {
  id: 'test',
  file: 'inexistant.glb',
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  height: 1,
  plinth: { width: 0.6, depth: 0.6, height: 0.9 },
  cartel: { author: 'Auteur', title: 'Titre', year: 1900, medium: 'marbre', credit: 'crédit' },
}

describe('SculptureLayer', () => {
  it('passe à son <Text> de cartel une police vendorisée sous BASE_URL', async () => {
    texteVu.length = 0
    // Se remonte une seconde fois une fois `useSculptureAssets` réglé (GLTF
    // introuvable au banc, résolu quand même en Map vide) : chaque rendu doit
    // porter la même police, pas seulement le premier.
    await ReactThreeTestRenderer.create(<SculptureLayer placements={[placement]} />)

    expect(texteVu.length).toBeGreaterThan(0)
    for (const props of texteVu) {
      expect(props.font).toBe(`${import.meta.env.BASE_URL}assets/fonts/PTSans-Regular.ttf`)
    }
  })
})
