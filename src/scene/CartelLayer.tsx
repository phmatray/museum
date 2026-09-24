/**
 * Les cartels du plan : un par toile de `accrochage.json`, le texte tiré de
 * `catalogue.json`.
 *
 * Seuls les cartels proches du visiteur sont montés : un cartel est un bloc de
 * texte, donc un appel de dessin, et 116 d'un coup coûteraient plus que tout le
 * bâtiment. Au-delà de six mètres, un texte de 2 cm est illisible de toute façon.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'

import type { Artwork, Catalogue } from '../domain/types'
import { useAccrochage } from '../hooks/useAccrochage'
import { cartelPlacements, cartelTexte, type CartelPlacement } from '../plan/cartels'
import { Cartel } from './Cartel'

const PORTEE = 6
/** Recalcul du voisinage quatre fois par seconde : le visiteur marche à 1,80 m/s. */
const PERIODE = 0.25

export function CartelLayer() {
  const accrochage = useAccrochage()
  const oeuvres = useCatalogue()
  const placements = useMemo(() => (accrochage ? cartelPlacements(accrochage) : []), [accrochage])
  const [proches, setProches] = useState<CartelPlacement[]>([])
  const attente = useRef(0)

  useFrame(({ camera }, delta) => {
    attente.current -= delta
    if (attente.current > 0) return
    attente.current = PERIODE
    const { x, y, z } = camera.position
    const vus = placements.filter((p) => Math.hypot(p.x - x, p.y - y, p.z - z) < PORTEE)
    // Même liste, même état : pas de rendu React quatre fois par seconde pour rien.
    if (vus.length !== proches.length || vus.some((p, i) => p !== proches[i])) setProches(vus)
  })

  if (oeuvres === null) return null
  return (
    <group name="cartels">
      {proches.map((p) => {
        const a = oeuvres.get(p.key)
        return a === undefined ? null : <Cartel key={p.key} placement={p} texte={cartelTexte(a)} />
      })}
    </group>
  )
}

let catalogue: Promise<Map<string, Artwork> | null> | null = null

/** Chargé une fois, sous `BASE_URL`. Sans catalogue, pas de cartels — la visite continue. */
function useCatalogue(): Map<string, Artwork> | null {
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
