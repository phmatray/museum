// @vitest-environment node — le domaine ne touche jamais au DOM.
/**
 * Tests de la dérivation (spec §4.4, §5, §7).
 *
 * Deux fils conducteurs :
 *
 *  1. RIEN NE SE PERD. Toute œuvre retenue est accrochée quelque part, une fois
 *     et une seule. C'est la propriété que le visiteur constate en marchant, et
 *     c'est celle qui casse en premier quand un module en amont change.
 *  2. RIEN NE BLOQUE. Clé orpheline, salle inexistante, atlas absent, catalogue
 *     vide : chacun de ces cas produit un avertissement et un musée.
 *
 * Le dernier bloc rejoue tout sur le catalogue réel — les dépôts effectivement
 * récupérés sur GitHub. C'est la seule preuve qui vaille : les corpus inventés
 * n'ont ni topics déséquilibrés, ni dépôts sans description, ni forks archivés.
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_FEATURED,
  correspondAuGlob,
  derive,
  formatPlan,
  honourScore,
  identifiantDeSalle,
  selectArtworks,
} from '../derive'
import type {
  Artwork,
  AtlasIndex,
  Catalogue,
  Curation,
  Museum,
  MuseumConfig,
  Placement,
  RepoKey,
} from '../types'
import brut from '../../../public/data/catalogue.json'

// ── Fixtures ─────────────────────────────────────────────────────────────

const CATALOGUE_REEL = brut as unknown as Catalogue
const REFERENCE = CATALOGUE_REEL.generatedAt

let compteur = 0

function oeuvre(partiel: Partial<Artwork> = {}): Artwork {
  const name = partiel.name ?? `repo-${String(compteur++).padStart(3, '0')}`
  const owner = partiel.owner ?? 'acme'
  const base: Artwork = {
    key: '',
    owner,
    name,
    title: name,
    description: '',
    url: `https://github.com/${owner}/${name}`,
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
    pushedAt: '2024-06-01T00:00:00Z',
    license: null,
    readmeExcerpt: '',
  }
  // La clé est toujours recalculée : un `partiel` qui la désaccorderait de
  // owner/name serait refusé par le schéma, donc impossible en vrai.
  return { ...base, ...partiel, key: `${owner}/${name}` }
}

function catalogue(artworks: Artwork[], generatedAt = '2026-07-25T00:00:00Z'): Catalogue {
  return { schemaVersion: 1, generatedAt, owners: ['acme'], artworks }
}

function config(overrides: Partial<MuseumConfig> = {}): MuseumConfig {
  return {
    schemaVersion: 1,
    name: 'Musée de test',
    owners: ['acme'],
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
    ...overrides,
  }
}

function curation(partiel: Partial<Curation> = {}): Curation {
  return { schemaVersion: 1, repos: {}, rooms: {}, excluded: [], ...partiel }
}

/** Atlas dense : une tuile par œuvre, dans l'ordre alphabétique des clés. */
function atlasPour(cles: RepoKey[]): AtlasIndex {
  const entries: AtlasIndex['entries'] = {}
  ;[...cles].sort().forEach((cle, i) => {
    entries[cle] = { atlas: Math.floor(i / 256), layer: i % 256 }
  })
  return { schemaVersion: 1, tileWidth: 256, tileHeight: 128, cols: 16, rows: 16, atlases: ['media/atlas-0.webp'], entries }
}

const ATLAS_VIDE: AtlasIndex = {
  schemaVersion: 1,
  tileWidth: 256,
  tileHeight: 128,
  cols: 16,
  rows: 16,
  atlases: [],
  entries: {},
}

function musee(
  artworks: Artwork[],
  options: { curation?: Curation; config?: MuseumConfig; atlas?: AtlasIndex } = {},
): Museum {
  const cat = catalogue(artworks)
  return derive({
    catalogue: cat,
    curation: options.curation ?? curation(),
    config: options.config ?? config(),
    atlas: options.atlas ?? atlasPour(artworks.map((a) => a.key)),
  })
}

// ── Outils d'inspection ──────────────────────────────────────────────────

function tousLesPlacements(m: Museum): Placement[] {
  return m.floors.flatMap((f) => f.rooms.flatMap((r) => r.walls.flatMap((w) => w.placements)))
}

function clesAccrochees(m: Museum): RepoKey[] {
  return tousLesPlacements(m).map((p) => p.key)
}

