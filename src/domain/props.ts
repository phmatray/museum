/**
 * LOT 4 — Mobilier et végétation (spec §9.4).
 *
 * Ce module DÉCIDE où se posent les bancs, les socles, les projecteurs, les
 * jardinières et les plantes. Il ne dessine rien : `scene/PropsLayer.tsx` prend
 * la liste et l'instancie. Comme tout ce qui vit dans `domain/`, il n'importe ni
 * `three` ni `react`, et tourne donc dans un test sans canvas.
 *
 * ── Pourquoi du mobilier, alors que ça ne sert à rien ──
 *
 * Ce n'est pas de la décoration. Un volume procédural se trahit par deux choses,
 * et le mobilier corrige exactement ces deux-là :
 *
 *  - **l'absence d'échelle**. Une salle de 12 m sur 9 avec des murs nus n'a
 *    aucune référence de taille : elle pourrait faire trois mètres ou trente.
 *    Une plante d'un mètre vingt, un banc de 1,60 m, un socle à hauteur de
 *    poitrine donnent instantanément la mesure du lieu ;
 *  - **l'orthogonalité intégrale**. Tout est en angle droit, tout est aligné.
 *    La silhouette organique d'un feuillage est la seule chose de la scène qui
 *    ne soit ni un rectangle ni un arc de cercle.
 *
 * Le rail de projecteurs, lui, ne s'explique pas par l'éclairage : les
 * projecteurs N'ÉMETTENT AUCUNE LUMIÈRE (§9.2, la surbrillance des toiles est
 * peinte dans le shader). Ils existent parce qu'un plafond de musée sans rail se
 * remarque immédiatement — c'est un objet que l'œil s'attend à trouver, et dont
 * l'absence se lit comme une erreur alors que la présence ne se commente pas.
 *
 * ── La contrainte dure : rien ne croise rien ──
 *
 * Un banc dans un mur, une plante au milieu d'une porte ou un socle au bord de
 * la trémie ne sont pas des défauts cosmétiques : ils bloquent le joueur, ou
 * pire, ils lui font traverser un décor. Chaque candidat est donc TESTÉ contre
 * les emprises réelles du niveau — murs, œuvres accrochées, ouvertures,
 * trémies, hélice de la rampe, et les props déjà posés — avant d'être retenu.
 * Un candidat refusé est simplement abandonné : on préfère une salle un peu
 * vide à une salle impraticable.
 *
 * ── Déterminisme ──
 *
 * Aucun `Math.random`, aucune horloge. La variation (espèce, rotation, échelle)
 * sort d'un générateur `mulberry32` dont la graine est le HACHAGE DE
 * L'IDENTIFIANT de salle. Deux conséquences voulues : deux appels donnent la
 * même liste au flottant près, et une salle garde ses plantes quand une autre
 * change — sans quoi le moindre ajout de dépôt redistribuerait toute la
 * végétation du bâtiment.
 */
import type { Floor, Museum, Ramp, Rect, Room, Vec2, Vec3, Wall } from './types'
// `decor.ts` n'importe rien d'ici : la dépendance ne va que dans ce sens, et il
// n'y a donc pas de cycle. C'est aussi ce qui rend l'ordre lisible — le décor se
// calcule d'abord, le mobilier ensuite.
import { DECOR_METRICS } from './decor'
import type { DecorPlacement } from './decor'

// ── Contrat public ───────────────────────────────────────────────────────

export type PropId =
  | 'banc'
  | 'socle'
  | 'projecteur'
  | 'jardiniere'
  | 'plante-01'
  | 'plante-02'
  | 'plante-03'
  | 'plante-04'

/** Ordre canonique, utilisé pour grouper les instances côté rendu. */
export const PROP_IDS: readonly PropId[] = [
  'banc',
  'socle',
  'projecteur',
  'jardiniere',
  'plante-01',
  'plante-02',
  'plante-03',
  'plante-04',
]

export interface PropPlacement {
  id: PropId
  /**
   * Position MONDE, hauteur comprise : `position.y` intègre déjà l'élévation du
   * niveau. Le rendu peut donc grouper par étage pour le culling sans avoir à
   * décaler quoi que ce soit, et un test lit une coordonnée sans contexte.
   */
  position: Vec3
  /** Lacet, en radians, autour de Y. */
  rotation: number
  scale: number
  floorId: string
}

/**
 * Emprise d'un prop à l'échelle 1.
 *
 * `radius` est le rayon du CYLINDRE englobant, pas une demi-largeur : les props
 * tournent, et un rayon est la seule mesure qui reste valable quel que soit le
 * lacet. `minY`/`maxY` sont relatifs au point d'ancrage — nuls ou positifs pour
 * ce qui est posé au sol, négatifs pour un projecteur suspendu dont l'ancrage
 * est le plan de plafond.
 */
export interface PropMetrics {
  radius: number
  minY: number
  maxY: number
}

/**
 * La pièce PEND-elle sous son ancrage, ou repose-t-elle dessus ?
 *
 * ── Pourquoi cette fonction existe, et pourquoi elle vit ICI ──
 *
 * La question se pose partout où l'on compare deux emprises au sol : un
 * projecteur suspendu à 3,90 m au-dessus d'un banc n'est pas une collision,
 * c'est un musée. Elle était donc écrite TROIS FOIS — dans `tools/plan.ts`,
 * dans l'épreuve de placement du décor, dans l'épreuve du mobilier — et les
 * trois fois de la même façon fautive : `maxY <= 0`.
 *
 * 🔴 Le kit Meshy l'a fait tomber d'un coup. Le nouveau projecteur mesure
 * `minY = −0,222 ; maxY = +0,002` : il pend, sans le moindre doute, et deux
 * millimètres de sa platine dépassent au-dessus du plan d'ancrage parce que
 * l'effondrement d'arêtes déplace des sommets. Comparer une borne à zéro EXACT
 * a fait basculer les trois tests à la fois, et le plan coté a sorti des
 * recouvrements entre un objet à 3,75 m de haut et une plante de 84 cm.
 *
 * On ne demande donc plus « la pièce dépasse-t-elle son ancrage » — question
 * dont la réponse tient dans un micromètre — mais « DE QUEL CÔTÉ est-elle »,
 * à laquelle le milieu de son étendue répond sans ambiguïté : −0,11 pour le
 * projecteur, +0,22 pour un banc.
 *
 * Une règle, une implémentation : le dépôt a déjà payé pour apprendre que la
 * même règle recopiée à trois endroits diverge, et que réparer là où on l'a vue
 * ne la répare pas là où elle se répète.
 */
