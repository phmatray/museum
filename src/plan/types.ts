/**
 * Le PLAN du musée : la seule source de vérité du bâtiment.
 *
 * ── Pourquoi un plan fixe ──
 *
 * L'ancien bâtiment était dérivé chaque nuit des clusters : quatre niveaux pour
 * cent œuvres, une fosse, sept salles vides, un escalier hélicoïdal. Aucun
 * architecte n'avait jamais dessiné de plan — il n'y avait que le résultat d'un
 * algorithme. Ici le bâtiment est dessiné une fois, en mètres, et versionné.
 * La nuit, seuls l'attribution des thèmes aux salles et l'accrochage changent.
 *
 * La 3D, les collisions et la minimap seront DÉRIVÉES de ce plan, jamais
 * l'inverse. Tout ce qui décide de la forme du bâtiment vit ici.
 *
 * Repère : x vers l'est, z vers le sud (celui de three), en mètres. Le nord est
 * en haut du plan dessiné.
 */

export interface Rect {
  x: number
  z: number
  width: number
  depth: number
}

export type RoomKind = 'gallery' | 'honneur' | 'hall' | 'balcony'

export interface Room extends Rect {
  id: string
  kind: RoomKind
  /** Nom de travail ; le thème réel est attribué au build. */
  name: string
}

/**
 * `door` et `entrance` se franchissent ; `open` relie deux surfaces sans mur
 * (deux balcons) ; `bay` est une baie sur le vide, qui se regarde et ne se
 * franchit pas.
 */
export type OpeningKind = 'door' | 'entrance' | 'open' | 'bay'

export interface Opening {
  kind: OpeningKind
  /** Salles de part et d'autre. `null` : l'extérieur. */
  a: string
  b: string | null
  /** Centre de l'ouverture, posé sur l'arête commune. */
  x: number
  z: number
  width: number
}

export interface Level {
  id: number
  name: string
  /** Cote du plancher fini. */
  elevation: number
  rooms: Room[]
  openings: Opening[]
  /**
   * Zones fermées au visiteur : le dessous d'une volée ou d'un palier trop bas
   * pour y passer. La règle de hauteur libre exige qu'elles soient déclarées.
   */
  obstacles: Rect[]
}

export type Direction = 'north' | 'south' | 'east' | 'west'

/** Une volée droite : pente constante, du bas vers le haut dans `direction`. */
export interface Flight extends Rect {
  id: string
  direction: Direction
  bottom: number
  top: number
  risers: number
}

export interface Landing extends Rect {
  id: string
  elevation: number
}

export interface Plan {
  name: string
  width: number
  depth: number
  /** Hauteur d'étage, plancher à plancher. */
  storey: number
  /** Épaisseur des dalles et des paliers, sous-face comprise. */
  slab: number
  levels: Level[]
  flights: Flight[]
  landings: Landing[]
  spawn: { level: number; x: number; z: number }
}
