import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { monterCimaises } from '../cimaises'

describe('monterCimaises', () => {
  it('monte 33 panneaux et 81 pièces d’alu en deux lots ombrés', () => {
    const [panneaux, alu] = monterCimaises(new Scene(new NullEngine()), MUSEE)
    expect(panneaux.thinInstanceCount).toBe(33)
    expect(alu.thinInstanceCount).toBe(81)
    expect(panneaux.receiveShadows && alu.receiveShadows).toBe(true)
  })
})
