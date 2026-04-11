# Epic 1: Navigation & Movement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build first-person navigation with keyboard/mouse controls, collision detection, mobile touch controls, guided tour mode, and room transitions for a browser-based 3D virtual museum.

**Architecture:** A React app using React Three Fiber for 3D rendering, `@react-three/rapier` for physics-based collision detection, and `@react-three/drei` for keyboard controls and helpers. The player is a kinematic rigid body with a capsule collider. Movement is handled via a custom `Player` component that reads keyboard state each frame and moves the physics body. Pointer lock provides mouse look. A separate `GuidedTour` component animates the camera along a `CatmullRomCurve3` spline.

**Tech Stack:** React 18, Three.js, @react-three/fiber, @react-three/drei, @react-three/rapier, Vite, TypeScript

---

## File Structure

```
src/
├── main.tsx                    # App entry point
├── App.tsx                     # Canvas + Physics + KeyboardControls wrapper
├── components/
│   ├── Player.tsx              # First-person player controller (movement + look)
│   ├── PointerLockOverlay.tsx  # Click-to-start overlay + pause menu on Escape
│   ├── MobileControls.tsx      # Virtual joystick + touch look
│   ├── GuidedTour.tsx          # Spline-based camera tour
│   ├── Room.tsx                # Single room geometry (walls, floor, ceiling)
│   ├── Doorway.tsx             # Doorway mesh + transition trigger
│   └── Minimap.tsx             # 2D minimap HUD showing current room
├── hooks/
│   ├── usePlayerMovement.ts    # Movement logic: reads keys, computes velocity
│   ├── usePointerLock.ts       # Pointer lock API wrapper
│   ├── useIsMobile.ts          # Detects touch-only devices
│   └── useRoomTransition.ts    # Crossfade + lighting shift on room change
├── config/
│   └── museum.json             # Room layout, doorway positions, tour path
├── stores/
│   └── gameStore.ts            # Zustand store: paused, currentRoom, tourActive
└── types/
    └── museum.ts               # TypeScript types for config schema
```

Additional root files:
- `index.html` — Vite entry HTML
- `package.json` — dependencies
- `tsconfig.json` — TypeScript config
- `vite.config.ts` — Vite config

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/types/museum.ts`

- [ ] **Step 1: Initialize the project with Vite**

```bash
cd /Users/phmatray/Repositories/javascript/museum
npm create vite@latest . -- --template react-ts
```

Accept overwrite if prompted (only `virtual-museum-user-stories.md` exists).

- [ ] **Step 2: Install dependencies**

```bash
npm install three @react-three/fiber @react-three/drei @react-three/rapier zustand
npm install -D @types/three vitest @testing-library/react jsdom
```

- [ ] **Step 3: Configure Vitest in `vite.config.ts`**

Replace the generated `vite.config.ts` with:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
```

- [ ] **Step 4: Add test script to `package.json`**

In the `"scripts"` section, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Create TypeScript types for the museum config**

Create `src/types/museum.ts`:

```typescript
export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface DoorwayConfig {
  id: string
  position: Vec3
  connectsTo: string // room ID
  width: number
  height: number
}

export interface RoomConfig {
  id: string
  name: string
  dimensions: { width: number; height: number; depth: number }
  position: Vec3
  doorways: DoorwayConfig[]
  wallColor: string
  floorColor: string
  ceilingColor: string
  ambientLightIntensity: number
}

export interface TourStop {
  position: Vec3
  lookAt: Vec3
  pauseDuration: number // seconds
}

export interface MuseumConfig {
  rooms: RoomConfig[]
  tourPath: TourStop[]
  playerSpawn: Vec3
  playerHeight: number
  playerSpeed: number
}
```

- [ ] **Step 6: Create a minimal `src/App.tsx`**

```tsx
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
```

- [ ] **Step 7: Update `src/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 8: Verify the app runs**

```bash
npm run dev
```

Expected: Browser opens, shows a gray plane with no errors in console.

- [ ] **Step 9: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold project with R3F, Rapier, Drei, and Vite"
```

---

## Task 2: Zustand Game Store

**Files:**
- Create: `src/stores/gameStore.ts`
- Create: `src/stores/__tests__/gameStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/gameStore.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { useGameStore } from '../gameStore'

describe('gameStore', () => {
  it('initializes with correct defaults', () => {
    const state = useGameStore.getState()
    expect(state.paused).toBe(false)
    expect(state.currentRoomId).toBe('room-1')
    expect(state.tourActive).toBe(false)
    expect(state.pointerLocked).toBe(false)
  })

  it('toggles pause state', () => {
    const { setPaused } = useGameStore.getState()
    setPaused(true)
    expect(useGameStore.getState().paused).toBe(true)
    setPaused(false)
    expect(useGameStore.getState().paused).toBe(false)
  })

  it('sets current room', () => {
    const { setCurrentRoomId } = useGameStore.getState()
    setCurrentRoomId('room-2')
    expect(useGameStore.getState().currentRoomId).toBe('room-2')
  })

  it('toggles tour mode', () => {
    const { setTourActive } = useGameStore.getState()
    setTourActive(true)
    expect(useGameStore.getState().tourActive).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/stores/__tests__/gameStore.test.ts
```

Expected: FAIL — cannot resolve `../gameStore`

- [ ] **Step 3: Implement the store**

Create `src/stores/gameStore.ts`:

