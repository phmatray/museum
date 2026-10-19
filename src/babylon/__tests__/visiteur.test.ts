import { readFileSync } from 'node:fs'

import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import config from '../../../museum.config.json'
import type { Accrochage } from '../../plan/hang'
import { MUSEE } from '../../plan/musee'
import { departDuVisiteur, monterVisiteur } from '../visiteur'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage

describe('departDuVisiteur', () => {
  it('part du départ du plan sans lien', () => {
    const d = departDuVisiteur(MUSEE, null, '', '', config.owners)
    expect([d.x, d.z, d.yaw, d.pitch]).toEqual([24, 37, 0, 0])
    expect(d.surface).toBeTruthy()
  })

  it('ouvre les yeux devant AspireStrapi avec ?p=', () => {
    const d = departDuVisiteur(MUSEE, accrochage, '?p=AspireStrapi', '', config.owners)
    expect(d.x).toBeGreaterThan(0)
    expect(d.x).toBeLessThan(16)
    expect(d.z).toBeGreaterThan(27)
    expect(d.z).toBeLessThan(40)
    expect(Math.sin(d.yaw)).toBeGreaterThan(0.9)
  })

  it('retombe sur le départ pour un projet inconnu', () => {
    const d = departDuVisiteur(MUSEE, accrochage, '?p=nexistepas', '', config.owners)
    expect([d.x, d.z]).toEqual([24, 37])
  })
})

describe('monterVisiteur', () => {
  // Le regard après une image, pour un cap et une inclinaison donnés.
  const regarder = (yaw: number, pitch: number) => {
    const engine = new NullEngine()
    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    const depart = departDuVisiteur(MUSEE, null, '', '', config.owners)
    const camera = monterVisiteur(scene, document.createElement('canvas'), { ...depart, yaw, pitch })
    scene.render()
    const oeil = camera.position.y - depart.y
    const avant = camera.getTarget().subtract(camera.position).normalize()
    engine.dispose()
    return { oeil, avant }
  }

  it("pose l'œil à 1,62 m et regarde comme three : yaw 0 vers −z, pitch > 0 vers le haut", () => {
    const { oeil, avant } = regarder(0, 0.3)
    expect(oeil).toBeCloseTo(1.62)
    expect(avant.z).toBeLessThan(-0.9)
    expect(avant.y).toBeGreaterThan(0.25)
  })

  it('tourne comme walk.ts : yaw π/2 vers −x', () => {
    expect(regarder(Math.PI / 2, 0).avant.x).toBeLessThan(-0.99)
  })
})
