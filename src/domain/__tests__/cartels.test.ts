/**
 * LOT 3 — Tests des cartels.
 *
 * Ce fichier vérifie la LOGIQUE, jamais le rendu : rien ici n'instancie de
 * canvas, de `Text` ni de `three`. Ce qui est testé, ce sont les quatre
 * propriétés dont dépend le confort visuel du visiteur, et qui sont invisibles
 * dans une capture d'écran :
 *
 *   1. la sélection des N plus proches est correcte ET stable — deux œuvres à
 *      distance rigoureusement égale doivent se départager toujours de la même
 *      façon, sinon les cartels clignotent ;
 *   2. aucune œuvre au-delà du seuil n'est retenue ;
 *   3. le cartel reste dans le plan du mur et ne chevauche jamais l'œuvre ;
 *   4. le pool ne dépasse jamais sa taille.
 *
 * Le dernier bloc rejoue la propriété n°3 sur `public/data/museum.json`, les
 * cent accrochages réels : c'est la seule façon d'attraper un cas de bord qu'un
 * mur fabriqué à la main ne produira jamais.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CARTEL_EXIT_MARGIN,
  CARTEL_GAP,
  CARTEL_MAX_DISTANCE,
  CARTEL_POOL_SIZE,
  CARTEL_WIDTH,
  DEFAULT_FACE_OFFSET,
  PANEL_MAX_DISTANCE,
  assignSlots,
  cartelText,
  collectCartels,
  layoutWallCartels,
  panelText,
  selectFocused,
  selectNearestCartels,
} from '../cartels'
import type { CartelSpec } from '../cartels'
import type { Artwork, Museum, Placement, Vec3, Wall } from '../types'

// ── Fabriques ────────────────────────────────────────────────────────────

const CONTEXTE = { floorId: 'f0', roomId: 'r0', theme: 'classic' as const }

/** Mur droit le long de +x, de longueur `length`, intérieur vers +z. */
function murX(length: number, placements: Placement[]): Wall {
  return {
    id: 'mur',
    a: { x: 0, z: 0 },
    b: { x: length, z: 0 },
    height: 4,
    kind: 'inner',
    normal: { x: 0, z: 1 },
    openings: [],
    placements,
  }
}

function accroche(key: string, u: number, width = 1, height = 0.5): Placement {
  return {
    key,
    u,
    centerHeight: 1.45,
    width,
    height,
    atlas: 0,
    layer: 0,
    pinned: false,
  }
}

/**
 * Un cartel factice posé à une position donnée. Sert aux tests de sélection, qui
 * ne s'intéressent qu'à `key`, `artworkCenter` et `normal`.
 */
function spec(key: string, center: Vec3, normal = { x: 0, z: 1 }): CartelSpec {
  return {
    key,
    floorId: 'f0',
    roomId: 'r0',
    wallId: 'mur',
    theme: 'classic',
    artworkCenter: center,
    anchor: center,
    yaw: 0,
    u: 0,
    side: 1,
    normal,
  }
}

const ORIGINE: Vec3 = { x: 0, y: 0, z: 0 }

// ── 1. Sélection des plus proches ────────────────────────────────────────

