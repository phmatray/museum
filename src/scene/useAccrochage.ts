/**
 * `accrochage.json`, chargé une fois pour les couches qui en dérivent (props,
 * cartels). En effet et non par `use()` : un accrochage absent ou en retard ne
 * doit ni masquer les murs derrière le Suspense, ni faire tomber la visite.
 */
import { useEffect, useState } from 'react'

import type { Accrochage } from '../plan/hang'

let promesse: Promise<Accrochage | null> | null = null

function charger(): Promise<Accrochage | null> {
  promesse ??= fetch(`${import.meta.env.BASE_URL}data/accrochage.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<Accrochage>
    })
    .catch((erreur: unknown) => {
      console.error('accrochage.json indisponible', erreur)
      return null
    })
  return promesse
}

export function useAccrochage(): Accrochage | null {
  const [accrochage, setAccrochage] = useState<Accrochage | null>(null)
  useEffect(() => {
    let vivant = true
    void charger().then((a) => vivant && setAccrochage(a))
    return () => {
      vivant = false
    }
  }, [])
  return accrochage
}
