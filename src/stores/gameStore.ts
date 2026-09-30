import { create } from 'zustand'

import config from '../../museum.config.json'
import { CLAIR, meteoDemandee, type Meteo } from '../domain/meteo'
import { saisonA, type Saison } from '../domain/saisons'
import { cielA, heureDemandee, type Ciel } from '../domain/soleil'
import type { Museum } from '../domain/types'
import type { Walker } from '../plan/walk'
import { recherche } from './reglagesStore'

interface GameState {
  paused: boolean
  currentRoomId: string
  tourActive: boolean
  pointerLocked: boolean
  /**
   * Le musée régénéré par l'éditeur, ou `null` pour celui du disque.
   *
   * Il vit ICI et non dans le magasin de l'éditeur, et ce n'est pas un détail
   * de rangement : `App` doit pouvoir le lire, or `App` est du code de
   * production. Le lire depuis `editor/` obligerait la production à importer
   * l'éditeur — donc `derive()`, les schémas zod et tout le panneau — pour un
   * champ qui y vaut éternellement `null`. Le magasin de jeu est déjà dans le
   * bundle ; y poser une référence ne coûte rien.
   */
  museumOverride: Museum | null
  /** Le visiteur du plan, publié par `PlanPlayer` quand il bouge : la minimap le lit. */
  visiteur: Walker | null
  /** L'arrêt de la visite guidée en cours, dans `buildTourItinerary`. */
  tourEtape: number
  /** La toile que le visiteur regarde (clé du dépôt), publiée par `EveilLayer`. */
  toile: string | null
  /**
   * Le projet que l'adresse demande (`?p=`, `domain/lien.ts`), une fois le
   * catalogue lu par `PlanPlayer` : `cle` nulle s'il n'est pas exposé ici.
   */
  rendezVous: { demande: string; cle: string | null } | null
  /** Le dépôt de la borne que le visiteur consulte, en salle d'honneur, publié par `VitrinesLayer`. */
  borne: string | null
  /** L'étape du journal que le visiteur regarde dans la baraque du chantier (son ancre, `t-94`), publiée par `ChantierLayer`. */
  etape: string | null
  /** Le visiteur regarde Bavette de près : `CarteBavette` s'ouvre. Publié par `BavetteLayer`. */
  bavetteRegarde: boolean
  /** Où se promène Bavette, pour la minimap : publié quelques fois par seconde. */
  bavette: { x: number; z: number; level: number } | null
  /** Le soleil du musée maintenant (ou à l'heure de `?heure=`), tenu à jour par `CycleSolaire`. */
  ciel: Ciel
  /** Le tableau des départs commence à tourner ses palettes (`TableauDeparts`) : leur cliquetis. */
  volets: { at: number; ms: number } | null
  /**
   * Une nouvelle version annoncée par la cloche de la nef, publiée par `Cloche`
   * à chaque coup : `at` change à chaque annonce, même pour le même dépôt.
   */
  annonce: { key: string; tag: string; at: number } | null
  /** Le temps qu'il fait à Bruxelles (Open-Meteo), ou celui de `?meteo=`, tenu à jour par `MeteoLayer`. */
  meteo: Meteo
  /** La saison du jardin, au jour de l'année ou à celle de `?saison=`. */
  saison: Saison
  /** Une session VR est ouverte (`VRLayer`) : le casque tient la caméra, la chaîne d'écran se retire. */
  enVR: boolean
  setPaused: (paused: boolean) => void
  setCurrentRoomId: (id: string) => void
  setTourActive: (active: boolean) => void
  setPointerLocked: (locked: boolean) => void
  setMuseumOverride: (museum: Museum | null) => void
}

export const useGameStore = create<GameState>((set) => ({
  paused: true,
  currentRoomId: 'room-1',
  tourActive: false,
  pointerLocked: false,
  museumOverride: null,
  visiteur: null,
  tourEtape: 0,
  toile: null,
  rendezVous: null,
  borne: null,
  etape: null,
  bavetteRegarde: false,
  bavette: null,
  ciel: cielDuMoment(),
  volets: null,
  annonce: null,
  meteo: meteoDemandee(recherche()) ?? CLAIR,
  saison: saisonA(new Date(), recherche()),
  enVR: false,
  setPaused: (paused) => set({ paused }),
  setCurrentRoomId: (id) => set({ currentRoomId: id }),
  setTourActive: (active) => set({ tourActive: active }),
  setPointerLocked: (locked) => set({ pointerLocked: locked }),
  setMuseumOverride: (museumOverride) => set({ museumOverride }),
}))

/**
 * L'entrée tactile du visiteur (#31), écrite par `MobileControlsOverlay` et lue
 * par `PlanPlayer` à chaque image. Un objet mutable plutôt qu'un état zustand :
 * un glissé de doigt émet un événement par image, et le passer par `set`
 * re-rendrait les abonnés à chaque pixel pour une valeur que seul `useFrame` lit.
 *
 * `forward`/`strafe` dans [−1, 1], comme le clavier ; `lookX`/`lookY` sont des
 * pixels de glissé accumulés, que `PlanPlayer` consomme et remet à zéro.
 */
export const toucher = { forward: 0, strafe: 0, lookX: 0, lookY: 0 }

/** Le ciel à l'instant, ou à l'heure demandée par `?heure=HH:MM`, au lieu du musée. */
export function cielDuMoment(): Ciel {
  const maintenant = new Date()
  const quand = heureDemandee(recherche(), maintenant) ?? maintenant
  return cielA(quand, config.location.latitude, config.location.longitude)
}

/**
 * L'entrée du visiteur en VR, écrite par `VRLayer` (sticks, marche au regard)
 * et lue par `PlanPlayer`, comme `toucher`. `sansSol` : le casque ne connaît
 * pas son sol (un Cardboard), le gréement se hausse à hauteur d'œil ;
 * `confort` : la vignette de confort, de 0 à 1.
 */
export const vrEntree = { avance: 0, cote: 0, hate: false, sansSol: false, confort: 0 }
