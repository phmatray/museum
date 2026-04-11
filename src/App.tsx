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

enum Controls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
}

export default function App() {
  const isMobile = useIsMobile()

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
                <Room key={room.id} config={room} onDoorwayEnter={() => {}} />
              ))}
            </Physics>
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </>
  )
}