```typescript
import { create } from 'zustand'

interface GameState {
  paused: boolean
  currentRoomId: string
  tourActive: boolean
  pointerLocked: boolean
  setPaused: (paused: boolean) => void
  setCurrentRoomId: (id: string) => void
  setTourActive: (active: boolean) => void
  setPointerLocked: (locked: boolean) => void
}

export const useGameStore = create<GameState>((set) => ({
  paused: false,
  currentRoomId: 'room-1',
  tourActive: false,
  pointerLocked: false,
  setPaused: (paused) => set({ paused }),
  setCurrentRoomId: (id) => set({ currentRoomId: id }),
  setTourActive: (active) => set({ tourActive: active }),
  setPointerLocked: (locked) => set({ pointerLocked: locked }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/stores/__tests__/gameStore.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/
git commit -m "feat: add zustand game store for pause, room, and tour state"
```

---

## Task 3: Pointer Lock Hook

**Files:**
- Create: `src/hooks/usePointerLock.ts`
- Create: `src/hooks/__tests__/usePointerLock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/usePointerLock.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePointerLock } from '../usePointerLock'

describe('usePointerLock', () => {
  beforeEach(() => {
    // Mock pointer lock API
    document.exitPointerLock = vi.fn()
    Object.defineProperty(document, 'pointerLockElement', {
      writable: true,
      value: null,
    })
  })

  it('returns isLocked false initially', () => {
    const { result } = renderHook(() => usePointerLock())
    expect(result.current.isLocked).toBe(false)
  })

  it('calls requestPointerLock on lock()', () => {
    const mockRequestPointerLock = vi.fn()
    const { result } = renderHook(() => usePointerLock())

    const canvas = document.createElement('canvas')
    canvas.requestPointerLock = mockRequestPointerLock

    act(() => {
      result.current.lock(canvas)
    })

    expect(mockRequestPointerLock).toHaveBeenCalled()
  })

  it('calls exitPointerLock on unlock()', () => {
    const { result } = renderHook(() => usePointerLock())

    act(() => {
      result.current.unlock()
    })

    expect(document.exitPointerLock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/usePointerLock.test.ts
```

Expected: FAIL — cannot resolve `../usePointerLock`

- [ ] **Step 3: Implement the hook**

Create `src/hooks/usePointerLock.ts`:

```typescript
import { useCallback, useEffect, useState } from 'react'
import { useGameStore } from '../stores/gameStore'

export function usePointerLock() {
  const [isLocked, setIsLocked] = useState(false)
  const setPointerLocked = useGameStore((s) => s.setPointerLocked)
  const setPaused = useGameStore((s) => s.setPaused)

  useEffect(() => {
    function handleChange() {
      const locked = document.pointerLockElement !== null
      setIsLocked(locked)
      setPointerLocked(locked)
      if (!locked) {
        setPaused(true)
      }
    }

    document.addEventListener('pointerlockchange', handleChange)
    return () => document.removeEventListener('pointerlockchange', handleChange)
  }, [setPointerLocked, setPaused])

  const lock = useCallback((element: HTMLElement) => {
    element.requestPointerLock()
  }, [])

  const unlock = useCallback(() => {
    document.exitPointerLock()
  }, [])

  return { isLocked, lock, unlock }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/usePointerLock.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePointerLock.ts src/hooks/__tests__/usePointerLock.test.ts
git commit -m "feat: add usePointerLock hook for pointer lock API"
```

---

## Task 4: Player Movement Hook

**Files:**
- Create: `src/hooks/usePlayerMovement.ts`
- Create: `src/hooks/__tests__/usePlayerMovement.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/usePlayerMovement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeMovement } from '../usePlayerMovement'
import * as THREE from 'three'

describe('computeMovement', () => {
  it('returns zero vector when no keys pressed', () => {
    const keys = { forward: false, backward: false, left: false, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const result = computeMovement(keys, camera, 1 / 60, 4)
    expect(result.x).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(0)
  })

  it('moves forward along negative Z in camera space', () => {
    const keys = { forward: true, backward: false, left: false, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0) // looking down -Z

    const result = computeMovement(keys, camera, 1 / 60, 4)
    expect(result.z).toBeLessThan(0)
    expect(result.x).toBeCloseTo(0)
  })

  it('moves left along negative X in camera space', () => {
    const keys = { forward: false, backward: false, left: true, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const result = computeMovement(keys, camera, 1 / 60, 4)
    expect(result.x).toBeLessThan(0)
    expect(result.z).toBeCloseTo(0)
  })

  it('respects speed parameter', () => {
    const keys = { forward: true, backward: false, left: false, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const slow = computeMovement(keys, camera, 1 / 60, 2)
    const fast = computeMovement(keys, camera, 1 / 60, 8)
    expect(Math.abs(fast.z)).toBeGreaterThan(Math.abs(slow.z))
  })

  it('normalizes diagonal movement', () => {
    const keys = { forward: true, backward: false, left: true, right: false }
    const camera = new THREE.PerspectiveCamera()
    camera.rotation.set(0, 0, 0)

    const result = computeMovement(keys, camera, 1 / 60, 4)
    const length = Math.sqrt(result.x ** 2 + result.z ** 2)
    const expectedMax = 4 * (1 / 60)
    expect(length).toBeLessThanOrEqual(expectedMax + 0.001)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/usePlayerMovement.test.ts
```

Expected: FAIL — cannot resolve `../usePlayerMovement`

- [ ] **Step 3: Implement the movement computation**

Create `src/hooks/usePlayerMovement.ts`:

