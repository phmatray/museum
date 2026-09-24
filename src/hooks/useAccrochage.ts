/**
 * L'accrochage courant (#43) : déplacé depuis `src/scene/PlanToiles.tsx`, où il
 * était défini localement et invisible à la minimap et à la visite guidée.
 * `PlanToiles`, `Minimap` et `GuidedTour` partagent désormais ce même fetch.
 */
import { useEffect, useState } from 'react'

import type { Accrochage } from '../plan/hang'
import { parseAccrochage } from '../schema'

export function useAccrochage(): Accrochage | null {
  const [accrochage, setAccrochage] = useState<Accrochage | null>(null)
  useEffect(() => {
    let vivant = true
    fetch(`${import.meta.env.BASE_URL}data/accrochage.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json().then(parseAccrochage)
      })
      .then(
        (charge) => vivant && setAccrochage(charge),
        (erreur: unknown) => console.error('accrochage.json indisponible', erreur),
      )
    return () => {
      vivant = false
    }
  }, [])
  return accrochage
}

/** Le thème que l'accrochage donne à une salle ; `repli` si absent ou pas encore chargé. */
export function themeName(accrochage: Accrochage | null, roomId: string, level: number, repli: string): string {
  return accrochage?.rooms.find((r) => r.id === roomId && r.level === level)?.name ?? repli
}
