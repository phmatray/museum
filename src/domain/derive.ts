/**
 * LOT 1 — Dérivation du musée (spec §4.4, §5, §7).
 *
 * C'est la fonction pivot du projet : elle prend les trois fichiers d'entrée —
 * le catalogue généré, la curation écrite à la main, la configuration
 * d'instance — et produit le `Museum` que la scène n'aura plus qu'à rendre.
 * Le même code tourne au build pour la production et en direct dans l'éditeur.
 *
 * L'enchaînement, dans cet ordre et pas un autre :
 *
 *   1. SÉLECTION   filtres de configuration, exclusions et inclusions forcées
 *                  de la curation ; séparation réserve / galerie
 *   2. HONNEUR     les `featured` de la curation, complétés au score `honneur`
 *   3. CLUSTERING  sur la galerie, œuvres maîtresses COMPRISES : N et les IDF
 *                  ne doivent pas dépendre de la salle d'honneur (spec §7.1)
 *   4. AFFECTATION les `room` de la curation déplacent une œuvre d'une salle à
 *                  l'autre, ou la descendent en réserve
 *   5. BÂTIMENT    `planBuilding`, puis les overrides de salle (nom, thème)
 *   6. ACCROCHAGE  `hangRoom` sur chaque salle
 *
 * DEUX RÈGLES ABSOLUES, toutes deux testées :
 *
 *  - Aucune horloge. `generatedAt` vient du catalogue, jamais de `Date.now()`,
 *    et le score de récence se mesure depuis cette même date. Deux dérivations
 *    du même catalogue donnent le même musée, octet pour octet, même à un an
 *    d'intervalle.
 *  - Aucune anomalie bloquante. Une clé orpheline, une salle inexistante, une
 *    tuile manquante : tout cela produit un avertissement et un musée quand
 *    même. Le site ne doit pas tomber parce qu'un dépôt a été renommé.
 *
 * Aucun import graphique : ce module tourne dans vitest sans canvas et dans
 * Node au moment du build.
 */
import { clusterArtworks, type Cluster } from './clustering'
import { hangRoom, type HangEntry } from './hanging'
import { planBuilding, rampSlopeDegrees } from './layout'
import type {
  Artwork,
  AtlasIndex,
  Catalogue,
  Curation,
  Floor,
  Museum,
  MuseumConfig,
  RepoKey,
  Room,
  RoomOverride,
} from './types'

// ── Contrat public ───────────────────────────────────────────────────────

/**
 * Atlas de repli quand le pipeline média n'a pas encore tourné.
 *
 * Les tuiles gardent la GÉOMÉTRIE du vrai atlas (spec §5) : c'est elle qui donne
 * le rapport largeur/hauteur des cadres, et un musée dérivé sans médias doit
 * tout de même accrocher des œuvres de la bonne forme — sinon la mise en page
 * changerait le jour où les images arrivent.
 *
 * Exporté ici et non recopié chez ses deux appelants : l'outil de dérivation et
 * l'éditeur doivent produire le MÊME bâtiment à partir des mêmes entrées, ce
 * qu'une seconde copie divergente rendrait faux sans prévenir.
 */
export const ATLAS_VIDE: AtlasIndex = Object.freeze({
  schemaVersion: 1,
  tileWidth: 256,
  tileHeight: 128,
  cols: 16,
  rows: 16,
  atlases: [],
  entries: {},
})

export interface DeriveInput {
  catalogue: Catalogue
  curation: Curation
  config: MuseumConfig
  atlas: AtlasIndex
}

/** Résultat du tri initial du catalogue, avant toute géométrie. */
export interface Selection {
  /** Tout ce qui entre au musée, trié par clé. */
  kept: Artwork[]
  /** Ce qui est exposé dans les salles thématiques (donc hors réserve). */
  gallery: Artwork[]
  /** Forks et archivés conservés : ils descendent au niveau −1 (spec §7.1). */
  vault: Artwork[]
  /** Œuvres maîtresses du rez-de-chaussée, triées par clé. */
  featured: RepoKey[]
  /** Dépôts du catalogue qui n'entrent pas au musée. */
  excludedCount: number
  warnings: string[]
}

/** Complément automatique de la salle d'honneur (spec §7.1). */
export const MAX_FEATURED = 12

