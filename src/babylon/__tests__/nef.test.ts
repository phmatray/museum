import { describe, expect, it } from 'vitest'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'

import { tournerAiguilles } from '../nef'

describe('tournerAiguilles', () => {
  it('tourne dans le sens horaire vu de +z : 3 h 30 → heures entre 3 et 4, minutes vers le bas', () => {
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    const [h, m] = [new TransformNode('h', scene), new TransformNode('m', scene)]
    tournerAiguilles(h, m, new Date(2026, 0, 1, 15, 30))
    const pointe = (t: TransformNode) => Vector3.TransformCoordinates(Vector3.Up(), t.computeWorldMatrix(true))
    const ph = pointe(h)
    // 3 h 30 : 105° après midi, à droite (+x) et un peu sous l'horizontale.
    expect(ph.x).toBeCloseTo(Math.sin((105 * Math.PI) / 180), 6)
    expect(ph.y).toBeCloseTo(Math.cos((105 * Math.PI) / 180), 6)
    const pm = pointe(m)
    expect(pm.x).toBeCloseTo(0, 6)
    expect(pm.y).toBeCloseTo(-1, 6)
  })
})