describe('selectNearestCartels', () => {
  it('rend les N plus proches, les plus proches d’abord', () => {
    const specs = [
      spec('c', { x: 3, y: 0, z: 0 }),
      spec('a', { x: 1, y: 0, z: 0 }),
      spec('b', { x: 2, y: 0, z: 0 }),
    ]

    const retenus = selectNearestCartels(specs, ORIGINE, { limit: 2 })

    expect(retenus.map((s) => s.key)).toEqual(['a', 'b'])
  })

  it('mesure en 3D, pas au sol : un étage plus haut est plus loin', () => {
    const specs = [
      spec('sol', { x: 4, y: 0, z: 0 }),
      spec('etage', { x: 1, y: 5, z: 0 }),
    ]

    expect(selectNearestCartels(specs, ORIGINE, { limit: 1 })[0].key).toBe('sol')
  })

  it('départage deux œuvres à distance égale par la clé, pas par l’ordre d’entrée', () => {
    // Le cas réel : on entre dans une salle par le milieu d'un mur, deux œuvres
    // symétriques sont à la même distance au bit près.
    const gauche = spec('zzz-gauche', { x: -2, y: 0, z: 0 })
    const droite = spec('aaa-droite', { x: 2, y: 0, z: 0 })

    const ordre1 = selectNearestCartels([gauche, droite], ORIGINE, { limit: 1 })
    const ordre2 = selectNearestCartels([droite, gauche], ORIGINE, { limit: 1 })

    expect(ordre1.map((s) => s.key)).toEqual(['aaa-droite'])
    expect(ordre2.map((s) => s.key)).toEqual(['aaa-droite'])
  })

  it('rend exactement la même liste sur deux appels identiques', () => {
    const specs = Array.from({ length: 40 }, (_, i) =>
      spec(`k${i}`, { x: Math.cos(i) * 4, y: 0, z: Math.sin(i) * 4 }),
    )

    const a = selectNearestCartels(specs, ORIGINE)
    const b = selectNearestCartels(specs, ORIGINE)

    expect(a.map((s) => s.key)).toEqual(b.map((s) => s.key))
  })

  it('ne retient jamais une œuvre au-delà du seuil', () => {
    const specs = [
      spec('dedans', { x: CARTEL_MAX_DISTANCE - 0.01, y: 0, z: 0 }),
      spec('dehors', { x: CARTEL_MAX_DISTANCE + 0.01, y: 0, z: 0 }),
      spec('loin', { x: 40, y: 0, z: 0 }),
    ]

    expect(selectNearestCartels(specs, ORIGINE).map((s) => s.key)).toEqual(['dedans'])
  })

  it('la marge de sortie retient un cartel allumé, mais n’en allume aucun', () => {
    const juste = CARTEL_MAX_DISTANCE + CARTEL_EXIT_MARGIN / 2
    const specs = [spec('a', { x: juste, y: 0, z: 0 })]

    // Éteint : au-delà du seuil d'entrée, il n'entre pas.
    expect(selectNearestCartels(specs, ORIGINE)).toHaveLength(0)
    // Déjà allumé : il reste, c'est l'hystérésis.
    expect(
      selectNearestCartels(specs, ORIGINE, { previous: new Set(['a']) }),
    ).toHaveLength(1)
  })

  it('même l’hystérésis a une fin', () => {
    const trop = CARTEL_MAX_DISTANCE + CARTEL_EXIT_MARGIN + 0.01
    const specs = [spec('a', { x: trop, y: 0, z: 0 })]

    expect(
      selectNearestCartels(specs, ORIGINE, { previous: new Set(['a']) }),
    ).toHaveLength(0)
  })

  it('ne rend jamais plus que la limite, même avec cent candidats à portée', () => {
    const specs = Array.from({ length: 100 }, (_, i) =>
      spec(`k${String(i).padStart(3, '0')}`, { x: i / 100, y: 0, z: 0 }),
    )

    expect(selectNearestCartels(specs, ORIGINE)).toHaveLength(CARTEL_POOL_SIZE)
    expect(selectNearestCartels(specs, ORIGINE, { limit: 4 })).toHaveLength(4)
  })

  it('un pas de côté ne renverse pas l’ordre de deux œuvres bien séparées', () => {
    // Anti-scintillement : le rang des œuvres ne doit pas dépendre du bruit.
    const specs = [
      spec('proche', { x: 1, y: 0, z: 0 }),
      spec('lointaine', { x: 3, y: 0, z: 0 }),
    ]

    for (let i = 0; i < 20; i++) {
      const oeil = { x: 0, y: 0, z: (i - 10) * 0.005 }
      expect(selectNearestCartels(specs, oeil).map((s) => s.key)).toEqual([
        'proche',
        'lointaine',
      ])
    }
  })
})

// ── 2. Pool ──────────────────────────────────────────────────────────────