/** Fenêtre de la composante de récence du score `honneur`, en jours. */
export const FENETRE_RECENCE_JOURS = 365

const JOUR_MS = 86_400_000

/**
 * Au-delà, les clés manquantes sont résumées en une ligne. Un atlas absent
 * produirait sinon un avertissement par dépôt et noierait les vrais problèmes.
 */
const MAX_CLES_LISTEES = 8

/** Rapport largeur/hauteur de repli si l'atlas ne dit rien de ses tuiles. */
const ASPECT_PAR_DEFAUT = 2

/** Noms acceptés pour viser la réserve depuis la curation. */
const ALIAS_RESERVE = new Set(['reserve', 'vault'])

/** Noms acceptés pour viser la salle d'honneur depuis `curation.rooms`. */
const ALIAS_HONNEUR = new Set(['honneur', 'salle-d-honneur', 'honour', 'featured'])

/** Champs de `RoomOverride` que la disposition du lot 1 ne sait pas encore honorer. */
const CHAMPS_SALLE_NON_GERES = ['floor', 'order', 'hidden'] as const

// ── Utilitaires ──────────────────────────────────────────────────────────

function compareCles(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Arrondi au micromètre, comme `layout.ts` : les coordonnées restent lisibles. */
function round(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

/**
 * Forme normalisée d'un nom de salle. C'est la clé sous laquelle la curation
 * désigne une salle, et elle doit tolérer ce qu'un humain écrit à la main :
 * « Blazor / MudBlazor », « blazor-mudblazor » et « Blazor / Mudblazor »
 * désignent la même salle.
 *
 * Les diacritiques sont repliés — « Réserve » et « reserve » sont la même
 * salle. La curation est un fichier JSON écrit au clavier ; exiger un accent
 * dans une clé serait un piège, d'autant que la comparaison s'applique des deux
 * côtés et laisse donc les identifiants de `clustering.ts` intacts.
 */
export function identifiantDeSalle(nom: string): string {
  const s = nom
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return s.length > 0 ? s : 'salle'
}

/**
 * Glob sur `owner/name` (spec §4.3). `*` ne franchit pas le `/`, `**` le
 * franchit, `?` vaut un caractère. La comparaison ignore la casse : GitHub
 * lui-même ne la distingue pas, et un motif `Atypical-*` qui ne prendrait pas
 * `atypical-consulting/x` serait un piège.
 */
export function correspondAuGlob(cle: string, motif: string): boolean {
  let source = '^'
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i]
    if (c === '*') {
      if (motif[i + 1] === '*') {
        source += '.*'
        i++
      } else {
        source += '[^/]*'
      }
    } else if (c === '?') {
      source += '[^/]'
    } else {
      source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`, 'i').test(cle)
}

/**
 * Jours écoulés entre `iso` et la date de référence — celle du catalogue, JAMAIS
 * l'horloge du build (spec §7.1). Une date illisible renvoie l'infini, donc une
 * récence nulle : mieux vaut ne pas récompenser que récompenser au hasard.
 */
function joursDepuis(iso: string, reference: string): number {
  const t = Date.parse(iso)
  const ref = Date.parse(reference)
  if (!Number.isFinite(t) || !Number.isFinite(ref)) return Number.POSITIVE_INFINITY
  return Math.max(0, (ref - t) / JOUR_MS)
}

/**
 * Score de sélection de la salle d'honneur (spec §7.1) :
 *
 *   clamp(2 × log10(1 + étoiles), 0, 3)  +  max(0, 1 − jours / 365)
 *
 * Les deux termes sont normalisés dans des plages comparables. Sans ces bornes,
 * additionner des étoiles brutes et une récence donne une somme dominée par le
 * plus grand des deux, et le score se réduit à un tri par étoiles.
 */
export function honourScore(artwork: Artwork, reference: string): number {
  const etoiles = Number.isFinite(artwork.stars) && artwork.stars > 0 ? artwork.stars : 0
  const notoriete = Math.min(3, Math.max(0, 2 * Math.log10(1 + etoiles)))
  const recence = Math.max(0, 1 - joursDepuis(artwork.pushedAt, reference) / FENETRE_RECENCE_JOURS)
  return notoriete + recence
}

// ── Sélection ────────────────────────────────────────────────────────────

/**
 * Tri par clé et dédoublonnage, comme `clustering.ts` : l'ordre du catalogue ne
 * doit influencer ni le musée ni le JSON produit.
 */
function indexerCatalogue(catalogue: Catalogue): Map<RepoKey, Artwork> {
  const index = new Map<RepoKey, Artwork>()
  for (const artwork of catalogue.artworks) {
    if (!index.has(artwork.key)) index.set(artwork.key, artwork)
  }
  return new Map([...index.entries()].sort(([a], [b]) => compareCles(a, b)))
}

/**
 * Les filtres de `museum.config.json`. `requireTopics` se lit comme une liste
 * blanche de thèmes : un dépôt passe s'il en porte AU MOINS un. L'exiger tous
 * ne laisserait à peu près rien passer sur un corpus réel.
 */
function passeLesFiltres(artwork: Artwork, filtres: MuseumConfig['filters']): boolean {
  if (filtres.excludeForks && artwork.isFork) return false
  if (filtres.excludeArchived && artwork.isArchived) return false
  if (filtres.minStars !== undefined && artwork.stars < filtres.minStars) return false
  if (filtres.requireTopics && filtres.requireTopics.length > 0) {
    const voulus = new Set(filtres.requireTopics.map((t) => t.toLowerCase()))
    if (!artwork.topics.some((t) => voulus.has(t.toLowerCase()))) return false
  }
  if (filtres.excludePatterns?.some((motif) => correspondAuGlob(artwork.key, motif))) return false
  return true
}

/**
 * Premier étage du pipeline : qui entre, qui reste dehors, qui descend en
 * réserve, qui monte en salle d'honneur.
 *
 * La distinction porte tout le reste : un filtre `excludeX` à `true` ÉCARTE le
 * dépôt du musée, à `false` il le CONSERVE mais l'envoie en réserve s'il est
 * fork ou archivé (spec §4.3 et §7.1). Sur la configuration de référence, cela
 * donne les trois nombres annoncés par le spec : 115 au catalogue, 100 retenus,
 * 72 en galerie.
 */
export function selectArtworks(input: Omit<DeriveInput, 'atlas'>): Selection {
  const { catalogue, curation, config } = input
  const warnings: string[] = []
  const index = indexerCatalogue(catalogue)
  const overrides = curation.repos ?? {}

  // Une clé orpheline signale un dépôt renommé, passé en privé ou supprimé :
  // l'override ne s'appliquera jamais et c'est invisible sans avertissement.
  for (const cle of Object.keys(overrides).sort(compareCles)) {
    if (!index.has(cle)) {
      warnings.push(`curation.repos["${cle}"] — dépôt absent du catalogue, override sans effet`)
    }
  }
  const exclues = new Set(curation.excluded ?? [])
  for (const cle of [...exclues].sort(compareCles)) {
    if (!index.has(cle)) {
      warnings.push(`curation.excluded — "${cle}" absent du catalogue, exclusion sans effet`)
    }
  }

  const kept: Artwork[] = []
  const gallery: Artwork[] = []
  const vault: Artwork[] = []
  let excludedCount = 0

  for (const artwork of index.values()) {
    const o = overrides[artwork.key] ?? {}
    const refuse = exclues.has(artwork.key) || o.include === false
    const force = o.include === true
    if (refuse || (!force && !passeLesFiltres(artwork, config.filters))) {
      excludedCount++
      if (o.featured === true) {
        const raison = refuse ? 'explicitement exclu' : 'écarté par les filtres'
        warnings.push(
          `curation.repos["${artwork.key}"] — marqué featured mais ${raison} : pas de salle d'honneur pour lui`,
        )
      }
      continue
    }
    kept.push(artwork)
    // Un fork ou un archivé retenu ne va pas dans l'anneau : il descend au
    // niveau −1, où l'accrochage est dense et l'éclairage minimal.
    if (artwork.isFork || artwork.isArchived) vault.push(artwork)
    else gallery.push(artwork)
  }

  // Salle d'honneur : la volonté humaine d'abord, le score ensuite.
  //
  // Un dépôt dont la curation a fixé la salle est hors du complément
  // automatique : le curateur a déjà dit où il le voulait, et un accrochage en
  // salle d'honneur est EXCLUSIF — il l'aurait décroché de la salle demandée.
  const explicites = new Set(kept.filter((a) => overrides[a.key]?.featured === true).map((a) => a.key))
  const complement = gallery
    .filter((a) => !explicites.has(a.key) && overrides[a.key]?.room === undefined)
    .sort((a, b) => {
      const d = honourScore(b, catalogue.generatedAt) - honourScore(a, catalogue.generatedAt)
      return d !== 0 ? d : compareCles(a.key, b.key)
    })
    .slice(0, Math.max(0, MAX_FEATURED - explicites.size))
    .map((a) => a.key)
  const featured = [...explicites, ...complement].sort(compareCles)

  return { kept, gallery, vault, featured, excludedCount, warnings }
}