// ── Sélection ────────────────────────────────────────────────────────────

describe('selectArtworks', () => {
  it('écarte les forks quand excludeForks, et envoie les archivés en réserve', () => {
    const s = selectArtworks({
      catalogue: catalogue([
        oeuvre({ name: 'normal' }),
        oeuvre({ name: 'forke', isFork: true }),
        oeuvre({ name: 'archive', isArchived: true }),
      ]),
      curation: curation(),
      config: config(),
    })
    expect(s.gallery.map((a) => a.name)).toEqual(['normal'])
    expect(s.vault.map((a) => a.name)).toEqual(['archive'])
    expect(s.excludedCount).toBe(1)
  })

  it('conserve les forks en réserve quand excludeForks est faux', () => {
    const c = config()
    c.filters.excludeForks = false
    const s = selectArtworks({
      catalogue: catalogue([oeuvre({ name: 'forke', isFork: true })]),
      curation: curation(),
      config: c,
    })
    expect(s.vault).toHaveLength(1)
    expect(s.excludedCount).toBe(0)
  })

  it('applique minStars, requireTopics et excludePatterns', () => {
    const c = config()
    c.filters.minStars = 5
    c.filters.requireTopics = ['dotnet']
    c.filters.excludePatterns = ['acme/secret-*']

    const s = selectArtworks({
      catalogue: catalogue([
        oeuvre({ name: 'bon', stars: 10, topics: ['dotnet'] }),
        oeuvre({ name: 'pauvre', stars: 1, topics: ['dotnet'] }),
        oeuvre({ name: 'hors-sujet', stars: 10, topics: ['rust'] }),
        oeuvre({ name: 'secret-x', stars: 10, topics: ['dotnet'] }),
      ]),
      curation: curation(),
      config: c,
    })
    expect(s.kept.map((a) => a.name)).toEqual(['bon'])
  })

  it("include: true passe outre les filtres, include: false et excluded l'emportent", () => {
    const s = selectArtworks({
      catalogue: catalogue([
        oeuvre({ name: 'forke', isFork: true }),
        oeuvre({ name: 'garde' }),
        oeuvre({ name: 'banni' }),
      ]),
      curation: curation({
        repos: { 'acme/forke': { include: true }, 'acme/garde': { include: false } },
        excluded: ['acme/banni'],
      }),
      config: config(),
    })
    expect(s.kept.map((a) => a.name)).toEqual(['forke'])
    // Un fork inclus de force reste un fork : sa place est en réserve.
    expect(s.vault.map((a) => a.name)).toEqual(['forke'])
  })

  it('complète la salle d’honneur jusqu’à MAX_FEATURED, les explicites d’abord', () => {
    const artworks = Array.from({ length: 30 }, (_, i) =>
      oeuvre({ name: `r${String(i).padStart(2, '0')}`, stars: i }),
    )
    const s = selectArtworks({
      catalogue: catalogue(artworks),
      curation: curation({ repos: { 'acme/r00': { featured: true } } }),
      config: config(),
    })
    expect(s.featured).toHaveLength(MAX_FEATURED)
    // r00 n'a aucune étoile : seul un choix humain peut l'y mettre.
    expect(s.featured).toContain('acme/r00')
    expect(s.featured).toContain('acme/r29')
  })

  it('ne trie jamais par ordre d’arrivée : deux catalogues permutés donnent la même sélection', () => {
    const artworks = Array.from({ length: 20 }, (_, i) => oeuvre({ name: `r${i}`, stars: i % 4 }))
    const a = selectArtworks({ catalogue: catalogue(artworks), curation: curation(), config: config() })
    const b = selectArtworks({
      catalogue: catalogue([...artworks].reverse()),
      curation: curation(),
      config: config(),
    })
    expect(b.featured).toEqual(a.featured)
    expect(b.kept.map((x) => x.key)).toEqual(a.kept.map((x) => x.key))
  })
})

// ── Score d'honneur ──────────────────────────────────────────────────────

