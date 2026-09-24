/**
 * Le filtrage de la curation avant accrochage : un dépôt exclu ne doit jamais
 * atteindre `assignRooms`/`hangPlan`, plutôt que d'y arriver sans image
 * (cf. `tools/build-media.ts`, qui applique déjà ce même filtre côté médias).
 */
import { describe, expect, it } from 'vitest'

import { filtrerExclus } from '../curation-filter.ts'
import type { Artwork, Curation } from '../../domain/types.ts'

let compteur = 0

function oeuvre(partiel: Partial<Artwork> = {}): Artwork {
  const nom = partiel.name ?? `repo-${String(compteur++).padStart(3, '0')}`
  return {
    key: `owner/${nom}`,
    owner: 'owner',
    name: nom,
    title: nom,
    description: '',
    url: `https://github.com/owner/${nom}`,
    homepage: null,
    topics: [],
    language: null,
    languages: {},
    stars: 0,
    forks: 0,
    openIssues: 0,
    isFork: false,
    isArchived: false,
    isTemplate: false,
    createdAt: '2024-01-01T00:00:00Z',
    pushedAt: '2024-01-01T00:00:00Z',
    license: null,
    readmeExcerpt: '',
    ...partiel,
  }
}

function curation(excluded: string[]): Curation {
  return { schemaVersion: 1, repos: {}, rooms: {}, excluded }
}

describe('filtrerExclus', () => {
  it('retire les dépôts listés dans curation.excluded', () => {
    const garde = oeuvre({ name: 'garde' })
    const exclu = oeuvre({ name: 'exclu' })
    expect(filtrerExclus([garde, exclu], curation([exclu.key]))).toEqual([garde])
  })

  it('ignore silencieusement une clé exclue sans œuvre correspondante', () => {
    const garde = oeuvre({ name: 'garde' })
    expect(filtrerExclus([garde], curation(['owner/disparu']))).toEqual([garde])
  })

  it('laisse le catalogue intact sans exclusion', () => {
    const artworks = [oeuvre(), oeuvre()]
    expect(filtrerExclus(artworks, curation([]))).toEqual(artworks)
  })
})