// ── Affectation manuelle des salles ──────────────────────────────────────

/** Toutes les orthographes sous lesquelles la curation peut viser ce cluster. */
function aliasDeCluster(cluster: Cluster): string[] {
  return [identifiantDeSalle(cluster.id), identifiantDeSalle(cluster.name)]
}

/**
 * `curation.repos[].room` force l'affectation (spec §4.2). La cible peut être
 * un cluster — désigné par son identifiant ou par son nom — ou la réserve, ce
 * dernier cas étant le « décrocher → réserve » de l'éditeur (spec §10).
 *
 * Une cible inconnue n'écarte pas l'œuvre : elle reste où le clustering l'avait
 * mise, et l'anomalie est signalée. Perdre une œuvre parce qu'un nom de salle a
 * changé serait le pire des comportements.
 */
function affecteSalles(
  clusters: Cluster[],
  curation: Curation,
  retenues: Set<RepoKey>,
  vault: Set<RepoKey>,
  warnings: string[],
): Cluster[] {
  const overrides = curation.repos ?? {}
  const demandes = Object.entries(overrides)
    .filter(([cle, o]) => typeof o.room === 'string' && o.room.length > 0 && retenues.has(cle))
    .sort(([a], [b]) => compareCles(a, b))
  if (demandes.length === 0) return clusters

  const parAlias = new Map<string, number>()
  clusters.forEach((cluster, i) => {
    for (const alias of aliasDeCluster(cluster)) if (!parAlias.has(alias)) parAlias.set(alias, i)
  })
  const membres = clusters.map((c) => new Set(c.keys))

  for (const [cle, o] of demandes) {
    const cible = identifiantDeSalle(o.room as string)
    if (ALIAS_RESERVE.has(cible)) {
      for (const groupe of membres) groupe.delete(cle)
      vault.add(cle)
      continue
    }
    const i = parAlias.get(cible)
    if (i === undefined) {
      warnings.push(
        `curation.repos["${cle}"].room = "${o.room}" — aucune salle de ce nom, affectation automatique conservée`,
      )
      continue
    }
    for (const groupe of membres) groupe.delete(cle)
    vault.delete(cle)
    membres[i].add(cle)
  }

  return clusters
    .map((cluster, i) => ({ ...cluster, keys: [...membres[i]].sort(compareCles) }))
    .filter((cluster) => cluster.keys.length > 0)
}