describe('honourScore', () => {
  it('borne la notoriété à 3 et la récence à 1', () => {
    const enorme = oeuvre({ stars: 10_000_000, pushedAt: REFERENCE })
    expect(honourScore(enorme, REFERENCE)).toBeCloseTo(4, 6)
  })

  it('ne récompense plus rien au-delà d’un an d’inactivité', () => {
    const vieux = oeuvre({ stars: 0, pushedAt: '2020-01-01T00:00:00Z' })
    expect(honourScore(vieux, REFERENCE)).toBe(0)
  })

  it('se mesure depuis generatedAt, pas depuis l’horloge du build', () => {
    const a = oeuvre({ stars: 0, pushedAt: '2026-01-01T00:00:00Z' })
    const tot = honourScore(a, '2026-02-01T00:00:00Z')
    const tard = honourScore(a, '2027-02-01T00:00:00Z')
    expect(tot).toBeGreaterThan(tard)
    expect(tard).toBe(0)
  })

  it('reste défini sur une date illisible', () => {
    expect(honourScore(oeuvre({ stars: 0, pushedAt: 'jamais' }), REFERENCE)).toBe(0)
  })
})

// ── Globs ────────────────────────────────────────────────────────────────

describe('correspondAuGlob', () => {
  it('ne franchit le / qu’avec **', () => {
    expect(correspondAuGlob('acme/mon-outil', 'acme/*')).toBe(true)
    expect(correspondAuGlob('acme/mon-outil', '*')).toBe(false)
    expect(correspondAuGlob('acme/mon-outil', '**')).toBe(true)
    expect(correspondAuGlob('acme/mon-outil', '**/mon-outil')).toBe(true)
  })

  it('ignore la casse et échappe les caractères spéciaux', () => {
    expect(correspondAuGlob('Acme/Truc', 'acme/truc')).toBe(true)
    expect(correspondAuGlob('acme/a.b', 'acme/a.b')).toBe(true)
    expect(correspondAuGlob('acme/axb', 'acme/a.b')).toBe(false)
    expect(correspondAuGlob('acme/ab', 'acme/a?')).toBe(true)
  })
})

// ── Assemblage ───────────────────────────────────────────────────────────

