/**
 * Le catalogue des dépôts (`catalogue.json`), indexé par clé. Déplacé depuis
 * `CartelLayer`, pour que le tableau des départs et les toiles s'en servent aussi.
 */
import { useEffect, useState } from 'react'

import type { Artwork, Catalogue } from '../domain/types'
import { cheminReadme, choisirVitrines } from '../plan/vitrines'

let catalogue: Promise<{ oeuvres: Map<string, Artwork>; vitrines: Artwork[] } | null> | null = null

/** Chargé une fois, sous `BASE_URL`. Sans catalogue, `null` : la visite continue sans. */
function charger() {
  catalogue ??= fetch(`${import.meta.env.BASE_URL}data/catalogue.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<Catalogue>
    })
    .then((c) => ({ oeuvres: new Map(c.artworks.map((a) => [a.key, a])), vitrines: choisirVitrines(c.artworks, c.owners) }))
    .catch((erreur: unknown) => {
      console.error('catalogue.json indisponible', erreur)
      return null
    })
  return catalogue
}

export function useCatalogue(): Map<string, Artwork> | null {
  const [oeuvres, setOeuvres] = useState<Map<string, Artwork> | null>(null)
  useEffect(() => {
    let vivant = true
    void charger().then((c) => vivant && setOeuvres(c?.oeuvres ?? null))
    return () => {
      vivant = false
    }
  }, [])
  return oeuvres
}

/** Les trois projets des vitrines de la salle d'honneur (`plan/vitrines.ts`), du mieux classé au moins bien. */
export function useVitrines(): Artwork[] | null {
  const [vitrines, setVitrines] = useState<Artwork[] | null>(null)
  useEffect(() => {
    let vivant = true
    void charger().then((c) => vivant && setVitrines(c?.vitrines ?? null))
    return () => {
      vivant = false
    }
  }, [])
  return vitrines
}

const readmes = new Map<string, Promise<string | null>>()

/** Le README d'un dépôt des vitrines, en markdown ; `null` tant qu'il n'est pas là, ou s'il manque. */
export function useReadme(key: string | null): string | null {
  const [md, setMd] = useState<{ key: string; md: string | null } | null>(null)
  useEffect(() => {
    if (key === null) return
    let vivant = true
    let p = readmes.get(key)
    if (p === undefined) {
      p = fetch(`${import.meta.env.BASE_URL}${cheminReadme(key)}`)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null)
      readmes.set(key, p)
    }
    void p.then((texte) => vivant && setMd({ key, md: texte }))
    return () => {
      vivant = false
    }
  }, [key])
  return md?.key === key ? md.md : null
}