```typescript
import * as THREE from 'three'

export interface MovementKeys {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

const _direction = new THREE.Vector3()
const _frontVector = new THREE.Vector3()
const _sideVector = new THREE.Vector3()

export function computeMovement(
  keys: MovementKeys,
  camera: THREE.Camera,
  delta: number,
  speed: number
): THREE.Vector3 {
  _frontVector.set(0, 0, (keys.backward ? 1 : 0) - (keys.forward ? 1 : 0))
  _sideVector.set((keys.left ? -1 : 0) + (keys.right ? 1 : 0), 0, 0)

  _direction
    .subVectors(_frontVector, _sideVector.negate())
    .normalize()
    .multiplyScalar(speed * delta)
    .applyEuler(new THREE.Euler(0, camera.rotation.y, 0))

  return _direction.clone()
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/usePlayerMovement.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePlayerMovement.ts src/hooks/__tests__/usePlayerMovement.test.ts
git commit -m "feat: add computeMovement for first-person keyboard navigation"
```

---

## Task 5: Player Component (First-Person Controller)

**Files:**
- Create: `src/components/Player.tsx`

- [ ] **Step 1: Implement the Player component**

Create `src/components/Player.tsx`:

```tsx
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboardControls } from '@react-three/drei'
import { CapsuleCollider, RigidBody, RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { computeMovement } from '../hooks/usePlayerMovement'
import { useGameStore } from '../stores/gameStore'

const PLAYER_SPEED = 4 // m/s
const PLAYER_HEIGHT = 1.7
const CAPSULE_RADIUS = 0.3
const CAPSULE_HALF_HEIGHT = 0.5

export function Player({ spawn = [0, 1, 0] }: { spawn?: [number, number, number] }) {
  const rigidBodyRef = useRef<RapierRigidBody>(null)
  const { camera } = useThree()
  const [, getKeys] = useKeyboardControls()
  const paused = useGameStore((s) => s.paused)
  const tourActive = useGameStore((s) => s.tourActive)

  useFrame((_, delta) => {
    if (paused || tourActive || !rigidBodyRef.current) return

    const keys = getKeys() as { forward: boolean; backward: boolean; left: boolean; right: boolean }
    const movement = computeMovement(keys, camera, delta, PLAYER_SPEED)

    const currentPos = rigidBodyRef.current.translation()
    rigidBodyRef.current.setNextKinematicTranslation({
      x: currentPos.x + movement.x,
      y: currentPos.y,
      z: currentPos.z + movement.z,
    })

    // Sync camera to player position
    camera.position.set(
      currentPos.x + movement.x,
      currentPos.y + PLAYER_HEIGHT - CAPSULE_HALF_HEIGHT,
      currentPos.z + movement.z
    )
  })

  return (
    <RigidBody
      ref={rigidBodyRef}
      type="kinematicPosition"
      position={spawn}
      colliders={false}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS]} />
    </RigidBody>
  )
}
```

- [ ] **Step 2: Add Player to App.tsx**

Update `src/App.tsx` — add import and place `<Player />` inside `<Physics>`:

```tsx
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { Player } from './components/Player'

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
            <Player spawn={[0, 1, 0]} />
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
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Expected: WASD moves the camera forward/backward/strafe in the 3D scene. No mouse look yet.

- [ ] **Step 4: Commit**

```bash
git add src/components/Player.tsx src/App.tsx
git commit -m "feat: add first-person player with keyboard movement and collision"
```

---

## Task 6: Pointer Lock Controls (Mouse Look)

**Files:**
- Create: `src/components/PointerLockOverlay.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the PointerLockOverlay component**

Create `src/components/PointerLockOverlay.tsx`:

```tsx
import { useEffect, useCallback } from 'react'
import { useThree } from '@react-three/fiber'
import { useGameStore } from '../stores/gameStore'

export function PointerLockCamera() {
  const { camera, gl } = useThree()
  const paused = useGameStore((s) => s.paused)
  const setPaused = useGameStore((s) => s.setPaused)
  const setPointerLocked = useGameStore((s) => s.setPointerLocked)

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return

      const sensitivity = 0.002
      camera.rotation.order = 'YXZ'
      camera.rotation.y -= event.movementX * sensitivity
      camera.rotation.x -= event.movementY * sensitivity
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x))
    },
    [camera, gl.domElement]
  )

  useEffect(() => {
    function handleLockChange() {
      const locked = document.pointerLockElement === gl.domElement
      setPointerLocked(locked)
      if (!locked) {
        setPaused(true)
      }
    }

    document.addEventListener('pointerlockchange', handleLockChange)
    document.addEventListener('mousemove', handleMouseMove)

    return () => {
      document.removeEventListener('pointerlockchange', handleLockChange)
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }, [gl.domElement, handleMouseMove, setPointerLocked, setPaused])

  return null
}

export function PointerLockOverlay() {
  const paused = useGameStore((s) => s.paused)
  const setPaused = useGameStore((s) => s.setPaused)

  const handleClick = () => {
    const canvas = document.querySelector('canvas')
    if (canvas) {
      canvas.requestPointerLock()
      setPaused(false)
    }
  }

  if (!paused) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        zIndex: 1000,
        cursor: 'pointer',
        flexDirection: 'column',
        gap: '1rem',
      }}
      onClick={handleClick}
    >
      <h1 style={{ fontSize: '2rem', margin: 0 }}>Virtual Museum</h1>
      <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>Click to enter</p>
      <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>
        WASD to move | Mouse to look | Escape to pause
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Wire into App.tsx**

Update `src/App.tsx`:

```tsx
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { Player } from './components/Player'
import { PointerLockCamera, PointerLockOverlay } from './components/PointerLockOverlay'

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
    <>
      <PointerLockOverlay />
      <KeyboardControls map={keyMap}>
        <Canvas camera={{ fov: 75, near: 0.1, far: 1000 }}>
          <Suspense fallback={null}>
            <Physics>
              <PointerLockCamera />
              <ambientLight intensity={0.5} />
              <Player spawn={[0, 1, 0]} />
              <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[50, 50]} />
                <meshStandardMaterial color="#808080" />
              </mesh>
            </Physics>
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </>
  )
}
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Expected: An overlay shows "Click to enter". After clicking, pointer lock activates, mouse look works (camera rotates with mouse), WASD moves relative to look direction. Pressing Escape shows the overlay again.