// ── Overrides de salle ───────────────────────────────────────────────────

/**
 * Applique `curation.rooms` sur les salles bâties.
 *
 * Les identifiants de salle produits par `layout.ts` sont POSITIONNELS
 * (`etage-1-north-0`) : ils bougent dès qu'un cluster change d'étage ou de côté,
 * donc une curation qui ne les viserait que par là serait orpheline au premier
 * refetch. On accepte donc aussi l'identifiant du cluster, qui lui est stable
 * tant que le thème existe, et — seconde passe — le nom déjà remplacé, pour que
 * `{ "nouveau-nom": { "theme": … } }` continue de porter après un renommage.
 */
function appliqueOverridesDeSalle(
  salles: Room[][],
  clusterParSalle: Map<Room, Cluster>,
  niveaux: number[],
  curation: Curation,
  warnings: string[],
): void {
  const overrides = curation.rooms ?? {}
  const cles = Object.keys(overrides).sort(compareCles)
  if (cles.length === 0) return

  const toutes: { room: Room; etage: number; index: number }[] = []
  salles.forEach((plateau, etage) =>
    plateau.forEach((room, index) => toutes.push({ room, etage, index })),
  )

  const alias = (cible: { room: Room; etage: number }): string[] => {
    const noms = [identifiantDeSalle(cible.room.id)]
    const cluster = clusterParSalle.get(cible.room)
    if (cluster) noms.push(...aliasDeCluster(cluster))
    if (niveaux[cible.etage] < 0) noms.push(...ALIAS_RESERVE)
    else if (niveaux[cible.etage] === 0 && !cluster) noms.push(...ALIAS_HONNEUR)
    return noms
  }

  const applique = (cible: { room: Room; etage: number; index: number }, o: RoomOverride): void => {
    const modifiee: Room = { ...cible.room }
    if (o.name) modifiee.name = o.name
    if (o.theme) modifiee.theme = o.theme
    salles[cible.etage][cible.index] = modifiee
    const cluster = clusterParSalle.get(cible.room)
    if (cluster) clusterParSalle.set(modifiee, cluster)
    cible.room = modifiee
  }

  const enAttente: string[] = []
  for (const cle of cles) {
    const voulu = identifiantDeSalle(cle)
    const cible = toutes.find((c) => alias(c).includes(voulu))
    if (!cible) {
      enAttente.push(cle)
      continue
    }
    applique(cible, overrides[cle])
  }

  // Seconde passe : la clé désigne peut-être le nom qu'un override vient tout
  // juste de poser. C'est ce qui rend un renommage idempotent d'un build à l'autre.
  for (const cle of enAttente) {
    const voulu = identifiantDeSalle(cle)
    const cible = toutes.find(
      (c) => identifiantDeSalle(salles[c.etage][c.index].name) === voulu,
    )
    if (!cible) {
      warnings.push(`curation.rooms["${cle}"] — aucune salle de ce nom, override ignoré`)
      continue
    }
    applique({ ...cible, room: salles[cible.etage][cible.index] }, overrides[cle])
  }

  for (const cle of cles) {
    const o = overrides[cle]
    const ignores = CHAMPS_SALLE_NON_GERES.filter((champ) => o[champ] !== undefined)
    if (ignores.length > 0) {
      warnings.push(
        `curation.rooms["${cle}"] — ${ignores.join(', ')} : la disposition du lot 1 ne sait pas encore déplacer une salle, champ ignoré`,
      )
    }
  }
}

