/**
 * LOT 1 — Validation des fichiers d'entrée du musée.
 *
 * Quatre fichiers entrent dans le pipeline, et ils n'ont pas le même auteur :
 * `catalogue.json` et `atlas.json` sortent d'un script, `museum.config.json`
 * et `curation.json` sortent des doigts d'un humain. D'où l'asymétrie assumée
 * de ce module : les fichiers GÉNÉRÉS tolèrent les champs inconnus (une
 * version ultérieure du générateur ne doit pas casser un ancien build), les
 * fichiers ÉCRITS À LA MAIN les refusent — `excludeFork` au lieu de
 * `excludeForks` doit sauter aux yeux, pas être ignoré en silence.
 *
 * Les messages sont reformatés intégralement : « Invalid input: expected
 * number » ne dit pas à quelqu'un qui édite du JSON dans un éditeur de texte
 * quelle ligne reprendre. On donne toujours les trois mêmes choses : le chemin
 * du champ, ce qui était attendu, ce qui a été reçu.
 *
 * Zéro import graphique ici : ce module tourne dans vitest sans canvas et dans
 * Node au moment du build.
 */
import { z } from 'zod'
import type {
  AtlasIndex,
  Catalogue,
  Curation,
  MuseumConfig,
} from '../domain/types'

/** Seule version de schéma que ce code sait lire. */
export const SCHEMA_VERSION = 1

const FICHIER_CATALOGUE = 'catalogue.json'
const FICHIER_CURATION = 'curation.json'
const FICHIER_CONFIG = 'museum.config.json'
const FICHIER_ATLAS = 'atlas.json'

// ── Erreur ───────────────────────────────────────────────────────────────

/**
 * Erreur de validation d'un fichier. `details` porte une ligne par problème,
 * déjà rédigée : un appelant qui veut afficher les erreurs autrement (éditeur,
 * sortie CI) n'a pas à re-traverser les `ZodIssue`.
 */
export class SchemaError extends Error {
  readonly fichier: string
  readonly details: string[]

  constructor(fichier: string, details: string[]) {
    const tete =
      details.length === 1
        ? `${fichier} — 1 erreur de validation :`
        : `${fichier} — ${details.length} erreurs de validation :`
    super([tete, ...details.map((d) => `  • ${d}`)].join('\n'))
    this.name = 'SchemaError'
    this.fichier = fichier
    this.details = details
  }
}

// ── Formatage des messages ───────────────────────────────────────────────

/** `artworks[3].topics[0]`, `repos["phmatray/museum"].room`, `(racine)`. */
function formaterChemin(chemin: readonly PropertyKey[]): string {
  if (chemin.length === 0) return '(racine)'
  let sortie = ''
  for (const segment of chemin) {
    if (typeof segment === 'number') {
      sortie += `[${segment}]`
    } else if (typeof segment === 'string' && /^[A-Za-z_$][\w$]*$/.test(segment)) {
      sortie += sortie === '' ? segment : `.${segment}`
    } else {
      sortie += `[${JSON.stringify(String(segment))}]`
    }
  }
  return sortie
}

/** Descend dans la valeur brute pour retrouver ce que l'humain a réellement écrit. */
function valeurAuChemin(racine: unknown, chemin: readonly PropertyKey[]): unknown {
  let courant: unknown = racine
  for (const segment of chemin) {
    if (courant === null || typeof courant !== 'object') return undefined
    courant = (courant as Record<PropertyKey, unknown>)[segment as string]
  }
  return courant
}

/** Rendu compact d'une valeur reçue, tronqué : un README de 1200 caractères ne rentre pas dans un message. */
function decrire(valeur: unknown): string {
  if (valeur === undefined) return 'rien'
  if (valeur === null) return 'null'
  if (typeof valeur === 'string') {
    const court = valeur.length > 40 ? `${valeur.slice(0, 40)}…` : valeur
    return JSON.stringify(court)
  }
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
  if (Array.isArray(valeur)) {
    return `un tableau de ${valeur.length} élément${valeur.length > 1 ? 's' : ''}`
  }
  if (typeof valeur === 'object') {
    const cles = Object.keys(valeur as object)
    const apercu = cles.slice(0, 3).join(', ')
    return `un objet { ${apercu}${cles.length > 3 ? ', …' : ''} }`
  }
  return typeof valeur
}

const NOMS_DE_TYPE: Record<string, string> = {
  string: 'une chaîne',
  number: 'un nombre',
  int: 'un entier',
  boolean: 'un booléen',
  array: 'un tableau',
  object: 'un objet',
  null: 'null',
  record: 'un objet',
}