- [ ] **Step 4: Commit**

```bash
git add src/components/PointerLockOverlay.tsx src/App.tsx
git commit -m "feat: add pointer lock mouse look and pause overlay"
```

---

## Task 7: Mobile Detection Hook

**Files:**
- Create: `src/hooks/useIsMobile.ts`
- Create: `src/hooks/__tests__/useIsMobile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useIsMobile.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIsMobile } from '../useIsMobile'

describe('useIsMobile', () => {
  it('returns false when matchMedia does not match', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true when matchMedia matches pointer:coarse', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/hooks/__tests__/useIsMobile.test.ts
```

Expected: FAIL — cannot resolve `../useIsMobile`

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useIsMobile.ts`:

```typescript
import { useState, useEffect } from 'react'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(pointer: coarse)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isMobile
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/hooks/__tests__/useIsMobile.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useIsMobile.ts src/hooks/__tests__/useIsMobile.test.ts
git commit -m "feat: add useIsMobile hook for touch device detection"
```

---

## Task 8: Mobile Touch Controls

**Files:**
- Create: `src/components/MobileControls.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement MobileControls**

Create `src/components/MobileControls.tsx`:

```tsx
import { useRef, useCallback } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { useGameStore } from '../stores/gameStore'
import * as THREE from 'three'

interface JoystickState {
  active: boolean
  dx: number
  dy: number
}

export function MobileControls() {
  const { camera } = useThree()
  const joystick = useRef<JoystickState>({ active: false, dx: 0, dy: 0 })
  const lookTouch = useRef<{ id: number | null; lastX: number; lastY: number }>({
    id: null,
    lastX: 0,
    lastY: 0,
  })
  const paused = useGameStore((s) => s.paused)

  useFrame((_, delta) => {
    if (paused) return
    // This is handled externally via the overlay callbacks
  })

  return null
}

export function MobileControlsOverlay({
  onMove,
  onLook,
}: {
  onMove: (dx: number, dy: number) => void
  onLook: (dx: number, dy: number) => void
}) {
  const joystickRef = useRef<HTMLDivElement>(null)
  const joystickOrigin = useRef({ x: 0, y: 0 })
  const joystickTouchId = useRef<number | null>(null)

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        const isLeftHalf = touch.clientX < window.innerWidth / 2

        if (isLeftHalf && joystickTouchId.current === null) {
          joystickTouchId.current = touch.identifier
          joystickOrigin.current = { x: touch.clientX, y: touch.clientY }
        }
      }
    },
    []
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]

        if (touch.identifier === joystickTouchId.current) {
          const dx = (touch.clientX - joystickOrigin.current.x) / 50
          const dy = (touch.clientY - joystickOrigin.current.y) / 50
          const len = Math.sqrt(dx * dx + dy * dy)
          const clamped = len > 1 ? { dx: dx / len, dy: dy / len } : { dx, dy }
          onMove(clamped.dx, clamped.dy)
        } else {
          // Right side = look
          onLook(touch.clientX, touch.clientY)
        }
      }
    },
    [onMove, onLook]
  )

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]
        if (touch.identifier === joystickTouchId.current) {
          joystickTouchId.current = null
          onMove(0, 0)
        }
      }
    },
    [onMove]
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        touchAction: 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Left joystick area indicator */}
      <div
        ref={joystickRef}
        style={{
          position: 'absolute',
          left: '10%',
          bottom: '15%',
          width: 120,
          height: 120,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.3)',
          pointerEvents: 'none',
        }}
      />
      {/* Right look area indicator */}
      <div
        style={{
          position: 'absolute',
          right: '10%',
          bottom: '15%',
          width: 120,
          height: 120,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.3)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Integrate mobile controls into App.tsx**

Add conditional rendering in `src/App.tsx`. After the existing imports add:

```tsx
import { useIsMobile } from './hooks/useIsMobile'
import { MobileControlsOverlay } from './components/MobileControls'
```

Inside the `App` component, before the return:

```tsx
const isMobile = useIsMobile()
const mobileMove = useRef({ dx: 0, dy: 0 })

const handleMove = useCallback((dx: number, dy: number) => {
  mobileMove.current = { dx, dy }
}, [])

