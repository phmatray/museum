import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../../plan/hang'
import { MUSEE } from '../../plan/musee'
import { posesDesProps } from '../props'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage

describe('props', () => {
  const poses = posesDesProps(accrochage)
  const de = (piece: string) => poses.filter((p) => p.piece === piece)

  it('compte les plantes et une cuve sous chaque lyrata et olivier', () => {
    expect(de('Olivier')).toHaveLength(27)
    expect(de('Lyrata')).toHaveLength(19 + 2)
    expect(de('Kentia')).toHaveLength(2)
    expect(de('Lyrata-cuve')).toHaveLength(48)
  })

  it('pose chaque plante à l’élévation de son niveau, échelle 0,85..1', () => {
    const cotes = new Set(MUSEE.levels.map((l) => l.elevation))
    for (const p of poses) {
      expect(cotes.has(p.y)).toBe(true)
      expect(p.echelle ?? 1).toBeGreaterThanOrEqual(0.85)
    }
    const cuves = de('Lyrata-cuve').map((p) => `${p.x},${p.y},${p.z}`)
    for (const p of [...de('Lyrata'), ...de('Olivier')]) expect(cuves).toContain(`${p.x},${p.y},${p.z}`)
  })
})
