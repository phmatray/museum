import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { partie } from '../etat'
import { monterSeance, type Coins } from '../seance'

const PROGRAMME = { schemaVersion: 1 as const, generatedAt: '', chaine: 'Atypical Craft', video: 'cHgop3wo3iM', titre: 'Claude Code', publie: '' }

describe('la séance', () => {
  const engine = new NullEngine()
  // Le HtmlMeshRenderer se cale sur le canevas : NullEngine n'en a pas, on lui en prête un.
  const toile = document.createElement('canvas')
  vi.spyOn(engine, 'getRenderingCanvas').mockReturnValue(toile)
  vi.spyOn(engine, 'getRenderingCanvasClientRect').mockReturnValue(new DOMRect(0, 0, 1280, 720))
  const scene = new Scene(engine)
  scene.useRightHandedSystem = true
  // La caméra regarde −z ; la toile 9 × 3,8 m à 10 m devant.
  const camera = new FreeCamera('c', new Vector3(0, 1.6, 0), scene)
  camera.setTarget(new Vector3(0, 1.6, -10))
  const coins: Coins = [new Vector3(-4.5, 4, -10), new Vector3(4.5, 4, -10), new Vector3(4.5, 0.2, -10), new Vector3(-4.5, 0.2, -10)]
  let effets = ''
  const s = monterSeance(scene, coins, PROGRAMME, { debut: () => (effets += 'd'), fin: () => (effets += 'f') })
  const film = () => document.querySelector<HTMLIFrameElement>('.seance-film')

  it('lancée : la visite continue, le lecteur sur la vidéo, un HtmlMesh posé devant la toile', () => {
    partie.setState({ paused: false })
    s.lancer()
    scene.render()
    expect(partie.getState()).toMatchObject({ seance: true, paused: false })
    expect(film()!.src).toContain('/embed/cHgop3wo3iM')
    const toileMesh = scene.getMeshById('seance-toile')!
    expect(toileMesh.position.z).toBeCloseTo(-9.99, 5)
    expect(toileMesh.getBoundingInfo().boundingBox.extendSize.x).toBeCloseTo(4.5, 5)
    expect(effets).toBe('d')
  })

  it('finir coupe le lecteur et retire le HtmlMesh', () => {
    s.finir()
    expect(partie.getState().seance).toBe(false)
    expect(film()).toBeNull()
    expect(scene.getMeshById('seance-toile')).toBeNull()
    expect(effets).toBe('df')
  })
})
