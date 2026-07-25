/**
 * Le contrat de domaine du musée.
 *
 * Règle absolue de ce dossier : AUCUN import de `three`, de `react` ou de quoi
 * que ce soit de graphique. Tout ce qui est ici doit pouvoir tourner dans un
 * test vitest sans canvas, et dans un script Node au moment du build.
 *
 * Trois familles de types, qui correspondent aux trois étages du pipeline :
 *
 *   Catalogue  généré depuis GitHub, jetable, écrasé à chaque build
 *   Curation   écrite à la main ou par l'éditeur, commitée, tout est optionnel
 *   Museum     dérivé des deux par `derive()`, jamais stocké à la main
 */

// ── Géométrie élémentaire ────────────────────────────────────────────────

export interface Vec2 {
  x: number
  z: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Rectangle aligné sur les axes, exprimé par son coin minimal et sa taille. */
export interface Rect {
  x: number
  z: number
  width: number
  depth: number
}

// ── Étage 1 : catalogue ──────────────────────────────────────────────────

/**
 * `owner/name`. C'est le SEUL identifiant qui traverse un refetch : le
 * catalogue est écrasé chaque nuit, la curation référence les dépôts par
 * cette clé et survit donc à l'écrasement.
 */
export type RepoKey = string

export interface Artwork {
  key: RepoKey
  owner: string
  name: string
  title: string
  description: string
  url: string
  homepage: string | null
  topics: string[]
  language: string | null
  languages: Record<string, number>
  stars: number
  forks: number
  openIssues: number
  isFork: boolean
  isArchived: boolean
  isTemplate: boolean
  createdAt: string
  pushedAt: string
  license: string | null
  readmeExcerpt: string
}

export interface Catalogue {
  schemaVersion: 1
  generatedAt: string
  owners: string[]
  artworks: Artwork[]
}

/**
 * Correspondance produite par le pipeline média : où trouver la tuile de
 * chaque dépôt dans les atlas. Séparée du catalogue parce qu'elle est produite
 * par une étape différente et peut être régénérée seule.
 */
export interface AtlasIndex {
  schemaVersion: 1
  tileWidth: number
  tileHeight: number
  cols: number
  rows: number
  atlases: string[]
  entries: Record<RepoKey, { atlas: number; layer: number }>
}

// ── Étage 2 : curation ───────────────────────────────────────────────────

export type ThemeId = 'classic' | 'modern' | 'immersive' | 'vault'

export interface RepoOverride {
  include?: boolean
  featured?: boolean
  room?: string
  title?: string
  blurb?: string
  image?: string
  placement?: { wallId: string; u: number; scale?: number }
}

export interface RoomOverride {
  name?: string
  floor?: number
  theme?: ThemeId
  order?: number
  hidden?: boolean
}

export interface Curation {
  schemaVersion: 1
  repos: Record<RepoKey, RepoOverride>
  rooms: Record<string, RoomOverride>
  excluded: RepoKey[]
}

// ── Configuration d'instance ─────────────────────────────────────────────

export interface MuseumConfig {
  schemaVersion: 1
  name: string
  owners: string[]
  filters: {
    excludeForks: boolean
    excludeArchived: boolean
    minStars?: number
    requireTopics?: string[]
    excludePatterns?: string[]
  }
  building: {
    roomDepth: number
    ceilingHeight: number
    slabThickness: number
    minAtriumSize: number
    minRoomWidth: number
    roomsPerFloor: number
  }
  clustering: {
    minClusterSize: number
    maxClusterSize: number
  }
}

// ── Étage 3 : bâtiment dérivé ────────────────────────────────────────────

export type Side = 'north' | 'east' | 'south' | 'west'

export type WallKind = 'outer' | 'side' | 'inner'

/** Ouverture dans un mur, en mètres depuis l'extrémité `a`. */
export interface Opening {
  kind: 'door' | 'bay'
  start: number
  end: number
  height: number
}

export interface Placement {
  key: RepoKey
  /** Centre de l'œuvre le long du mur, en mètres depuis `a`. */
  u: number
  /** Hauteur de l'axe au-dessus du plancher. 1.45 par défaut (standard muséal). */
  centerHeight: number
  width: number
  height: number
  atlas: number
  layer: number
  /** Vrai si la position vient d'un override de curation : exclue de la répartition. */
  pinned: boolean
}

export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  height: number
  kind: WallKind
  /** Normale horizontale pointant vers l'intérieur de la salle. */
  normal: Vec2
  openings: Opening[]
  placements: Placement[]
}

export interface Room {
  id: string
  name: string
  side: Side
  footprint: Rect
  theme: ThemeId
  walls: Wall[]
  /** Les topics de plus fort IDF du cluster, pour le cartel de salle. */
  topics: string[]
  keys: RepoKey[]
}

export interface Ramp {
  id: string
  fromFloor: string
  toFloor: string
  centre: Vec2
  radius: number
  startAngle: number
  /** Balayage en radians. π = demi-tour par niveau. */
  sweep: number
  width: number
  /** Dénivelé total, en mètres. */
  rise: number
  baseElevation: number
}

export interface Floor {
  id: string
  name: string
  /** -1 = réserve, 0 = rez-de-chaussée, 1+ = étages. */
  level: number
  /** CALCULÉE depuis les niveaux inférieurs. Jamais saisie. */
  elevation: number
  ceilingHeight: number
  rooms: Room[]
  /** Trémies. L'atrium en est une, présente à tous les niveaux sauf le plus bas. */
  slabHoles: Rect[]
  /** Emprise de la dalle de ce niveau. */
  footprint: Rect
}

export interface Museum {
  config: MuseumConfig
  generatedAt: string
  floors: Floor[]
  ramps: Ramp[]
  atrium: Rect
  spawn: { floorId: string; position: Vec3; yaw: number }
  /** Dépôts retenus, indexés par clé, pour les cartels et les panneaux. */
  artworks: Record<RepoKey, Artwork>
  stats: {
    artworkCount: number
    roomCount: number
    floorCount: number
    excludedCount: number
    vaultCount: number
  }
  /** Anomalies non bloquantes : clés de curation orphelines, etc. */
  warnings: string[]
}

// ── Constantes partagées ─────────────────────────────────────────────────

/** Standard muséal : axe des œuvres à 57 pouces du sol. */
export const MUSEUM_HANG_HEIGHT = 1.45

/** Marge laissée libre à chaque extrémité d'un mur, en mètres. */
export const WALL_CORNER_MARGIN = 0.5

/** Espacement minimal entre deux cadres, en mètres. */
export const MIN_ARTWORK_GAP = 0.6

/** Espacement maximal avant de centrer le groupe plutôt que de l'étaler. */
export const MAX_ARTWORK_GAP = 2.5

/** Un segment de mur plus court que ça ne peut rien recevoir. */
export const MIN_USABLE_SEGMENT = 1.2