// ── Accrochage ───────────────────────────────────────────────────────────

/**
 * Une entrée d'accrochage par dépôt retenu.
 *
 * L'aspect vient de la GRILLE de l'atlas et n'est jamais codé en dur (spec
 * §7.4) : le pipeline média peut décider demain de tuiles carrées, ou la
 * curation fournir une image d'un autre format, sans qu'aucun cadre ne se
 * déforme ici.
 */
function fabriqueEntrees(
  kept: Artwork[],
  curation: Curation,
  atlas: AtlasIndex,
): { parCle: Map<RepoKey, HangEntry>; manquants: RepoKey[] } {
  const aspect =
    atlas.tileWidth > 0 && atlas.tileHeight > 0
      ? atlas.tileWidth / atlas.tileHeight
      : ASPECT_PAR_DEFAUT
  const entrees = atlas.entries ?? {}
  const parCle = new Map<RepoKey, HangEntry>()
  const manquants: RepoKey[] = []

  for (const artwork of kept) {
    const tuile = entrees[artwork.key]
    if (!tuile) manquants.push(artwork.key)
    const placement = curation.repos?.[artwork.key]?.placement
    const entree: HangEntry = {
      key: artwork.key,
      stars: artwork.stars,
      aspect,
      atlas: tuile?.atlas ?? 0,
      layer: tuile?.layer ?? 0,
    }
    if (placement) {
      entree.pinned = { u: placement.u, scale: placement.scale, wallId: placement.wallId }
    }
    parCle.set(artwork.key, entree)
  }

  return { parCle, manquants }
}

// ── Point d'entrée ───────────────────────────────────────────────────────

/**
 * Catalogue + curation + configuration + atlas → musée complet.
 *
 * Pure au sens strict : ni horloge, ni aléa, ni entrée-sortie. Les entrées ne
 * sont jamais mutées — `EMPTY_CURATION` est gelée et un appelant peut passer la
 * même curation deux fois de suite sans surprise.
 */