const NOMS_DE_FORMAT: Record<string, string> = {
  datetime: 'une date ISO 8601 (par exemple 2026-07-25T13:04:23Z)',
  url: 'une URL absolue',
}

const NOMS_DORIGINE: Record<string, string> = {
  array: 'élément',
  string: 'caractère',
  set: 'élément',
}

/**
 * Amorces des messages par défaut de zod. Elles servent à reconnaître un
 * message que NOUS avons rédigé (`{ error: '…' }` sur une contrainte) pour le
 * laisser passer tel quel, plutôt que de le remplacer par une traduction
 * générique qui perdrait l'explication.
 */
const AMORCES_ZOD = ['Invalid', 'Too small', 'Too big', 'Unrecognized key', 'Not a', 'Must ']

function messagePersonnalise(anomalie: z.core.$ZodIssue): string | null {
  if (AMORCES_ZOD.some((amorce) => anomalie.message.startsWith(amorce))) return null
  return anomalie.message
}

/** Traduit une anomalie zod en une ligne lisible, valeur reçue comprise. */
function expliquer(anomalie: z.core.$ZodIssue, brut: unknown): string[] {
  const chemin = formaterChemin(anomalie.path)
  const recu = valeurAuChemin(brut, anomalie.path)
  const suffixe = recu === undefined ? '' : `, reçu ${decrire(recu)}`

  const personnalise = messagePersonnalise(anomalie)
  if (personnalise !== null) return [`${chemin} — ${personnalise}${suffixe}`]

  switch (anomalie.code) {
    case 'invalid_type': {
      const attendu = NOMS_DE_TYPE[anomalie.expected] ?? anomalie.expected
      // Une valeur absente et une valeur du mauvais type se corrigent
      // différemment : on ne les dit pas de la même façon.
      if (recu === undefined) return [`${chemin} — champ requis manquant, attendu ${attendu}`]
      return [`${chemin} — attendu ${attendu}, reçu ${decrire(recu)}`]
    }

    case 'invalid_value': {
      const valeurs = anomalie.values.map((v) => decrire(v)).join(' ou ')
      return [`${chemin} — attendu ${valeurs}${suffixe}`]
    }

    case 'unrecognized_keys': {
      const cles = anomalie.keys.map((k) => `"${k}"`).join(', ')
      const parent = anomalie.path.length === 0 ? '' : `${chemin} : `
      return [
        `${parent}clé${anomalie.keys.length > 1 ? 's' : ''} inconnue${anomalie.keys.length > 1 ? 's' : ''} ${cles} — faute de frappe, ou champ retiré du schéma`,
      ]
    }

    case 'too_small': {
      const unite = NOMS_DORIGINE[anomalie.origin]
      const borne = anomalie.inclusive ? `au moins ${anomalie.minimum}` : `strictement plus de ${anomalie.minimum}`
      return unite
        ? [`${chemin} — attendu ${borne} ${unite}${Number(anomalie.minimum) > 1 ? 's' : ''}${suffixe}`]
        : [`${chemin} — attendu une valeur ${anomalie.inclusive ? '≥' : '>'} ${anomalie.minimum}${suffixe}`]
    }

    case 'too_big': {
      const unite = NOMS_DORIGINE[anomalie.origin]
      const borne = anomalie.inclusive ? `au plus ${anomalie.maximum}` : `strictement moins de ${anomalie.maximum}`
      return unite
        ? [`${chemin} — attendu ${borne} ${unite}${Number(anomalie.maximum) > 1 ? 's' : ''}${suffixe}`]
        : [`${chemin} — attendu une valeur ${anomalie.inclusive ? '≤' : '<'} ${anomalie.maximum}${suffixe}`]
    }

    case 'invalid_format': {
      const attendu = NOMS_DE_FORMAT[anomalie.format]
      if (attendu) return [`${chemin} — attendu ${attendu}${suffixe}`]
      return [`${chemin} — ${anomalie.message}${suffixe}`]
    }

    // Clé de dictionnaire invalide : l'anomalie utile est celle qui est
    // imbriquée, mais le chemin qui compte pour l'humain est celui de la clé.
    case 'invalid_key':
    case 'invalid_element': {
      const internes = anomalie.issues.flatMap((interne) =>
        expliquer({ ...interne, path: [] } as z.core.$ZodIssue, undefined),
      )
      const quoi = anomalie.code === 'invalid_key' ? 'clé invalide' : 'élément invalide'
      return internes.map((interne) => `${chemin} — ${quoi} : ${interne.replace('(racine) — ', '')}`)
    }

    default:
      return [`${chemin} — ${anomalie.message}${suffixe}`]
  }
}

function lever(fichier: string, erreur: z.ZodError, brut: unknown): never {
  throw new SchemaError(
    fichier,
    erreur.issues.flatMap((anomalie) => expliquer(anomalie, brut)),
  )
}

