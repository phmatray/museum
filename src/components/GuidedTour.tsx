/**
 * Le cartouche de la visite guidée (#31) : la salle visée et l'avancement.
 * La marche elle-même est conduite par `PlanPlayer` le long de
 * `buildTourItinerary`, par le même `step()` que le clavier.
 */
import { VISITE as STOPS } from '../plan/tour'
import { useGameStore } from '../stores/gameStore'

export function GuidedTour() {
  const tourActive = useGameStore((s) => s.tourActive)
  const etape = useGameStore((s) => s.tourEtape)
  if (!tourActive) return null
  const stop = STOPS[etape]
  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: '1rem', left: '1rem', zIndex: 200, padding: '0.5rem 0.75rem',
        background: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: 4, font: '14px system-ui, sans-serif',
      }}
    >
      Visite guidée · {stop?.name} ({etape + 1}/{STOPS.length})
    </div>
  )
}