describe('derive', () => {
  it('prend generatedAt du catalogue et jamais l’horloge', () => {
    const m = musee([oeuvre(), oeuvre(), oeuvre()])
    expect(m.generatedAt).toBe('2026-07-25T00:00:00Z')
  })

  it('produit un musée même sur un catalogue vide', () => {
    const m = musee([])
    expect(m.floors.length).toBeGreaterThan(0)
    expect(m.stats.artworkCount).toBe(0)
    expect(clesAccrochees(m)).toEqual([])
  })

  it('accroche chaque œuvre retenue une fois et une seule', () => {
    const artworks = Array.from({ length: 40 }, (_, i) =>
      oeuvre({ name: `r${String(i).padStart(2, '0')}`, topics: [`sujet-${i % 5}`], stars: i }),
    )
    const m = musee(artworks)
    const accrochees = clesAccrochees(m)
    expect(new Set(accrochees).size).toBe(accrochees.length)
    expect([...accrochees].sort()).toEqual(artworks.map((a) => a.key).sort())
  })

  it('exclut les œuvres maîtresses des murs de leur salle thématique', () => {
    const artworks = Array.from({ length: 30 }, (_, i) => oeuvre({ name: `r${i}`, stars: i }))
    const m = musee(artworks)
    const honneur = m.floors.find((f) => f.level === 0)!.rooms[0]
    const collections = m.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)
    for (const cle of honneur.keys) {
      expect(collections.some((r) => r.keys.includes(cle))).toBe(false)
    }
  })

  it('descend forks et archivés au niveau −1', () => {
    const c = config()
    c.filters.excludeForks = false
    const m = musee(
      [
        ...Array.from({ length: 8 }, (_, i) => oeuvre({ name: `vivant-${i}` })),
        oeuvre({ name: 'vieux', isArchived: true }),
        oeuvre({ name: 'copie', isFork: true }),
      ],
      { config: c },
    )
    const reserve = m.floors.find((f) => f.level === -1)
    expect(reserve?.rooms[0].keys.sort()).toEqual(['acme/copie', 'acme/vieux'])
    expect(m.stats.vaultCount).toBe(2)
  })

  it('donne des statistiques cohérentes avec le contenu', () => {
    const m = musee(Array.from({ length: 25 }, (_, i) => oeuvre({ name: `r${i}` })))
    expect(m.stats.artworkCount).toBe(Object.keys(m.artworks).length)
    expect(m.stats.floorCount).toBe(m.floors.length)
    expect(m.stats.roomCount).toBe(m.floors.reduce((n, f) => n + f.rooms.length, 0))
  })

  it('place le départ hors des trémies du plancher d’arrivée', () => {
    const c = config()
    c.filters.excludeForks = false
    const m = musee(
      [...Array.from({ length: 10 }, (_, i) => oeuvre({ name: `r${i}` })), oeuvre({ name: 'vieux', isArchived: true })],
      { config: c },
    )
    const rdc = m.floors.find((f) => f.id === m.spawn.floorId)!
    expect(rdc.slabHoles.length).toBeGreaterThan(0) // une réserve existe, la dalle est percée
    for (const trou of rdc.slabHoles) {
      const dedans =
        m.spawn.position.x > trou.x &&
        m.spawn.position.x < trou.x + trou.width &&
        m.spawn.position.z > trou.z &&
        m.spawn.position.z < trou.z + trou.depth
      expect(dedans).toBe(false)
    }
  })

  it('est déterministe : deux dérivations identiques, octet pour octet', () => {
    const artworks = Array.from({ length: 30 }, (_, i) =>
      oeuvre({ name: `r${i}`, topics: [`t${i % 4}`], stars: i * 3 }),
    )
    const a = musee(artworks)
    const b = musee([...artworks].reverse())
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

// ── Curation ─────────────────────────────────────────────────────────────

describe('derive — curation', () => {
  const artworks = Array.from({ length: 24 }, (_, i) =>
    oeuvre({ name: `r${String(i).padStart(2, '0')}`, topics: [`sujet-${i % 3}`] }),
  )

  it('signale une clé orpheline sans rien bloquer', () => {
    const m = musee(artworks, {
      curation: curation({ repos: { 'acme/disparu': { featured: true } }, excluded: ['acme/parti'] }),
    })
    expect(m.warnings).toContain(
      'curation.repos["acme/disparu"] — dépôt absent du catalogue, override sans effet',
    )
    expect(m.warnings).toContain('curation.excluded — "acme/parti" absent du catalogue, exclusion sans effet')
    expect(m.stats.artworkCount).toBe(artworks.length)
  })

  it('signale un dépôt à la fois exclu et marqué featured', () => {
    const m = musee(artworks, {
      curation: curation({ repos: { 'acme/r00': { featured: true } }, excluded: ['acme/r00'] }),
    })
    expect(m.warnings.some((w) => w.includes('acme/r00') && w.includes('featured'))).toBe(true)
    expect(clesAccrochees(m)).not.toContain('acme/r00')
  })

  it('déplace une œuvre vers la salle visée par son override', () => {
    const reference = musee(artworks)
    const collections = reference.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)
    const source = collections.find((r) => r.keys.length > 1)!
    const cible = collections.find((r) => r.id !== source.id)!
    const cle = source.keys[0]

    const m = musee(artworks, {
      curation: curation({ repos: { [cle]: { room: identifiantDeSalle(cible.name) } } }),
    })
    const salles = m.floors.flatMap((f) => f.rooms)
    const dansCible = salles.find((r) => r.name === cible.name)!
    expect(dansCible.keys).toContain(cle)
    expect(salles.filter((r) => r.keys.includes(cle))).toHaveLength(1)
  })

  it('descend une œuvre en réserve quand la curation vise « reserve »', () => {
    const m = musee(artworks, { curation: curation({ repos: { 'acme/r05': { room: 'reserve' } } }) })
    const reserve = m.floors.find((f) => f.level === -1)!
    expect(reserve.rooms[0].keys).toContain('acme/r05')
    expect(m.stats.vaultCount).toBe(1)
  })

  it('accepte une clé de salle sans accent ni ponctuation', () => {
    expect(identifiantDeSalle('Réserve')).toBe('reserve')
    expect(identifiantDeSalle('Blazor / MudBlazor')).toBe('blazor-mudblazor')
    const m = musee(artworks, { curation: curation({ repos: { 'acme/r05': { room: 'RÉSERVE' } } }) })
    expect(m.floors.find((f) => f.level === -1)!.rooms[0].keys).toContain('acme/r05')
  })

  it('ne promeut pas en salle d’honneur un dépôt dont la curation a fixé la salle', () => {
    // Sans cette règle, le complément automatique du rez-de-chaussée décrocherait
    // l'œuvre de la salle que le curateur venait de lui assigner.
    const m = musee(artworks, { curation: curation({ repos: { 'acme/r00': { room: 'reserve' } } }) })
    const honneur = m.floors.find((f) => f.level === 0)!.rooms[0]
    expect(honneur.keys).not.toContain('acme/r00')
    expect(m.floors.find((f) => f.level === -1)!.rooms[0].keys).toContain('acme/r00')
  })

  it('signale une salle inexistante sans perdre l’œuvre', () => {
    const m = musee(artworks, {
      curation: curation({ repos: { 'acme/r03': { room: 'salle-qui-nexiste-pas' } } }),
    })
    expect(m.warnings.some((w) => w.includes('salle-qui-nexiste-pas'))).toBe(true)
    expect(clesAccrochees(m)).toContain('acme/r03')
  })

  it('renomme et rethème une salle, et le renommage est idempotent', () => {
    const reference = musee(artworks)
    const salle = reference.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)[0]
    const cle = identifiantDeSalle(salle.name)

    const m = musee(artworks, {
      curation: curation({ rooms: { [cle]: { name: 'Cabinet des curiosités', theme: 'modern' } } }),
    })
    const renommee = m.floors.flatMap((f) => f.rooms).find((r) => r.id === salle.id)!
    expect(renommee.name).toBe('Cabinet des curiosités')
    expect(renommee.theme).toBe('modern')

    // Le curateur relit le plan, y voit « cabinet-des-curiosites » et ajoute une
    // seconde entrée sous ce nom : elle doit porter sur la même salle.
    const m2 = musee(artworks, {
      curation: curation({
        rooms: {
          [cle]: { name: 'Cabinet des curiosités' },
          'cabinet-des-curiosites': { theme: 'immersive' },
        },
      }),
    })
    expect(m2.warnings.filter((w) => w.includes('cabinet-des-curiosites'))).toEqual([])
    const rethemee = m2.floors.flatMap((f) => f.rooms).find((r) => r.id === salle.id)!
    expect(rethemee.name).toBe('Cabinet des curiosités')
    expect(rethemee.theme).toBe('immersive')
  })

  it('signale les champs de salle que la disposition ne sait pas encore honorer', () => {
    const reference = musee(artworks)
    const cle = identifiantDeSalle(reference.floors.filter((f) => f.level > 0)[0].rooms[0].name)
    const m = musee(artworks, { curation: curation({ rooms: { [cle]: { floor: 3, hidden: true } } }) })
    expect(m.warnings.some((w) => w.includes('floor, hidden'))).toBe(true)
  })

  it('remplace le titre d’une œuvre', () => {
    const m = musee(artworks, { curation: curation({ repos: { 'acme/r01': { title: 'Le Grand Œuvre' } } }) })
    expect(m.artworks['acme/r01'].title).toBe('Le Grand Œuvre')
  })

  it('épingle un placement à la position voulue', () => {
    const reference = musee(artworks)
    const salle = reference.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)[0]
    const mur = salle.walls.find((w) => w.placements.length > 0)!
    const cle = salle.keys[0]

    const m = musee(artworks, {
      curation: curation({ repos: { [cle]: { placement: { wallId: mur.id, u: 4, scale: 1.5 } } } }),
    })
    const pose = tousLesPlacements(m).find((p) => p.key === cle)!
    expect(pose.pinned).toBe(true)
    expect(pose.u).toBeCloseTo(4, 6)
  })
})

