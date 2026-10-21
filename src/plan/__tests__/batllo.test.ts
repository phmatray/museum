/** La baie Batlló : seule sa boîte de verre disparaît du rendu (le GLB, lui, est confronté au plan dans maquettes.test.ts). */
import { expect, it } from 'vitest'

import { MUSEE } from '../musee'
import { meshLevel } from '../mesh'
import { BAIE_BATLLO, sansBaieBatllo } from '../batllo'

it('sansBaieBatllo retire la seule boîte de verre de la baie Batlló', () => {
  for (const l of MUSEE.levels) {
    const verre = meshLevel(MUSEE, l.id).filter((b) => b.kind === 'glass')
    expect(sansBaieBatllo(verre, l.id)).toHaveLength(verre.length - (l.id === BAIE_BATLLO.level ? 1 : 0))
  }
})