export function derive(input: DeriveInput): Museum {
  const { catalogue, curation, config, atlas } = input
  const selection = selectArtworks({ catalogue, curation, config })
  const warnings = [...selection.warnings]
  const retenues = new Set(selection.kept.map((a) => a.key))

  const featured = new Set(selection.featured)
  const vault = new Set(selection.vault.map((a) => a.key))

  // Les œuvres maîtresses restent dans le corpus de clustering : N et les IDF
  // ne doivent pas dépendre du contenu de la salle d'honneur (spec §7.1).
  let clusters = clusterArtworks(selection.gallery, {
    minSize: config.clustering.minClusterSize,
    maxSize: config.clustering.maxClusterSize,
  })
  clusters = affecteSalles(clusters, curation, retenues, vault, warnings)

  // …mais leur accrochage est exclusif : elles quittent les murs de leur salle
  // thématique et ceux de la réserve.
  for (const cle of featured) vault.delete(cle)
  clusters = clusters
    .map((cluster) => ({ ...cluster, keys: cluster.keys.filter((cle) => !featured.has(cle)) }))
    .filter((cluster) => cluster.keys.length > 0)

  const plan = planBuilding({
    clusters,
    featured: [...featured].sort(compareCles),
    vault: [...vault].sort(compareCles),
    config,
  })

  // Une salle de collection s'identifie par la plus petite clé qu'elle expose :
  // les clusters sont disjoints, et `layout.ts` recopie leurs clés telles quelles.
  const clusterParPremiereCle = new Map<RepoKey, Cluster>()
  for (const cluster of clusters) clusterParPremiereCle.set(cluster.keys[0], cluster)

  const salles = plan.floors.map((floor) => floor.rooms.map((room) => ({ ...room })))
  const clusterParSalle = new Map<Room, Cluster>()
  salles.forEach((plateau, i) => {
    if (plan.floors[i].level < 0) return
    for (const room of plateau) {
      const cluster = room.keys.length > 0 ? clusterParPremiereCle.get(room.keys[0]) : undefined
      if (cluster) clusterParSalle.set(room, cluster)
    }
  })
  appliqueOverridesDeSalle(
    salles,
    clusterParSalle,
    plan.floors.map((f) => f.level),
    curation,
    warnings,
  )

  const { parCle, manquants } = fabriqueEntrees(selection.kept, curation, atlas)
  if (manquants.length > MAX_CLES_LISTEES) {
    warnings.push(
      `atlas.json — ${manquants.length} dépôts sans tuile (dont ${manquants
        .slice(0, MAX_CLES_LISTEES)
        .join(', ')}) : couche 0 par défaut`,
    )
  } else {
    for (const cle of manquants) {
      warnings.push(`atlas.json — "${cle}" n'a pas de tuile, couche 0 par défaut`)
    }
  }

  const floors: Floor[] = plan.floors.map((floor, i) => ({
    ...floor,
    rooms: salles[i].map((room) => {
      const entrees = room.keys.map((cle) => parCle.get(cle)).filter((e): e is HangEntry => !!e)
      return hangRoom(room, entrees)
    }),
  }))

  // Point d'apparition : dans l'aile Sud du rez-de-chaussée, face au vide.
  // Surtout PAS dans l'atrium — dès qu'une réserve existe, la dalle y est
  // percée et le visiteur naîtrait dans le trou.
  const rdc = floors.find((f) => f.level === 0) ?? floors[0]
  const { atrium } = plan
  const spawn = {
    floorId: rdc.id,
    position: {
      x: round(atrium.x + atrium.width / 2),
      y: rdc.elevation,
      z: round(atrium.z + atrium.depth + config.building.roomDepth / 2),
    },
    // Cap 0 : le regard part vers le Nord, donc vers l'atrium et les rampes.
    yaw: 0,
  }

  const artworks: Record<RepoKey, Artwork> = {}
  for (const artwork of selection.kept) {
    const titre = curation.repos?.[artwork.key]?.title
    artworks[artwork.key] = titre ? { ...artwork, title: titre } : artwork
  }

  return {
    config,
    generatedAt: catalogue.generatedAt,
    floors,
    ramps: plan.ramps,
    atrium: plan.atrium,
    spawn,
    artworks,
    stats: {
      artworkCount: selection.kept.length,
      roomCount: floors.reduce((n, f) => n + f.rooms.length, 0),
      floorCount: floors.length,
      excludedCount: selection.excludedCount,
      vaultCount: vault.size,
    },
    warnings,
  }
}