// ── Atlas ────────────────────────────────────────────────────────────────

describe('derive — atlas', () => {
  const artworks = Array.from({ length: 12 }, (_, i) => oeuvre({ name: `r${i}` }))

  it('reporte les couches de l’atlas sur les placements', () => {
    const atlas = atlasPour(artworks.map((a) => a.key))
    const m = musee(artworks, { atlas })
    for (const p of tousLesPlacements(m)) {
      expect(p.layer).toBe(atlas.entries[p.key].layer)
      expect(p.atlas).toBe(atlas.entries[p.key].atlas)
    }
  })

  it('résume les clés absentes de l’atlas en une ligne quand elles sont nombreuses', () => {
    const m = musee(artworks, { atlas: ATLAS_VIDE })
    const lignes = m.warnings.filter((w) => w.startsWith('atlas.json'))
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toContain('12 dépôts sans tuile')
    expect(tousLesPlacements(m).every((p) => p.layer === 0)).toBe(true)
  })

  it('détaille les clés absentes quand elles sont peu nombreuses', () => {
    const atlas = atlasPour(artworks.slice(0, 11).map((a) => a.key))
    const m = musee(artworks, { atlas })
    expect(m.warnings.filter((w) => w.startsWith('atlas.json'))).toEqual([
      'atlas.json — "acme/r11" n\'a pas de tuile, couche 0 par défaut',
    ])
  })

  it('déduit le rapport largeur/hauteur de la grille de l’atlas, sans le coder en dur', () => {
    const carre: AtlasIndex = { ...atlasPour(artworks.map((a) => a.key)), tileWidth: 256, tileHeight: 256 }
    const m = musee(artworks, { atlas: carre })
    for (const p of tousLesPlacements(m)) expect(p.width / p.height).toBeCloseTo(1, 6)
  })
})

