import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { hauteurDuParc } from '../../plan/relief'
import { lotsDeLEnceinte, monterEnceinte, MUR } from '../enceinte'

describe('enceinte', () => {
  it('range le mur et le belvédère en quatre lots, la terrasse posée sur le relief', () => {
    const l = lotsDeLEnceinte()
    expect(l.brique).toBe(MUR.brique)
    expect(l.fer).toBe(MUR.fer)
    expect(l.pierre.length).toBeGreaterThan(MUR.pierre.length)
    expect(l.pierre.every((b) => b.kind === 'wall')).toBe(true)
    expect(l.foulees.length).toBeGreaterThan(0)
    expect(l.foulees.some((b) => b.kind === 'wall')).toBe(false)
    // Le dessus de la terrasse est le sol du parc : rien ne flotte, rien ne s'enterre.
    for (const b of l.foulees.filter((x) => x.kind === 'slab')) expect(b.y + b.h / 2).toBeCloseTo(hauteurDuParc(b.x, b.z), 2)
  })

  it('monte quatre maillages, usure sur la brique et la pierre seulement', () => {
    const scene = new Scene(new NullEngine())
    const ms = monterEnceinte(scene)
    const l = lotsDeLEnceinte()
    expect(ms.map((m) => m.name)).toEqual(['enceinte:brique', 'enceinte:pierre', 'enceinte:foulees', 'enceinte:fer'])
    expect(ms.map((m) => m.getTotalVertices())).toEqual([l.brique, l.pierre, l.foulees, l.fer].map((b) => b.length * 24))
    expect(ms.map((m) => m.isVerticesDataPresent('boite'))).toEqual([true, true, false, false])
    expect(ms[0].material?.pluginManager?.getPlugin('VieuxMur')).toBeTruthy()
    expect(ms[1].material?.pluginManager?.getPlugin('Chaperon')).toBeTruthy()
  })
})
