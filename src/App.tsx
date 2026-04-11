import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { Player } from './components/Player'
import { PointerLockCamera, PointerLockOverlay } from './components/PointerLockOverlay'
import { Room } from './components/Room'
import museumConfig from './config/museum.json'
import { MuseumConfig } from './types/museum'
import { useIsMobile } from './hooks/useIsMobile'
import { MobileControlsOverlay } from './components/MobileControls'
import { useRoomTransition } from './hooks/useRoomTransition'
import { Minimap } from './components/Minimap'

enum Controls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
}

export default function App() {
  const isMobile = useIsMobile()
  const { triggerTransition, fadeRef } = useRoomTransition()

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
              <ambientLight intensity={0.5} />
              <Player spawn={[0, 1, 0]} />
              {(museumConfig as MuseumConfig).rooms.map((room) => (
                <Room key={room.id} config={room} onDoorwayEnter={triggerTransition} />
              ))}
            </Physics>
          </Suspense>
        </Canvas>
      </KeyboardControls>
      <div
        ref={fadeRef}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'black',
          opacity: 0,
          pointerEvents: 'none',
          transition: 'opacity 0.5s ease',
          zIndex: 500,
        }}
      />
    </>
  )
}
