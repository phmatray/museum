/**
 * LOT 3 — L'itinéraire de la visite guidée.
 *
 * La visite est DÉRIVÉE du bâtiment, jamais écrite : l'ancien modèle portait un
 * `tourPath` saisi à la main dans la configuration, qui devenait faux dès qu'un
 * dépôt entrait ou sortait du catalogue — la nuit suivante, en somme. Ici, un
 * musée à 3 salles et un musée à 50 produisent tous les deux un parcours
 * complet sans que personne n'ait rien à rééditer.
 *
 * Ce module est PUR : pas de `three`, pas de `react`, pas d'horloge, pas
 * d'aléa. Deux appels sur le même musée rendent le même itinéraire, arrêt pour
 * arrêt, jusqu'au micromètre — c'est ce qui rend la visite testable sans canvas
 * et reproductible d'une machine à l'autre.
 *
 * ── Ce que l'itinéraire décide ──
 *
 *  1. **L'ordre des niveaux.** Le rez-de-chaussée d'abord (c'est l'accueil, et
 *     la salle d'honneur y est), puis les étages en montant, puis SEULEMENT
 *     ensuite ce qui est sous terre — la réserve est le bout du parcours, pas
 *     son ouverture. On ne visite pas les archives avant les chefs-d'œuvre.
 *  2. **L'ordre des salles d'un niveau.** Le plan est un anneau (spec §7.2) :
 *     on en fait le tour dans un sens fixe, sans jamais traverser le vide
 *     central. On entame le tour par la salle la plus proche de l'arrivée, ce
 *     qui évite de repartir à l'opposé du palier à peine sorti de la rampe.
 *  3. **Où se poser dans une salle.** Face à son mur le plus garni, à la
 *     distance qu'il faut pour le voir en entier sans reculer dans le mur d'en
 *     face.
 *  4. **Comment changer d'étage.** Par la rampe hélicoïdale, en la suivant :
 *     un vol direct d'un palier à l'autre traverserait la dalle. Un musée sans
 *     rampe reste visitable — la caméra passe alors d'un niveau à l'autre en
 *     ligne droite, faute de mieux.
 *
 * Les galeries aveugles (spec §7.2) sont exclues : ce sont des volumes qui
 * ferment l'enveloppe, sans accrochage ni porte. S'y arrêter reviendrait à
 * faire admirer un mur nu.
 */
import { isBlindGallery } from './layout'
import { MUSEUM_HANG_HEIGHT } from './types'
import type { Floor, Museum, Ramp, Room, Vec2, Vec3, Wall } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

/**
 * Nature d'un arrêt.
 *
 * `transit` n'est pas un arrêt au sens du visiteur : c'est un point de passage
 * imposé par la géométrie (le tracé de la rampe), de durée de pause nulle. Les
 * distinguer permet à l'interface de n'annoncer que les vraies salles, et aux
 * tests de compter les salles visitées sans avoir à deviner.
 */
export type TourStopKind = 'room' | 'transit'

export interface TourStop {
  /** Identifiant stable, dérivé de la salle ou de la rampe. */
  id: string
  kind: TourStopKind
  /** Niveau où se trouve l'arrêt. */
  floorId: string
  /** Nom du niveau, pour l'affichage. */
  floorName: string
  /** Salle visitée, ou `null` pour un point de passage. */
  roomId: string | null
  /** Ce qu'on affiche à l'écran pendant l'arrêt. */
  label: string
  /** Position de la CAMÉRA, en coordonnées monde (élévation du niveau comprise). */
  position: Vec3
  /** Point regardé, en coordonnées monde. */
  lookAt: Vec3
  /** Temps d'arrêt, en secondes. Nul pour un point de passage. */
  pauseDuration: number
}

export interface TourOptions {
  /** Temps d'arrêt devant une salle, en secondes. */
  pauseDuration?: number
  /** Hauteur de l'œil au-dessus du plancher, en mètres. */
  eyeHeight?: number
  /** Recul maximal devant un mur, en mètres. */
  viewDistance?: number
}