// ── Plan en texte ────────────────────────────────────────────────────────

describe('formatPlan', () => {
  it('imprime les niveaux, les salles, les murs et les avertissements', () => {
    const m = musee(Array.from({ length: 20 }, (_, i) => oeuvre({ name: `r${i}` })), {
      atlas: ATLAS_VIDE,
    })
    const texte = formatPlan(m)
    expect(texte).toContain('Musée de test')
    expect(texte).toContain('Rez-de-chaussée')
    expect(texte).toContain('clé de curation')
    expect(texte).toContain('accrochage(s)')
    expect(texte).toContain('avertissements (1)')
  })

  it('dit explicitement qu’il n’y a rien à signaler', () => {
    expect(formatPlan(musee(Array.from({ length: 8 }, () => oeuvre())))).toContain('aucun avertissement')
  })

  it('affiche une clé de curation qui désigne réellement la salle', () => {
    const artworks = Array.from({ length: 20 }, (_, i) => oeuvre({ name: `r${i}`, topics: [`t${i % 3}`] }))
    const m = musee(artworks)
    const salle = m.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)[0]
    const cle = identifiantDeSalle(salle.name)
    const apres = musee(artworks, { curation: curation({ rooms: { [cle]: { theme: 'vault' } } }) })
    expect(apres.floors.flatMap((f) => f.rooms).find((r) => r.id === salle.id)!.theme).toBe('vault')
  })
})

// ── Corpus réel ──────────────────────────────────────────────────────────

