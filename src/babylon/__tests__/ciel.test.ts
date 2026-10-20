import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { cielA } from '../../domain/soleil'
import { codeDuCiel, monterCiel, photoUtile } from '../ciel'
import { VIVANTES } from '../etat'
import { reglagesDuCiel } from '../soleil'

describe('monterCiel', () => {
  it('éteint tant que la photo manque, vivant', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { dome, charge } = monterCiel(new Scene(new NullEngine()))
    expect(dome.isEnabled()).toBe(false)
    expect(charge()).toBe(false)
    expect(dome.scaling.x).toBe(800)
    expect(dome.metadata.zone).toBe('ciel')
    expect(VIVANTES.has('ciel')).toBe(true)
  })

  it('n’attend que la photo qui pèse', () => {
    expect(photoUtile(1, { jour: true, nuit: false })).toBe(true)
    expect(photoUtile(0, { jour: true, nuit: false })).toBe(false)
    expect(photoUtile(0.5, { jour: true, nuit: false })).toBe(false)
    expect(photoUtile(0.5, { jour: true, nuit: true })).toBe(true)
  })

  it('WGSL sans GLSL résiduel', () => {
    const { sommets, fragments } = codeDuCiel(true)
    expect(sommets + fragments).not.toMatch(/\bfloat |\bvec[234]\(|\batan\(|texture2D/)
    expect(fragments).toContain('atan2(')
    expect(codeDuCiel(false).fragments).toContain('atan(d.z, d.x)')
  })
})

describe('reglagesDuCiel sous la météo', () => {
  it('couvert : le soleil tombe au quart', () => {
    const c = cielA(new Date('2026-10-19T13:00:00Z'), 50.85, 4.35)
    expect(reglagesDuCiel(c, { nuages: 1, brouillard: 0 }).intensite).toBeCloseTo(reglagesDuCiel(c).intensite * 0.25)
    expect(reglagesDuCiel(c, { nuages: 1, brouillard: 1 }).intensite).toBeCloseTo(reglagesDuCiel(c).intensite * 0.15)
  })
})