/** Six secondes : le temps de lire un cartel de salle sans s'impatienter. */
export const DEFAULT_PAUSE_DURATION = 6

/** Hauteur du regard. La même que celle du joueur, pour que la visite ne « saute » pas. */
export const DEFAULT_EYE_HEIGHT = 1.6

/**
 * Recul devant le mur regardé.
 *
 * 3,5 m cadre un mur de 6 à 12 m à 75° de champ. Au-delà on recule dans le mur
 * d'en face ; en deçà, les œuvres des extrémités sortent de l'écran.
 */
export const DEFAULT_VIEW_DISTANCE = 3.5

/**
 * Points de passage intercalés sur une rampe.
 *
 * Trois suffisent : la spline qui les relie retrouve l'hélice à quelques
 * centimètres près sur un demi-tour, et chaque point ajouté coûte un arrêt à
 * traverser. Zéro donnerait une corde qui coupe le vide de l'atrium en
 * diagonale — visuellement, un passage à travers la dalle.
 */
const RAMP_WAYPOINTS = 3

// ── API ──────────────────────────────────────────────────────────────────

/**
 * L'itinéraire complet d'un musée.
 *
 * Renvoie une liste vide s'il n'y a rien à montrer (musée dont toutes les
 * salles sont aveugles) : l'appelant doit rendre la main plutôt que de figer le
 * visiteur dans une visite sans étape.
 */
export function buildTour(museum: Museum, options: TourOptions = {}): TourStop[] {
  const pauseDuration = options.pauseDuration ?? DEFAULT_PAUSE_DURATION
  const eyeHeight = options.eyeHeight ?? DEFAULT_EYE_HEIGHT
  const viewDistance = options.viewDistance ?? DEFAULT_VIEW_DISTANCE

  const stops: TourStop[] = []
  let precedent: Floor | null = null

  for (const floor of tourFloorOrder(museum)) {
    const salles = visitableRooms(floor)
    // Un niveau sans rien à montrer n'est pas une étape. On ne met pas non plus
    // à jour `precedent` : la rampe se calcule depuis le dernier niveau
    // réellement visité, en traversant celui-ci au passage.
    if (salles.length === 0) continue

    // La rampe D'ABORD : c'est son point de sortie, et non la dernière salle du
    // niveau précédent, qui décide par quelle salle on entame le palier.
    if (precedent !== null) {
      stops.push(...rampStops(museum, precedent, floor, eyeHeight))
    }

    const depuis = stops.length > 0 ? stops[stops.length - 1].position : null
    for (const room of ringOrder(salles, museum, depuis)) {
      stops.push(roomStop(floor, room, { pauseDuration, eyeHeight, viewDistance }))
    }
    precedent = floor
  }

  return stops
}

/**
 * Les niveaux dans l'ordre de visite : rez-de-chaussée, étages en montant,
 * puis les niveaux enterrés en descendant.
 *
 * Le rez-de-chaussée est le niveau 0 ; s'il n'existe pas (musée entièrement
 * enterré, ou plateau unique numéroté autrement) on part du plus bas, faute de
 * candidat plus légitime.
 *
 * La réserve passe en dernier et non en premier bien qu'elle soit sous nos
 * pieds : c'est un choix de mise en scène, pas de géométrie. Le visiteur monte
 * jusqu'au sommet, puis redescend l'hélice jusqu'aux archives — la descente
 * repasse par tous les niveaux intermédiaires, la caméra ne se téléporte pas.
 */
export function tourFloorOrder(museum: Museum): Floor[] {
  const parNiveau = [...museum.floors].sort((a, b) => a.level - b.level)
  if (parNiveau.length === 0) return []

  const rdcIndex = parNiveau.findIndex((f) => f.level === 0)
  if (rdcIndex <= 0) return parNiveau

  const auDessus = parNiveau.slice(rdcIndex)
  const enDessous = parNiveau.slice(0, rdcIndex).reverse()
  return [...auDessus, ...enDessous]
}

