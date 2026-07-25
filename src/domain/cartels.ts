/**
 * LOT 3 — Cartels : quoi écrire, où le poser, et surtout POUR QUI (spec § 9.3).
 *
 * Module purement arithmétique : aucun import de `three` ni de `react`. Tout ce
 * qui DÉCIDE quelque chose — quelles œuvres méritent un cartel, de quel côté il
 * se pose, laquelle le visiteur regarde — vit ici, et se teste sans canvas.
 * `scene/CartelLayer.tsx` ne fait que rendre le verdict de ces fonctions.
 *
 * ── Pourquoi une sélection, et pas simplement 100 cartels ──
 *
 * Le texte SDF de troika coûte un draw call ET une re-vectorisation des glyphes
 * à chaque changement de contenu. Cent cartels, c'est cent draw calls sur un
 * budget total de 150 déjà consommé aux deux tiers par le bâtiment. Au-delà de
 * 6 m un cartel de 2,6 cm de haut fait moins de 3 pixels : on ne le lit pas, on
 * le paie. D'où le seuil de § 9.3, qui ramène le pire cas à ~15 cartels.
 *
 * ── Pourquoi ces fonctions sont TOTALES et déterministes ──
 *
 * Elles tournent dans `useFrame`, potentiellement 60 fois par seconde. Deux
 * conséquences non négociables :
 *
 *   1. AUCUN aléa, AUCUNE horloge. Deux appels sur la même position de caméra
 *      rendent exactement la même liste, dans le même ordre. Les égalités de
 *      distance se départagent par clé alphabétique — sans quoi deux œuvres
 *      symétriques par rapport au visiteur (cas fréquent : on entre dans une
 *      salle par le milieu d'un mur) se voleraient leur emplacement à chaque
 *      image, et les cartels clignoteraient.
 *   2. Une HYSTÉRÉSIS sur tous les seuils. Un visiteur qui marche s'arrête
 *      naturellement pile sur la frontière des 6 m ; sans marge de sortie, le
 *      moindre balancement du pas allumerait et éteindrait le cartel plusieurs
 *      fois par seconde.
 */
import type {
  Artwork,
  Museum,
  Placement,
  RepoKey,
  ThemeId,
  Vec2,
  Vec3,
  Wall,
} from './types'
import { WALL_CORNER_MARGIN } from './types'

// ── Seuils (spec § 9.3 et US-2.4) ────────────────────────────────────────

/** Au-delà, un cartel est illisible : on ne le rend pas du tout. */
export const CARTEL_MAX_DISTANCE = 6

/**
 * Marge de sortie : un cartel déjà allumé le reste jusqu'à 6,6 m. C'est la
 * seule chose qui empêche le clignotement d'un visiteur immobile à 6,00 m.
 */
export const CARTEL_EXIT_MARGIN = 0.6

/**
 * Taille du pool de composants `Text`. Le § 9.3 annonce ~15 cartels simultanés
 * au pire ; 16 laisse une unité de marge sans jamais dépasser le budget de
 * ~20 draw calls.
 */
export const CARTEL_POOL_SIZE = 16

/** Emprise du cartel dans le plan du mur, en mètres. */
export const CARTEL_WIDTH = 0.3
export const CARTEL_HEIGHT = 0.16

/** Blanc laissé entre le bord du cadre et le bord du cartel, en mètres. */
export const CARTEL_GAP = 0.1

/**
 * Distance de l'œuvre au mur — l'épaisseur du mur plus un relief.
 *
 * `builders/wall.ts` est la source de vérité de l'épaisseur (`WALL_THICKNESS`),
 * mais `domain/` ne peut pas l'importer sans traîner `three` avec lui. La valeur
 * est donc un PARAMÈTRE de `collectCartels`, que la scène renseigne depuis la
 * constante réelle ; ce défaut ne sert qu'aux tests et à un appel isolé.
 *
 * DUPLICATION ASSUMÉE, À TENIR À LA MAIN : 0,32 m d'épaisseur (§9.4) plus un
 * centimètre de relief. Si `WALL_THICKNESS` rebouge, ce nombre doit suivre,
 * sans quoi les cartels de test s'enfoncent dans le mur au lieu de s'y poser.
 */
export const DEFAULT_FACE_OFFSET = 0.33

