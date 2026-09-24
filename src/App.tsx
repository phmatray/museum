import { Canvas } from '@react-three/fiber'
import { KeyboardControls } from '@react-three/drei'
import { Suspense } from 'react'
import { PointerLockCamera, PointerLockOverlay, TourExitButton } from './components/PointerLockOverlay'
import { PlanBuilding } from './scene/PlanBuilding'
import { PlanPlayer } from './components/PlanPlayer'
import { PostProcessing } from './scene/PostProcessing'
import { MobileControlsOverlay } from './components/MobileControls'
import { useIsMobile } from './hooks/useIsMobile'
import { Minimap } from './components/Minimap'
import { GuidedTour } from './components/GuidedTour'

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
 * Le musée publié est le bâtiment du plan (#17), sans Rapier : `plan/walk.ts`
 * fait les collisions, et le visiteur apparaît au sud du hall.
 *
 * `preserveDrawingBuffer` en développement seulement : sans lui, relire le
 * canvas depuis un navigateur piloté rend une image noire ; en production personne ne
 * le relit, et le tampon peut être recyclé.
 */
export default function App() {
  const isMobile = useIsMobile()
  return (
    <>
      <PointerLockOverlay />
      <TourExitButton />
      <GuidedTour />
      {isMobile && <MobileControlsOverlay />}
      <Minimap />
      <KeyboardControls map={keyMap}>
        <Canvas camera={{ fov: 75, near: 0.1, far: 1000 }} gl={{ preserveDrawingBuffer: import.meta.env.DEV }}>
          <Suspense fallback={null}>
            <PointerLockCamera />
            <PlanBuilding />
            <PlanPlayer />
            <PostProcessing />
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </>
  )
}
