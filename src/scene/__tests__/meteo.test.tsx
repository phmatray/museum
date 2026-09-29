/**
 * Le temps qui change, vu par la scène : ni gel ni pluie éteinte au-dedans.
 *
 * Deux bugs de Philippe : passer du clair à la pluie gelait le musée (la brume
 * posée puis ôtée changeait le programme de TOUTES les matières : 65
 * recompilations d'un coup), et la pluie ne se voyait qu'une fois dehors (la
 * chute était éteinte dès que la caméra passait sous les toits).
 */
import { describe, expect, it } from 'vitest'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'

import { CLAIR, meteoDemandee } from '../../domain/meteo'
import { METEOS } from '../../domain/reglages'
import { useGameStore } from '../../stores/gameStore'
import { MeteoLayer } from '../MeteoLayer'

/** Le visiteur au milieu de la nef, face aux portes. */
function DansLaNef() {
  useFrame(({ camera }) => {
    camera.position.set(24, 1.7, 28)
  })
  return null
}

describe('MeteoLayer', () => {
  it("garde la même brume quel que soit le temps : aucun programme n'est à recompiler", async () => {
    useGameStore.setState({ meteo: CLAIR })
    const r = await ReactThreeTestRenderer.create(<MeteoLayer />)
    const scene = r.scene.instance as unknown as THREE.Scene
    await r.advanceFrames(2, 0.016)
    const brume = scene.fog
    expect(brume).not.toBeNull()
    for (const m of [...METEOS, 'clair']) {
      useGameStore.setState({ meteo: m === 'clair' ? CLAIR : meteoDemandee(`?meteo=${m}`)! })
      await r.advanceFrames(30, 0.1)
      expect(scene.fog, m).toBe(brume)
    }
    await r.unmount()
  })

  it('pleut encore quand le visiteur est dans la nef', async () => {
    useGameStore.setState({ meteo: meteoDemandee('?meteo=pluie')! })
    const r = await ReactThreeTestRenderer.create(<><DansLaNef /><MeteoLayer /></>)
    await r.advanceFrames(40, 0.1)
    const chutes = r.scene.findAll((n) => (n.instance as THREE.Mesh).geometry?.type === 'InstancedBufferGeometry')
    const pluie = chutes.map((n) => (n.instance as THREE.Mesh).geometry as THREE.InstancedBufferGeometry).find((g) => g.instanceCount > 0)
    expect(pluie).toBeDefined()
    await r.unmount()
  })
})
