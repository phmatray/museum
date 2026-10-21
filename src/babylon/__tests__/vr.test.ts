import { describe, expect, it } from 'vitest'

import { espaceDeReference, manetteDe, tapotementCompte } from '../vr.ts'

describe('vr (Babylon)', () => {
  it('ne prend local-floor que s’il est accordé, sinon local (jamais viewer)', () => {
    expect(espaceDeReference(['viewer', 'local', 'local-floor'])).toBe('local-floor')
    expect(espaceDeReference(['viewer', 'local'])).toBe('local')
    expect(espaceDeReference(undefined)).toBe('local')
  })

  it('lit une source WebXR comme une manette, avec ou sans gamepad', () => {
    const gamepad = { axes: [0, 0, 0.5, -1], buttons: [{ pressed: false }, { pressed: true }] } as unknown as Gamepad
    expect(manetteDe({ handedness: 'left', targetRayMode: 'tracked-pointer', gamepad })).toEqual({
      handedness: 'left', targetRayMode: 'tracked-pointer', axes: [0, 0, 0.5, -1], boutons: [false, true],
    })
    expect(manetteDe({ handedness: 'none', targetRayMode: 'gaze', gamepad: undefined })).toEqual({ handedness: 'none', targetRayMode: 'gaze', axes: [], boutons: [] })
  })

  it('ne compte pas un tapotement sur la flèche retour ni sur la roue des réglages du polyfill', () => {
    expect(tapotementCompte(400, 300, 800, 600)).toBe(true)
    expect(tapotementCompte(20, 20, 800, 600)).toBe(false)
    expect(tapotementCompte(410, 580, 800, 600)).toBe(false)
    expect(tapotementCompte(20, 580, 800, 600)).toBe(true)
  })
})
