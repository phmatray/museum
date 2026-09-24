/**
 * `PlanPlayer` : la garde de pause du `useFrame`, et la caméra posée au point
 * d'apparition à hauteur d'œil.
 *
 * `@react-three/test-renderer` n'expose la caméra du root R3F par aucune API
 * publique (`getInstance()` suppose un nœud hôte monté et lève sur l'arbre vide
 * que rend `PlanPlayer`, qui ne dessine rien) : on la récupère par le même
 * `useThree()` que le composant sous test, via un composant-sonde qui ne fait
 * que la remonter — la même caméra, partagée par le root.
 *
 * La touche avant est simulée en conditions réelles : un `<KeyboardControls>`
 * dont la map porte les quatre directions que `PlanPlayer` lit (une map
 * partielle laisserait `t.backward`/`t.left`/`t.right` à `undefined`, et
 * `Number(undefined)` vaut NaN — l'entrée du pas se serait empoisonnée en
 * silence) et un vrai `KeyboardEvent('keydown')` sur `window`, où
 * `KeyboardControls` écoute. Le repli suggéré par le plan — espionner
 * `plan/walk.ts#step` — n'a pas été nécessaire : la touche réelle traverse le
 * vrai câblage jusqu'à la caméra.
 */
import { describe, expect, it } from 'vitest'
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import ReactThreeTestRenderer, { act } from '@react-three/test-renderer'
import { KeyboardControls } from '@react-three/drei'
import type * as THREE from 'three'

import { PlanPlayer } from '../PlanPlayer'
import { toucher, useGameStore } from '../../stores/gameStore'
import { PAS_FIXE } from '../../domain/locomotion'

/** Les quatre directions que `PlanPlayer` lit — toutes présentes, même à `false`. */
const KEY_MAP = [
  { name: 'forward', keys: ['KeyW'] },
  { name: 'backward', keys: ['KeyS'] },
  { name: 'left', keys: ['KeyA'] },
  { name: 'right', keys: ['KeyD'] },
]

function CaptureCamera({ onCamera }: { onCamera: (camera: THREE.Camera) => void }) {
  const { camera } = useThree()
  useEffect(() => onCamera(camera), [camera, onCamera])
  return null
}

async function monterPlanPlayer() {
  let camera: THREE.Camera | undefined
  const renderer = await ReactThreeTestRenderer.create(
    <KeyboardControls map={KEY_MAP}>
      <PlanPlayer />
      <CaptureCamera onCamera={(c) => { camera = c }} />
    </KeyboardControls>,
  )
  if (!camera) throw new Error('caméra jamais capturée par CaptureCamera')
  return { renderer, camera }
}

describe('PlanPlayer', () => {
  it("pose la caméra au point d'apparition, à hauteur d'œil", async () => {
    const { camera } = await monterPlanPlayer()
    expect(camera.position.x).toBeCloseTo(24)
    expect(camera.position.y).toBeCloseTo(1.62) // HAUTEUR_OEIL, élévation du rez-de-chaussée
    expect(camera.position.z).toBeCloseTo(37)
  })

  it('ne bouge pas la caméra tant que le jeu reste en pause (défaut du magasin)', async () => {
    const { renderer, camera } = await monterPlanPlayer()
    await act(async () => useGameStore.setState({ paused: true }))
    const avant = camera.position.clone()

    await renderer.advanceFrames(1, 1 / 60)

    expect(camera.position.toArray()).toEqual(avant.toArray())
  })

  // Le test précédent ne tient aucune touche : sans entrée, l'absence de
  // mouvement ne prouve rien sur la garde elle-même (`step()` ne bougerait
  // pas non plus si la garde disparaissait). Celui-ci tient la touche avant
  // PENDANT la pause : seule la garde `if (paused) return` empêche alors le
  // mouvement (relevé en revue de code, #21).
  it('ignore la touche avant tenue tant que le jeu reste en pause', async () => {
    const { renderer, camera } = await monterPlanPlayer()
    const zInitial = camera.position.z

    await act(async () => useGameStore.setState({ paused: true }))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    })
    await renderer.advanceFrames(5, PAS_FIXE)

    expect(camera.position.z).toBeCloseTo(zInitial)
  })

  it('avance la caméra une fois le jeu repris et la touche avant tenue', async () => {
    const { renderer, camera } = await monterPlanPlayer()
    const zInitial = camera.position.z

    await act(async () => useGameStore.setState({ paused: false }))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    })
    await renderer.advanceFrames(5, PAS_FIXE)

    expect(camera.position.z).not.toBeCloseTo(zInitial)
  })

  // #31 : le joystick tactile passe par le même `step()` que le clavier, et le
  // glissé du regard tourne la même caméra que la souris.
  it('avance et tourne au joystick tactile, sans clavier', async () => {
    const { renderer, camera } = await monterPlanPlayer()
    const zInitial = camera.position.z
    const yawInitial = camera.rotation.y

    await act(async () => useGameStore.setState({ paused: false }))
    Object.assign(toucher, { forward: 1, strafe: 0, lookX: 0, lookY: 0 })
    await renderer.advanceFrames(5, PAS_FIXE)
    expect(camera.position.z).toBeLessThan(zInitial) // yaw 0 = −z

    toucher.forward = 0
    toucher.lookX = 100
    await renderer.advanceFrames(1, PAS_FIXE)
    expect(camera.rotation.y).toBeLessThan(yawInitial)
    expect(toucher.lookX).toBe(0) // consommé une fois, pas rejoué à chaque image
  })

  // #31 : la visite guidée conduit le visiteur sans clavier ni joystick, vers
  // le premier arrêt, et publie l'étape en cours pour le cartouche.
  it('marche seule vers le premier arrêt pendant la visite guidée', async () => {
    const { renderer, camera } = await monterPlanPlayer()
    const avant = camera.position.clone()
    Object.assign(toucher, { forward: 0, strafe: 0, lookX: 0, lookY: 0 })

    await act(async () => useGameStore.setState({ paused: false, tourActive: true, tourEtape: -1 }))
    await renderer.advanceFrames(30, 1 / 60)

    expect(camera.position.distanceTo(avant)).toBeGreaterThan(0.5)
    expect(useGameStore.getState().tourEtape).toBe(0)
    await act(async () => useGameStore.setState({ tourActive: false }))
  })
})
