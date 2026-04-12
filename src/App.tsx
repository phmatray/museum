import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, useMemo, useCallback } from 'react'
import { Player } from './components/Player'
import { PointerLockCamera, PointerLockOverlay, TourExitButton } from './components/PointerLockOverlay'
import { Room } from './components/Room'
import { GuidedTour } from './components/GuidedTour'
import museumConfig from './config/museum.json'
import type { MuseumConfig } from './types/museum'
import { useIsMobile } from './hooks/useIsMobile'
import { MobileControlsOverlay } from './components/MobileControls'
import { useRoomTransition } from './hooks/useRoomTransition'
import { Minimap } from './components/Minimap'
import { useGameStore } from './stores/gameStore'

enum Controls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
}

export default function App() {
  const isMobile = useIsMobile()
  const { triggerTransition } = useRoomTransition()

  const handleTourComplete = useCallback(() => {
    useGameStore.getState().setTourActive(false)
    useGameStore.getState().setPaused(true)
  }, [])

  const keyMap = useMemo(
    () => [
      { name: Controls.forward, keys: ['ArrowUp', 'KeyW'] },
      { name: Controls.backward, keys: ['ArrowDown', 'KeyS'] },
      { name: Controls.left, keys: ['ArrowLeft', 'KeyA'] },
      { name: Controls.right, keys: ['ArrowRight', 'KeyD'] },
    ],
    []
  )

  return (
    <>
      <PointerLockOverlay />
      <TourExitButton />
      <Minimap config={museumConfig as MuseumConfig} />
      {isMobile && (
        <MobileControlsOverlay
          onMove={() => {}}
          onLook={() => {}}
        />
      )}
      <KeyboardControls map={keyMap}>
        <Canvas camera={{ fov: 75, near: 0.1, far: 1000 }}>
          <Suspense fallback={null}>
            <Physics>
              <PointerLockCamera />
              <ambientLight intensity={1.2} />
              <hemisphereLight args={['#ffffff', '#444444', 0.8]} />
              <Player spawn={[0, 1, 0]} />
              {(museumConfig as MuseumConfig).rooms.map((room) => (
                <Room key={room.id} config={room} onDoorwayEnter={triggerTransition} />
              ))}
              <GuidedTour
                stops={(museumConfig as MuseumConfig).tourPath}
                onComplete={handleTourComplete}
              />
            </Physics>
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </>
  )
}
