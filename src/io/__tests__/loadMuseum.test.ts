/**
 * LOT 2 — Tests du chargeur de `museum.json`.
 *
 * Deux corpus : des musées minuscules fabriqués sur mesure, pour tenir chaque
 * règle de validation par le col, et le MUSÉE RÉEL de `public/data/museum.json`,
 * pour que le contrat reste vrai sur la seule donnée qui compte.
 *
 * Les assertions sur le musée réel sont volontairement des INVARIANTS et non
 * des compteurs : ce fichier est régénéré à chaque `npm run derive`, et un test
 * qui fige « 4 niveaux, atrium 12×12 » se met au rouge dès qu'un dépôt est
 * ajouté sur GitHub — sans que rien ne soit cassé.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi, afterEach } from 'vitest'

import { SchemaError } from '../../schema'
import type { Museum } from '../../domain/types'
import {
  MUSEUM_PATH,
  VOID_MARGIN,
  floorAbove,
  floorById,
  floorWalls,
  loadMuseum,
  museumResource,
  parseMuseum,
  rampsFrom,
  resetMuseumResource,
  resolveSpawn,
  voidFloorY,
} from '../loadMuseum'

// ── Corpus ───────────────────────────────────────────────────────────────

// `import.meta.url` n'est pas un chemin de fichier sous jsdom : on part de la
// racine du projet, qui est le répertoire de travail de vitest.
const CHEMIN_REEL = resolve(process.cwd(), 'public/data/museum.json')

/** Le musée réel, lu en JSON BRUT : c'est bien le parseur qu'on teste. */
const brutReel: unknown = JSON.parse(readFileSync(CHEMIN_REEL, 'utf8'))

/**
 * Le plus petit musée valide qu'on puisse écrire : un niveau, une dalle, pas de
 * salle, pas de rampe. Sert de base à toutes les mutations négatives — chaque
 * test ne modifie QUE le champ qu'il met à l'épreuve.
 */
function museeMinimal(): Record<string, unknown> {
  return {
    config: {
      schemaVersion: 1,
      name: 'Test',
      owners: ['phmatray'],
      filters: {},
      building: {},
      clustering: {},
    },
    generatedAt: '2026-07-25T00:00:00Z',
    floors: [
      {
        id: 'rdc',
        name: 'Rez-de-chaussée',
        level: 0,
        elevation: 0,
        ceilingHeight: 4.3,
        rooms: [],
        slabHoles: [],
        footprint: { x: -10, z: -10, width: 20, depth: 20 },
      },
    ],
    ramps: [],
    atrium: { x: -6, z: -6, width: 12, depth: 12 },
    spawn: { floorId: 'rdc', position: { x: 0, y: 0, z: 5 }, yaw: 0 },
    artworks: {},
    stats: {
      artworkCount: 0,
      roomCount: 0,
      floorCount: 1,
      excludedCount: 0,
      vaultCount: 0,
    },
    warnings: [],
  }
}

/** Applique une mutation à une copie profonde, sans toucher l'original. */
function muter(mutation: (musee: never) => void): Record<string, unknown> {
  const copie = structuredClone(museeMinimal())
  mutation(copie as never)
  return copie
}

function messages(action: () => unknown): string[] {
  try {
    action()
  } catch (erreur) {
    if (erreur instanceof SchemaError) return erreur.details
    throw erreur
  }
  throw new Error('aucune SchemaError levée alors qu’une était attendue')
}

// ── parseMuseum : cas nominal ────────────────────────────────────────────