describe('assignSlots', () => {
  const vide = (n: number) => new Array<string | null>(n).fill(null)

  it('remplit les cases libres dans l’ordre de distance', () => {
    expect(assignSlots(vide(4), ['a', 'b'], 4)).toEqual(['a', 'b', null, null])
  })

  it('ne dépasse JAMAIS la taille du pool', () => {
    const trop = Array.from({ length: 50 }, (_, i) => `k${i}`)

    for (const taille of [0, 1, 4, CARTEL_POOL_SIZE]) {
      const cases = assignSlots(vide(taille), trop, taille)
      expect(cases).toHaveLength(taille)
      expect(cases.filter((c) => c !== null)).toHaveLength(taille)
    }
  })

  it('une œuvre déjà affichée CONSERVE son emplacement', () => {
    const avant = ['a', 'b', 'c', null]
    // `b` s'éloigne et sort, `d` entre, `c` devient le plus proche : les rangs
    // changent mais `a` et `c` ne bougent pas de case, et `d` récupère la case
    // libérée par `b` — la plus basse disponible, jamais une case occupée.
    const apres = assignSlots(avant, ['c', 'a', 'd'], 4)

    expect(apres).toEqual(['a', 'd', 'c', null])
  })

  it('libère les cases des œuvres sorties du champ', () => {
    expect(assignSlots(['a', 'b', 'c', null], [], 4)).toEqual([null, null, null, null])
  })

  it('ne place jamais deux fois la même œuvre', () => {
    const cases = assignSlots(['a', 'a', null, null], ['a', 'b'], 4)

    expect(cases.filter((c) => c === 'a')).toHaveLength(1)
    expect(cases).toContain('b')
  })

  it('se redimensionne quand la taille du pool change', () => {
    expect(assignSlots(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 2)).toEqual(['a', 'b'])
  })

  it('est stable : réappliquer la même sélection ne bouge rien', () => {
    const selection = ['a', 'b', 'c']
    const premier = assignSlots(vide(8), selection, 8)
    const second = assignSlots(premier, selection, 8)

    expect(second).toEqual(premier)
  })
})

// ── 3. Placement ─────────────────────────────────────────────────────────

describe('layoutWallCartels', () => {
  it('pose le cartel dans le plan du mur, à la distance de la face visible', () => {
    const wall = murX(10, [accroche('a', 5)])
    const [cartel] = layoutWallCartels(wall, 3, CONTEXTE)

    // Le mur est en z = 0, l'intérieur vers +z : tout ce qui est accroché est à
    // `faceOffset` du segment, ni devant ni derrière.
    expect(cartel.anchor.z).toBeCloseTo(DEFAULT_FACE_OFFSET, 9)
    expect(cartel.artworkCenter.z).toBeCloseTo(DEFAULT_FACE_OFFSET, 9)
  })

  it('aligne l’arête haute du cartel sur l’arête basse du cadre', () => {
    const wall = murX(10, [accroche('a', 5, 1.6, 0.8)])
    const [cartel] = layoutWallCartels(wall, 3, CONTEXTE)

    expect(cartel.anchor.y).toBeCloseTo(3 + 1.45 - 0.4, 9)
  })

  it('pose le cartel à côté de l’œuvre, du côté de `b` quand la place y est', () => {
    const wall = murX(10, [accroche('a', 5, 1)])
    const [cartel] = layoutWallCartels(wall, 0, CONTEXTE)

    expect(cartel.side).toBe(1)
    expect(cartel.u).toBeCloseTo(5 + 0.5 + CARTEL_GAP + CARTEL_WIDTH / 2, 9)
    expect(cartel.anchor.x).toBeCloseTo(cartel.u, 9)
  })

  it('bascule de l’autre côté quand le voisin de droite est trop près', () => {
    // 0,30 m de blanc à droite : impossible d'y loger 0,10 + 0,30.
    const wall = murX(12, [accroche('a', 5, 1), accroche('b', 6.3, 1)])
    const [gauche] = layoutWallCartels(wall, 0, CONTEXTE)

    expect(gauche.side).toBe(-1)
    expect(gauche.u).toBeCloseTo(5 - 0.5 - CARTEL_GAP - CARTEL_WIDTH / 2, 9)
  })

  it('ne chevauche jamais l’œuvre, même serré contre l’extrémité du mur', () => {
    // Mur court, œuvre presque au bout : le cadrage dans le mur doit céder
    // devant la règle de non-recouvrement.
    const wall = murX(2, [accroche('a', 1.7, 0.6)])
    const [cartel] = layoutWallCartels(wall, 0, CONTEXTE)

    expect(Math.abs(cartel.u - 1.7)).toBeGreaterThanOrEqual(0.3 + CARTEL_WIDTH / 2 - 1e-9)
  })

  it('oriente le texte vers l’intérieur de la salle', () => {
    // Mur en z = 0, intérieur vers +z : le +Z local du texte doit être +Z monde.
    const [nord] = layoutWallCartels(murX(10, [accroche('a', 5)]), 0, CONTEXTE)
    expect(nord.yaw).toBeCloseTo(0, 9)

    // Même mur retourné : l'intérieur est vers −z, le texte fait demi-tour.
    const sud: Wall = {
      ...murX(10, [accroche('a', 5)]),
      a: { x: 10, z: 0 },
      b: { x: 0, z: 0 },
      normal: { x: 0, z: -1 },
    }
    expect(Math.abs(layoutWallCartels(sud, 0, CONTEXTE)[0].yaw)).toBeCloseTo(Math.PI, 9)
  })

  it('ignore un mur dégénéré plutôt que de diviser par zéro', () => {
    const degenere: Wall = { ...murX(0, [accroche('a', 0)]), b: { x: 0, z: 0 } }

    expect(layoutWallCartels(degenere, 0, CONTEXTE)).toEqual([])
  })
})

