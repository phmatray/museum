import { useEffect, useState, type ComponentType } from 'react'
import { PointerLockOverlay, TourExitButton } from './components/PointerLockOverlay'
import { MobileControlsOverlay } from './components/MobileControls'
import { useIsMobile } from './hooks/useIsMobile'
import { Minimap } from './components/Minimap'
import { CarteOeuvre } from './components/CarteOeuvre'
import { BorneOeuvre } from './components/BorneOeuvre'
import { CarteBavette } from './components/CarteBavette'
import { CarteEtape } from './components/CarteEtape'
import { GuidedTour } from './components/GuidedTour'
import { BoutonSon } from './components/BoutonSon'
import { EcranChargement } from './components/EcranChargement'
import { MessagePartage } from './components/Partage'

// La 3D (three, R3F, la scène) est un morceau à part : l'accueil s'affiche sans
// l'attendre. Ses fichiers se téléchargent dès le HTML (`modulepreload`, voir
// vite.config.ts) ; on ne les ÉVALUE qu'une fois l'accueil peint. Montée par un
// effet plutôt que par `lazy` + `Suspense` : React retarde de 300 ms la
// révélation d'un `Suspense` qui a montré son repli, la première image aussi.
function Musee3DPlusTard() {
  const [Musee3D, setMusee3D] = useState<ComponentType | null>(null)
  useEffect(() => {
    let vivant = true
    const image = requestAnimationFrame(() => {
      void import('./Musee3D').then((m) => vivant && setMusee3D(() => m.default))
    })
    return () => {
      vivant = false
      cancelAnimationFrame(image)
    }
  }, [])
  return Musee3D === null ? null : <Musee3D />
}

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
      <CarteEtape />
      <BoutonSon />
      <MessagePartage />
      <Musee3DPlusTard />
      <EcranChargement />
    </>
  )
}
