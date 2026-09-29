/**
 * Le catalogue des dépôts (`catalogue.json`), indexé par clé. Déplacé depuis
 * `CartelLayer`, pour que le tableau des départs et les toiles s'en servent aussi.
 */
import { useEffect, useState } from 'react'

import type { IndexCaptures } from '../domain/captures'
import type { Artwork, Catalogue } from '../domain/types'
import { cheminReadme, choisirVitrines } from '../plan/vitrines'
import { suivre } from '../stores/chargementStore'

let catalogue: Promise<{ oeuvres: Map<string, Artwork>; vitrines: Artwork[] } | null> | null = null

/** Chargé une fois, sous `BASE_URL`. Sans catalogue, `null` : la visite continue sans. */
function charger() {
  catalogue ??= suivre(fetch(`${import.meta.env.BASE_URL}data/catalogue.json`))
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

let captures: Promise<IndexCaptures> | null = null

/**
 * L'URL de la capture d'un dépôt (site ou README, `tools/build-captures.ts`),
 * `null` s'il n'en a pas — ou tant que l'index n'est pas arrivé. Sans index
 * (build sans captures), jamais d'erreur : les cartes restent sans image.
 */
export function useCapture(key: string | null): string | null {
  const [index, setIndex] = useState<IndexCaptures | null>(null)
  useEffect(() => {
    let vivant = true
    captures ??= fetch(`${import.meta.env.BASE_URL}media/captures.json`)
      .then((r) => (r.ok ? (r.json() as Promise<IndexCaptures>) : {}))
      .catch(() => ({}))
    void captures.then((i) => vivant && setIndex(i))
    return () => {
      vivant = false
    }
  }, [])
  const file = key === null ? undefined : index?.[key]?.file
  return file ? `${import.meta.env.BASE_URL}media/${file}` : null
}