// ── 4. Panneau de proximité ──────────────────────────────────────────────

describe('selectFocused', () => {
  const devant = { x: 0, y: 0, z: 1 }

  it('choisit l’œuvre regardée, sous la distance du panneau', () => {
    const specs = [
      spec('face', { x: 0, y: 0, z: 2 }, { x: 0, z: -1 }),
      spec('cote', { x: 2, y: 0, z: 0.2 }, { x: -1, z: 0 }),
    ]

    expect(selectFocused(specs, ORIGINE, devant, {})?.key).toBe('face')
  })

  it('ne rend rien au-delà de 2,5 m', () => {
    const specs = [spec('loin', { x: 0, y: 0, z: PANEL_MAX_DISTANCE + 0.1 }, { x: 0, z: -1 })]

    expect(selectFocused(specs, ORIGINE, devant, {})).toBeNull()
  })

  it('ne rend rien quand le visiteur ne regarde pas l’œuvre', () => {
    const specs = [spec('face', { x: 0, y: 0, z: 2 }, { x: 0, z: -1 })]

    expect(selectFocused(specs, ORIGINE, { x: 1, y: 0, z: 0 }, {})).toBeNull()
  })

  it('ignore une œuvre accrochée de l’autre côté de la cloison', () => {
    // Même position, mais sa normale dit qu'elle regarde ailleurs : le visiteur
    // est DERRIÈRE elle, il ne peut pas la voir.
    const specs = [spec('dos', { x: 0, y: 0, z: 2 }, { x: 0, z: 1 })]

    expect(selectFocused(specs, ORIGINE, devant, {})).toBeNull()
  })

  it('n’en désigne qu’une, la plus centrée dans le regard', () => {
    const specs = [
      spec('centre', { x: 0.05, y: 0, z: 2 }, { x: 0, z: -1 }),
      spec('biais', { x: 0.6, y: 0, z: 2 }, { x: 0, z: -1 }),
    ]

    const focus = selectFocused(specs, ORIGINE, devant, {})
    expect(focus?.key).toBe('centre')
  })

  it('garde le panneau ouvert quand la tête tourne un peu', () => {
    const specs = [spec('face', { x: 0, y: 0, z: 2 }, { x: 0, z: -1 })]
    // 32° : au-delà du cône d'entrée (25°), en deçà du cône de sortie (40°).
    const legerementDeCote = { x: Math.sin(0.56), y: 0, z: Math.cos(0.56) }

    expect(selectFocused(specs, ORIGINE, legerementDeCote, {})).toBeNull()
    expect(selectFocused(specs, ORIGINE, legerementDeCote, { previousKey: 'face' })?.key).toBe(
      'face',
    )
  })

  it('ne se laisse pas piéger par une direction de regard nulle', () => {
    const specs = [spec('face', { x: 0, y: 0, z: 2 }, { x: 0, z: -1 })]

    expect(selectFocused(specs, ORIGINE, { x: 0, y: 0, z: 0 }, {})).toBeNull()
  })
})