export function pendAuPlafond(m: { minY: number; maxY: number }): boolean {
  return (m.minY + m.maxY) / 2 < 0
}

/**
 * Mesuré sur les GLB eux-mêmes (bornes des accesseurs POSITION, transformation
 * de nœud comprise), pas estimé. Une valeur trop petite ici ferait passer les
 * tests d'intersection tout en enfonçant une plante dans un mur à l'écran.
 */
export const PROP_METRICS: Record<PropId, PropMetrics> = {
  // ── Les quatre pièces du kit, RELEVÉES sur le kit Meshy du 2026-08-16 ──
  //
  // Les hauteurs sont inchangées au millimètre (0,45 / 1,05 / 0,22 / 0,50) : la
  // table `PIECES` de `process-meshy.py` les a reprises exprès du kit
  // procédural qu'elle remplace, parce que `HAUTEUR_JARDINIERE` porte 33
  // plantes et que `DEGAGEMENT_BANC` porte les bancs de trémie. Ce qui a bougé,
  // ce sont les RAYONS — les nouvelles pièces n'ont pas la même empreinte —
  // et c'est l'épreuve de mesure qui l'a dit, pas une relecture.
  //
  // ⚠️ Les résidus à ±1 mm (`banc.minY = −0,001`, `projecteur.maxY = 0,002`)
  // sont réels : ils viennent de l'effondrement d'arêtes, qui déplace des
  // sommets. On les écrit tels que mesurés plutôt que de les arrondir à zéro —
  // arrondir ici, c'est écrire un vœu à la place d'une mesure.
  //
  // 1,61 × 0,44 m : demi-diagonale 0,80 — le banc est le seul prop franchement
  // allongé, et c'est justement celui qu'on fait tourner face au mur.
  banc: { radius: 0.805, minY: -0.001, maxY: 0.45 },
  socle: { radius: 0.339, minY: 0, maxY: 1.05 },
  // Ancré sur le PLAN DE PLAFOND : la platine affleure la dalle, le corps pend
  // en dessous. Le rayon a FONDU de 0,123 à 0,095 : la pièce Meshy est un simple
  // fût dans un étrier, là où la précédente portait une tête inclinée à 28° qui
  // débordait de son axe. `RECUL_RAIL` a donc désormais de la marge, pas moins.
  projecteur: { radius: 0.095, minY: -0.222, maxY: 0.002 },
  jardiniere: { radius: 0.529, minY: 0, maxY: 0.503 },
  // L'anthurium est un buisson bas et TRÈS étalé : son rayon dépasse sa
  // hauteur. C'est ce qui en fait un bon casseur d'angle droit, et ce qui
  // oblige à lui réserver près d'un mètre soixante d'envergure.
  'plante-01': { radius: 0.807, minY: -0.011, maxY: 0.49 },
  'plante-02': { radius: 0.44, minY: -0.009, maxY: 0.416 },
  // Seule espèce à porter son propre pot : la hauteur inclut le contenant.
  'plante-03': { radius: 0.578, minY: 0, maxY: 0.841 },
  'plante-04': { radius: 0.131, minY: 0, maxY: 0.268 },
}

/**
 * Aire au-delà de laquelle une salle DOIT recevoir de la végétation, en m².
 *
 * Exportée parce que c'est le seuil que le test interroge : « au moins une
 * plante par salle de taille suffisante » n'a de sens que si « suffisante » est
 * une valeur, pas une intuition. 25 m², c'est une pièce de 5 m sur 5 — en
 * dessous, un pot de 1,4 m d'envergure mange le passage.
 */
export const SALLE_ASSEZ_GRANDE = 25

// ── Réglages de placement ────────────────────────────────────────────────

/**
 * Distance minimale entre un prop et l'AXE d'un mur, en mètres.
 *
 * On mesure depuis l'axe et non depuis le parement parce que l'épaisseur des
 * murs est en cours de révision (0,20 → 0,32 m, §9.4) et vit dans
 * `builders/wall.ts`, que `domain/` n'a pas le droit d'importer (il tire
 * `three`). 0,75 m laisse encore 0,43 m de jeu avec un mur de 0,32 m, largement
 * de quoi passer devant une toile qui déborde de son parement.
 */
const RECUL_MUR = 0.75

/** Marge autour d'une trémie : garde-corps compris, plus la place de s'y accouder. */
const RECUL_TREMIE = 0.8

/** Profondeur du couloir laissé libre de part et d'autre d'une ouverture. */
const PASSAGE_PORTE = 1.6

/** Élargissement latéral d'une ouverture : on ne frôle pas un chambranle. */
const MARGE_PORTE = 0.6

/**
 * Hauteur minimale du volume réservé à une ouverture, en mètres.
 *
 * Une porte fait 2,10 m ; réserver seulement sa hauteur laisserait poser un
 * prop juste au-dessus du linteau, où il n'a rien à faire. On réserve donc au
 * moins 2,20 m — mais PAS toute la hauteur sous plafond, sinon aucun projecteur
 * ne pourrait être aligné sur un mur percé d'une baie.
 */
