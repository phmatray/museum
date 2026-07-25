import { describe, it, expect } from 'vitest'
// Les vraies données, importées telles qu'elles sont commitées : ce test
// échoue le jour où le générateur produit un fichier que le schéma refuse.
import catalogueReel from '../../../public/data/catalogue.json'
import configReel from '../../../museum.config.json'
import {
  EMPTY_CURATION,
  SchemaError,
  atlasIndexSchema,
  catalogueSchema,
  curationSchema,
  museumConfigSchema,
  parseAtlasIndex,
  parseCatalogue,
  parseCuration,
  parseMuseumConfig,
} from '../index'

/** Le message d'une erreur levée, ou '' si rien n'a été levé. */
function messageDe(action: () => unknown): string {
  try {
    action()
  } catch (erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur)
  }
  return ''
}

// Catalogue minimal valide, pour dériver des cas fautifs sans répéter 20 champs.
function artworkValide(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'phmatray/museum',
    owner: 'phmatray',
    name: 'museum',
    title: 'museum',
    description: 'un musée',
    url: 'https://github.com/phmatray/museum',
    homepage: null,
    topics: ['threejs'],
    language: 'TypeScript',
    languages: { TypeScript: 1200 },
    stars: 3,
    forks: 0,
    openIssues: 1,
    isFork: false,
    isArchived: false,
    isTemplate: false,
    createdAt: '2026-01-02T03:04:05Z',
    pushedAt: '2026-07-25T13:04:23Z',
    license: 'MIT',
    readmeExcerpt: '# museum',
    ...surcharge,
  }
}

function catalogueValide(artworks: unknown[] = [artworkValide()]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-25T13:29:21.005Z',
    owners: ['phmatray'],
    artworks,
  }
}

function atlasValide(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    tileWidth: 256,
    tileHeight: 128,
    cols: 16,
    rows: 16,
    atlases: ['media/atlas-0.webp'],
    entries: { 'phmatray/museum': { atlas: 0, layer: 3 } },
    ...surcharge,
  }
}

describe('données réelles', () => {
  it('accepte public/data/catalogue.json tel qu’il est généré', () => {
    const catalogue = parseCatalogue(catalogueReel)

    expect(catalogue.schemaVersion).toBe(1)
    expect(catalogue.artworks).toHaveLength(catalogueReel.artworks.length)
    expect(catalogue.artworks.length).toBeGreaterThan(100)
    expect(catalogue.owners).toContain('phmatray')
    // La clé est l'identifiant qui traverse un refetch : elle doit survivre au parse.
    expect(catalogue.artworks.every((a) => a.key === `${a.owner}/${a.name}`)).toBe(true)
  })

  it('accepte museum.config.json tel qu’il est commité', () => {
    const config = parseMuseumConfig(configReel)

    expect(config.name).toBe('Atypical Museum')
    expect(config.owners).toEqual(['phmatray', 'Atypical-Consulting'])
    expect(config.filters.excludeForks).toBe(true)
    expect(config.building.roomDepth).toBe(9)
    expect(config.clustering.maxClusterSize).toBe(14)
  })

  it('parse deux fois le catalogue réel à l’identique — aucune source de non-déterminisme', () => {
    expect(JSON.stringify(parseCatalogue(catalogueReel))).toBe(
      JSON.stringify(parseCatalogue(catalogueReel)),
    )
  })
})

describe('parseMuseumConfig — valeurs par défaut', () => {
  it('complète un config minimal avec tous les défauts de la section 4.3', () => {
    const config = parseMuseumConfig({ owners: ['phmatray'] })

    expect(config).toEqual({
      schemaVersion: 1,
      name: 'Musée GitHub',
      owners: ['phmatray'],
      filters: { excludeForks: true, excludeArchived: false },
      building: {
        roomDepth: 9,
        ceilingHeight: 4.3,
        slabThickness: 0.4,
        minAtriumSize: 12,
        minRoomWidth: 6,
        roomsPerFloor: 6,
      },
      clustering: { minClusterSize: 4, maxClusterSize: 14 },
    })
  })

  it('n’écrase jamais une valeur fournie', () => {
    const config = parseMuseumConfig({
      owners: ['x'],
      name: 'Autre',
      filters: { excludeForks: false, minStars: 10 },
      building: { roomsPerFloor: 4 },
      clustering: { minClusterSize: 2, maxClusterSize: 5 },
    })

    expect(config.name).toBe('Autre')
    expect(config.filters.excludeForks).toBe(false)
    expect(config.filters.minStars).toBe(10)
    // Les champs voisins non fournis gardent leur défaut.
    expect(config.filters.excludeArchived).toBe(false)
    expect(config.building.roomsPerFloor).toBe(4)
    expect(config.building.roomDepth).toBe(9)
    expect(config.clustering.maxClusterSize).toBe(5)
  })

  it('les filtres facultatifs restent absents plutôt que vides', () => {
    const config = parseMuseumConfig({ owners: ['x'] })
    expect(config.filters.minStars).toBeUndefined()
    expect(config.filters.requireTopics).toBeUndefined()
    expect(config.filters.excludePatterns).toBeUndefined()
  })
})