/** US-2.4 : le panneau riche n'apparaît que très près. */
export const PANEL_MAX_DISTANCE = 2.5
export const PANEL_EXIT_MARGIN = 0.4

/**
 * « Regarder l'œuvre » = l'avoir dans un cône de 25° autour de l'axe du regard.
 * Le cône de SORTIE est plus large (40°) : sans cela, lire la description ferait
 * disparaître le panneau au premier mouvement de tête.
 */
export const PANEL_ENTER_COSINE = Math.cos((25 * Math.PI) / 180)
export const PANEL_KEEP_COSINE = Math.cos((40 * Math.PI) / 180)

/** Tolérance de comparaison. On manipule des mètres, le micron suffit. */
const EPS = 1e-9

// ── Contrat public ───────────────────────────────────────────────────────

/**
 * Tout ce dont la scène a besoin pour poser un cartel, calculé une fois au
 * chargement du musée. Rien ici ne dépend de la caméra : ce sont des données de
 * bâtiment, pas de rendu.
 */
export interface CartelSpec {
  key: RepoKey
  floorId: string
  roomId: string
  wallId: string
  /** Thème de la salle, qui décide de la couleur d'encre du cartel. */
  theme: ThemeId
  /** Centre de l'œuvre dans le monde : c'est LUI qu'on regarde et qu'on mesure. */
  artworkCenter: Vec3
  /**
   * Point d'accrochage du cartel : milieu de son ARÊTE HAUTE, dans le plan du
   * mur. Le composant y pose un texte centré horizontalement et ancré en haut,
   * ce qui lui évite d'avoir à savoir dans quel sens pointe l'axe `u` du mur.
   */
  anchor: Vec3
  /** Rotation autour de Y qui met le texte dans le plan du mur, face à la salle. */
  yaw: number
  /** Position du cartel le long du mur, en mètres depuis `a`. */
  u: number
  /** +1 si le cartel est du côté de `b`, −1 du côté de `a`. */
  side: 1 | -1
  /** Normale intérieure du mur, unitaire — sert au test « le visiteur est-il devant ? ». */
  normal: Vec2
}

// ── Repère du mur ────────────────────────────────────────────────────────

interface WallFrame2D {
  length: number
  /** Direction `a → b`, unitaire. */
  ex: Vec2
  /** Normale intérieure exacte, recalculée depuis `a → b`. */
  inward: Vec2
}

/**
 * Repère 2D du mur, IDENTIQUE à celui de `builders/wall.ts`.
 *
 * Ces quatre lignes de trigonométrie sont volontairement dupliquées : la version
 * de `builders/` renvoie une `THREE.Matrix4`, et importer `three` dans `domain/`
 * romprait la règle qui rend ce dossier testable sans WebGL. La duplication est
 * bornée (une direction et une perpendiculaire) et verrouillée par un test qui
 * compare les deux sur le musée réel.
 *
 * La normale du contrat est arrondie au micromètre par `layout.ts` : on ne s'en
 * sert que pour choisir le CÔTÉ, jamais comme axe.
 */
function wallFrame2D(wall: Wall): WallFrame2D {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const length = Math.hypot(dx, dz)
  if (length < EPS) {
    return { length: 0, ex: { x: 1, z: 0 }, inward: { x: 0, z: -1 } }
  }

  const ex = { x: dx / length, z: dz / length }
  const perp = { x: ex.z, z: -ex.x }
  const versLInterieur = perp.x * wall.normal.x + perp.z * wall.normal.z >= 0
  return {
    length,
    ex,
    inward: versLInterieur ? perp : { x: -perp.x, z: -perp.z },
  }
}

// ── Placement du cartel ──────────────────────────────────────────────────

/** Espace libre, en mètres, de part et d'autre d'une œuvre sur son mur. */
interface FreeSpace {
  left: number
  right: number
}

/**
 * Ce qui reste entre le bord d'un cadre et son voisin — ou l'extrémité utile du
 * mur, marge d'angle déduite.
 *
 * On raisonne sur les VOISINS et non sur les segments utiles calculés par
 * `hanging.ts` : les segments ne sont pas stockés dans `museum.json`, et de
 * toute façon un cartel ne se soucie que de ne rien recouvrir. Les ouvertures
 * sont ignorées ici à dessein — une œuvre n'est jamais accrochée à moins de
 * `écartMin` d'un jambage, donc un cartel de 0,30 m posé à 0,10 m du cadre reste
 * du bon côté.
 */