const HAUTEUR_PASSAGE = 2.2

/**
 * Demi-épaisseur réservée au CORPS d'un mur, en mètres.
 *
 * Un mur s'extrude vers l'intérieur de sa salle sur toute son épaisseur depuis
 * son axe : 0,45 m couvre les 0,32 m du §9.4 révisé, plus un jeu. C'est cette
 * bande-là, et non `RECUL_MUR`, qui s'applique au-dessus du mobilier.
 */
const CORPS_MUR = 0.45

/**
 * Hauteur du volume où le mobilier vit, en mètres.
 *
 * En dessous, on se cogne, on regarde des toiles, on longe une plinthe : le
 * recul au mur y est de rigueur. Au-dessus, il n'y a plus que le plafond et ce
 * qu'on y accroche.
 */
const HAUTEUR_MOBILIER = 2.6

/** Jeu horizontal entre deux props voisins, en mètres. */
const ENTRE_PROPS = 0.4

/** Recul du rail de projecteurs par rapport à l'axe du mur, en mètres. */
const RECUL_RAIL = 1.15

/** Recul d'un banc par rapport à l'axe du mur qu'il regarde, en mètres. */
const RECUL_BANC = 2.6

/** Pas d'échantillonnage du pourtour d'une salle, en mètres. */
const PAS_POURTOUR = 4

/**
 * Recul de l'anneau de jardinières par rapport au bord de la trémie, en mètres.
 *
 * 2,40 m, et pas moins : l'hélice de la rampe occupe le vide central jusqu'à
 * 5,90 m de rayon, et son débouché déborde sur la dalle. Un anneau plus serré
 * posait des bacs pile là où le visiteur met le pied en sortant de la rampe.
 */
const RECUL_ANNEAU = 2.4

/** Pas de l'anneau de jardinières autour de la trémie, en mètres. */
const PAS_ANNEAU = 3.4

/**
 * Marge autour de l'hélice d'une rampe, en mètres.
 *
 * Généreuse (1,5 m) parce que la rampe n'est pas seulement un objet : c'est un
 * TRAJET. Poser une jardinière à son débouché ne la ferait pas croiser, mais
 * mettrait un obstacle exactement là où le visiteur pose le pied en arrivant.
 */
const MARGE_RAMPE = 1.5

/**
 * Hauteur de la jardinière : les plantes qu'elle reçoit s'y posent.
 *
 * DÉRIVÉE du modèle, et non recopiée. Elle valait `0.5` en dur, ce qui était la
 * cote du bac de l'époque — un nombre juste, donc invisible, et qui serait
 * devenu faux à la première jardinière remodelée. Le défaut aurait été muet :
 * un bac de 0,44 m aurait laissé les 33 plantes non autoportantes flotter à six
 * centimètres au-dessus de leur terreau, ce qu'aucune épreuve ne regarde et que
 * seul un coup d'œil sous le bon angle attrape.
 *
 * `maxY` de la jardinière EST sa hauteur : c'est la même mesure, prise une fois.
 */
const HAUTEUR_JARDINIERE = PROP_METRICS.jardiniere.maxY

/**
 * Enfoncement d'une plante dans sa jardinière, en mètres.
 *
 * Posée pile sur l'arête, on verrait le disque de terre du modèle flotter au
 * ras du bord. Six centimètres suffisent à le cacher derrière la margelle.
 */
const ENFONCEMENT = 0.06

/**
 * Les espèces, et comment elles se posent.
 *
 * Trois des quatre modèles Poly Haven sont des spécimens BOTANIQUES : ils n'ont
 * pas de pot, seulement une motte. Ils exigent donc une jardinière, qui n'est
 * pas un ajout décoratif mais la condition pour qu'ils ne flottent pas.
 */
interface Espece {
  id: PropId
  /** Vrai si le modèle porte son propre pot et se pose donc à même le sol. */
  autoportante: boolean
  echelleMin: number
  echelleMax: number
}

/**
 * Les échelles ne sont pas des goûts : elles amènent chaque espèce à la taille
 * d'une plante de hall, soit un mètre à un mètre trente hors tout, jardinière
 * comprise. Les relevés Poly Haven sont à l'échelle réelle du SUJET
 * photographié — un anthurium de cinquante centimètres, une haworthia de vingt
 * — et posés bruts dans un volume de 4,30 m sous plafond ils passeraient pour
 * des mauvaises herbes.
 */
const ESPECES: readonly Espece[] = [
  { id: 'plante-01', autoportante: false, echelleMin: 1, echelleMax: 1.2 },
  { id: 'plante-02', autoportante: false, echelleMin: 1.4, echelleMax: 1.7 },
  { id: 'plante-03', autoportante: true, echelleMin: 1, echelleMax: 1.2 },
  { id: 'plante-04', autoportante: false, echelleMin: 2, echelleMax: 2.4 },
]

// ── Aléa reproductible ───────────────────────────────────────────────────

/**
 * FNV-1a 32 bits. Choisi pour sa brièveté et sa stabilité : c'est une fonction
 * de hachage publiée, pas une improvisation, et elle donnera la même graine
 * dans dix ans pour `etage-1-north-0`.
 */
