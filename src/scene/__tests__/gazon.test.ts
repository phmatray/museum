/**
 * La carte du sol du gazon : l'herbe ne pousse ni dans le musée, ni sur le
 * parvis, ni dans une allée, ni dans l'eau ; sa cote est celle du relief.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { CONTOUR_ETANG } from '../../plan/jardin'
import { MUSEE } from '../../plan/musee'
import { parkPlacements } from '../../plan/park'
import { hauteurDuParc } from '../../plan/relief'
import { carteDuSol } from '../gazon'

const parc = parkPlacements(MUSEE)
const carte = carteDuSol(parc)

/** Le texel sous (x, z) : [cote, herbe]. */
function lire(x: number, z: number): [number, number] {
  const { width } = carte.texture.image
  const [i, j] = [Math.floor((x - carte.cadre.x) / 0.5), Math.floor((z - carte.cadre.y) / 0.5)]
  const data = carte.texture.image.data as Uint16Array
  const k = (j * width + i) * 4
  return [THREE.DataUtils.fromHalfFloat(data[k]), THREE.DataUtils.fromHalfFloat(data[k + 1])]
}

describe('carteDuSol', () => {
  it('fait pousser l’herbe en pleine pelouse, à la cote du relief', () => {
    const [h, herbe] = lire(-25.2, 60.2)
    expect(herbe).toBe(1)
    expect(h).toBeCloseTo(hauteurDuParc(-25.25, 60.25), 2)
    expect(h).toBeGreaterThan(0.5)
  })
  it('pas dans le musée ni sur le parvis', () => {
    expect(lire(24, 20)[1]).toBe(0)
    expect(lire(-3, 43)[1]).toBe(0)
  })
  it('pas sur l’axe de l’entrée', () => expect(lire(24, 70)[1]).toBe(0))
  it('pas dans l’étang', () => {
    const [cx, cz] = CONTOUR_ETANG.reduce(([a, b], [x, z]) => [a + x / CONTOUR_ETANG.length, b + z / CONTOUR_ETANG.length], [0, 0])
    expect(lire(cx, cz)[1]).toBe(0)
  })
})
