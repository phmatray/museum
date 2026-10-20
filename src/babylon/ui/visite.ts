/**
 * Le cartouche de la visite guidée (GuidedTour.tsx) : la salle visée et
 * l'avancement. La marche est conduite par visiteur.ts le long de VISITE, qui
 * publie `partie.tourEtape` ; le bouton « Quitter la visite » vit dans accueil.ts.
 */
import type { Accrochage } from '../../plan/hang.ts'
import { VISITE } from '../../plan/tour.ts'
import { partie } from '../etat.ts'
import { el, observer, themeName } from './dom.ts'
import './visite.css'

export function monterVisite(racine: HTMLElement, accrochage: Accrochage | null): void {
  const cartouche = el('div', { role: 'status', class: 'visite-cartouche', hidden: true })
  racine.append(cartouche)
  observer(partie, (s) => [s.tourActive, s.tourEtape] as const, ([actif, etape]) => {
    cartouche.hidden = !actif
    if (!actif) return
    const stop = VISITE[etape]
    cartouche.textContent = `Visite guidée · ${stop ? themeName(accrochage, stop.roomId, stop.level, stop.name) : ''} (${etape + 1}/${VISITE.length})`
  })
}