/**
 * Les salles d'un niveau où il vaut la peine de s'arrêter.
 *
 * Le critère est l'aveuglement au sens de `layout.isBlindGallery` — un
 * identifiant, donc un champ que la curation ne peut pas réécrire — et non
 * « aucune œuvre accrochée » : une salle thématique momentanément vide reste
 * une salle, elle a un nom, des topics et une porte.
 */
export function visitableRooms(floor: Floor): Room[] {
  return floor.rooms.filter((room) => !isBlindGallery(room))
}

/**
 * Le mur le plus garni d'une salle : celui devant lequel on se plante.
 *
 * Départage : nombre d'œuvres, puis longueur, puis identifiant. Les deux
 * derniers critères ne servent qu'au déterminisme — sans eux, deux murs à
 * égalité rendraient l'itinéraire dépendant de l'ordre d'écriture du JSON.
 */
export function bestWall(room: Room): Wall | null {
  let meilleur: Wall | null = null
  for (const mur of room.walls) {
    if (meilleur === null || compareWalls(mur, meilleur) > 0) meilleur = mur
  }
  return meilleur
}

// ── Arrêts de salle ──────────────────────────────────────────────────────

interface StopMetrics {
  pauseDuration: number
  eyeHeight: number
  viewDistance: number
}

function roomStop(floor: Floor, room: Room, metrics: StopMetrics): TourStop {
  const commun = {
    id: `stop-${room.id}`,
    kind: 'room' as const,
    floorId: floor.id,
    floorName: floor.name,
    roomId: room.id,
    label: room.name,
    pauseDuration: metrics.pauseDuration,
  }

  const mur = bestWall(room)
  // Une salle sans mur ne devrait pas exister — `buildRoom` en produit quatre —
  // mais un musée dérivé par une version antérieure pourrait en manquer. On
  // recule au centre plutôt que de renvoyer des `NaN` dans la caméra.
  if (mur === null) {
    const centre = rectCentre(room)
    return {
      ...commun,
      position: vec3(centre.x, floor.elevation + metrics.eyeHeight, centre.z),
      lookAt: vec3(centre.x, floor.elevation + MUSEUM_HANG_HEIGHT, centre.z - 1),
    }
  }

  const milieu = { x: (mur.a.x + mur.b.x) / 2, z: (mur.a.z + mur.b.z) / 2 }
  const normale = unit(mur.normal, room, milieu)

  // Le recul est borné par la salle elle-même : la moitié de sa dimension dans
  // l'axe du regard place la caméra au centre, jamais au-delà du mur opposé.
  // Sans cette borne, un cabinet de 4 m de profondeur ferait reculer la caméra
  // de 3,5 m dans la salle voisine.
  const traversee =
    Math.abs(normale.x) > Math.abs(normale.z) ? room.footprint.width : room.footprint.depth
  const recul = Math.max(0.3, Math.min(metrics.viewDistance, traversee / 2))

  return {
    ...commun,
    position: vec3(
      milieu.x + normale.x * recul,
      floor.elevation + metrics.eyeHeight,
      milieu.z + normale.z * recul,
    ),
    // On vise la hauteur d'accrochage muséale, pas le milieu du mur : c'est là
    // que sont les œuvres (spec §7.4), et un mur de 4,3 m regardé en son milieu
    // les couperait en deux.
    lookAt: vec3(milieu.x, floor.elevation + MUSEUM_HANG_HEIGHT, milieu.z),
  }
}

/** Nombre d'œuvres, puis longueur, puis identifiant. Strictement ordonnant. */
function compareWalls(a: Wall, b: Wall): number {
  const parNombre = a.placements.length - b.placements.length
  if (parNombre !== 0) return parNombre
  const parLongueur = wallLength(a) - wallLength(b)
  if (Math.abs(parLongueur) > 1e-9) return parLongueur
  // Ordre lexicographique inversé pour que le PLUS PETIT identifiant gagne :
  // `compareWalls` est utilisé en « strictement supérieur », donc le vainqueur
  // à égalité doit être celui qui compare le plus grand.
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

function wallLength(wall: Wall): number {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z)
}

