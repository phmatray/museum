import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { describe, expect, it } from 'vitest'

import { soleilEcran } from '../postTraitement'

// Une caméra main droite à l'origine qui regarde −z.
const vue = Matrix.LookAtRH(Vector3.Zero(), new Vector3(0, 0, -1), Vector3.Up()).multiply(Matrix.PerspectiveFovRH(Math.PI / 2, 1, 0.1, 1000))
const avant = new Vector3(0, 0, -1)

describe('soleilEcran', () => {
  it('au centre quand on le regarde', () => {
    const p = soleilEcran([0, 0, -1], Vector3.Zero(), avant, vue)!
    expect(p[0]).toBeCloseTo(0.5)
    expect(p[1]).toBeCloseTo(0.5)
  })

  it('en haut quand il est au-dessus du regard, rien derrière', () => {
    expect(soleilEcran([0, Math.SQRT1_2, -Math.SQRT1_2], Vector3.Zero(), avant, vue)![1]).toBeCloseTo(1)
    expect(soleilEcran([0, 0, 1], Vector3.Zero(), avant, vue)).toBeNull()
  })
})