/**
 * Contrôle de version AVANT le schéma : un fichier d'une autre version
 * produirait sinon une avalanche d'erreurs de champs, alors que la seule
 * chose à dire est « ce fichier vient d'un autre code, régénère-le ».
 *
 * `requise` distingue les fichiers générés (la version y est toujours écrite,
 * son absence signale un fichier étranger) des fichiers écrits à la main, où
 * l'omettre est une commodité légitime.
 */
function verifierVersion(brut: unknown, fichier: string, requise: boolean): void {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return
  const version = (brut as Record<string, unknown>).schemaVersion
  if (version === undefined) {
    if (requise) {
      throw new SchemaError(fichier, [
        `schemaVersion — champ requis manquant, attendu ${SCHEMA_VERSION} ; ce fichier est généré, régénère-le`,
      ])
    }
    return
  }
  if (version !== SCHEMA_VERSION) {
    throw new SchemaError(fichier, [
      `schemaVersion — version ${decrire(version)} inconnue, seule la version ${SCHEMA_VERSION} est prise en charge par ce code`,
    ])
  }
}

// ── Briques communes ─────────────────────────────────────────────────────

/**
 * `owner/name`. On valide la forme : écrire `phmatray-museum` au lieu de
 * `phmatray/museum` dans la curation donnerait sinon une clé orpheline
 * silencieuse, c'est-à-dire un override qui ne s'applique jamais.
 */
const cleDepot = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/, { error: 'attendu une clé de la forme "owner/nom"' })

const versionOptionnelle = z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION)

// ── Catalogue (généré) ───────────────────────────────────────────────────

const artworkSchema = z.object({
  key: cleDepot,
  owner: z.string().min(1),
  name: z.string().min(1),
  title: z.string(),
  description: z.string(),
  url: z.url(),
  homepage: z.string().nullable(),
  topics: z.array(z.string()),
  language: z.string().nullable(),
  languages: z.record(z.string(), z.number()),
  stars: z.number().int().min(0),
  forks: z.number().int().min(0),
  openIssues: z.number().int().min(0),
  isFork: z.boolean(),
  isArchived: z.boolean(),
  isTemplate: z.boolean(),
  createdAt: z.iso.datetime(),
  pushedAt: z.iso.datetime(),
  license: z.string().nullable(),
  readmeExcerpt: z.string(),
})

export const catalogueSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    owners: z.array(z.string().min(1)),
    artworks: z.array(artworkSchema),
  })
  .superRefine((catalogue, ctx) => {
    // La clé est l'identifiant qui survit à un refetch et sert d'index partout
    // en aval : un doublon écraserait silencieusement une œuvre, une clé
    // désaccordée du couple owner/name casserait la remontée vers GitHub.
    const vues = new Set<string>()
    catalogue.artworks.forEach((artwork, i) => {
      if (vues.has(artwork.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['artworks', i, 'key'],
          message: 'clé en double — chaque dépôt ne peut figurer qu’une fois dans le catalogue',
        })
      }
      vues.add(artwork.key)
      const attendue = `${artwork.owner}/${artwork.name}`
      if (artwork.key !== attendue) {
        ctx.addIssue({
          code: 'custom',
          path: ['artworks', i, 'key'],
          message: `attendu "${attendue}", d’après les champs owner et name`,
        })
      }
    })
  })

export function parseCatalogue(raw: unknown): Catalogue {
  verifierVersion(raw, FICHIER_CATALOGUE, true)
  const resultat = catalogueSchema.safeParse(raw)
  if (!resultat.success) lever(FICHIER_CATALOGUE, resultat.error, raw)
  const catalogue: Catalogue = resultat.data
  return catalogue
}

// ── Curation (écrite à la main) ──────────────────────────────────────────

const themeSchema = z.enum(['classic', 'modern', 'immersive', 'vault'])

const repoOverrideSchema = z.strictObject({
  include: z.boolean().optional(),
  featured: z.boolean().optional(),
  room: z.string().min(1).optional(),
  title: z.string().optional(),
  blurb: z.string().optional(),
  image: z.string().min(1).optional(),
  placement: z
    .strictObject({
      wallId: z.string().min(1),
      u: z.number(),
      scale: z.number().positive().optional(),
    })
    .optional(),
})

const roomOverrideSchema = z.strictObject({
  name: z.string().min(1).optional(),
  floor: z.number().int().optional(),
  theme: themeSchema.optional(),
  order: z.number().int().optional(),
  hidden: z.boolean().optional(),
})