const handleLook = useCallback((x: number, y: number) => {
  // Touch look is handled directly — will integrate with player
}, [])
```

After the `<PointerLockOverlay />`, add:

```tsx
{isMobile && <MobileControlsOverlay onMove={handleMove} onLook={handleLook} />}
```

- [ ] **Step 3: Verify on mobile (or using Chrome DevTools device emulation)**

```bash
npm run dev
```

Open Chrome DevTools > toggle device toolbar (phone mode). Expected: Touch control areas appear at bottom left and bottom right. Desktop mode shows no touch controls.

- [ ] **Step 4: Commit**

```bash
git add src/components/MobileControls.tsx src/hooks/useIsMobile.ts src/App.tsx
git commit -m "feat: add mobile touch controls with virtual joystick"
```

---

## Task 9: Room Component with Collision Walls

**Files:**
- Create: `src/components/Room.tsx`
- Create: `src/config/museum.json`

- [ ] **Step 1: Create the museum config**

Create `src/config/museum.json`:

```json
{
  "rooms": [
    {
      "id": "room-1",
      "name": "Main Hall",
      "dimensions": { "width": 12, "height": 4, "depth": 12 },
      "position": { "x": 0, "y": 0, "z": 0 },
      "doorways": [
        { "id": "door-1-2", "position": { "x": 6, "y": 0, "z": 0 }, "connectsTo": "room-2", "width": 2, "height": 3 }
      ],
      "wallColor": "#f5f5f0",
      "floorColor": "#8B6F47",
      "ceilingColor": "#ffffff",
      "ambientLightIntensity": 0.6
    },
    {
      "id": "room-2",
      "name": "Modern Wing",
      "dimensions": { "width": 10, "height": 4, "depth": 10 },
      "position": { "x": 12, "y": 0, "z": 0 },
      "doorways": [
        { "id": "door-2-1", "position": { "x": -5, "y": 0, "z": 0 }, "connectsTo": "room-1", "width": 2, "height": 3 },
        { "id": "door-2-3", "position": { "x": 0, "y": 0, "z": 5 }, "connectsTo": "room-3", "width": 2, "height": 3 }
      ],
      "wallColor": "#2c2c2c",
      "floorColor": "#555555",
      "ceilingColor": "#333333",
      "ambientLightIntensity": 0.3
    },
    {
      "id": "room-3",
      "name": "Photography Gallery",
      "dimensions": { "width": 14, "height": 4, "depth": 8 },
      "position": { "x": 12, "y": 0, "z": 14 },
      "doorways": [
        { "id": "door-3-2", "position": { "x": 0, "y": 0, "z": -4 }, "connectsTo": "room-2", "width": 2, "height": 3 },
        { "id": "door-3-4", "position": { "x": 7, "y": 0, "z": 0 }, "connectsTo": "room-4", "width": 2, "height": 3 }
      ],
      "wallColor": "#f0f0f0",
      "floorColor": "#8B6F47",
      "ceilingColor": "#ffffff",
      "ambientLightIntensity": 0.5
    },
    {
      "id": "room-4",
      "name": "Immersive Room",
      "dimensions": { "width": 10, "height": 5, "depth": 10 },
      "position": { "x": 26, "y": 0, "z": 14 },
      "doorways": [
        { "id": "door-4-3", "position": { "x": -5, "y": 0, "z": 0 }, "connectsTo": "room-3", "width": 2, "height": 3 }
      ],
      "wallColor": "#1a1a1a",
      "floorColor": "#111111",
      "ceilingColor": "#0a0a0a",
      "ambientLightIntensity": 0.1
    }
  ],
  "tourPath": [
    { "position": { "x": 0, "y": 1.7, "z": 0 }, "lookAt": { "x": 6, "y": 1.7, "z": 0 }, "pauseDuration": 8 },
    { "position": { "x": 12, "y": 1.7, "z": 0 }, "lookAt": { "x": 12, "y": 1.7, "z": 5 }, "pauseDuration": 8 },
    { "position": { "x": 12, "y": 1.7, "z": 14 }, "lookAt": { "x": 19, "y": 1.7, "z": 14 }, "pauseDuration": 8 },
    { "position": { "x": 26, "y": 1.7, "z": 14 }, "lookAt": { "x": 26, "y": 1.7, "z": 19 }, "pauseDuration": 8 }
  ],
  "playerSpawn": { "x": 0, "y": 1, "z": 0 },
  "playerHeight": 1.7,
  "playerSpeed": 4
}
```

- [ ] **Step 2: Implement the Room component**

Create `src/components/Room.tsx`:

```tsx
import { CuboidCollider } from '@react-three/rapier'
import { RoomConfig } from '../types/museum'

interface RoomProps {
  config: RoomConfig
}