describe('parseMuseum', () => {
  it('accepte le musée minimal', () => {
    expect(() => parseMuseum(museeMinimal())).not.toThrow()
  })

  it('accepte le musée réel de public/data/museum.json', () => {
    expect(() => parseMuseum(brutReel)).not.toThrow()
  })

  it('rend l’objet tel quel : les données ne sont ni réécrites ni réordonnées', () => {
    const musee = parseMuseum(brutReel)
    // Un schéma qui appliquerait des `default()` au mauvais endroit renverrait
    // un bâtiment DIFFÉRENT de celui qui a été dérivé, sans le dire.
    expect(musee.floors.map((f) => f.id)).toEqual(
      (brutReel as Museum).floors.map((f) => f.id),
    )
    expect(musee.atrium).toEqual((brutReel as Museum).atrium)
    expect(musee.spawn).toEqual((brutReel as Museum).spawn)
  })

  it('tolère un champ inconnu : le fichier est généré, pas édité', () => {
    // Une version ultérieure du dérivateur ajoute un champ ; les musées déjà
    // déployés doivent continuer à s'ouvrir.
    const avecExtra = muter((m: Record<string, unknown>) => {
      m.futurChamp = { quelqueChose: true }
      ;(m.floors as Record<string, unknown>[])[0].futurChamp = 42
    })
    expect(() => parseMuseum(avecExtra)).not.toThrow()
  })
})

// ── parseMuseum : ce qui doit être refusé ────────────────────────────────

describe('parseMuseum refuse ce qui rendrait la scène injouable', () => {
  it('un musée sans aucun niveau', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      m.floors = []
    })))
    expect(details.join('\n')).toContain('floors')
  })

  it('un spawn qui désigne un niveau inexistant', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      ;(m.spawn as Record<string, unknown>).floorId = 'sous-sol-42'
    })))
    expect(details).toHaveLength(1)
    expect(details[0]).toContain('spawn.floorId')
    expect(details[0]).toContain('niveau inexistant')
  })

  it('une rampe qui part ou arrive dans le vide', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      ;(m.ramps as unknown[]).push({
        id: 'orpheline',
        fromFloor: 'rdc',
        toFloor: 'etage-99',
        centre: { x: 0, z: 0 },
        radius: 4.8,
        startAngle: 0,
        sweep: Math.PI,
        width: 2.2,
        rise: 4.7,
        baseElevation: 0,
      })
    })))
    expect(details).toHaveLength(1)
    expect(details[0]).toContain('ramps[0].toFloor')
  })

  it('deux niveaux portant le même identifiant', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      const floors = m.floors as Record<string, unknown>[]
      floors.push(structuredClone(floors[0]))
    })))
    expect(details.join('\n')).toContain('en double')
  })

  it('une emprise de dalle de largeur nulle', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      const floors = m.floors as Record<string, Record<string, unknown>>[]
      ;(floors[0].footprint as Record<string, unknown>).width = 0
    })))
    expect(details.join('\n')).toContain('floors[0].footprint.width')
  })

  it('une coordonnée NaN — le tueur silencieux du frustum culling', () => {
    // `NaN` dans une position donne une bounding sphere `NaN`, donc un objet qui
    // n'est jamais dessiné et jamais signalé. `JSON.parse` ne peut pas produire
    // de NaN, mais un `museum.json` reconstruit en mémoire, si.
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      const floors = m.floors as Record<string, Record<string, unknown>>[]
      ;(floors[0].footprint as Record<string, unknown>).x = Number.NaN
    })))
    expect(details.join('\n')).toContain('floors[0].footprint.x')
  })

  it('une hauteur de mur négative', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      const floors = m.floors as Record<string, unknown>[]
      floors[0].rooms = [
        {
          id: 'salle',
          name: 'Salle',
          side: 'north',
          footprint: { x: -5, z: -5, width: 10, depth: 9 },
          theme: 'classic',
          topics: [],
          keys: [],
          walls: [
            {
              id: 'salle-outer',
              a: { x: -5, z: -5 },
              b: { x: 5, z: -5 },
              height: -1,
              kind: 'outer',
              normal: { x: 0, z: 1 },
              openings: [],
              placements: [],
            },
          ],
        },
      ]
    })))
    expect(details.join('\n')).toContain('walls[0].height')
  })

  it('nomme le chemin exact du champ fautif, pas « invalid input »', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      const floors = m.floors as Record<string, unknown>[]
      floors[0].elevation = 'zéro'
    })))
    expect(details[0].startsWith('floors[0].elevation —')).toBe(true)
  })

  it('signale toutes les anomalies d’un coup, pas la première seulement', () => {
    const details = messages(() => parseMuseum(muter((m: Record<string, unknown>) => {
      const floors = m.floors as Record<string, unknown>[]
      floors[0].elevation = 'zéro'
      floors[0].ceilingHeight = -3
    })))
    expect(details.length).toBeGreaterThanOrEqual(2)
  })

  it('lève une SchemaError nommant le fichier', () => {
    let capturee: unknown
    try {
      parseMuseum({})
    } catch (erreur) {
      capturee = erreur
    }
    expect(capturee).toBeInstanceOf(SchemaError)
    expect((capturee as SchemaError).fichier).toBe('museum.json')
    expect((capturee as SchemaError).message).toContain('museum.json')
  })
})