describe('EMPTY_CURATION', () => {
  it('est une curation valide — cas où curation.json n’existe pas', () => {
    expect(curationSchema.safeParse(EMPTY_CURATION).success).toBe(true)
    expect(parseCuration(EMPTY_CURATION)).toEqual({
      schemaVersion: 1,
      repos: {},
      rooms: {},
      excluded: [],
    })
  })

  it('est gelée : une mutation accidentelle ne contamine pas l’appelant suivant', () => {
    expect(Object.isFrozen(EMPTY_CURATION)).toBe(true)
    expect(Object.isFrozen(EMPTY_CURATION.repos)).toBe(true)
    expect(Object.isFrozen(EMPTY_CURATION.excluded)).toBe(true)
  })

  it('un objet vide donne le même résultat que EMPTY_CURATION', () => {
    expect(parseCuration({})).toEqual(EMPTY_CURATION)
  })
})

describe('parseCuration', () => {
  it('accepte une curation complète', () => {
    const curation = parseCuration({
      schemaVersion: 1,
      repos: {
        'phmatray/museum': {
          featured: true,
          room: 'Trois D',
          placement: { wallId: 'r1-inner', u: 3.2, scale: 1.5 },
        },
      },
      rooms: { 'Trois D': { name: 'Salle 3D', theme: 'immersive', order: 1 } },
      excluded: ['phmatray/vieux-truc'],
    })

    expect(curation.repos['phmatray/museum'].featured).toBe(true)
    expect(curation.rooms['Trois D'].theme).toBe('immersive')
    expect(curation.excluded).toEqual(['phmatray/vieux-truc'])
  })

  it('rejette un thème inconnu en nommant le champ', () => {
    const message = messageDe(() => parseCuration({ rooms: { a: { theme: 'gothique' } } }))
    expect(message).toContain('rooms.a.theme')
    expect(message).toContain('"gothique"')
    expect(message).toContain('immersive')
  })

  it('rejette une clé de dépôt mal formée en la citant', () => {
    const message = messageDe(() => parseCuration({ repos: { 'phmatray-museum': {} } }))
    expect(message).toContain('repos["phmatray-museum"]')
    expect(message).toContain('owner/nom')
  })

  it('rejette une clé inconnue dans un override plutôt que de l’ignorer', () => {
    const message = messageDe(() =>
      parseCuration({ repos: { 'phmatray/museum': { featurd: true } } }),
    )
    expect(message).toContain('repos["phmatray/museum"]')
    expect(message).toContain('"featurd"')
  })
})

