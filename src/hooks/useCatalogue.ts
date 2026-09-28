/**
 * Le catalogue des dépôts (`catalogue.json`), indexé par clé. Déplacé depuis
 * `CartelLayer`, pour que le tableau des départs et les toiles s'en servent aussi.
 */
import { useEffect, useState } from 'react'

import type { Artwork, Catalogue } from '../domain/types'

let catalogue: Promise<Map<string, Artwork> | null> | null = null

/** Chargé une fois, sous `BASE_URL`. Sans catalogue, `null` : la visite continue sans. */
export function useCatalogue(): Map<string, Artwork> | null {
  const [oeuvres, setOeuvres] = useState<Map<string, Artwork> | null>(null)
  useEffect(() => {
    let vivant = true
    catalogue ??= fetch(`${import.meta.env.BASE_URL}data/catalogue.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Catalogue>
      })
      .then((c) => new Map(c.artworks.map((a) => [a.key, a])))
      .catch((erreur: unknown) => {
        console.error('catalogue.json indisponible', erreur)
        return null
      })
    void catalogue.then((c) => vivant && setOeuvres(c))
    return () => {
      vivant = false
    }
  }, [])
  return oeuvres
}
