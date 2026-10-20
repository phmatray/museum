import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { partie } from '../etat'
import { monterSeance, type Coins } from '../seance'

const PROGRAMME = { schemaVersion: 1 as const, generatedAt: '', chaine: 'Atypical Craft', video: 'cHgop3wo3iM', titre: 'Claude Code', publie: '' }

describe('la séance', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  // La caméra regarde −z ; la toile 9 × 3,8 m à 10 m devant.
  const camera = new FreeCamera('c', new Vector3(0, 1.6, 0), scene)
  camera.setTarget(new Vector3(0, 1.6, -10))
  const coins: Coins = [new Vector3(-4.5, 4, -10), new Vector3(4.5, 4, -10), new Vector3(4.5, 0.2, -10), new Vector3(-4.5, 0.2, -10)]
  const toile = document.createElement('canvas')
  Object.defineProperty(toile, 'clientWidth', { value: 1280 })
  Object.defineProperty(toile, 'clientHeight', { value: 720 })
  let effets = ''
  const s = monterSeance(scene, camera, toile, document.body, coins, PROGRAMME, { debut: () => (effets += 'd'), fin: () => (effets += 'f') })
  const film = () => document.querySelector<HTMLIFrameElement>('.seance-film')!

  it('lancée : la visite continue, lecteur sur la vidéo, posé sur la toile par une matrice', () => {
    scene.render()
    partie.setState({ paused: false })
    s.lancer()
    expect(partie.getState()).toMatchObject({ seance: true, paused: false })
    expect(film().src).toContain('/embed/cHgop3wo3iM')
    expect(film().style.transform).toMatch(/^matrix3d\(/)
    expect(document.querySelector<HTMLElement>('.seance')!.hidden).toBe(false)
    expect(effets).toBe('d')
  })

  it('finir coupe le lecteur et efface la projection', () => {
    s.finir()
    expect(partie.getState().seance).toBe(false)
    expect(film().src).toBe('about:blank')
    expect(document.querySelector<HTMLElement>('.seance')!.hidden).toBe(true)
    expect(effets).toBe('df')
  })
})