// ── 5. Rédaction ─────────────────────────────────────────────────────────

function oeuvre(patch: Partial<Artwork> = {}): Artwork {
  return {
    key: 'phmatray/Demo',
    owner: 'phmatray',
    name: 'Demo',
    title: 'Demo',
    description: 'Une démonstration.',
    url: 'https://github.com/phmatray/Demo',
    homepage: null,
    topics: ['dotnet', 'csharp'],
    language: 'C#',
    languages: { 'C#': 100 },
    stars: 12,
    forks: 0,
    openIssues: 0,
    isFork: false,
    isArchived: false,
    isTemplate: false,
    createdAt: '2023-04-01T00:00:00Z',
    pushedAt: '2026-01-01T00:00:00Z',
    license: null,
    readmeExcerpt: '',
    ...patch,
  }
}

describe('rédaction', () => {
  it('écrit titre, propriétaire, langage, étoiles et année', () => {
    expect(cartelText(oeuvre())).toBe('Demo\nphmatray · C#\n★ 12 · 2023')
  })

  it('n’écrit pas une ligne d’étoiles pour un dépôt à zéro étoile', () => {
    // Quarante dépôts sur soixante-douze sont à zéro : « ★ 0 » sur la moitié des
    // cartels ne dit rien et occupe une ligne.
    expect(cartelText(oeuvre({ stars: 0 }))).toBe('Demo\nphmatray · C#\n2023')
  })

  it('survit à un dépôt sans langage ni date', () => {
    const texte = cartelText(oeuvre({ language: null, stars: 0, createdAt: '' }))

    expect(texte).toBe('Demo\nphmatray')
  })

  it('tronque la description du panneau sans couper un mot', () => {
    const longue = `${'mot '.repeat(200)}fin`
    const { body } = panelText(oeuvre({ description: longue }))
    const description = body.split('\n\n')[0]

    expect(description.length).toBeLessThanOrEqual(221)
    expect(description.endsWith('…')).toBe(true)
    expect(description).not.toContain('  ')
  })

  it('limite les topics à quatre', () => {
    const { body } = panelText(oeuvre({ topics: ['a', 'b', 'c', 'd', 'e', 'f'] }))

    expect(body).toContain('#a  #b  #c  #d')
    expect(body).not.toContain('#e')
  })

  it('rend un panneau utilisable même sans description ni topics', () => {
    const contenu = panelText(oeuvre({ description: '', topics: [] }))

    expect(contenu.heading).toContain('Demo')
    expect(contenu.body).toBe('')
  })
})

// ── 6. Le musée réel ─────────────────────────────────────────────────────