// ── loadMuseum : le réseau ───────────────────────────────────────────────

describe('loadMuseum', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetMuseumResource()
  })

  it('valide ce qu’il reçoit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(museeMinimal()))))
    const musee = await loadMuseum('/quelque-part/museum.json')
    expect(musee.floors).toHaveLength(1)
  })

  it('demande le fichier sous la base du site, jamais à la racine du domaine', async () => {
    // Sur GitHub Pages le site vit sous /<dépôt>/ : un chemin absolu y donne un
    // 404 que seule la console révèle.
    const espion = vi.fn<(cible: string) => Promise<Response>>(
      async () => new Response(JSON.stringify(museeMinimal())),
    )
    vi.stubGlobal('fetch', espion)
    await loadMuseum()
    const demande = espion.mock.calls[0][0]
    expect(demande).toBe(`${import.meta.env.BASE_URL}${MUSEUM_PATH}`)
    expect(demande.endsWith(MUSEUM_PATH)).toBe(true)
  })

  it('transforme un 404 en message qui dit quoi faire', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404, statusText: 'Not Found' })),
    )
    await expect(loadMuseum('/absent.json')).rejects.toBeInstanceOf(SchemaError)
    await expect(loadMuseum('/absent.json')).rejects.toThrow(/404/)
    await expect(loadMuseum('/absent.json')).rejects.toThrow(/derive/)
  })

  it('transforme du HTML servi à la place du JSON en message clair', async () => {
    // Cas très réel : un serveur statique mal configuré renvoie index.html en
    // 200 pour toute URL inconnue. Sans ce garde, l'erreur serait un
    // « Unexpected token < » sans nom de fichier.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>')))
    await expect(loadMuseum('/index.html')).rejects.toBeInstanceOf(SchemaError)
    await expect(loadMuseum('/index.html')).rejects.toThrow(/illisible en JSON/)
  })
})

describe('museumResource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetMuseumResource()
  })

  it('ne va chercher le fichier qu’une fois, quel que soit le nombre d’appelants', async () => {
    // C'est la condition de survie de `use()` : une promesse nouvelle à chaque
    // rendu resuspend, donc refetch, donc boucle infinie.
    const espion = vi.fn(async () => new Response(JSON.stringify(museeMinimal())))
    vi.stubGlobal('fetch', espion)

    const [a, b] = await Promise.all([museumResource(), museumResource()])
    expect(espion).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('oublie un échec, pour qu’un remontage puisse réessayer', async () => {
    const espion = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Server Error' }))
      .mockResolvedValue(new Response(JSON.stringify(museeMinimal())))
    vi.stubGlobal('fetch', espion)

    await expect(museumResource()).rejects.toBeInstanceOf(SchemaError)
    await expect(museumResource()).resolves.toBeTruthy()
    expect(espion).toHaveBeenCalledTimes(2)
  })
})

// ── Accès dérivés, sur le musée réel ─────────────────────────────────────