describe('derive — le catalogue réel, quelle que soit sa taille', () => {
  const CONFIG_REELLE = config({
    name: 'Atypical Museum',
    owners: ['phmatray', 'Atypical-Consulting'],
    filters: { excludeForks: true, excludeArchived: false, excludePatterns: [] },
  })
  const atlas = atlasPour(CATALOGUE_REEL.artworks.map((a) => a.key))
  const reel = (c: Curation = curation()): Museum =>
    derive({ catalogue: CATALOGUE_REEL, curation: c, config: CONFIG_REELLE, atlas })

  /**
   * ── Ce test figeait 115, 100, 72 et 28. Il a cassé la première publication ──
   *
   * Le catalogue N'EST PAS une fixture : la CI le refetch depuis l'API GitHub à
   * chaque publication, et un cron le refait chaque nuit. Le jour où un dépôt
   * public de plus est apparu — 116 au lieu de 115 —, quatre tests sont tombés
   * et le déploiement s'est arrêté avant le build. Un test qui échoue parce que
   * son auteur a créé un dépôt ne mesure pas le code : il mesure le calendrier.
   *
   * Ce qui doit rester vrai quelle que soit la taille du corpus, ce sont les
   * ÉGALITÉS entre ses parts. On les vérifie donc, plus les bornes de bon sens
   * qui attraperaient un catalogue vide ou un filtre devenu fou.
   */
  it('partitionne le catalogue réel sans en perdre ni en inventer', () => {
    const s = selectArtworks({ catalogue: CATALOGUE_REEL, curation: curation(), config: CONFIG_REELLE })
    const total = CATALOGUE_REEL.artworks.length

    // Un vrai portefeuille, pas un catalogue vide ni un doublement suspect.
    expect(total).toBeGreaterThan(50)
    expect(s.kept.length).toBeGreaterThan(total / 2)
    expect(s.kept.length).toBeLessThanOrEqual(total)

    // La partition est exacte : rien ne tombe entre la galerie et la réserve.
    expect(s.gallery.length + s.vault.length).toBe(s.kept.length)
    expect(s.kept.length + s.excludedCount).toBe(total)

    // La réserve reçoit exactement les forks et les archivés retenus — c'est la
    // règle du §7, et elle se vérifie sur le corpus plutôt que sur un nombre.
    expect(s.vault.map((a) => a.key).sort()).toEqual(
      s.kept.filter((a) => a.isFork || a.isArchived).map((a) => a.key).sort(),
    )
  })

  it('accroche chaque dépôt retenu une fois, et rien d’autre', () => {
    const s = selectArtworks({ catalogue: CATALOGUE_REEL, curation: curation(), config: CONFIG_REELLE })
    const m = reel()
    const accrochees = clesAccrochees(m)
    expect(accrochees).toHaveLength(s.kept.length)
    expect(new Set(accrochees).size).toBe(s.kept.length)
    expect([...accrochees].sort()).toEqual(Object.keys(m.artworks).sort())
  })

  it('n’a aucun avertissement quand catalogue, curation et atlas sont complets', () => {
    expect(reel().warnings).toEqual([])
  })

  it('remplit la salle d’honneur sans la déborder', () => {
    const m = reel()
    const rdc = m.floors.find((f) => f.level === 0)!
    expect(rdc.rooms).toHaveLength(1)
    expect(rdc.rooms[0].keys).toHaveLength(MAX_FEATURED)
  })

  it('ne laisse aucun cadre déborder de son mur ni en chevaucher un autre', () => {
    for (const floor of reel().floors) {
      for (const room of floor.rooms) {
        for (const mur of room.walls) {
          const longueur = Math.hypot(mur.b.x - mur.a.x, mur.b.z - mur.a.z)
          const poses = [...mur.placements].sort((a, b) => a.u - b.u)
          poses.forEach((p, i) => {
            expect(p.u - p.width / 2).toBeGreaterThanOrEqual(-1e-6)
            expect(p.u + p.width / 2).toBeLessThanOrEqual(longueur + 1e-6)
            expect(p.centerHeight).toBeGreaterThan(0)
            if (i > 0) {
              const precedent = poses[i - 1]
              expect(p.u - p.width / 2).toBeGreaterThanOrEqual(
                precedent.u + precedent.width / 2 - 1e-6,
              )
            }
          })
        }
      }
    }
  })

  it('est déterministe sur le corpus réel', () => {
    expect(JSON.stringify(reel())).toBe(JSON.stringify(reel()))
  })

  it('survit à une curation qui déplace, exclut, renomme et épingle en même temps', () => {
    const reference = reel()
    const salle = reference.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)[0]
    const autre = reference.floors.filter((f) => f.level > 0).flatMap((f) => f.rooms)[1]
    const m = reel(
      curation({
        repos: {
          [salle.keys[0]]: { room: identifiantDeSalle(autre.name) },
          [salle.keys[1]]: { room: 'reserve' },
          [salle.keys[2]]: { featured: true, title: 'Pièce maîtresse' },
          'phmatray/depot-disparu': { include: true },
        },
        rooms: { [identifiantDeSalle(autre.name)]: { name: 'Grande galerie' } },
        excluded: [salle.keys[3]],
      }),
    )
    const accrochees = clesAccrochees(m)
    expect(new Set(accrochees).size).toBe(accrochees.length)
    expect(accrochees).toHaveLength(m.stats.artworkCount)
    expect(accrochees).not.toContain(salle.keys[3])
    expect(m.floors.flatMap((f) => f.rooms).some((r) => r.name === 'Grande galerie')).toBe(true)
    expect(m.warnings.some((w) => w.includes('phmatray/depot-disparu'))).toBe(true)
  })

  it('imprime un plan lisible du bâtiment réel', () => {
    const m = reel()
    const texte = formatPlan(m)
    expect(texte).toContain('Atypical Museum')
    // La ligne de comptage est construite à partir du musée obtenu, pas d'un
    // nombre figé : c'est le FORMAT qu'on vérifie, pas la taille du portefeuille.
    expect(texte).toContain(
      `${CATALOGUE_REEL.artworks.length} dépôts · ${m.stats.artworkCount} retenus`,
    )
    expect(texte.split('\n').length).toBeGreaterThan(40)
  })
})
