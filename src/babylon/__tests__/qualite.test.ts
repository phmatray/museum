import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { partie } from '../etat.ts'
import { monterQualite, verdictImages } from '../qualite.ts'

describe('qualite', () => {
  afterEach(() => vi.restoreAllMocks())

  it('juge comme le PerformanceMonitor de drei', () => {
    expect(verdictImages(Array(10).fill(60), 60)).toBe('hausse')
    expect(verdictImages([...Array(8).fill(39), 60, 60], 60)).toBe('baisse')
    expect(verdictImages([...Array(7).fill(39), 60, 60, 60], 60)).toBeNull()
    // Écran 144 Hz : 60 im/s ne suffit plus pour monter, et n'est pas une baisse.
    expect(verdictImages(Array(10).fill(60), 144)).toBeNull()
    expect(verdictImages(Array(10).fill(50), 144)).toBe('baisse')
  })

  it('descend d’un palier quand les images tombent, une fois prêt seulement', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const engine = new NullEngine()
    const pose = vi.spyOn(engine, 'setHardwareScalingLevel')
    const scene = new Scene(engine)
    const q = monterQualite(engine, scene, () => null)
    expect(pose).toHaveBeenLastCalledWith(1)
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    const image = (ms: number) => {
      t += ms
      scene.onBeforeRenderObservable.notifyObservers(scene)
    }
    for (let i = 0; i < 200; i++) image(50)
    expect(pose).toHaveBeenCalledTimes(1)
    q.demarrer()
    // 20 im/s : 10 fenêtres de 250 ms, puis le verdict.
    for (let i = 0; i < 60; i++) image(50)
    expect(pose).toHaveBeenLastCalledWith(1 / 0.75)
    vi.unstubAllGlobals()
  })

  it('se tient tranquille en VR', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const engine = new NullEngine()
    const pose = vi.spyOn(engine, 'setHardwareScalingLevel')
    const scene = new Scene(engine)
    monterQualite(engine, scene, () => null).demarrer()
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => t)
    partie.setState({ enVR: true })
    for (let i = 0; i < 60; i++) {
      t += 50
      scene.onBeforeRenderObservable.notifyObservers(scene)
    }
    expect(pose).toHaveBeenCalledTimes(1)
    partie.setState({ enVR: false })
    vi.unstubAllGlobals()
  })

  // NullEngine.getHardwareScalingLevel() rend toujours 1 : on espionne la pose.
  it('?qualite=basse fige le palier le plus sobre', () => {
    vi.stubGlobal('devicePixelRatio', 1)
    const engine = new NullEngine()
    const pose = vi.spyOn(engine, 'setHardwareScalingLevel')
    monterQualite(engine, new Scene(engine), () => 'basse')
    expect(pose).toHaveBeenLastCalledWith(1 / 0.75)
    vi.unstubAllGlobals()
  })
})