describe('accès dérivés (musée réel)', () => {
  const musee = parseMuseum(brutReel)

  it('floorById retrouve chaque niveau et rien d’autre', () => {
    for (const floor of musee.floors) {
      expect(floorById(musee, floor.id)).toBe(floor)
    }
    expect(floorById(musee, 'niveau-inexistant')).toBeUndefined()
  })

  it('resolveSpawn pose le joueur SUR le plancher de son niveau, pas au rez', () => {
    const niveau = floorById(musee, musee.spawn.floorId)
    expect(niveau).toBeDefined()
    const spawn = resolveSpawn(musee)
    expect(spawn.position.y).toBeCloseTo(niveau!.elevation + musee.spawn.position.y, 9)
    expect(spawn.position.x).toBe(musee.spawn.position.x)
    expect(spawn.position.z).toBe(musee.spawn.position.z)
    expect(spawn.yaw).toBe(musee.spawn.yaw)
  })

  it('resolveSpawn remonte réellement d’un étage quand le spawn n’est pas au rez', () => {
    // Mutation dirigée : sans l'addition de `floor.elevation`, ce test tombe.
    const haut = musee.floors.reduce((a, b) => (b.elevation > a.elevation ? b : a))
    const deplace: Museum = { ...musee, spawn: { ...musee.spawn, floorId: haut.id } }
    expect(resolveSpawn(deplace).position.y).toBeCloseTo(
      haut.elevation + musee.spawn.position.y,
      9,
    )
    expect(resolveSpawn(deplace).position.y).toBeGreaterThan(resolveSpawn(musee).position.y)
  })

  it('voidFloorY est sous le plancher le plus bas, avec une marge plus grande qu’un étage', () => {
    const plusBas = Math.min(...musee.floors.map((f) => f.elevation))
    expect(voidFloorY(musee)).toBeCloseTo(plusBas - VOID_MARGIN, 9)

    // Le filet ne doit jamais se déclencher pour une chute d'un seul niveau,
    // sous peine de téléporter un joueur qui saute simplement dans l'atrium.
    const hauteurs = musee.floors.map((f) => f.elevation).sort((a, b) => a - b)
    const plusGrandEcart = Math.max(
      ...hauteurs.slice(1).map((h, i) => h - hauteurs[i]),
    )
    expect(VOID_MARGIN).toBeGreaterThan(plusGrandEcart)
  })

  it('floorAbove suit l’ordre des élévations, et rien au-dessus du dernier', () => {
    const parElevation = [...musee.floors].sort((a, b) => a.elevation - b.elevation)
    for (let i = 0; i < parElevation.length - 1; i++) {
      expect(floorAbove(musee, parElevation[i])).toBe(parElevation[i + 1])
    }
    expect(floorAbove(musee, parElevation[parElevation.length - 1])).toBeUndefined()
  })

  it('un seul niveau n’a pas de dalle au-dessus : c’est lui qui porte la toiture', () => {
    const sansDessus = musee.floors.filter((f) => floorAbove(musee, f) === undefined)
    expect(sansDessus).toHaveLength(1)
  })

  it('floorWalls rassemble les murs de toutes les salles du niveau', () => {
    for (const floor of musee.floors) {
      const attendu = floor.rooms.reduce((n, r) => n + r.walls.length, 0)
      expect(floorWalls(floor)).toHaveLength(attendu)
    }
    // Le musée réel n'est pas vide : sinon ce test passerait à vide.
    expect(musee.floors.flatMap(floorWalls).length).toBeGreaterThan(0)
  })

  it('rampsFrom partitionne les rampes : chacune est rattachée à un et un seul niveau', () => {
    const total = musee.floors.reduce((n, f) => n + rampsFrom(musee, f.id).length, 0)
    expect(total).toBe(musee.ramps.length)
    expect(musee.ramps.length).toBeGreaterThan(0)
  })

  it('chaque rampe part du plancher de son niveau de départ', () => {
    // Invariant de raccord : une rampe qui ne démarre pas au plancher laisse une
    // marche infranchissable, ou flotte au-dessus du vide.
    for (const ramp of musee.ramps) {
      const depart = floorById(musee, ramp.fromFloor)
      expect(depart).toBeDefined()
      expect(ramp.baseElevation).toBeCloseTo(depart!.elevation, 6)
    }
  })

  it('chaque rampe arrive exactement au plancher du niveau d’arrivée', () => {
    for (const ramp of musee.ramps) {
      const arrivee = floorById(musee, ramp.toFloor)
      expect(arrivee).toBeDefined()
      expect(ramp.baseElevation + ramp.rise).toBeCloseTo(arrivee!.elevation, 6)
    }
  })
})
