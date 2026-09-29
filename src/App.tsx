import { Suspense, lazy } from 'react'
import { PointerLockOverlay, TourExitButton } from './components/PointerLockOverlay'
import { MobileControlsOverlay } from './components/MobileControls'
import { useIsMobile } from './hooks/useIsMobile'
import { Minimap } from './components/Minimap'
import { CarteOeuvre } from './components/CarteOeuvre'
import { BorneOeuvre } from './components/BorneOeuvre'
import { CarteBavette } from './components/CarteBavette'
import { GuidedTour } from './components/GuidedTour'
import { BoutonSon } from './components/BoutonSon'

// La 3D (three, R3F, la scène) est un morceau à part : l'accueil s'affiche sans l'attendre.
const Musee3D = lazy(() => import('./Musee3D'))

/**
 * Le musée publié est le bâtiment du plan (#17), sans Rapier : `plan/walk.ts`
 * fait les collisions, et le visiteur apparaît au sud du hall. Le `Canvas` et
 * les commandes vivent dans `Musee3D`.
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
      <CarteOeuvre />
      <BorneOeuvre />
      <CarteBavette />
      <BoutonSon />
      <Suspense fallback={null}>
        <Musee3D />
      </Suspense>
    </>
  )
}
