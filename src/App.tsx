import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'

enum Controls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
}

export default function App() {
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
    <KeyboardControls map={keyMap}>
      <Canvas camera={{ fov: 75, near: 0.1, far: 1000 }}>
        <Suspense fallback={null}>
          <Physics>
            <ambientLight intensity={0.5} />
            <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[50, 50]} />
              <meshStandardMaterial color="#808080" />
            </mesh>
          </Physics>
        </Suspense>
      </Canvas>
    </KeyboardControls>
  )
}
