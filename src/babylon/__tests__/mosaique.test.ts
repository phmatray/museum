import { describe, expect, it } from 'vitest'

import { decalerLuminance } from '../mosaique'

describe('mosaïque', () => {
  it('décale la luminance HSL comme offsetHSL de three (teinte linéaire de #dba43a)', () => {
    const r = decalerLuminance([0.7083757798856457, 0.3712376804636741, 0.04231141061442144], 0.02)
    expect(r[0]).toBeCloseTo(0.7461212370534316, 6)
    expect(r[1]).toBeCloseTo(0.39101889880130836, 6)
    expect(r[2]).toBeCloseTo(0.04456595344663561, 6)
    expect(decalerLuminance([0.5, 0.5, 0.5], -0.6)).toEqual([0, 0, 0])
  })
})
