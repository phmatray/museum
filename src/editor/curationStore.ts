/**
 * LOT 5 — L'état de l'éditeur (spec §10).
 *
 * ── Ce que l'éditeur édite, et ce qu'il n'édite PAS ──
 *
 * Il édite la **curation**, jamais le musée. Le musée est DÉRIVÉ — `derive()`
 * est une fonction pure de (catalogue, curation, configuration, atlas) — et
 * modifier son résultat à la main reviendrait à écrire dans un cache : le
 * premier « Régénérer » effacerait le travail. C'est exactement le défaut que le
 * bouton « Régénérer » est là pour rendre impossible à ignorer, et il est le
 * test de santé de toute l'architecture : s'il perd du travail, la séparation
 * catalogue/curation fuit quelque part.
 *
 * ── Pourquoi la dérivation tourne dans le NAVIGATEUR ──
 *
 * Elle pourrait tourner côté serveur, dans le plugin Vite. Mais alors
 * « Régénérer » testerait le pipeline du serveur, pas celui qui construit
 * réellement la scène — et un écart entre les deux ne se verrait jamais. Ici,
 * c'est le même `derive()` que celui de `tools/derive-museum.ts`, appelé sur les
 * mêmes entrées, et son résultat va directement dans la scène.
 *
 * Tout ce fichier disparaît du bundle de production : il n'est importé que
 * derrière un `import.meta.env.DEV`, et son point d'écriture — le plugin Vite —
 * n'existe pas dans un build.
 */
import { create } from 'zustand'

import { useGameStore } from '../stores/gameStore'

import { ATLAS_VIDE, derive } from '../domain/derive'
import type { AtlasIndex, Curation, Museum, MuseumConfig, RoomOverride, ThemeId } from '../domain/types'
import { parseAtlasIndex, parseCatalogue, parseCuration, parseMuseumConfig } from '../schema'
import type { Catalogue } from '../domain/types'

/** Les entrées de la dérivation, servies en une fois par le plugin Vite. */
interface Entrees {
  config: MuseumConfig
  catalogue: Catalogue
  curation: Curation
  atlas: AtlasIndex
}

export type EtatEnregistrement =
  | { statut: 'inactif' }
  | { statut: 'en-cours' }
  | { statut: 'ok'; a: number }
  | { statut: 'erreur'; message: string }

interface EditorState {
  ouvert: boolean
  entrees: Entrees | null
  /** Erreur de chargement des entrées, s'il y en a une. */
  panne: string | null
  /**
   * Le musée dérivé de la curation en cours. `null` ⇒ la scène affiche le
   * `museum.json` du disque, c'est-à-dire l'état publié.
   */
  museum: Museum | null
  /** Vrai dès qu'une modification n'a pas encore été enregistrée. */
  modifie: boolean
  enregistrement: EtatEnregistrement
  /** Étage affiché dans le plan. */
  niveau: number
  /** Salle sélectionnée, identifiant du musée DÉRIVÉ. */
  selection: string | null

  basculer: () => void
  charger: () => Promise<void>
  choisirNiveau: (niveau: number) => void
  selectionner: (id: string | null) => void
  modifierSalle: (id: string, patch: Partial<RoomOverride>) => void
  regenerer: () => void
  enregistrer: () => Promise<void>
  reinitialiser: () => void
}

const VIDE: Curation = { schemaVersion: 1, repos: {}, rooms: {}, excluded: [] }

export const useEditorStore = create<EditorState>((set, get) => ({
  ouvert: false,
  entrees: null,
  panne: null,
  museum: null,
  modifie: false,
  enregistrement: { statut: 'inactif' },
  niveau: 0,
  selection: null,

  basculer: () => {
    const ouvert = !get().ouvert
    set({ ouvert })
    if (ouvert && get().entrees === null) void get().charger()
  },

  charger: async () => {
    try {
      const res = await fetch('/__museum/inputs')
      if (!res.ok) throw new Error(`le serveur de développement répond ${res.status}`)
      const brut = (await res.json()) as Record<string, unknown>
      // Validé par les MÊMES schémas que le pipeline : une entrée que l'éditeur
      // accepte est, par construction, une entrée que la CI acceptera.
      set({
        entrees: {
          config: parseMuseumConfig(brut.config),
          catalogue: parseCatalogue(brut.catalogue),
          curation: brut.curation ? parseCuration(brut.curation) : VIDE,
          atlas: brut.atlas ? parseAtlasIndex(brut.atlas) : ATLAS_VIDE,
        },
        panne: null,
      })
    } catch (erreur) {
      set({ panne: erreur instanceof Error ? erreur.message : String(erreur) })
    }
  },

  choisirNiveau: (niveau) => set({ niveau, selection: null }),
  selectionner: (selection) => set({ selection }),

  modifierSalle: (id, patch) => {
    const { entrees } = get()
    if (entrees === null) return
    const avant = entrees.curation.rooms[id] ?? {}
    // Une valeur vidée RETIRE l'override au lieu d'écrire une chaîne vide : sans
    // ça, `curation.json` se remplirait d'entrées `{ name: "" }` qui écraseraient
    // le nom dérivé par du vide.
    const apres: RoomOverride = { ...avant, ...patch }
    for (const cle of Object.keys(apres) as (keyof RoomOverride)[]) {
      const v = apres[cle]
      if (v === undefined || v === '' || v === null) delete apres[cle]
    }

    const rooms = { ...entrees.curation.rooms }
    if (Object.keys(apres).length === 0) delete rooms[id]
    else rooms[id] = apres

    set({
      entrees: { ...entrees, curation: { ...entrees.curation, rooms } },
      modifie: true,
      enregistrement: { statut: 'inactif' },
    })
  },

  regenerer: () => {
    const { entrees } = get()
    if (entrees === null) return
    // `derive()` est PUR : aucune entrée n'est mutée, on peut donc le rejouer
    // autant de fois qu'on veut sur les mêmes objets.
    const museum = derive({
      catalogue: entrees.catalogue,
      curation: entrees.curation,
      config: entrees.config,
      atlas: entrees.atlas,
    })
    set({ museum })
    // La scène lit le magasin de JEU : c'est ce qui permet à `App` de ne rien
    // importer de `editor/`.
    useGameStore.getState().setMuseumOverride(museum)
  },

  enregistrer: async () => {
    const { entrees } = get()
    if (entrees === null) return
    set({ enregistrement: { statut: 'en-cours' } })
    try {
      const res = await fetch('/__museum/curation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entrees.curation),
      })
      const corps = (await res.json()) as { erreur?: string }
      if (!res.ok) throw new Error(corps.erreur ?? `le serveur répond ${res.status}`)
      set({ modifie: false, enregistrement: { statut: 'ok', a: performance.now() } })
    } catch (erreur) {
      set({
        enregistrement: {
          statut: 'erreur',
          message: erreur instanceof Error ? erreur.message : String(erreur),
        },
      })
    }
  },

  reinitialiser: () => {
    set({ museum: null, selection: null })
    useGameStore.getState().setMuseumOverride(null)
    void get().charger()
  },
}))

/** Les thèmes proposés dans le panneau. Même liste que le domaine. */
export const THEMES: readonly ThemeId[] = ['classic', 'modern', 'immersive', 'vault']