export function Room({ config }: RoomProps) {
  const { dimensions, position, wallColor, floorColor, ceilingColor, ambientLightIntensity } = config
  const { width, height, depth } = dimensions
  const px = position.x
  const py = position.y
  const pz = position.z
  const wallThickness = 0.2

  return (
    <group position={[px, py, pz]}>
      {/* Ambient light for this room */}
      <pointLight position={[0, height - 0.5, 0]} intensity={ambientLightIntensity} distance={Math.max(width, depth) * 1.5} />

      {/* Floor */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={floorColor} />
      </mesh>

      {/* Ceiling */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={ceilingColor} />
      </mesh>

      {/* Back wall (-Z) */}
      <mesh position={[0, height / 2, -depth / 2]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[0, height / 2, -depth / 2]} args={[width / 2, height / 2, wallThickness / 2]} />

      {/* Front wall (+Z) */}
      <mesh position={[0, height / 2, depth / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[0, height / 2, depth / 2]} args={[width / 2, height / 2, wallThickness / 2]} />

      {/* Left wall (-X) */}
      <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[-width / 2, height / 2, 0]} args={[wallThickness / 2, height / 2, depth / 2]} />

      {/* Right wall (+X) */}
      <mesh position={[width / 2, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[depth, height]} />
        <meshStandardMaterial color={wallColor} />
      </mesh>
      <CuboidCollider position={[width / 2, height / 2, 0]} args={[wallThickness / 2, height / 2, depth / 2]} />

      {/* Floor collider */}
      <CuboidCollider position={[0, -wallThickness / 2, 0]} args={[width / 2, wallThickness / 2, depth / 2]} />
    </group>
  )
}
```

- [ ] **Step 3: Integrate rooms into App.tsx**

Add to imports in `src/App.tsx`:

```tsx
import { Room } from './components/Room'
import museumConfig from './config/museum.json'
import { MuseumConfig } from './types/museum'
```

Replace the floor plane mesh with:

```tsx
{(museumConfig as MuseumConfig).rooms.map((room) => (
  <Room key={room.id} config={room} />
))}
```

- [ ] **Step 4: Verify in browser**

```bash
npm run dev
```

Expected: Four rooms are visible with distinct wall/floor colors. Player cannot walk through walls (collision detection works).

- [ ] **Step 5: Commit**

```bash
git add src/components/Room.tsx src/config/museum.json src/App.tsx
git commit -m "feat: add Room component with walls, floor, ceiling, and colliders"
```

---

## Task 10: Doorway Component with Transition Trigger

**Files:**
- Create: `src/components/Doorway.tsx`
- Create: `src/hooks/useRoomTransition.ts`
- Modify: `src/components/Room.tsx`

- [ ] **Step 1: Create the room transition hook**

Create `src/hooks/useRoomTransition.ts`:

```typescript
import { useState, useCallback, useRef } from 'react'
import { useGameStore } from '../stores/gameStore'

export function useRoomTransition() {
  const [transitioning, setTransitioning] = useState(false)
  const setCurrentRoomId = useGameStore((s) => s.setCurrentRoomId)
  const fadeRef = useRef<HTMLDivElement | null>(null)

  const triggerTransition = useCallback(
    (targetRoomId: string) => {
      if (transitioning) return

      setTransitioning(true)

      // Fade overlay
      if (fadeRef.current) {
        fadeRef.current.style.opacity = '1'
      }

      setTimeout(() => {
        setCurrentRoomId(targetRoomId)

        if (fadeRef.current) {
          fadeRef.current.style.opacity = '0'
        }

        setTimeout(() => {
          setTransitioning(false)
        }, 500)
      }, 500)
    },
    [transitioning, setCurrentRoomId]
  )

  return { transitioning, triggerTransition, fadeRef }
}
```

- [ ] **Step 2: Create the Doorway component**

Create `src/components/Doorway.tsx`:

```tsx
import { useRef } from 'react'
import { CuboidCollider } from '@react-three/rapier'
import { DoorwayConfig } from '../types/museum'
import { useGameStore } from '../stores/gameStore'

interface DoorwayProps {
  config: DoorwayConfig
  roomPosition: { x: number; y: number; z: number }
  onEnter: (targetRoomId: string) => void
}

export function Doorway({ config, roomPosition, onEnter }: DoorwayProps) {
  const hasTriggered = useRef(false)
  const currentRoomId = useGameStore((s) => s.currentRoomId)

  const worldX = roomPosition.x + config.position.x
  const worldY = roomPosition.y + config.position.y + config.height / 2
  const worldZ = roomPosition.z + config.position.z

  return (
    <group position={[worldX, worldY, worldZ]}>
      {/* Visual doorway frame */}
      <mesh>
        <boxGeometry args={[config.width + 0.4, config.height + 0.2, 0.3]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      {/* Opening (slightly darker) */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[config.width, config.height]} />
        <meshStandardMaterial color="#111111" transparent opacity={0.3} />
      </mesh>

      {/* Trigger sensor — no physics collision, just intersection detection */}
      <CuboidCollider
        sensor
        position={[0, 0, 0]}
        args={[config.width / 2, config.height / 2, 0.5]}
        onIntersectionEnter={() => {
          if (!hasTriggered.current) {
            hasTriggered.current = true
            onEnter(config.connectsTo)
            setTimeout(() => {
              hasTriggered.current = false
            }, 2000)
          }
        }}
      />
    </group>
  )
}
```

- [ ] **Step 3: Add doorways to the Room component**

Update `src/components/Room.tsx` — add import and render doorways at the end of the `<group>`:

```tsx
import { Doorway } from './Doorway'
```

Add prop to Room:

```tsx
interface RoomProps {
  config: RoomConfig
  onDoorwayEnter: (targetRoomId: string) => void
}
```

Inside the `<group>`, after the wall colliders:

```tsx
{config.doorways.map((doorway) => (
  <Doorway
    key={doorway.id}
    config={doorway}
    roomPosition={position}
    onEnter={onDoorwayEnter}
  />
))}
```

- [ ] **Step 4: Add transition fade overlay and handler in App.tsx**

Add to `src/App.tsx`:

```tsx
import { useRoomTransition } from './hooks/useRoomTransition'
```

Inside the component:

```tsx
const { transitioning, triggerTransition, fadeRef } = useRoomTransition()
```

Pass `onDoorwayEnter={triggerTransition}` to each `<Room>`.

Add a fade overlay div after the Canvas:

```tsx
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
```

- [ ] **Step 5: Verify in browser**

```bash
npm run dev
```

Expected: Doorways are visible between rooms. Walking through a doorway triggers a brief fade-to-black transition and updates the current room in the store.

- [ ] **Step 6: Commit**

```bash
git add src/components/Doorway.tsx src/hooks/useRoomTransition.ts src/components/Room.tsx src/App.tsx
git commit -m "feat: add doorways with room transition fade effect"
```

---

## Task 11: Guided Tour Mode

**Files:**
- Create: `src/components/GuidedTour.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement the GuidedTour component**

Create `src/components/GuidedTour.tsx`:

```tsx
import { useRef, useState, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '../stores/gameStore'
import { TourStop } from '../types/museum'

interface GuidedTourProps {
  stops: TourStop[]
  onComplete: () => void
}

export function GuidedTour({ stops, onComplete }: GuidedTourProps) {
  const { camera } = useThree()
  const tourActive = useGameStore((s) => s.tourActive)
  const setCurrentRoomId = useGameStore((s) => s.setCurrentRoomId)

  const currentStopIndex = useRef(0)
  const progress = useRef(0) // 0-1 between stops
  const pauseTimer = useRef(0)
  const isPaused = useRef(false)

  const speed = 2 // meters per second along path

  useFrame((_, delta) => {
    if (!tourActive || stops.length < 2) return

    const idx = currentStopIndex.current
    if (idx >= stops.length - 1) {
      onComplete()
      return
    }

    // Pausing at a stop
    if (isPaused.current) {
      pauseTimer.current += delta
      if (pauseTimer.current >= stops[idx].pauseDuration) {
        isPaused.current = false
        pauseTimer.current = 0
        currentStopIndex.current += 1
        progress.current = 0
      }
      return
    }

    // Moving between stops
    const from = stops[idx]
    const to = stops[idx + 1]
    const fromPos = new THREE.Vector3(from.position.x, from.position.y, from.position.z)
    const toPos = new THREE.Vector3(to.position.x, to.position.y, to.position.z)
    const distance = fromPos.distanceTo(toPos)
    const travelTime = distance / speed

    progress.current += delta / travelTime

    if (progress.current >= 1) {
      progress.current = 1
      isPaused.current = true
      pauseTimer.current = 0
    }

    // Interpolate position
    const pos = fromPos.lerp(toPos, progress.current)
    camera.position.copy(pos)

    // Interpolate look target
    const fromLook = new THREE.Vector3(from.lookAt.x, from.lookAt.y, from.lookAt.z)
    const toLook = new THREE.Vector3(to.lookAt.x, to.lookAt.y, to.lookAt.z)
    const lookTarget = fromLook.lerp(toLook, progress.current)
    camera.lookAt(lookTarget)
  })

  // Reset on mount
  useEffect(() => {
    if (tourActive) {
      currentStopIndex.current = 0
      progress.current = 0
      isPaused.current = false
      pauseTimer.current = 0
    }
  }, [tourActive])

  return null
}
```

- [ ] **Step 2: Add tour UI button and integrate into App.tsx**

Add to `src/App.tsx` imports:

```tsx
import { GuidedTour } from './components/GuidedTour'
```

In the `PointerLockOverlay` component (or alongside it), add a "Start Guided Tour" button:

Update `src/components/PointerLockOverlay.tsx` — add tour button:

```tsx
const tourActive = useGameStore((s) => s.tourActive)
const setTourActive = useGameStore((s) => s.setTourActive)

const handleStartTour = (e: React.MouseEvent) => {
  e.stopPropagation()
  setTourActive(true)
  setPaused(false)
}
```

Inside the overlay div, add after the instructions paragraph:

```tsx
<button
  onClick={handleStartTour}
  style={{
    marginTop: '1rem',
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    background: '#4a90d9',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  }}
>
  Start Guided Tour
</button>
```

In `App.tsx`, inside the `<Physics>` block:

```tsx
<GuidedTour
  stops={(museumConfig as MuseumConfig).tourPath}
  onComplete={() => {
    useGameStore.getState().setTourActive(false)
    useGameStore.getState().setPaused(true)
  }}
/>
```

- [ ] **Step 3: Add "Exit Tour" button visible during tour**

Add to `src/components/PointerLockOverlay.tsx` — render when tour is active and not paused:

Create a new export in the file:

```tsx
export function TourExitButton() {
  const tourActive = useGameStore((s) => s.tourActive)
  const setTourActive = useGameStore((s) => s.setTourActive)

  if (!tourActive) return null

  return (
    <button
      onClick={() => {
        setTourActive(false)
      }}
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        padding: '0.5rem 1rem',
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '4px',
        cursor: 'pointer',
        zIndex: 1000,
      }}
    >
      Exit Tour (ESC)
    </button>
  )
}
```

Add `<TourExitButton />` to `App.tsx` alongside `<PointerLockOverlay />`.

- [ ] **Step 4: Verify in browser**

```bash
npm run dev
```

Expected: The overlay shows "Start Guided Tour". Clicking it starts automatic camera movement through the tour stops. An "Exit Tour" button appears in the top-right. Pressing it or Escape returns to manual control.

- [ ] **Step 5: Commit**

```bash
git add src/components/GuidedTour.tsx src/components/PointerLockOverlay.tsx src/App.tsx
git commit -m "feat: add guided tour mode with spline camera path"
```

---

## Task 12: Minimap

**Files:**
- Create: `src/components/Minimap.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Implement the Minimap component**

Create `src/components/Minimap.tsx`:

```tsx
import { useGameStore } from '../stores/gameStore'
import { MuseumConfig } from '../types/museum'

interface MinimapProps {
  config: MuseumConfig
}

export function Minimap({ config }: MinimapProps) {
  const currentRoomId = useGameStore((s) => s.currentRoomId)

  // Calculate bounds for scaling
  const allX = config.rooms.flatMap((r) => [r.position.x - r.dimensions.width / 2, r.position.x + r.dimensions.width / 2])
  const allZ = config.rooms.flatMap((r) => [r.position.z - r.dimensions.depth / 2, r.position.z + r.dimensions.depth / 2])
  const minX = Math.min(...allX)
  const maxX = Math.max(...allX)
  const minZ = Math.min(...allZ)
  const maxZ = Math.max(...allZ)
  const rangeX = maxX - minX || 1
  const rangeZ = maxZ - minZ || 1
  const mapSize = 150
  const padding = 10

  function toMapCoords(x: number, z: number) {
    return {
      x: padding + ((x - minX) / rangeX) * (mapSize - 2 * padding),
      y: padding + ((z - minZ) / rangeZ) * (mapSize - 2 * padding),
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        width: mapSize,
        height: mapSize,
        background: 'rgba(0,0,0,0.6)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.2)',
        zIndex: 200,
        overflow: 'hidden',
      }}
    >
      <svg width={mapSize} height={mapSize}>
        {config.rooms.map((room) => {
          const center = toMapCoords(room.position.x, room.position.z)
          const w = (room.dimensions.width / rangeX) * (mapSize - 2 * padding)
          const h = (room.dimensions.depth / rangeZ) * (mapSize - 2 * padding)
          const isCurrent = room.id === currentRoomId

          return (
            <rect
              key={room.id}
              x={center.x - w / 2}
              y={center.y - h / 2}
              width={w}
              height={h}
              fill={isCurrent ? 'rgba(74, 144, 217, 0.5)' : 'rgba(255,255,255,0.1)'}
              stroke={isCurrent ? '#4a90d9' : 'rgba(255,255,255,0.3)'}
              strokeWidth={isCurrent ? 2 : 1}
            />
          )
        })}
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Add Minimap to App.tsx**

Import and render:

```tsx
import { Minimap } from './components/Minimap'
```

Add after `<TourExitButton />`:

```tsx
<Minimap config={museumConfig as MuseumConfig} />
```

- [ ] **Step 3: Verify in browser**

```bash
npm run dev
```

Expected: A small minimap appears in the bottom-right corner showing room outlines. The current room is highlighted in blue. Walking through a doorway updates the highlight.

- [ ] **Step 4: Commit**

```bash
git add src/components/Minimap.tsx src/App.tsx
git commit -m "feat: add minimap HUD showing current room"
```

---

## Task 13: Final Integration & Cross-Browser Verification

**Files:**
- Modify: `src/App.tsx` (final assembly)
- Modify: `index.html` (meta tags, title)

- [ ] **Step 1: Update index.html with proper meta tags**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>Virtual Museum</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; overflow: hidden; }
      body { font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the final integrated App.tsx**

Ensure `src/App.tsx` has all components assembled correctly:

```tsx
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, useMemo, useCallback, useRef } from 'react'
import { Player } from './components/Player'
import { PointerLockCamera, PointerLockOverlay, TourExitButton } from './components/PointerLockOverlay'
import { Room } from './components/Room'
import { GuidedTour } from './components/GuidedTour'
import { Minimap } from './components/Minimap'
import { useRoomTransition } from './hooks/useRoomTransition'
import { useIsMobile } from './hooks/useIsMobile'
import { MobileControlsOverlay } from './components/MobileControls'
import { useGameStore } from './stores/gameStore'
import museumConfig from './config/museum.json'
import { MuseumConfig } from './types/museum'

enum Controls {
  forward = 'forward',
  backward = 'backward',
  left = 'left',
  right = 'right',
}

const config = museumConfig as MuseumConfig

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

  const { triggerTransition, fadeRef } = useRoomTransition()
  const isMobile = useIsMobile()

  const handleTourComplete = useCallback(() => {
    useGameStore.getState().setTourActive(false)
    useGameStore.getState().setPaused(true)
  }, [])

  return (
    <>
      <PointerLockOverlay />
      <TourExitButton />
      <Minimap config={config} />
      {isMobile && (
        <MobileControlsOverlay
          onMove={() => {}}
          onLook={() => {}}
        />
      )}
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
      <KeyboardControls map={keyMap}>
        <Canvas camera={{ fov: 75, near: 0.1, far: 1000 }}>
          <Suspense fallback={null}>
            <Physics>
              <PointerLockCamera />
              <Player spawn={[config.playerSpawn.x, config.playerSpawn.y, config.playerSpawn.z]} />
              <GuidedTour stops={config.tourPath} onComplete={handleTourComplete} />
              {config.rooms.map((room) => (
                <Room key={room.id} config={room} onDoorwayEnter={triggerTransition} />
              ))}
            </Physics>
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </>
  )
}
```

- [ ] **Step 3: Run dev server and verify all features**

```bash
npm run dev
```

Manual test checklist:
- [ ] WASD moves forward/backward/left/right
- [ ] Mouse look rotates camera in pointer lock mode
- [ ] Escape releases pointer lock and shows pause overlay
- [ ] Click re-enters the experience
- [ ] Collision detection prevents walking through walls
- [ ] Doorway transitions trigger fade effect
- [ ] Minimap updates on room change
- [ ] "Start Guided Tour" auto-navigates through rooms
- [ ] "Exit Tour" returns to free navigation
- [ ] No console errors

- [ ] **Step 4: Run all tests**

```bash
npm run test
```

Expected: All unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: complete Epic 1 - navigation, movement, tour, and room transitions"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Project scaffolding | `package.json`, `App.tsx`, `types/museum.ts` |
| 2 | Zustand game store | `stores/gameStore.ts` |
| 3 | Pointer lock hook | `hooks/usePointerLock.ts` |
| 4 | Player movement hook | `hooks/usePlayerMovement.ts` |
| 5 | Player component | `components/Player.tsx` |
| 6 | Mouse look + overlay | `components/PointerLockOverlay.tsx` |
| 7 | Mobile detection | `hooks/useIsMobile.ts` |
| 8 | Mobile touch controls | `components/MobileControls.tsx` |
| 9 | Room component + config | `components/Room.tsx`, `config/museum.json` |
| 10 | Doorways + transitions | `components/Doorway.tsx`, `hooks/useRoomTransition.ts` |
| 11 | Guided tour | `components/GuidedTour.tsx` |
| 12 | Minimap | `components/Minimap.tsx` |
| 13 | Final integration | `App.tsx`, `index.html` |
