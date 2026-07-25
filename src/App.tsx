import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { KeyboardControls } from '@react-three/drei'
import { Suspense, use, useCallback, useMemo } from 'react'
import { Player } from './components/Player'
import { PointerLockCamera, PointerLockOverlay, TourExitButton } from './components/PointerLockOverlay'
import { GuidedTour } from './components/GuidedTour'
import { MuseumScene } from './scene/MuseumScene'
import { PostProcessing } from './scene/PostProcessing'
import { museumResource, resolveSpawn, voidFloorY } from './io/loadMuseum'
import { useIsMobile } from './hooks/useIsMobile'
import { MobileControlsOverlay } from './components/MobileControls'
import { Minimap } from './components/Minimap'
import { MuseumErrorBoundary } from './components/MuseumErrorBoundary'
import { EditorMount } from './editor/EditorMount'
import { useGameStore } from './stores/gameStore'
import { VisitorTracker } from './hooks/useRoomTransition'

// Objet constant plutôt qu'`enum` : `erasableSyntaxOnly` interdit les enums,
// qui émettent du code au lieu de disparaître au strip des types.
const Controls = {
  forward: 'forward',
  backward: 'backward',
  left: 'left',
  right: 'right',
  hate: 'hate',
} as const

/**
 * Le musée est chargé ICI, au-dessus du `Canvas`.
 *
 * `museum.json` sert à trois consommateurs qui ne vivent pas au même endroit :
 * le bâtiment (dans le canvas), le spawn du joueur (dans le canvas) et le plan
 * (en HTML, à côté). `museumResource()` mémorise la promesse, si bien que ces
 * appels multiples à `use()` partagent une requête et UN SEUL objet `Museum` —
 * ce qui interdit structurellement que le joueur apparaisse dans un bâtiment et
 * que le plan en dessine un autre.
 */
export default function App() {
  return (
    // La frontière ENGLOBE le Suspense, et pas l'inverse : `use()` sur une
    // promesse rejetée relance pendant le rendu de l'enfant, et une frontière
    // placée à l'intérieur ne verrait jamais rien. Sans elle, un `museum.json`
    // que le schéma refuse laisse l'écran de chargement à l'affiche
    // indéfiniment — vécu.
    <MuseumErrorBoundary>
      <Suspense fallback={<ChargementDuMusee />}>
        <Museum />
      </Suspense>
    </MuseumErrorBoundary>
  )
}

function Museum() {
  const publie = use(museumResource())
  const isMobile = useIsMobile()

  // Le musée RÉGÉNÉRÉ par l'éditeur prend la main sur celui du disque. En
  // production le crochet rend toujours `null` et l'expression se réduit à
  // `publie` — c'est la même ligne, sans branche à maintenir en double.
  const museum = useGameStore((s) => s.museumOverride) ?? publie

  const spawn = useMemo(() => resolveSpawn(museum), [museum])
  const voidY = useMemo(() => voidFloorY(museum), [museum])

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
      /*
        La HÂTE, et pourquoi elle est apparue en même temps que la vitesse de
        marche a baissé.

        La vitesse était réglée à 4 m/s, soit 14,4 km/h : celle d'un coureur. À
        cette allure une salle de sept mètres se traverse en moins de deux
        secondes et rien ne se regarde. Elle est passée à 1,80 m/s — un pas
        soutenu — mais traverser un plateau déjà vu deviendrait long : Maj rend
        les 3,80 m/s à qui sait où il va.
      */
      { name: Controls.hate, keys: ['ShiftLeft', 'ShiftRight'] },
    ],
    []
  )

  return (
    <>
      <PointerLockOverlay />
      <TourExitButton />
      <Minimap museum={museum} floorId={museum.spawn.floorId} />
      <EditorMount publie={museum} />
      {isMobile && (
        <MobileControlsOverlay
          onMove={() => {}}
          onLook={() => {}}
        />
      )}
      <KeyboardControls map={keyMap}>
        {/*
          `shadows` est indispensable : la verrière zénithale est la seule ombre
          du bâtiment (spec §9.2, une shadow map), et sans ce drapeau le
          `castShadow` de la lumière directionnelle est ignoré en silence.
          `"percentage"` plutôt que `true` : le défaut de R3F est
          `PCFSoftShadowMap`, que three 0.183 a déprécié et remplace de toute
          façon par `PCFShadowMap` en écrivant un avertissement à chaque
          démarrage. Autant demander directement ce qu'on obtient.
        */}
        <Canvas
          shadows="percentage"
          camera={{ fov: 75, near: 0.1, far: 1000 }}
          gl={{
            /**
             * EN DÉVELOPPEMENT SEULEMENT, et pour une raison précise.
             *
             * Sans ce drapeau, le tampon de dessin d'un canvas WebGL est
             * invalidé dès que la frame est composée : `drawImage(canvas)` et
             * `toDataURL()` rendent alors une image entièrement NOIRE. Ce n'est
             * pas une panne visible — la page s'affiche parfaitement, seule la
             * relecture est vide — et `tools/capture.ts` mesurait donc « 100 %
             * de pixels noirs » sur un musée parfaitement éclairé.
             *
             * Le coût est réel (le tampon ne peut plus être recyclé entre deux
             * images), d'où la restriction au développement : en production
             * personne ne relit le canvas.
             */
            preserveDrawingBuffer: import.meta.env.DEV,
          }}
        >
          <Suspense fallback={null}>
            <Physics>
              <PointerLockCamera />
              <MuseumScene />
              <Player
                spawn={[spawn.position.x, spawn.position.y, spawn.position.z]}
                yaw={spawn.yaw}
                voidY={voidY}
              />
              {/*
                La visite guidée DÉRIVE son itinéraire du bâtiment (lot 3,
                `domain/tour.ts`) : plus rien à saisir à la main, et un dépôt qui
                entre ou sort du catalogue déplace le parcours tout seul.
              */}
              <GuidedTour onComplete={handleTourComplete} />
              {/*
                Le suivi du visiteur alimente le plan et `currentRoomId`. Il vit
                dans le canvas parce qu'il lit la caméra à chaque image ; il ne
                rend rien.
              */}
              <VisitorTracker museum={museum} />
            </Physics>
            {/*
              Le post-traitement (spec §9.4). HORS de `<Physics>` : il ne
              déclare aucun corps rigide, et le groupe R3F que monte le
              composeur n'a rien à faire dans le monde de Rapier.

              Il prend la main sur la boucle de rendu (`useFrame` à priorité 1),
              d'où sa place APRÈS la scène et le joueur : R3F exécute les
              `useFrame` par priorité croissante, si bien que la caméra est déjà
              recalée sur le visiteur quand le composeur rend l'image.

              Il est DANS le `<Suspense>` du canvas parce qu'il lit la scène
              chargée : monté avant elle, son `RenderPass` capturerait un
              bâtiment vide et sa première image serait un fond nu.
            */}
            <PostProcessing />
          </Suspense>
        </Canvas>
      </KeyboardControls>
    </>
  )
}

/**
 * Écran d'attente pendant le chargement de `museum.json`.
 *
 * Un `fallback={null}` afficherait une page blanche : si le fichier manque ou
 * est invalide, `loadMuseum` lève une `SchemaError` détaillée, mais elle ne
 * part que dans la console. Un mot à l'écran vaut mieux que rien.
 */
function ChargementDuMusee() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#0e1116',
        color: 'rgba(255,255,255,0.7)',
        font: '400 0.95rem/1.5 system-ui, sans-serif',
        letterSpacing: '0.04em',
      }}
    >
      Ouverture du musée…
    </div>
  )
}