describe('messages d’erreur exploitables', () => {
  it('type invalide : chemin, attendu, reçu', () => {
    const message = messageDe(() =>
      parseCatalogue(catalogueValide([artworkValide({ stars: 'beaucoup' })])),
    )
    expect(message).toContain('artworks[0].stars')
    expect(message).toContain('attendu un nombre')
    expect(message).toContain('"beaucoup"')
  })

  it('champ manquant : dit « manquant », pas « undefined »', () => {
    const artwork = artworkValide()
    delete artwork.description
    const message = messageDe(() => parseCatalogue(catalogueValide([artwork])))
    expect(message).toContain('artworks[0].description')
    expect(message).toContain('champ requis manquant')
  })

  it('date non ISO : donne un exemple de format attendu', () => {
    const message = messageDe(() =>
      parseCatalogue(catalogueValide([artworkValide({ pushedAt: 'hier' })])),
    )
    expect(message).toContain('artworks[0].pushedAt')
    expect(message).toContain('ISO 8601')
    expect(message).toContain('"hier"')
  })

  it('clé en double dans le catalogue', () => {
    const message = messageDe(() =>
      parseCatalogue(catalogueValide([artworkValide(), artworkValide()])),
    )
    expect(message).toContain('artworks[1].key')
    expect(message).toContain('double')
  })

  it('clé désaccordée de owner/name', () => {
    const message = messageDe(() =>
      parseCatalogue(catalogueValide([artworkValide({ key: 'phmatray/autre' })])),
    )
    expect(message).toContain('artworks[0].key')
    expect(message).toContain('phmatray/museum')
  })

  it('borne de clustering incohérente, avec le champ à corriger', () => {
    const message = messageDe(() =>
      parseMuseumConfig({ owners: ['x'], clustering: { minClusterSize: 10, maxClusterSize: 3 } }),
    )
    expect(message).toContain('clustering.maxClusterSize')
    expect(message).toContain('minClusterSize')
  })

  it('liste d’owners vide', () => {
    const message = messageDe(() => parseMuseumConfig({ owners: [] }))
    expect(message).toContain('owners')
    expect(message).toContain('au moins un propriétaire')
  })

  it('racine qui n’est pas un objet', () => {
    const message = messageDe(() => parseCatalogue('[]'))
    expect(message).toContain('(racine)')
    expect(message).toContain('attendu un objet')
  })

  it('accumule toutes les erreurs plutôt que de s’arrêter à la première', () => {
    const erreur = messageDe(() =>
      parseMuseumConfig({ owners: [], building: { roomDepth: -1 }, clustering: { minClusterSize: 0 } }),
    )
    expect(erreur.split('\n').filter((l) => l.startsWith('  •')).length).toBeGreaterThanOrEqual(3)
    expect(erreur).toContain('museum.config.json')
    expect(erreur).toContain('erreurs de validation')
  })

  it('expose les détails ligne à ligne sur SchemaError', () => {
    let capturee: unknown
    try {
      parseMuseumConfig({ owners: [] })
    } catch (erreur) {
      capturee = erreur
    }
    expect(capturee).toBeInstanceOf(SchemaError)
    const erreur = capturee as SchemaError
    expect(erreur.fichier).toBe('museum.config.json')
    expect(erreur.details).toHaveLength(1)
    expect(erreur.details[0]).toContain('owners')
  })
})

describe('schemaVersion', () => {
  it('rejette une version inconnue du catalogue en disant laquelle est supportée', () => {
    const message = messageDe(() => parseCatalogue({ ...catalogueValide(), schemaVersion: 2 }))
    expect(message).toContain('schemaVersion')
    expect(message).toContain('version 2 inconnue')
    expect(message).toContain('version 1')
  })

  it('rejette une version inconnue de la curation, de la config et de l’atlas', () => {
    for (const parse of [parseCuration, parseMuseumConfig, parseAtlasIndex]) {
      const message = messageDe(() => parse({ schemaVersion: 99, owners: ['x'] }))
      expect(message).toContain('version 99 inconnue')
      expect(message).toContain('seule la version 1')
    }
  })

  it('exige la version sur les fichiers générés, la déduit sur ceux écrits à la main', () => {
    const sansVersion = catalogueValide()
    delete sansVersion.schemaVersion
    expect(messageDe(() => parseCatalogue(sansVersion))).toContain('schemaVersion')

    expect(parseMuseumConfig({ owners: ['x'] }).schemaVersion).toBe(1)
    expect(parseCuration({}).schemaVersion).toBe(1)
  })

  it('une version non numérique est rejetée comme une version inconnue', () => {
    const message = messageDe(() => parseCuration({ schemaVersion: '1' }))
    expect(message).toContain('version "1" inconnue')
  })
})

describe('parseAtlasIndex', () => {
  it('accepte un index cohérent', () => {
    const index = parseAtlasIndex(atlasValide())
    expect(index.entries['phmatray/museum']).toEqual({ atlas: 0, layer: 3 })
    expect(index.atlases).toHaveLength(1)
  })

  it('rejette une couche hors de la grille', () => {
    const message = messageDe(() =>
      parseAtlasIndex(atlasValide({ entries: { 'phmatray/museum': { atlas: 0, layer: 999 } } })),
    )
    expect(message).toContain('entries["phmatray/museum"].layer')
    expect(message).toContain('256 tuiles')
  })

  it('rejette une référence vers un atlas inexistant', () => {
    const message = messageDe(() =>
      parseAtlasIndex(atlasValide({ entries: { 'phmatray/museum': { atlas: 4, layer: 0 } } })),
    )
    expect(message).toContain('entries["phmatray/museum"].atlas')
    expect(message).toContain('inexistant')
  })
})

describe('les schémas exportés restent utilisables directement', () => {
  it('safeParse ne lève pas et signale l’échec', () => {
    expect(catalogueSchema.safeParse(catalogueValide()).success).toBe(true)
    expect(museumConfigSchema.safeParse({ owners: ['x'] }).success).toBe(true)
    expect(curationSchema.safeParse({}).success).toBe(true)
    expect(atlasIndexSchema.safeParse(atlasValide()).success).toBe(true)
    expect(catalogueSchema.safeParse(null).success).toBe(false)
  })
})
