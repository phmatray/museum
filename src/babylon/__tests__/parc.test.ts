import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { dallage, FOULE, PARC, pelouse } from '../parc'

describe('le parc partagé', () => {
  it('calcule le parc une fois : terrain, parvis et les 4 bandes du dallage', () => {
    expect(PARC.terrain).toEqual({ x: -40, z: -40, width: 128, depth: 120 })
    expect(PARC.dalles).toHaveLength(4)
    expect(FOULE).toHaveLength(4)
  })

  it('une pelouse et un dallage par scène, Lambert sans spéculaire pour la pelouse', () => {
    const scene = new Scene(new NullEngine())
    expect(pelouse(scene)).toBe(pelouse(scene))
    expect(dallage(scene)).toBe(dallage(scene))
    expect(pelouse(scene).metallicF0Factor).toBe(0)
    expect(pelouse(new Scene(new NullEngine()))).not.toBe(pelouse(scene))
  })
})