function freeSpace(
  placement: Placement,
  voisins: readonly Placement[],
  wallLength: number,
): FreeSpace {
  const gauche = placement.u - placement.width / 2
  const droite = placement.u + placement.width / 2

  let borneGauche = WALL_CORNER_MARGIN
  let borneDroite = wallLength - WALL_CORNER_MARGIN

  for (const autre of voisins) {
    if (autre === placement) continue
    const autreGauche = autre.u - autre.width / 2
    const autreDroite = autre.u + autre.width / 2
    if (autreDroite <= gauche + EPS) borneGauche = Math.max(borneGauche, autreDroite)
    if (autreGauche >= droite - EPS) borneDroite = Math.min(borneDroite, autreGauche)
  }

  return { left: gauche - borneGauche, right: borneDroite - droite }
}

/** Place utile pour un cartel d'un côté donné : le blanc plus la largeur. */
const PLACE_REQUISE = CARTEL_GAP + CARTEL_WIDTH

/**
 * De quel côté poser le cartel.
 *
 * Convention muséale : à DROITE de l'œuvre (dans le sens `a → b` du mur) quand
 * la place le permet, parce qu'un accrochage où les cartels alternent au hasard
 * se lit comme un désordre. On ne bascule à gauche que si la droite est trop
 * étroite, et si les deux le sont on prend le côté le plus large — un cartel
 * légèrement serré reste préférable à un cartel qui sort du mur.
 */
function chooseSide(free: FreeSpace): 1 | -1 {
  if (free.right >= PLACE_REQUISE - EPS) return 1
  if (free.left >= PLACE_REQUISE - EPS) return -1
  return free.right >= free.left ? 1 : -1
}

/**
 * Les cartels d'un mur, un par œuvre accrochée.
 *
 * Deux invariants tenus ici, et vérifiés par les tests sur le musée réel :
 *
 *   - le cartel est ENTIÈREMENT dans le plan du mur, à `faceOffset` de la face
 *     extérieure, donc collé à la face visible sans la traverser ;
 *   - il ne CHEVAUCHE PAS l'œuvre, ni horizontalement (au moins `CARTEL_GAP`
 *     entre les deux bords) ni verticalement (l'arête haute du cartel EST
 *     l'arête basse du cadre — c'est ce qu'« aligné sur son bord inférieur »
 *     veut dire, et c'est ce qui rend le non-recouvrement inconditionnel).
 */
export function layoutWallCartels(
  wall: Wall,
  elevation: number,
  contexte: { floorId: string; roomId: string; theme: ThemeId },
  faceOffset: number = DEFAULT_FACE_OFFSET,
): CartelSpec[] {
  const { length, ex, inward } = wallFrame2D(wall)
  if (length < EPS) return []

  // Le texte doit REGARDER la salle : son axe +Z local est la normale intérieure.
  const yaw = Math.atan2(inward.x, inward.z)

  return wall.placements.map((placement) => {
    const free = freeSpace(placement, wall.placements, length)
    const side = chooseSide(free)

    // Centre du cartel le long du mur. Deux corrections, dans cet ordre : on
    // ramène d'abord le cartel dans les bornes du mur (mieux vaut serré contre
    // l'angle que dans le vide), puis on REGARANTIT l'écart au cadre. L'ordre
    // n'est pas indifférent : le non-recouvrement est la règle absolue, le
    // cadrage dans le mur n'est qu'une préférence. Sur un musée valide aucune
    // des deux corrections ne s'applique — l'accrochage laisse 0,6 m de blanc
    // minimum et 0,5 m de marge d'angle, largement de quoi loger 0,40 m.
    const voulu =
      placement.u + side * (placement.width / 2 + CARTEL_GAP + CARTEL_WIDTH / 2)
    const borne = Math.min(Math.max(voulu, CARTEL_WIDTH / 2), length - CARTEL_WIDTH / 2)
    const ecartMinimal = placement.width / 2 + CARTEL_WIDTH / 2
    const u =
      side === 1
        ? Math.max(borne, placement.u + ecartMinimal)
        : Math.min(borne, placement.u - ecartMinimal)

    const bordBas = placement.centerHeight - placement.height / 2

    return {
      key: placement.key,
      floorId: contexte.floorId,
      roomId: contexte.roomId,
      wallId: wall.id,
      theme: contexte.theme,
      artworkCenter: {
        x: wall.a.x + ex.x * placement.u + inward.x * faceOffset,
        y: elevation + placement.centerHeight,
        z: wall.a.z + ex.z * placement.u + inward.z * faceOffset,
      },
      anchor: {
        x: wall.a.x + ex.x * u + inward.x * faceOffset,
        y: elevation + bordBas,
        z: wall.a.z + ex.z * u + inward.z * faceOffset,
      },
      yaw,
      u,
      side,
      normal: inward,
    }
  })
}

