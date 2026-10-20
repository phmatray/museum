import { readFileSync } from 'node:fs'

import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { beforeEach, describe, expect, it } from 'vitest'

import config from '../../../museum.config.json'
import type { Catalogue } from '../../domain/types'
import type { Accrochage } from '../../plan/hang'
import { VISITE } from '../../plan/tour'
import { choisirVitrines, SALLE_VITRINES } from '../../plan/vitrines'
import { marquerPret } from '../chargement'
import { partie, toucher } from '../etat'
import { MUSEE } from '../../plan/musee'
import { departDuVisiteur, monterVisiteur } from '../visiteur'

const accrochage = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage
const catalogue = JSON.parse(readFileSync('public/data/catalogue.json', 'utf8')) as Catalogue

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

  it('retombe sur le départ pour un projet inconnu, et le dit au billet', () => {
    const d = departDuVisiteur(MUSEE, accrochage, '?p=nexistepas', '', config.owners)
    expect([d.x, d.z]).toEqual([24, 37])
    expect(d.rendezVous).toEqual({ demande: 'nexistepas', cle: null })
    expect(departDuVisiteur(MUSEE, accrochage, '', '', config.owners).rendezVous).toBeNull()
  })

  it('ne dit rien et reste au départ sans accrochage ni catalogue', () => {
    for (const d of [departDuVisiteur(MUSEE, null, '?p=AspireStrapi', '', config.owners), departDuVisiteur(MUSEE, accrochage, '?p=AspireStrapi', '', config.owners, null)]) {
      expect([d.x, d.z]).toEqual([24, 37])
      expect(d.rendezVous).toBeNull()
    }
  })

  it('trouve un projet en vitrine, dans la salle d’honneur', () => {
    const vitrines = choisirVitrines(catalogue.artworks, catalogue.owners).map((a) => a.key)
    const d = departDuVisiteur(MUSEE, accrochage, `?projet=${vitrines[0]}`, '', config.owners, vitrines)
    expect(d.surface.endsWith(`:${SALLE_VITRINES}`)).toBe(true)
    expect(d.rendezVous).toEqual({ demande: vitrines[0], cle: vitrines[0] })
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

describe('pause, toucher et visite guidée', () => {
  const INITIAL = partie.getState()
  beforeEach(() => {
    partie.setState(INITIAL, true)
    Object.assign(toucher, { forward: 0, strafe: 0, lookX: 0, lookY: 0 })
  })
  // Un visiteur au départ, des images de 50 ms (6 pas fixes chacune).
  const monter = () => {
    const engine = new NullEngine()
    engine.getDeltaTime = () => 50
    const scene = new Scene(engine)
    scene.useRightHandedSystem = true
    const camera = monterVisiteur(scene, document.createElement('canvas'), departDuVisiteur(MUSEE, null, '', '', config.owners))
    const images = (n: number) => { for (let i = 0; i < n; i++) scene.render() }
    return { camera, images, fin: () => engine.dispose() }
  }

  it('en pause ou avant la fin du chargement, rien ne bouge ; le joystick fait marcher ensuite', () => {
    const { camera, images, fin } = monter()
    toucher.forward = 1
    partie.setState({ paused: false })
    images(5) // pas encore prêt
    expect(camera.walker().z).toBe(37)
    marquerPret()
    partie.setState({ paused: true })
    images(5)
    expect(camera.walker().z).toBe(37)
    partie.setState({ paused: false })
    images(5)
    expect(camera.walker().z).toBeLessThan(37)
    expect(partie.getState().visiteur).toBe(camera.walker())
    fin()
  })

  it('le glissé du doigt tourne le regard et se consomme', () => {
    marquerPret()
    const { camera, images, fin } = monter()
    partie.setState({ paused: false })
    toucher.lookX = 100
    images(1)
    expect(camera.rotation.y).toBeCloseTo(-0.2)
    expect(toucher.lookX).toBe(0)
    fin()
  })

  it('la visite repart du départ, avance ses arrêts, et une touche de marche rend la main', () => {
    marquerPret()
    const { camera, images, fin } = monter()
    camera.placer({ ...camera.walker(), x: 30, z: 30, pitch: 0 })
    partie.setState({ tourActive: true, paused: false })
    images(1)
    expect(camera.walker().z).toBeLessThan(37)
    expect(Math.hypot(camera.walker().x - 24, camera.walker().z - 37)).toBeLessThan(1)
    images(2000) // 100 s de marche
    expect(partie.getState().tourEtape).toBeGreaterThan(0)
    expect(partie.getState().tourEtape).toBeLessThan(VISITE.length)
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }))
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }))
    expect(partie.getState()).toMatchObject({ tourActive: false, paused: false })
    fin()
  })
})
