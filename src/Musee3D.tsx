/**
 * Le musée en 3D : le `Canvas` et tout ce qui vit dedans.
 *
 * Un module à part, chargé à la demande par `App` : three, R3F, drei et toutes
 * les couches de la scène pèsent l'essentiel du site, et l'accueil (HTML pur)
 * doit s'afficher sans les attendre. Le post-traitement est lui-même un second
 * morceau, demandé DÈS que ce module s'évalue — les deux téléchargements
 * courent en parallèle — et monté sans suspendre le bâtiment : la première
 * image n'attend pas l'occlusion ambiante.
 */
import { Canvas } from '@react-three/fiber'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, lazy } from 'react'

import { PointerLockCamera } from './components/PointerLockCamera'
import { PlanPlayer } from './components/PlanPlayer'
import { PlanBuilding } from './scene/PlanBuilding'
import { utiliserKTX2 } from './io/textures'
import { Pret } from './scene/chargement'

const postTraitement = import('./scene/PostProcessing')
const PostProcessing = lazy(() => postTraitement.then((m) => ({ default: m.PostProcessing })))

// Objet constant plutôt qu'`enum` : `erasableSyntaxOnly` interdit les enums,
// qui émettent du code au lieu de disparaître au strip des types.
const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  hate: 'hate',
} as const

// Codes PHYSIQUES (KeyW…) : ZQSD sur un clavier AZERTY, sans rien configurer.
const keyMap = [
  { name: Controls.forward, keys: ['ArrowUp', 'KeyW'] },
  { name: Controls.backward, keys: ['ArrowDown', 'KeyS'] },
  { name: Controls.left, keys: ['ArrowLeft', 'KeyA'] },
  { name: Controls.right, keys: ['ArrowRight', 'KeyD'] },
  /*
    La HÂTE, et pourquoi elle existe à côté de la marche normale.

    La marche est réglée à 3,5 m/s (`VITESSE_MARCHE`) — un pas soutenu, qui
    laisse le temps de regarder. Mais traverser un plateau déjà vu deviendrait
    long à cette allure : Maj rend les 6 m/s (`VITESSE_HATE`) à qui sait où il
    va.
  */
  { name: Controls.hate, keys: ['ShiftLeft', 'ShiftRight'] },
]

/**
 * `preserveDrawingBuffer` en développement seulement : sans lui, relire le
 * canvas depuis un navigateur piloté rend une image noire ; en production personne ne
 * le relit, et le tampon peut être recyclé.
 */
export default function Musee3D() {
  return (
    <KeyboardControls map={keyMap}>
      <Canvas shadows="percentage" camera={{ fov: 75, near: 0.1, far: 1000 }} gl={{ preserveDrawingBuffer: import.meta.env.DEV }} onCreated={({ gl }) => utiliserKTX2(gl)}>
        <Pret />
        <Suspense fallback={null}>
          <PointerLockCamera />
          <PlanBuilding />
          <PlanPlayer />
        </Suspense>
        <Suspense fallback={null}>
          <PostProcessing />
        </Suspense>
      </Canvas>
    </KeyboardControls>
  )
}
