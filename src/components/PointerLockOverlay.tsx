import React, { useEffect } from 'react'
import config from '../../museum.config.json'
import { useGameStore } from '../stores/gameStore'

export function PointerLockOverlay() {
  const paused = useGameStore((s) => s.paused)
  const setPaused = useGameStore((s) => s.setPaused)
  const setTourActive = useGameStore((s) => s.setTourActive)
  // Venu par un lien vers une toile (`?p=`) : on le lui dit, ou on s'excuse.
  const rdv = useGameStore((s) => s.rendezVous)

  const handleClick = () => {
    const canvas = document.querySelector('canvas')
    if (canvas) {
      // Absent sur iPhone, refusé ailleurs au toucher : la visite doit démarrer quand même (#31).
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => {})
      setPaused(false)
    }
  }

  const handleStartTour = (e: React.MouseEvent) => {
    e.stopPropagation()
    setTourActive(true)
    setPaused(false)
  }

  if (!paused) return null

  return (
    <div
      // Repère stable pour un navigateur piloté, qui doit escamoter cet écran
      // avant de mesurer la luminance de la scène — il couvre tout le cadre.
      // Le retirer par un clic est impossible en headless : le clic demande le
      // verrouillage du pointeur, que Chrome refuse hors interaction réelle.
      data-museum-overlay="accueil"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Dégradé plutôt qu'un voile uniforme : à 0,7 d'opacité sur toute la
        // surface, la PREMIÈRE image du musée était assombrie de 70 % avant même
        // que la 3D n'entre en jeu — la moitié de l'impression « trop sombre »
        // venait de là. Le dégradé ne charge que la bande centrale, là où le
        // texte a besoin de contraste, et laisse voir le bâtiment autour.
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.06) 100%)',
        color: 'white',
        zIndex: 1000,
        cursor: 'pointer',
        flexDirection: 'column',
        gap: '1rem',
      }}
      onClick={handleClick}
    >
      <h1 style={{ fontSize: '2rem', margin: 0, fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 400, letterSpacing: '0.06em' }}>{config.name}</h1>
      {rdv?.cle && (
        <p style={{ fontSize: '1.35rem', margin: 0, fontFamily: "Georgia, 'Times New Roman', serif" }}>
          Vous êtes attendu devant <strong style={{ color: '#e0b060', fontWeight: 400 }}>{rdv.cle.slice(rdv.cle.indexOf('/') + 1)}</strong>
        </p>
      )}
      {rdv && rdv.cle === null && (
        <p style={{ fontSize: '1rem', margin: 0, opacity: 0.85, maxWidth: '36rem', textAlign: 'center', textWrap: 'balance', padding: '0 1rem' }}>
          « {rdv.demande} » n’est pas exposé ici — la visite commence à l’entrée.
        </p>
      )}
      <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>Cliquer pour entrer</p>
      <p style={{ fontSize: '0.9rem', opacity: 0.6 }}>
        ZQSD (WASD) ou flèches pour marcher · Espace pour sauter · souris pour regarder · Échap pour la pause
      </p>
      <button
        onClick={handleStartTour}
        style={{
          marginTop: '1rem',
          padding: '0.75rem 1.5rem',
          fontSize: '1rem',
          background: '#d1a54a',
          color: '#1c2530',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Visite guidée
      </button>
    </div>
  )
}

export function TourExitButton() {
  const tourActive = useGameStore((s) => s.tourActive)
  const setTourActive = useGameStore((s) => s.setTourActive)
  const setPaused = useGameStore((s) => s.setPaused)

  // ESC key exits the tour. We need a separate keydown listener because
  // pointer lock isn't engaged during the tour, so the pointerlockchange
  // handler never fires.
  useEffect(() => {
    if (!tourActive) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setTourActive(false)
        setPaused(true)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [tourActive, setTourActive, setPaused])

  if (!tourActive) return null

  return (
    <button
      onClick={() => {
        setTourActive(false)
        setPaused(true)
      }}
      style={{
        position: 'fixed',
        top: '1rem',
        right: '1rem',
        padding: '0.5rem 1rem',
        // Dégradé plutôt qu'un voile uniforme : à 0,7 d'opacité sur toute la
        // surface, la PREMIÈRE image du musée était assombrie de 70 % avant même
        // que la 3D n'entre en jeu — la moitié de l'impression « trop sombre »
        // venait de là. Le dégradé ne charge que la bande centrale, là où le
        // texte a besoin de contraste, et laisse voir le bâtiment autour.
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.06) 100%)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '4px',
        cursor: 'pointer',
        zIndex: 1000,
      }}
    >
      Quitter la visite (Échap)
    </button>
  )
}