/**
 * La normale du mur, normalisée et REDRESSÉE vers l'intérieur de la salle.
 *
 * Le modèle promet une normale intérieure ; on la vérifie tout de même contre
 * le centre de l'emprise. Une normale retournée ferait reculer la caméra à
 * travers le mur, et le symptôme (une salle noire) ne dirait rien de la cause.
 */
function unit(normal: Vec2, room: Room, milieu: Vec2): Vec2 {
  const norme = Math.hypot(normal.x, normal.z)
  const centre = rectCentre(room)
  if (norme < 1e-9) {
    // Pas de normale exploitable : on regarde depuis le centre de la salle.
    const dx = centre.x - milieu.x
    const dz = centre.z - milieu.z
    const d = Math.hypot(dx, dz)
    return d < 1e-9 ? { x: 0, z: 1 } : { x: dx / d, z: dz / d }
  }
  const u = { x: normal.x / norme, z: normal.z / norme }
  const versCentre = (centre.x - milieu.x) * u.x + (centre.z - milieu.z) * u.z
  return versCentre < 0 ? { x: -u.x, z: -u.z } : u
}

function rectCentre(room: Room): Vec2 {
  return {
    x: room.footprint.x + room.footprint.width / 2,
    z: room.footprint.z + room.footprint.depth / 2,
  }
}

// ── Ordre des salles sur l'anneau ────────────────────────────────────────

/**
 * Les salles d'un niveau, dans l'ordre où on en fait le tour.
 *
 * L'anneau se parcourt par angle croissant autour du centre de l'atrium : c'est
 * la seule façon de garantir qu'on ne traverse jamais le vide central, et elle
 * ne dépend d'aucun ordre d'écriture. Le tour est ensuite FAIT TOURNER pour
 * commencer par la salle la plus proche du point d'arrivée — sinon, en sortant
 * de la rampe, la visite repartirait systématiquement du côté Est, quitte à
 * traverser tout le palier avant de commencer.
 */
