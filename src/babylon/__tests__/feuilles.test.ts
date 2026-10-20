import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { saisonDuJour } from '../../domain/saisons.ts'
import { vivant } from '../etat.ts'
import { dansLeLobe, feuillesMortes, monterFeuilles } from '../feuilles.ts'
import { PARC } from '../parc.ts'

describe('feuilles mortes (Babylon)', () => {
  it('découpe cinq lobes : le centre dedans, les coins dehors', () => {
    expect(dansLeLobe(0, 0)).toBe(true)
    expect(dansLeLobe(0.95, 0.95)).toBe(false)
  })

  it('ne pose que la part tombée, couchée sur le sol', () => {
    const toutes = feuillesMortes(PARC, 1)
    const moitie = feuillesMortes(PARC, 0.5)
    expect(feuillesMortes(PARC, 0).positions.length).toBe(0)
    expect(toutes.positions.length).toBeGreaterThan(0)
    const n = moitie.positions.length / toutes.positions.length
    expect(n).toBeGreaterThan(0.4)
    expect(n).toBeLessThan(0.6)
    expect(toutes.colors.length / 4).toBe(toutes.positions.length / 3)
  })

  it('suit la saison vivante : éteintes l’été, refaites à l’automne', () => {
    const avant = vivant.getState().saison
    vivant.setState({ saison: saisonDuJour(180) })
    const scene = new Scene(new NullEngine())
    monterFeuilles(scene)
    const m = scene.getMeshByName('feuilles-mortes')!
    expect(m.isEnabled()).toBe(false)
    expect(m.material?.pluginManager?.getPlugin('Intemperies')).toBeTruthy()
    vivant.setState({ saison: saisonDuJour(330) })
    expect(m.isEnabled()).toBe(true)
    expect(m.getTotalVertices()).toBe(feuillesMortes(PARC, saisonDuJour(330).feuillesAuSol).positions.length / 3)
    vivant.setState({ saison: avant })
  })
})