export function graineDepuis(texte: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** `mulberry32` : un état de 32 bits, une bonne équirépartition, zéro dépendance. */
export function generateur(graine: number): () => number {
  let etat = graine >>> 0
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Boîtes ───────────────────────────────────────────────────────────────

/** Boîte alignée sur les axes, en coordonnées monde. */
export interface Boite {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/**
 * Un obstacle est une boîte OU un disque.
 *
 * Le disque n'est pas un raffinement gratuit : l'hélice d'une rampe est
 * circulaire et centrée sur l'atrium, et sa boîte englobante déborde de plus de
 * trois mètres dans les diagonales. Modélisée en boîte, elle interdisait tout
 * le pourtour du vide central — c'est-à-dire exactement l'endroit où le §9.4
 * demande une rangée de végétation.
 */
export type Obstacle =
  | ({ forme: 'boite' } & Boite)
  | {
      forme: 'disque'
      x: number
      z: number
      rayon: number
      minY: number
      maxY: number
    }

/** Vrai si la boîte d'un prop rencontre l'obstacle. */
export function obstrue(boite: Boite, obstacle: Obstacle): boolean {
  if (obstacle.forme === 'boite') return croisent(boite, obstacle)
  if (boite.minY >= obstacle.maxY || obstacle.minY >= boite.maxY) return false
  // Point de la boîte le plus proche du centre du disque : c'est le test
  // cercle/rectangle standard, et le seul qui ne rejette pas les diagonales.
  const px = Math.min(Math.max(obstacle.x, boite.minX), boite.maxX)
  const pz = Math.min(Math.max(obstacle.z, boite.minZ), boite.maxZ)
  return Math.hypot(px - obstacle.x, pz - obstacle.z) < obstacle.rayon
}

export function croisent(a: Boite, b: Boite): boolean {
  return (
    a.minX < b.maxX &&
    b.minX < a.maxX &&
    a.minY < b.maxY &&
    b.minY < a.maxY &&
    a.minZ < b.maxZ &&
    b.minZ < a.maxZ
  )
}

/**
 * L'emprise d'un prop posé, à son échelle.
 *
 * Cylindrique en plan (voir `PropMetrics.radius`) : le lacet n'entre donc pas
 * dans le calcul, et une rotation ne peut jamais faire déborder un prop
 * validé.
 */
export function boiteDuProp(placement: PropPlacement): Boite {
  const m = PROP_METRICS[placement.id]
  const r = m.radius * placement.scale
  return {
    minX: placement.position.x - r,
    maxX: placement.position.x + r,
    minZ: placement.position.z - r,
    maxZ: placement.position.z + r,
    minY: placement.position.y + m.minY * placement.scale,
    maxY: placement.position.y + m.maxY * placement.scale,
  }
}

// ── Le point d'entrée ────────────────────────────────────────────────────

/**
 * Meuble et végétalise le bâtiment entier.
 *
 * Pur : même musée, même liste, dans le même ordre. L'ordre lui-même est
 * contractuel — niveaux dans l'ordre du musée, puis salles dans l'ordre du
 * niveau, puis pourtour de l'atrium — parce que le rendu construit ses lots
 * d'instances par simple parcours et qu'un ordre instable ferait scintiller les
 * matrices d'un rechargement à l'autre.
 */
/**
 * @param decor Les pièces d'architecture DÉJÀ posées, qui deviennent des
 *   obstacles au même titre qu'un mur.
 *
 *   L'ordre n'est pas arbitraire : **l'architecture existe avant le mobilier, et
 *   c'est le mobilier qui cède.** Une nervure naît du nez de dalle, elle y est ou
 *   le bâtiment est faux ; un banc, lui, a toujours un autre endroit où aller.
 *
 *   Par défaut vide, et c'est ce qui rend l'ajout sûr : les épreuves écrites
 *   avant le décor appellent toujours `placeProps(museum)` et voient exactement
 *   ce qu'elles voyaient.
 *
 *   Le besoin n'a pas été deviné, il a été MESURÉ : `tools/plan.ts` a montré
 *   l'anneau de jardinières du pourtour d'atrium traversant les nervures sur
 *   deux niveaux, jusqu'à 0,75 m de recouvrement. Rien ne pouvait l'empêcher —
 *   les deux modules placent contre des géométries différentes et ne se
 *   connaissaient pas.
 */
export function placeProps(
  museum: Museum,
  decor: readonly DecorPlacement[] = [],
): PropPlacement[] {
  const resultat: PropPlacement[] = []

  for (const floor of museum.floors) {
    const obstacles = obstaclesDuNiveau(museum, floor, decor)
    // Les props déjà posés deviennent à leur tour des obstacles : sans ça, deux
    // salles adjacentes peuvent poser chacune une jardinière de part et d'autre
    // d'une cloison mince et les faire se chevaucher au travers.
    const poses: Boite[] = []

    // Le poseur travaille par GROUPE et non par pièce, parce que certaines
    // pièces n'ont aucun sens seules : une plante posée sur sa jardinière
    // occupe le même mètre carré qu'elle. Testées une à une, la seconde serait
    // systématiquement refusée par la première — et le bâtiment se remplirait
    // de jardinières vides. Le groupe est donc testé en bloc, puis accepté ou
    // refusé en bloc.
    const poser = (groupe: PropPlacement[]): boolean => {
      if (groupe.length === 0) return false
      const boite = groupe.map(boiteDuProp).reduce(union)
      if (obstacles.some((o) => obstrue(boite, o))) return false
      if (poses.some((p) => croisent(etendre(boite, ENTRE_PROPS), p))) return false
      poses.push(boite)
      resultat.push(...groupe)
      return true
    }

    for (const room of floor.rooms) {
      meublerSalle(floor, room, poser)
    }
    borderLesTremies(floor, poser)
  }

  return resultat
}

// ── Les obstacles d'un niveau ────────────────────────────────────────────

/**
 * Tout ce qu'un prop n'a pas le droit de toucher, sur ce niveau.
 *
 * Exporté pour que la sonde de développement puisse afficher ce que le
 * placement a réellement vu — un prop mal posé vient presque toujours d'un
 * obstacle manquant, pas d'un test d'intersection faux.
 */
export function obstaclesDuNiveau(
  museum: Museum,
  floor: Floor,
  decor: readonly DecorPlacement[] = [],
): Obstacle[] {
  const obstacles: Obstacle[] = []
  const bas = floor.elevation
  const haut = floor.elevation + floor.ceilingHeight

  // Le décor d'architecture, en disques : une pièce qui penche déborde de son
  // axe, et le cylindre englobant est la seule emprise qui reste vraie quel que
  // soit son lacet — la même raison qui fait que `PropMetrics` mesure un rayon.
  for (const piece of decor) {
    if (piece.floorId !== null && piece.floorId !== floor.id) continue
    const m = DECOR_METRICS[piece.id]
    obstacles.push({
      forme: 'disque',
      x: piece.position.x,
      z: piece.position.z,
      rayon: m.radius * Math.max(piece.scale.x, piece.scale.z),
      minY: piece.position.y + m.minY * piece.scale.y,
      maxY: piece.position.y + m.maxY * piece.scale.y,
    })
  }

  for (const room of floor.rooms) {
    for (const wall of room.walls) {
      // DEUX bandes, et c'est ce qui permet au rail de projecteurs d'exister.
      // Au niveau du mobilier on s'écarte franchement du mur (RECUL_MUR) :
      // c'est là que sont les plinthes, les cimaises et les toiles. Plus haut,
      // seul le CORPS du mur est un obstacle — sans quoi aucun projecteur ne
      // pourrait être aligné à 1,15 m d'un mur, puisque toutes les têtes
      // proches d'un angle tomberaient dans la bande du mur perpendiculaire.
      obstacles.push(bandeDeMur(wall, bas, Math.min(haut, bas + HAUTEUR_MOBILIER), RECUL_MUR))
      obstacles.push(bandeDeMur(wall, bas, haut, CORPS_MUR))
      for (const opening of wall.openings) {
        obstacles.push(boiteDOuverture(wall, opening, bas))
      }
      for (const placement of wall.placements) {
        // L'œuvre est déjà couverte par la bande de mur au sol ; elle ne l'est
        // plus pour un projecteur, qui vit à 1,15 m du parement. On la remet
        // donc explicitement, avec son débord de cadre.
        obstacles.push(boiteDOeuvre(wall, placement.u, placement.width, placement.height, bas))
      }
    }
  }

  // Les trémies : ni prop au sol au-dessus du vide, ni prop collé au garde-corps.
  for (const hole of floor.slabHoles) {
    obstacles.push(depuisRect(agrandir(hole, RECUL_TREMIE), bas, haut))
  }

  // L'hélice des rampes qui touchent ce niveau — départ comme arrivée. On
  // réserve le DISQUE, pas l'anneau : le débouché d'une rampe est aussi
  // encombrant que son tablier, et il est au centre.
  for (const ramp of museum.ramps) {
    if (ramp.fromFloor !== floor.id && ramp.toFloor !== floor.id) continue
    obstacles.push(disqueDeRampe(ramp, bas, haut))
  }

  return obstacles
}

/** La bande occupée par un mur, élargie du recul de part et d'autre de son axe. */
function bandeDeMur(wall: Wall, bas: number, haut: number, recul: number): Obstacle {
  return {
    forme: 'boite',
    minX: Math.min(wall.a.x, wall.b.x) - recul,
    maxX: Math.max(wall.a.x, wall.b.x) + recul,
    minZ: Math.min(wall.a.z, wall.b.z) - recul,
    maxZ: Math.max(wall.a.z, wall.b.z) + recul,
    minY: bas,
    maxY: haut,
  }
}

/**
 * Le couloir d'une ouverture : la largeur du jour, élargie, traversant le mur
 * de part et d'autre.
 *
 * Volontairement limité en hauteur (`HAUTEUR_PASSAGE`) : c'est le PASSAGE du
 * joueur qui doit rester libre, pas la colonne d'air jusqu'au plafond. Sans
 * cette limite, un mur percé d'une baie ne pourrait plus recevoir de rail de
 * projecteurs.
 */
function boiteDOuverture(
  wall: Wall,
  opening: { start: number; end: number; height: number },
  bas: number,
): Obstacle {
  const d = direction(wall)
  const debut = { x: wall.a.x + d.x * (opening.start - MARGE_PORTE), z: wall.a.z + d.z * (opening.start - MARGE_PORTE) }
  const fin = { x: wall.a.x + d.x * (opening.end + MARGE_PORTE), z: wall.a.z + d.z * (opening.end + MARGE_PORTE) }
  const n = wall.normal
  return {
    forme: 'boite',
    minX: Math.min(debut.x, fin.x) - Math.abs(n.x) * PASSAGE_PORTE,
    maxX: Math.max(debut.x, fin.x) + Math.abs(n.x) * PASSAGE_PORTE,
    minZ: Math.min(debut.z, fin.z) - Math.abs(n.z) * PASSAGE_PORTE,
    maxZ: Math.max(debut.z, fin.z) + Math.abs(n.z) * PASSAGE_PORTE,
    minY: bas,
    maxY: bas + Math.max(opening.height, HAUTEUR_PASSAGE),
  }
}

/** L'emprise d'une toile accrochée, cadre et débord compris. */
function boiteDOeuvre(
  wall: Wall,
  u: number,
  largeur: number,
  hauteur: number,
  bas: number,
): Obstacle {
  const d = direction(wall)
  const centre = { x: wall.a.x + d.x * u, z: wall.a.z + d.z * u }
  const demi = largeur / 2
  // 0,55 m depuis l'axe : l'épaisseur d'un mur révisé (0,32 m) plus le débord du
  // cadre et sa marge. Du côté opposé la toile n'existe pas, mais la bande de
  // mur couvre déjà ce côté-là.
  const debord = 0.55
  return {
    forme: 'boite',
    minX: Math.min(centre.x - demi * Math.abs(d.x), centre.x + wall.normal.x * debord) - 0.05,
    maxX: Math.max(centre.x + demi * Math.abs(d.x), centre.x + wall.normal.x * debord) + 0.05,
    minZ: Math.min(centre.z - demi * Math.abs(d.z), centre.z + wall.normal.z * debord) - 0.05,
    maxZ: Math.max(centre.z + demi * Math.abs(d.z), centre.z + wall.normal.z * debord) + 0.05,
    // Une œuvre est accrochée à 1,45 m ; sa boîte descend jusqu'au sol pour
    // qu'aucun socle de 1,05 m ne vienne se glisser dessous et la masquer.
    minY: bas,
    maxY: bas + 1.45 + hauteur / 2 + 0.1,
  }
}

/** Le disque interdit par une rampe hélicoïdale, marge comprise. */
function disqueDeRampe(ramp: Ramp, bas: number, haut: number): Obstacle {
  return {
    forme: 'disque',
    x: ramp.centre.x,
    z: ramp.centre.z,
    rayon: ramp.radius + ramp.width / 2 + MARGE_RAMPE,
    minY: bas,
    maxY: haut,
  }
}

// ── Meubler une salle ────────────────────────────────────────────────────

type Poseur = (groupe: PropPlacement[]) => boolean

function meublerSalle(floor: Floor, room: Room, poser: Poseur): void {
  // Une graine par SALLE, pas par bâtiment : ajouter un dépôt déplace des
  // œuvres, il n'a aucune raison de redistribuer la végétation des autres.
  const alea = generateur(graineDepuis(room.id))
  const aire = room.footprint.width * room.footprint.depth

  poserLesPlantes(floor, room, aire, alea, poser)
  poserLeBanc(floor, room, aire, poser)
  poserLesSocles(floor, room, aire, alea, poser)
  poserLeRail(floor, room, poser)
}

/**
 * La végétation d'une salle : les angles d'abord, le pourtour ensuite.
 *
 * Les angles d'abord parce que c'est là qu'une plante travaille le plus : c'est
 * l'endroit exact où deux plans orthogonaux se rencontrent, donc l'endroit où
 * l'orthogonalité du procédural est la plus lisible. C'est aussi le seul
 * endroit d'une salle d'exposition qui ne serve à rien d'autre.
 */
function poserLesPlantes(
  floor: Floor,
  room: Room,
  aire: number,
  alea: () => number,
  poser: Poseur,
): void {
  if (aire < 12) return
  // Une plante pour 40 m², deux au minimum dès qu'une salle est de bonne taille,
  // douze au plus. Le plafond a été relevé de huit à douze après relecture à
  // l'écran : la réserve fait 30 m sur 30, et huit bacs y disparaissaient
  // franchement — c'est précisément la salle où l'échelle manque le plus.
  const cible = aire < SALLE_ASSEZ_GRANDE ? 1 : Math.min(12, Math.max(2, Math.round(aire / 40)))

  let poseesCount = 0
  for (const point of pourtour(room.footprint, RECUL_MUR + 1.1, PAS_POURTOUR)) {
    if (poseesCount >= cible) break
    const espece = ESPECES[Math.floor(alea() * ESPECES.length) % ESPECES.length]
    const echelle = espece.echelleMin + alea() * (espece.echelleMax - espece.echelleMin)
    if (poserUnePlante(floor, espece, echelle, point, alea() * Math.PI * 2, poser)) poseesCount++
  }
}

/**
 * Pose une plante, avec sa jardinière si l'espèce n'en porte pas.
 *
 * Le couple est indissociable : on teste l'encombrement du PLUS GRAND des deux
 * avant de poser quoi que ce soit, sinon une jardinière validée pourrait
 * recevoir un feuillage qui, lui, entre dans le mur.
 */
function poserUnePlante(
  floor: Floor,
  espece: Espece,
  echelle: number,
  point: Vec2,
  lacet: number,
  poser: Poseur,
): boolean {
  const plante: PropPlacement = {
    id: espece.id,
    position: {
      x: point.x,
      y: floor.elevation + (espece.autoportante ? 0 : HAUTEUR_JARDINIERE - ENFONCEMENT),
      z: point.z,
    },
    rotation: lacet,
    scale: echelle,
    floorId: floor.id,
  }

  if (espece.autoportante) return poser([plante])

  return poser([
    {
      id: 'jardiniere',
      position: { x: point.x, y: floor.elevation, z: point.z },
      // Une jardinière carrée tournée d'un quart de tour est identique à
      // elle-même : on la garde alignée, elle sert d'assise franche au feuillage.
      rotation: 0,
      scale: 1,
      floorId: floor.id,
    },
    plante,
  ])
}

/**
 * Le banc, au milieu de la salle, FACE AU MUR LE PLUS GARNI.
 *
 * C'est la règle des vrais musées, et elle n'est pas arbitraire : on s'assoit
 * pour regarder, donc devant ce qu'il y a à regarder. Un banc au centre
 * géométrique d'une salle vide serait un meuble, pas un usage — et la
 * différence se voit.
 */
function poserLeBanc(floor: Floor, room: Room, aire: number, poser: Poseur): void {
  if (aire < 45) return
  if (Math.min(room.footprint.width, room.footprint.depth) < 6) return

  const mur = murLePlusGarni(room)
  if (mur === null) return

  const d = direction(mur)
  const u = moyenne(mur.placements.map((p) => p.u))
  // On recule dans la salle, mais jamais au-delà de sa moitié : dans une salle
  // de 6 m de profondeur, 2,60 m mettraient le banc contre le mur d'en face.
  const recul = Math.min(RECUL_BANC, profondeurUtile(room.footprint, mur.normal) * 0.42)

  poser([
    {
      id: 'banc',
      position: {
        x: mur.a.x + d.x * u + mur.normal.x * recul,
        y: floor.elevation,
        z: mur.a.z + d.z * u + mur.normal.z * recul,
      },
      // Le grand axe du banc est PARALLÈLE au mur : on s'assoit de face, en
      // rangée. Un lacet de θ envoie le +X local sur (cos θ, 0, −sin θ).
      rotation: Math.atan2(-d.z, d.x),
      scale: 1,
      floorId: floor.id,
    },
  ])
}

/** Le mur qui porte le plus d'œuvres. `null` si la salle est nue. */
function murLePlusGarni(room: Room): Wall | null {
  let meilleur: Wall | null = null
  for (const wall of room.walls) {
    if (wall.placements.length === 0) continue
    // Départage par identifiant à égalité de garnissage : l'ordre du JSON n'est
    // pas un contrat, le déterminisme en est un.
    if (
      meilleur === null ||
      wall.placements.length > meilleur.placements.length ||
      (wall.placements.length === meilleur.placements.length && wall.id < meilleur.id)
    ) {
      meilleur = wall
    }
  }
  return meilleur
}

/**
 * Un ou deux socles, dans les salles qui ont de la place au sol.
 *
 * Ils sont posés sur l'axe LONG de la salle, à un tiers et deux tiers : c'est
 * la seule disposition qui ne se retrouve jamais dans l'axe d'une porte, dont
 * les ouvertures sont, elles, presque toujours centrées sur leur mur.
 */
function poserLesSocles(
  floor: Floor,
  room: Room,
  aire: number,
  alea: () => number,
  poser: Poseur,
): void {
  if (aire < 70) return
  const nombre = aire >= 150 ? 2 : 1
  const fp = room.footprint
  const horizontal = fp.width >= fp.depth
  const cx = fp.x + fp.width / 2
  const cz = fp.z + fp.depth / 2
  const longueur = horizontal ? fp.width : fp.depth

  for (let i = 0; i < nombre; i++) {
    // Un socle unique va au centre ; deux socles se répartissent au tiers.
    const t = nombre === 1 ? 0 : (i === 0 ? -1 : 1) / 3
    const decalage = t * longueur
    poser([
      {
        id: 'socle',
        position: {
          x: horizontal ? cx + decalage : cx,
          y: floor.elevation,
          z: horizontal ? cz : cz + decalage,
        },
        // Un socle est un prisme carré : le faire pivoter d'un angle franc casse
        // la lecture « tout est aligné » sans qu'on puisse dire pourquoi.
        rotation: (alea() - 0.5) * 0.5,
        scale: 1,
        floorId: floor.id,
      },
    ])
  }
}

/**
 * Le rail de projecteurs : un par œuvre, au plafond, à l'aplomb du recul.
 *
 * Aucun n'émet de lumière (§9.2). Ils sont alignés sur le `u` des œuvres parce
 * qu'un rail dont les têtes ne correspondent à rien se lit comme un décor de
 * fond de scène ; alignées, elles racontent l'accrochage.
 */
function poserLeRail(floor: Floor, room: Room, poser: Poseur): void {
  for (const wall of room.walls) {
    for (const placement of wall.placements) {
      const d = direction(wall)
      poser([
        {
          id: 'projecteur',
          position: {
            x: wall.a.x + d.x * placement.u + wall.normal.x * RECUL_RAIL,
            y: floor.elevation + floor.ceilingHeight,
            z: wall.a.z + d.z * placement.u + wall.normal.z * RECUL_RAIL,
          },
          // La tête regarde le mur : le lacet θ envoie le +Z local sur
          // (sin θ, 0, cos θ), on veut donc −normal.
          rotation: Math.atan2(-wall.normal.x, -wall.normal.z),
          scale: 1,
          floorId: floor.id,
        },
      ])
    }
  }
}

// ── Le pourtour de l'atrium ──────────────────────────────────────────────

/**
 * L'anneau de jardinières et les bancs qui bordent le vide central.
 *
 * Il ne se pose que là où la dalle est LIBRE : aux niveaux où les salles
 * viennent au contact de la trémie, il ne reste aucun pourtour et l'anneau sort
 * vide — c'est correct, et c'est pour ça que le test se fait sur l'emprise
 * réelle et non sur une intention.
 *
 * Au rez-de-chaussée en revanche, le hall entoure la trémie sur trois côtés :
 * c'est la première image du musée, et la seule où l'anneau existe vraiment.
 */
function borderLesTremies(floor: Floor, poser: Poseur): void {
  const alea = generateur(graineDepuis(`${floor.id}:atrium`))

  for (const hole of floor.slabHoles) {
    // Les bancs D'ABORD, l'anneau ensuite. L'ordre est une décision, pas une
    // commodité : les deux se disputent le milieu de chaque bord, et c'est le
    // banc qui doit gagner. C'est le meuble le plus regardé du bâtiment — on
    // s'assoit face au puits de lumière — alors qu'un bac de plus au même
    // endroit ne raconte rien. Posé en second, l'anneau se contente d'encadrer
    // le banc au lieu de lui prendre sa place.
    for (const banc of bancsDeTremie(floor, hole)) {
      if (surDalleLibre(floor, { x: banc.position.x, z: banc.position.z })) poser([banc])
    }

    for (const point of pourtour(agrandir(hole, RECUL_ANNEAU), 0, PAS_ANNEAU)) {
      if (!surDalleLibre(floor, point)) continue
      const espece = ESPECES[Math.floor(alea() * ESPECES.length) % ESPECES.length]
      const echelle = espece.echelleMin + alea() * (espece.echelleMax - espece.echelleMin)
      poserUnePlante(floor, espece, echelle, point, alea() * Math.PI * 2, poser)
    }
  }
}

/**
 * Dégagement derrière l'anneau, pour que le banc tienne entier.
 *
 * DÉRIVÉ du banc, et non recopié. La valeur était `0.9` en dur, c'est-à-dire la
 * demi-longueur du banc plus un jeu — encore un nombre juste tant que le banc ne
 * bougeait pas. Le lire sur `PROP_METRICS` fait que rallonger le banc écarte
 * l'anneau tout seul, au lieu de le laisser mordre sur le vide de la trémie.
 *
 * Le jeu de 7 cm est ce qui reste quand on retire le rayon mesuré (0,828 m) de
 * l'ancienne constante : la géométrie ne bouge donc que de trois millimètres, ce
 * qui est le prix de ne plus avoir de nombre magique.
 */
const DEGAGEMENT_BANC = PROP_METRICS.banc.radius + 0.07

function bancsDeTremie(floor: Floor, hole: Rect): PropPlacement[] {
  const cx = hole.x + hole.width / 2
  const cz = hole.z + hole.depth / 2
  const dx = hole.width / 2 + RECUL_ANNEAU + DEGAGEMENT_BANC
  const dz = hole.depth / 2 + RECUL_ANNEAU + DEGAGEMENT_BANC
  // Nord et sud : banc allongé selon X. Est et ouest : allongé selon Z.
  const cotes: { x: number; z: number; rotation: number }[] = [
    { x: cx, z: cz - dz, rotation: 0 },
    { x: cx, z: cz + dz, rotation: 0 },
    { x: cx - dx, z: cz, rotation: Math.PI / 2 },
    { x: cx + dx, z: cz, rotation: Math.PI / 2 },
  ]
  return cotes.map((c) => ({
    id: 'banc' as const,
    position: { x: c.x, y: floor.elevation, z: c.z },
    rotation: c.rotation,
    scale: 1,
    floorId: floor.id,
  }))
}

/**
 * Vrai si le point est sur la dalle du niveau ET hors de toute salle.
 *
 * Les salles sont closes : on n'y entre que par une porte. Un prop du pourtour
 * qui atterrirait dans une salle serait, au mieux, un doublon de la végétation
 * que la salle a déjà posée pour elle-même.
 */
function surDalleLibre(floor: Floor, point: Vec2): boolean {
  if (!dansRect(point, retrecir(floor.footprint, 1))) return false
  return !floor.rooms.some((room) => dansRect(point, agrandir(room.footprint, RECUL_MUR)))
}

// ── Géométrie de service ─────────────────────────────────────────────────

/** Vecteur unitaire de `a` vers `b`. */
function direction(wall: Wall): Vec2 {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const l = Math.hypot(dx, dz) || 1
  return { x: dx / l, z: dz / l }
}

/** Étendue de la salle dans la direction de `normal`, depuis le mur. */
function profondeurUtile(fp: Rect, normal: Vec2): number {
  return Math.abs(normal.x) > Math.abs(normal.z) ? fp.width : fp.depth
}

function moyenne(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  return valeurs.reduce((s, v) => s + v, 0) / valeurs.length
}

/**
 * Les points d'un pourtour rectangulaire, ANGLES D'ABORD.
 *
 * L'ordre est le contrat de ce module : les quatre angles sont rendus les
 * premiers, puis les points intermédiaires de chaque côté. Comme l'appelant
 * s'arrête dès qu'il a son compte, une salle reçoit ses plantes dans ses angles
 * avant d'en recevoir le long de ses murs — sans qu'aucun code d'appel n'ait à
 * connaître la différence.
 */
function pourtour(rect: Rect, marge: number, pas: number): Vec2[] {
  const r = retrecir(rect, marge)
  if (r.width <= 0 || r.depth <= 0) return []

  const x0 = r.x
  const x1 = r.x + r.width
  const z0 = r.z
  const z1 = r.z + r.depth

  const angles: Vec2[] = [
    { x: x0, z: z0 },
    { x: x1, z: z0 },
    { x: x1, z: z1 },
    { x: x0, z: z1 },
  ]

  const intermediaires: Vec2[] = []
  const long = (a: number, b: number, fixe: number, horizontal: boolean) => {
    const n = Math.floor((b - a) / pas)
    for (let i = 1; i < n; i++) {
      const t = a + ((b - a) * i) / n
      intermediaires.push(horizontal ? { x: t, z: fixe } : { x: fixe, z: t })
    }
  }
  long(x0, x1, z0, true)
  long(x0, x1, z1, true)
  long(z0, z1, x0, false)
  long(z0, z1, x1, false)

  return [...angles, ...intermediaires]
}

function retrecir(rect: Rect, marge: number): Rect {
  return {
    x: rect.x + marge,
    z: rect.z + marge,
    width: rect.width - 2 * marge,
    depth: rect.depth - 2 * marge,
  }
}

function agrandir(rect: Rect, marge: number): Rect {
  return retrecir(rect, -marge)
}

function dansRect(point: Vec2, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.z >= rect.z &&
    point.z <= rect.z + rect.depth
  )
}

function depuisRect(rect: Rect, bas: number, haut: number): Obstacle {
  return {
    forme: 'boite',
    minX: rect.x,
    maxX: rect.x + rect.width,
    minZ: rect.z,
    maxZ: rect.z + rect.depth,
    minY: bas,
    maxY: haut,
  }
}

/** La plus petite boîte contenant les deux. */
function union(a: Boite, b: Boite): Boite {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

/** Dilate une boîte horizontalement seulement : la hauteur est déjà juste. */
function etendre(boite: Boite, marge: number): Boite {
  return {
    ...boite,
    minX: boite.minX - marge,
    maxX: boite.maxX + marge,
    minZ: boite.minZ - marge,
    maxZ: boite.maxZ + marge,
  }
}