describe('sur le musée réel (public/data/museum.json)', () => {
  const musee = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/data/museum.json'), 'utf8'),
  ) as Museum

  const specs = collectCartels(musee)

  /** Le mur qui porte un cartel donné, retrouvé par son identifiant. */
  const murs = new Map<string, { wall: Wall; elevation: number }>()
  for (const floor of musee.floors) {
    for (const room of floor.rooms) {
      for (const wall of room.walls) murs.set(wall.id, { wall, elevation: floor.elevation })
    }
  }

  it('produit un cartel par œuvre accrochée', () => {
    expect(specs).toHaveLength(musee.stats.artworkCount)
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length)
  })

  it('aucun cartel ne chevauche son œuvre', () => {
    for (const cartel of specs) {
      const { wall } = murs.get(cartel.wallId)!
      const placement = wall.placements.find((p) => p.key === cartel.key)!
      const ecart = Math.abs(cartel.u - placement.u)

      expect(ecart).toBeGreaterThanOrEqual(placement.width / 2 + CARTEL_WIDTH / 2 - 1e-9)
    }
  })

  it('aucun cartel ne chevauche l’œuvre voisine', () => {
    for (const cartel of specs) {
      const { wall } = murs.get(cartel.wallId)!
      for (const autre of wall.placements) {
        if (autre.key === cartel.key) continue
        const ecart = Math.abs(cartel.u - autre.u)
        expect(ecart).toBeGreaterThanOrEqual(autre.width / 2 + CARTEL_WIDTH / 2 - 1e-9)
      }
    }
  })

  it('aucun cartel ne sort du mur', () => {
    for (const cartel of specs) {
      const { wall } = murs.get(cartel.wallId)!
      const longueur = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z)

      expect(cartel.u - CARTEL_WIDTH / 2).toBeGreaterThanOrEqual(-1e-9)
      expect(cartel.u + CARTEL_WIDTH / 2).toBeLessThanOrEqual(longueur + 1e-9)
    }
  })

  it('tout cartel est dans le plan de son mur, du bon côté', () => {
    for (const cartel of specs) {
      const { wall } = murs.get(cartel.wallId)!
      const dx = wall.b.x - wall.a.x
      const dz = wall.b.z - wall.a.z
      const longueur = Math.hypot(dx, dz)
      const ex = { x: dx / longueur, z: dz / longueur }

      // Décomposition du vecteur `a → cartel` dans le repère du mur.
      const vx = cartel.anchor.x - wall.a.x
      const vz = cartel.anchor.z - wall.a.z
      const leLongDuMur = vx * ex.x + vz * ex.z
      const horsDuMur = vx * cartel.normal.x + vz * cartel.normal.z

      expect(leLongDuMur).toBeCloseTo(cartel.u, 9)
      // Exactement à la face visible : ni enfoncé dans le mur, ni flottant.
      expect(horsDuMur).toBeCloseTo(DEFAULT_FACE_OFFSET, 9)
      // Et la normale utilisée est bien celle du contrat, pas son opposée.
      expect(cartel.normal.x * wall.normal.x + cartel.normal.z * wall.normal.z).toBeGreaterThan(0)
    }
  })

  it('tout cartel pend sous son œuvre et reste au-dessus du plancher', () => {
    for (const cartel of specs) {
      const { wall, elevation } = murs.get(cartel.wallId)!
      const placement = wall.placements.find((p) => p.key === cartel.key)!

      expect(cartel.anchor.y).toBeCloseTo(
        elevation + placement.centerHeight - placement.height / 2,
        9,
      )
      // 0,55 m de dégagement : la hauteur du panneau de proximité au pire.
      expect(cartel.anchor.y - elevation).toBeGreaterThan(0.55)
    }
  })

  it('le pool suffit partout dans le bâtiment', () => {
    // Balayage de CHAQUE salle sur une grille 9×9 à hauteur d'œil, et pas
    // seulement au centre : dans les grandes salles le centre est à plus de 6 m
    // de tous les murs et ne verrait aucun cartel — le test serait vide de sens.
    // Le §9.3 annonce ~15 cartels simultanés au pire ; si un point du bâtiment
    // en demandait davantage, le pool tronquerait et des œuvres pourtant proches
    // resteraient muettes.
    let maximum = 0
    for (const floor of musee.floors) {
      for (const room of floor.rooms) {
        for (let i = 1; i < 10; i++) {
          for (let j = 1; j < 10; j++) {
            const oeil = {
              x: room.footprint.x + (room.footprint.width * i) / 10,
              y: floor.elevation + 1.7,
              z: room.footprint.z + (room.footprint.depth * j) / 10,
            }
            const proches = selectNearestCartels(specs, oeil, {
              limit: Number.MAX_SAFE_INTEGER,
            })
            maximum = Math.max(maximum, proches.length)
          }
        }
      }
    }

    // Mesuré : 13, dans `etage-1-south-1`, l'angle le plus dense du musée.
    expect(maximum).toBeGreaterThan(0)
    expect(maximum).toBeLessThanOrEqual(CARTEL_POOL_SIZE)
  })

  it('chaque cartel a bien une œuvre à décrire', () => {
    for (const cartel of specs) {
      const artwork = musee.artworks[cartel.key]
      expect(artwork).toBeDefined()
      expect(cartelText(artwork).length).toBeGreaterThan(0)
    }
  })
})