export const curationSchema = z.strictObject({
  schemaVersion: versionOptionnelle,
  repos: z.record(cleDepot, repoOverrideSchema).default({}),
  rooms: z.record(z.string().min(1), roomOverrideSchema).default({}),
  excluded: z.array(cleDepot).default([]),
})

/**
 * Curation vide, pour le cas nominal où `curation.json` n'existe pas encore.
 * Gelée : c'est une constante partagée par tous les appelants, une mutation
 * accidentelle contaminerait le musée suivant. Un `derive()` pur n'a de toute
 * façon aucune raison d'y écrire.
 */
const curationVide: Curation = {
  schemaVersion: SCHEMA_VERSION,
  repos: {},
  rooms: {},
  excluded: [],
}
Object.freeze(curationVide.repos)
Object.freeze(curationVide.rooms)
Object.freeze(curationVide.excluded)

export const EMPTY_CURATION: Curation = Object.freeze(curationVide)

export function parseCuration(raw: unknown): Curation {
  verifierVersion(raw, FICHIER_CURATION, false)
  const resultat = curationSchema.safeParse(raw)
  if (!resultat.success) lever(FICHIER_CURATION, resultat.error, raw)
  const curation: Curation = resultat.data
  return curation
}

// ── Configuration d'instance (écrite à la main) ──────────────────────────

const filtersSchema = z
  .strictObject({
    excludeForks: z.boolean().default(true),
    excludeArchived: z.boolean().default(false),
    minStars: z.number().int().min(0).optional(),
    requireTopics: z.array(z.string().min(1)).optional(),
    excludePatterns: z.array(z.string().min(1)).optional(),
  })
  .prefault({})

const buildingSchema = z
  .strictObject({
    roomDepth: z.number().positive().default(9),
    ceilingHeight: z.number().positive().default(4.3),
    slabThickness: z.number().positive().default(0.4),
    minAtriumSize: z.number().positive().default(12),
    minRoomWidth: z.number().positive().default(6),
    roomsPerFloor: z.number().int().min(1).default(6),
  })
  .prefault({})

const clusteringSchema = z
  .strictObject({
    minClusterSize: z.number().int().min(1).default(4),
    maxClusterSize: z.number().int().min(1).default(14),
  })
  .prefault({})
  .refine((c) => c.maxClusterSize >= c.minClusterSize, {
    error: 'doit être ≥ minClusterSize, sinon aucune coupe ne satisfait les deux bornes',
    path: ['maxClusterSize'],
  })

export const museumConfigSchema = z.strictObject({
  schemaVersion: versionOptionnelle,
  name: z.string().min(1).default('Musée GitHub'),
  owners: z
    .array(z.string().min(1))
    .min(1, { error: 'attendu au moins un propriétaire GitHub — sans owner il n’y a rien à exposer' }),
  filters: filtersSchema,
  building: buildingSchema,
  clustering: clusteringSchema,
})

export function parseMuseumConfig(raw: unknown): MuseumConfig {
  verifierVersion(raw, FICHIER_CONFIG, false)
  const resultat = museumConfigSchema.safeParse(raw)
  if (!resultat.success) lever(FICHIER_CONFIG, resultat.error, raw)
  const config: MuseumConfig = resultat.data
  return config
}

// ── Index d'atlas (généré) ───────────────────────────────────────────────

export const atlasIndexSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    tileWidth: z.number().int().positive(),
    tileHeight: z.number().int().positive(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
    atlases: z.array(z.string().min(1)),
    entries: z.record(
      cleDepot,
      z.object({
        atlas: z.number().int().min(0),
        layer: z.number().int().min(0),
      }),
    ),
  })
  .superRefine((index, ctx) => {
    // Une entrée hors bornes ne se voit qu'au rendu, sous la forme d'une toile
    // noire ou d'une exception WebGL. Autant la refuser au chargement.
    const couches = index.cols * index.rows
    for (const [cle, entree] of Object.entries(index.entries)) {
      if (entree.atlas >= index.atlases.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', cle, 'atlas'],
          message: `renvoie à un atlas inexistant — ${index.atlases.length} atlas déclaré${index.atlases.length > 1 ? 's' : ''} dans "atlases"`,
        })
      }
      if (entree.layer >= couches) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', cle, 'layer'],
          message: `couche hors de la grille — ${index.cols}×${index.rows} = ${couches} tuiles par atlas`,
        })
      }
    }
  })

export function parseAtlasIndex(raw: unknown): AtlasIndex {
  verifierVersion(raw, FICHIER_ATLAS, true)
  const resultat = atlasIndexSchema.safeParse(raw)
  if (!resultat.success) lever(FICHIER_ATLAS, resultat.error, raw)
  const index: AtlasIndex = resultat.data
  return index
}