/**
 * Tous les cartels du musée, dans l'ordre structurel (niveaux, salles, murs).
 *
 * Calculé UNE FOIS au chargement : c'est un dérivé du bâtiment, pas du point de
 * vue. La caméra ne fait ensuite que filtrer cette liste.
 */
export function collectCartels(
  museum: Museum,
  faceOffset: number = DEFAULT_FACE_OFFSET,
): CartelSpec[] {
  const specs: CartelSpec[] = []
  for (const floor of museum.floors) {
    for (const room of floor.rooms) {
      const contexte = { floorId: floor.id, roomId: room.id, theme: room.theme }
      for (const wall of room.walls) {
        specs.push(...layoutWallCartels(wall, floor.elevation, contexte, faceOffset))
      }
    }
  }
  return specs
}

// ── Sélection par proximité ──────────────────────────────────────────────

export interface SelectionOptions {
  /** Seuil d'allumage, en mètres. Défaut : `CARTEL_MAX_DISTANCE`. */
  maxDistance?: number
  /** Rallonge accordée aux cartels DÉJÀ allumés. Défaut : `CARTEL_EXIT_MARGIN`. */
  exitMargin?: number
  /** Nombre maximal de cartels rendus. Défaut : `CARTEL_POOL_SIZE`. */
  limit?: number
  /** Clés actuellement affichées, pour l'hystérésis. */
  previous?: ReadonlySet<RepoKey>
}

function distance2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * Les œuvres les plus proches du visiteur, au plus `limit`, les plus proches
 * d'abord.
 *
 * Trois propriétés, toutes testées :
 *
 *   - AUCUNE œuvre au-delà du seuil n'est retenue. Une œuvre déjà affichée
 *     bénéficie de la marge de sortie, et d'elle seule : la marge ne fait jamais
 *     ENTRER personne.
 *   - l'ordre est total et déterministe. À distance rigoureusement égale — deux
 *     œuvres symétriques par rapport au visiteur — c'est la clé alphabétique qui
 *     tranche, donc toujours la même, image après image.
 *   - la fonction n'alloue qu'un tableau : elle est appelée depuis `useFrame`.
 */
export function selectNearestCartels(
  specs: readonly CartelSpec[],
  eye: Vec3,
  options: SelectionOptions = {},
): CartelSpec[] {
  const maxDistance = options.maxDistance ?? CARTEL_MAX_DISTANCE
  const exitMargin = options.exitMargin ?? CARTEL_EXIT_MARGIN
  const limit = options.limit ?? CARTEL_POOL_SIZE
  const previous = options.previous

  const seuilEntree = maxDistance * maxDistance
  const seuilSortie = (maxDistance + exitMargin) * (maxDistance + exitMargin)

  const retenus: { spec: CartelSpec; d2: number }[] = []
  for (const spec of specs) {
    const d2 = distance2(spec.artworkCenter, eye)
    const seuil = previous?.has(spec.key) ? seuilSortie : seuilEntree
    if (d2 <= seuil) retenus.push({ spec, d2 })
  }

  retenus.sort((a, b) => a.d2 - b.d2 || (a.spec.key < b.spec.key ? -1 : a.spec.key > b.spec.key ? 1 : 0))

  return retenus.slice(0, Math.max(0, limit)).map((r) => r.spec)
}

// ── Pool d'emplacements ──────────────────────────────────────────────────