// ── Plan en texte ────────────────────────────────────────────────────────

function metres(v: number): string {
  return v.toFixed(1)
}

/**
 * Rendu lisible du musée dérivé — la sortie de `npm run plan`, et le critère de
 * fin du lot 1 (spec §13).
 *
 * Il vit dans le domaine, pas dans `tools/`, pour deux raisons : il est pur, donc
 * testable ; et c'est le seul endroit d'où l'on peut afficher la clé de curation
 * d'une salle, celle qu'un curateur devra recopier dans `curation.json`.
 */
export function formatPlan(museum: Museum): string {
  const lignes: string[] = []
  const { stats, atrium } = museum
  const emprise = museum.floors[0]?.footprint

  lignes.push(museum.config.name)
  lignes.push(`plan dérivé du catalogue du ${museum.generatedAt}`)
  lignes.push('')
  lignes.push(
    `catalogue   ${stats.artworkCount + stats.excludedCount} dépôts · ${stats.artworkCount} retenus · ` +
      `${stats.excludedCount} écartés · ${stats.vaultCount} en réserve`,
  )
  lignes.push(
    `bâtiment    ${stats.floorCount} niveaux · ${stats.roomCount} salles · ` +
      `atrium ${metres(atrium.width)} × ${metres(atrium.depth)} m` +
      (emprise ? ` · emprise ${metres(emprise.width)} × ${metres(emprise.depth)} m` : ''),
  )
  const rampe = museum.ramps[0]
  lignes.push(
    rampe
      ? `rampes      ${museum.ramps.length} · rayon ${metres(rampe.radius)} m · ` +
          `balayage ${((rampe.sweep * 180) / Math.PI).toFixed(0)}° · pente ${rampeEnDegres(rampe)}°`
      : 'rampes      aucune (bâtiment sur un seul niveau)',
  )
  lignes.push(
    `départ      ${museum.spawn.floorId} en (${metres(museum.spawn.position.x)}, ` +
      `${metres(museum.spawn.position.y)}, ${metres(museum.spawn.position.z)}) · cap ${museum.spawn.yaw}°`,
  )

  for (const floor of museum.floors) {
    lignes.push('')
    lignes.push(
      `── ${floor.name} — niveau ${floor.level} · élévation ${metres(floor.elevation)} m · ` +
        `plafond ${metres(floor.ceilingHeight)} m · ${floor.rooms.length} salle(s)`,
    )
    if (floor.rooms.length === 0) lignes.push('   (plateau vide)')

    for (const room of floor.rooms) {
      const accrochees = room.walls.reduce((n, w) => n + w.placements.length, 0)
      const orphelines = room.keys.length - accrochees
      lignes.push('')
      lignes.push(
        `   ${room.name}   [${room.theme}] ${room.side} · ` +
          `${metres(room.footprint.width)} × ${metres(room.footprint.depth)} m`,
      )
      lignes.push(
        `     salle ${room.id} · clé de curation « ${identifiantDeSalle(room.name)} »`,
      )
      lignes.push(
        `     ${room.keys.length} œuvre(s) · ${accrochees} accrochée(s)` +
          (orphelines > 0 ? ` · ${orphelines} SANS PLACE` : ''),
      )
      lignes.push(`     thèmes : ${room.topics.length > 0 ? room.topics.join(', ') : '—'}`)
      for (const wall of room.walls) {
        const longueur = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z)
        lignes.push(
          `     ${wall.id.padEnd(26)} ${wall.kind.padEnd(6)} ${metres(longueur).padStart(5)} m · ` +
            `${wall.openings.length} ouverture(s) · ${String(wall.placements.length).padStart(2)} accrochage(s)`,
        )
      }
    }
  }

  lignes.push('')
  if (museum.warnings.length === 0) {
    lignes.push('aucun avertissement')
  } else {
    lignes.push(`avertissements (${museum.warnings.length}) :`)
    for (const avertissement of museum.warnings) lignes.push(`  • ${avertissement}`)
  }

  return lignes.join('\n')
}

function rampeEnDegres(rampe: Museum['ramps'][number]): string {
  return rampSlopeDegrees(rampe).toFixed(1)
}
