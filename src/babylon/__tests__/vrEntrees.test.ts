import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Scene } from '@babylonjs/core/scene'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CRAN } from '../../domain/vr'
import { partie, vrEntree } from '../etat'
import type { PorteVR } from '../vr'
import { monterEntreesVR } from '../vrEntrees'

function monter(inputSources: unknown[] = []) {
  const engine = new NullEngine()
  vi.spyOn(engine, 'getDeltaTime').mockReturnValue(16)
  const scene = new Scene(engine)
  const session = Object.assign(new EventTarget(), { inputSources })
  const porte = { mode: 'cardboard', gree: new TransformNode('g', scene), xr: () => ({ sessionManager: { session } }), entrer: async () => {} } as unknown as PorteVR
  monterEntreesVR(scene, porte)
  partie.setState({ enVR: true })
  const select = (targetRayMode: string) => session.dispatchEvent(Object.assign(new Event('select'), { inputSource: { targetRayMode } }))
  return { scene, porte, select }
}

afterEach(() => partie.setState({ enVR: false }))

describe('monterEntreesVR', () => {
  it('un regard sélectionné (ou un tapotement hors des boutons du polyfill) lance puis arrête la marche', () => {
    const { scene, select } = monter()
    select('gaze')
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(vrEntree.avance).toBe(1)
    select('tracked-pointer')
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(vrEntree.avance).toBe(1)
    dispatchEvent(new MouseEvent('pointerdown', { clientX: 5, clientY: 5 }))
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(vrEntree.avance).toBe(1)
    dispatchEvent(new MouseEvent('pointerdown', { clientX: innerWidth / 3, clientY: innerHeight / 2 }))
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(vrEntree.avance).toBe(0)
  })

  it('tourne le gréement par crans au stick droit et ferme la vignette', () => {
    const droite = { handedness: 'right', targetRayMode: 'tracked-pointer', gamepad: { axes: [0, 0, 0, 0], buttons: [] } }
    const gauche = { handedness: 'left', targetRayMode: 'tracked-pointer', gamepad: { axes: [0, 0, 0, 0], buttons: [] } }
    const { scene, porte } = monter([gauche, droite])
    scene.onBeforeRenderObservable.notifyObservers(scene)
    droite.gamepad.axes[2] = 1
    scene.onBeforeRenderObservable.notifyObservers(scene)
    expect(porte.gree.rotation.y).toBeCloseTo(-CRAN)
    expect(vrEntree.confort).toBeGreaterThan(0)
  })
})