/**
 * Réaffecte le pool de composants `Text` aux œuvres sélectionnées.
 *
 * Instancier un `Text` de troika alloue une géométrie, un matériau dérivé et un
 * atlas SDF ; le faire à chaque image effondrerait la fréquence bien avant que
 * les draw calls ne posent problème. On garde donc `size` composants montés à
 * demeure et on ne fait que leur changer leur contenu.
 *
 * La règle d'affectation est la STABILITÉ : une œuvre déjà affichée CONSERVE son
 * emplacement, même si elle a changé de rang de distance. Sans cela, un simple
 * pas de côté permuterait deux emplacements, chaque `Text` se re-vectoriserait
 * pour afficher le texte de l'autre, et on paierait le coût de la création sans
 * en avoir la contrepartie.
 *
 * Le tableau renvoyé fait EXACTEMENT `size` cases : le pool ne peut pas déborder,
 * quel que soit le nombre de sélectionnés.
 */
export function assignSlots(
  previous: readonly (RepoKey | null)[],
  selected: readonly RepoKey[],
  size: number = CARTEL_POOL_SIZE,
): (RepoKey | null)[] {
  const taille = Math.max(0, size)
  const voulus = new Set(selected)
  const emplacements: (RepoKey | null)[] = new Array(taille).fill(null)

  // 1) les rescapés gardent leur case.
  const deja = new Set<RepoKey>()
  for (let i = 0; i < taille; i++) {
    const key = previous[i] ?? null
    if (key !== null && voulus.has(key) && !deja.has(key)) {
      emplacements[i] = key
      deja.add(key)
    }
  }

  // 2) les nouveaux venus prennent les cases libres, dans l'ordre de distance.
  let libre = 0
  for (const key of selected) {
    if (deja.has(key)) continue
    while (libre < taille && emplacements[libre] !== null) libre++
    if (libre >= taille) break // pool plein : le surplus attendra
    emplacements[libre] = key
    deja.add(key)
  }

  return emplacements
}

// ── Panneau de proximité (US-2.4) ────────────────────────────────────────

export interface FocusOptions {
  maxDistance?: number
  exitMargin?: number
  enterCosine?: number
  keepCosine?: number
  /** Œuvre actuellement détaillée, pour l'hystérésis. */
  previousKey?: RepoKey | null
}

/**
 * L'œuvre que le visiteur REGARDE, s'il y en a une. Une seule à la fois.
 *
 * Trois conditions cumulatives, dans cet ordre de coût croissant :
 *
 *   1. être à portée (2,5 m, US-2.4) ;
 *   2. être DEVANT sa propre toile — la normale du mur le dit, et c'est ce qui
 *      évite d'ouvrir le panneau d'une œuvre accrochée de l'autre côté d'une
 *      cloison, à 2 m à vol d'oiseau mais invisible ;
 *   3. être dans le cône du regard.
 *
 * Le critère de départage est l'ANGLE, pas la distance : entre deux œuvres
 * voisines, celle qu'on regarde est celle qui est au centre de l'écran, pas la
 * plus proche du corps.
 */
export function selectFocused(
  specs: readonly CartelSpec[],
  eye: Vec3,
  forward: Vec3,
  options: FocusOptions = {},
): CartelSpec | null {
  const maxDistance = options.maxDistance ?? PANEL_MAX_DISTANCE
  const exitMargin = options.exitMargin ?? PANEL_EXIT_MARGIN
  const enterCosine = options.enterCosine ?? PANEL_ENTER_COSINE
  const keepCosine = options.keepCosine ?? PANEL_KEEP_COSINE
  const previousKey = options.previousKey ?? null

  const norme = Math.hypot(forward.x, forward.y, forward.z)
  if (norme < EPS) return null
  const fx = forward.x / norme
  const fy = forward.y / norme
  const fz = forward.z / norme

  let meilleur: CartelSpec | null = null
  let meilleurCos = -Infinity
  let meilleurD2 = Infinity

  for (const spec of specs) {
    const dx = spec.artworkCenter.x - eye.x
    const dy = spec.artworkCenter.y - eye.y
    const dz = spec.artworkCenter.z - eye.z
    const d = Math.hypot(dx, dy, dz)
    if (d < EPS) continue

    const encours = spec.key === previousKey
    const portee = encours ? maxDistance + exitMargin : maxDistance
    if (d > portee) continue

    // Le visiteur doit être du côté éclairé du mur : le vecteur qui va vers
    // l'œuvre remonte la normale intérieure à contresens.
    if (dx * spec.normal.x + dz * spec.normal.z > 0) continue

    const cos = (dx * fx + dy * fy + dz * fz) / d
    if (cos < (encours ? keepCosine : enterCosine)) continue

    const d2 = d * d
    const mieux =
      cos > meilleurCos + EPS ||
      (Math.abs(cos - meilleurCos) <= EPS &&
        (d2 < meilleurD2 - EPS ||
          (Math.abs(d2 - meilleurD2) <= EPS && meilleur !== null && spec.key < meilleur.key)))
    if (meilleur === null || mieux) {
      meilleur = spec
      meilleurCos = cos
      meilleurD2 = d2
    }
  }

  return meilleur
}