function ringOrder(rooms: Room[], museum: Museum, depuis: Vec3 | null): Room[] {
  const centre = {
    x: museum.atrium.x + museum.atrium.width / 2,
    z: museum.atrium.z + museum.atrium.depth / 2,
  }

  const parAngle = [...rooms].sort((a, b) => {
    const da = angleAround(centre, rectCentre(a))
    const db = angleAround(centre, rectCentre(b))
    if (Math.abs(da - db) > 1e-9) return da - db
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  if (depuis === null || parAngle.length < 2) return parAngle

  let debut = 0
  let meilleure = Infinity
  parAngle.forEach((room, i) => {
    const c = rectCentre(room)
    const d = (c.x - depuis.x) ** 2 + (c.z - depuis.z) ** 2
    // Strictement inférieur : à distance égale, la plus petite position dans
    // l'ordre angulaire gagne, donc le résultat ne dépend pas du tri.
    if (d < meilleure - 1e-9) {
      meilleure = d
      debut = i
    }
  })

  return [...parAngle.slice(debut), ...parAngle.slice(0, debut)]
}

/** Angle dans [0, 2π), mesuré depuis l'axe +X dans le plan XZ. */
function angleAround(centre: Vec2, point: Vec2): number {
  const a = Math.atan2(point.z - centre.z, point.x - centre.x)
  return a < 0 ? a + 2 * Math.PI : a
}

// ── Passage d'un niveau à l'autre ────────────────────────────────────────

/**
 * Les points de passage entre deux niveaux, rampe par rampe.
 *
 * On ne relie pas directement `from` à `to` : entre le dernier étage et la
 * réserve il y a trois rampes à enfiler, et une seule d'entre elles ne mène
 * nulle part. On énumère donc tous les niveaux compris entre les deux, dans le
 * sens du parcours, et on suit chaque rampe intermédiaire.
 *
 * Un couple de niveaux sans rampe ne produit AUCUN point : la caméra le franchit
 * en ligne droite. C'est le cas d'un musée à un seul plateau agrandi à la main,
 * et il n'y a pas de raison de refuser de le visiter.
 */
function rampStops(museum: Museum, from: Floor, to: Floor, eyeHeight: number): TourStop[] {
  if (from.id === to.id) return []
  const montee = to.level > from.level

  const bas = Math.min(from.level, to.level)
  const haut = Math.max(from.level, to.level)
  const chaine = museum.floors
    .filter((f) => f.level >= bas && f.level <= haut)
    .sort((a, b) => (montee ? a.level - b.level : b.level - a.level))

  const stops: TourStop[] = []
  for (let i = 0; i + 1 < chaine.length; i++) {
    const a = chaine[i]
    const b = chaine[i + 1]
    const ramp = rampBetween(museum, a.id, b.id)
    if (ramp === null) continue

    // `t` court toujours de la base vers le sommet de l'hélice ; c'est le SENS
    // DE PARCOURS qui s'inverse en descente.
    const versLeHaut = ramp.fromFloor === a.id
    for (let k = 1; k <= RAMP_WAYPOINTS; k++) {
      const f = k / (RAMP_WAYPOINTS + 1)
      const t = versLeHaut ? f : 1 - f
      const p = helixPoint(ramp, t)
      const y = p.y + eyeHeight
      stops.push({
        // Le sens fait partie de l'identifiant : une même rampe est empruntée
        // deux fois (montée puis descente vers la réserve), et deux arrêts
        // homonymes dans un même itinéraire seraient un piège à clés React.
        id: `transit-${ramp.id}-${versLeHaut ? 'up' : 'down'}-${k}`,
        kind: 'transit',
        floorId: b.id,
        floorName: b.name,
        roomId: null,
        label: b.name,
        position: vec3(p.x, y, p.z),
        // On regarde le vide central pendant la montée : c'est le seul endroit
        // d'où l'on voit le bâtiment entier, et la rotation naturelle de
        // l'hélice fait défiler tous les niveaux.
        lookAt: vec3(ramp.centre.x, y, ramp.centre.z),
        pauseDuration: 0,
      })
    }
  }
  return stops
}

function rampBetween(museum: Museum, a: string, b: string): Ramp | null {
  for (const ramp of museum.ramps) {
    if (ramp.fromFloor === a && ramp.toFloor === b) return ramp
    if (ramp.fromFloor === b && ramp.toFloor === a) return ramp
  }
  return null
}

/**
 * Point de la surface de marche de la rampe au paramètre `t`.
 *
 * Même définition analytique que `builders/ramp.rampSurfacePoint`, réécrite ici
 * en trois lignes plutôt qu'importée : `builders/` dépend de `three`, et le
 * domaine ne dépend de rien. L'hélice, elle, est une propriété de la DONNÉE
 * `Ramp` — pas du maillage qu'on en tire.
 */
function helixPoint(ramp: Ramp, t: number): Vec3 {
  const angle = ramp.startAngle + ramp.sweep * t
  return {
    x: ramp.centre.x + ramp.radius * Math.cos(angle),
    y: ramp.baseElevation + ramp.rise * t,
    z: ramp.centre.z + ramp.radius * Math.sin(angle),
  }
}

// ── Utilitaires ──────────────────────────────────────────────────────────

/**
 * Coordonnées arrondies au micromètre.
 *
 * Même convention que `domain/layout` : ce qui sort du domaine est arrondi une
 * fois, à la source. Deux exécutions sur des machines différentes rendent ainsi
 * des itinéraires comparables octet pour octet, ce qui rend le déterminisme
 * testable autrement qu'à `toBeCloseTo` près.
 */
function vec3(x: number, y: number, z: number): Vec3 {
  return { x: round(x), y: round(y), z: round(z) }
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6
}