// ── Rédaction ────────────────────────────────────────────────────────────

/** L'année d'un horodatage ISO. `''` si la date est absente ou illisible. */
function year(iso: string): string {
  const m = /^(\d{4})/.exec(iso ?? '')
  return m ? m[1] : ''
}

/**
 * Le texte du cartel : trois lignes, un seul `Text`.
 *
 * Un `Text` par ligne serait plus joli — un titre gras, un sous-titre maigre —
 * et coûterait TROIS draw calls par cartel, soit 48 pour le pool : deux fois et
 * demie le budget des cartels à lui seul. Trois lignes dans un seul bloc en
 * coûtent un.
 */
export function cartelText(artwork: Artwork): string {
  const lignes = [artwork.title]

  const identite = [artwork.owner, artwork.language].filter(Boolean).join(' · ')
  if (identite) lignes.push(identite)

  const chiffres = [
    artwork.stars > 0 ? `★ ${artwork.stars.toLocaleString('fr-FR')}` : null,
    year(artwork.createdAt) || null,
  ].filter(Boolean)
  if (chiffres.length > 0) lignes.push(chiffres.join(' · '))

  return lignes.join('\n')
}

/** Longueur maximale de la description sur le panneau, en caractères. */
export const PANEL_DESCRIPTION_LIMIT = 220

/**
 * Coupe un texte sans casser un mot, et sans jamais rendre plus long que
 * l'entrée. Le panneau a une hauteur physique : une description de 200 mots
 * (le plafond d'US-2.4) descendrait sous le plancher de la salle.
 */
function truncate(texte: string, limite: number): string {
  const propre = texte.trim().replace(/\s+/g, ' ')
  if (propre.length <= limite) return propre
  const coupe = propre.slice(0, limite)
  const espace = coupe.lastIndexOf(' ')
  return `${(espace > limite * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`
}

export interface PanelText {
  /** Titre, propriétaire, chiffres. Rendu en gros. */
  heading: string
  /** Description tronquée, puis les topics. Rendu en petit. */
  body: string
}

/**
 * Le contenu du panneau de proximité, découpé en DEUX blocs seulement.
 *
 * Deux et pas quatre, pour la même raison que le cartel tient en un seul bloc :
 * chaque bloc de texte est un draw call. Deux tailles de corps suffisent à
 * hiérarchiser l'information ; un troisième niveau ne vaut pas son coût.
 */
export function panelText(artwork: Artwork): PanelText {
  const meta = [
    artwork.language,
    artwork.stars > 0 ? `★ ${artwork.stars.toLocaleString('fr-FR')}` : null,
    year(artwork.createdAt) || null,
    artwork.isArchived ? 'archivé' : null,
  ]
    .filter(Boolean)
    .join('  ·  ')

  const morceaux: string[] = []
  const description = truncate(artwork.description ?? '', PANEL_DESCRIPTION_LIMIT)
  if (description) morceaux.push(description)
  // Quatre topics au maximum : au-delà, la liste passe à la ligne et pousse le
  // panneau sous le plancher.
  if (artwork.topics.length > 0) {
    morceaux.push(artwork.topics.slice(0, 4).map((t) => `#${t}`).join('  '))
  }

  return {
    heading: [artwork.title, artwork.owner, meta].filter(Boolean).join('\n'),
    body: morceaux.join('\n\n'),
  }
}
