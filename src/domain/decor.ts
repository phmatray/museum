/**
 * LOT 9 — Le DÉCOR d'architecture : ce qui tient au bâtiment, pas aux salles.
 *
 * Ce module décide OÙ se posent les pièces qui appartiennent à la STRUCTURE —
 * nervures d'atrium pour commencer. Il ne dessine rien : `scene/DecorLayer.tsx`
 * prend la liste et la fusionne. Comme tout ce qui vit dans `domain/`, il
 * n'importe ni `three` ni `react`.
 *
 * ── Pourquoi un module séparé de `props.ts` ──
 *
 * Ce n'est pas le même problème, et les mettre ensemble aurait mélangé deux
 * régimes qui ne se ressemblent pas :
 *
 *  - `props.ts` est un solveur par REJET. Il propose un banc, le teste contre la
 *    géométrie de la salle, et l'ABANDONNE s'il ne passe pas — « on préfère une
 *    salle un peu vide à une salle impraticable ». Une nervure d'atrium n'est pas
 *    un candidat : elle naît du nez de dalle, elle y est ou le bâtiment est faux.
 *  - `PropPlacement.rotation` est un LACET (un nombre) et `scale` un scalaire,
 *    parce que le mobilier ne tourne qu'autour de Y. Une pièce d'architecture
 *    bascule et s'étire : il lui faut trois axes. Élargir `PropPlacement`
 *    casserait `PropsLayer` et l'hypothèse sur laquelle repose
 *    `PropMetrics.radius`, qui dit explicitement qu'un rayon suffit « quel que
 *    soit le lacet ».
 *  - `PROP_IDS` est un contrat de LOTS D'INSTANCES : `PropsLayer` fait un
 *    `InstancedMesh` par entrée. Y verser les pièces de décor coûterait un draw
 *    call chacune, sur un compteur déjà à 259 pour un plafond de 150.
 *
 * Le précédent existe : `domain/park.ts` importe déjà `generateur` et
 * `graineDepuis` de `./props` et vit à côté. On fait pareil.
 *
 * ── Déterminisme ──
 *
 * Aucun `Math.random`, aucune horloge. Ce module est pour l'instant entièrement
 * régulier — les nervures sont réparties au pas constant — et le restera tant
 * qu'une variation n'apporte rien : une colonnade dont les fûts seraient
 * inégalement espacés ne lirait pas comme du hasard, elle lirait comme un défaut.
 */
import type { Museum, Rect, Vec3 } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

export type DecorId =
  // ── Structure ──
  | 'nervure-atrium'
  | 'nervure-lanterneau'
  | 'mat-arborescent'
  | 'console'
  | 'sculpture-atrium'
  | 'suspension-atrium'
  // ── Accueil ──
  | 'banque-accueil'
  | 'totem'
  | 'borne-info'
  | 'poteau-file'
  | 'portemanteau'
  | 'corbeille'
  | 'banc-courbe'
  // ── Salles ──
  | 'pupitre-cartel'
  | 'socle-haut'
  | 'socle-bas'
  | 'vitrine'
  | 'lampadaire'
  | 'jardiniere-longue'
  | 'jardiniere-ronde'
  // ── Parc ──
  | 'portique'
  | 'sculpture-parvis'
  | 'banc-parc'
  | 'borne-parc'
  | 'vasque'

/**
 * Ordre canonique, contractuel comme `PROP_IDS`.
 *
 * ⛔ Deux pièces du kit n'y figurent PAS, et c'est délibéré :
 *
 *  - `balustrade-nervuree` — `ramp.ts` produit déjà `railingColliders` le long
 *    des deux rives de l'hélice, et les nervures de trémie bordent déjà les
 *    plateaux. Une troisième main courante au même endroit ne se lirait pas
 *    comme du soin, elle se lirait comme un doublon. La pièce reste dans le kit,
 *    prête pour l'escalier sculpté, qui n'est pas encore fait.
 *
 * Une pièce présente dans le kit mais absente d'ici ne coûte que sa place dans
 * le GLB commité : `assemblerLeDecor` ne charge que ce qui est placé.
 */
export const DECOR_IDS: readonly DecorId[] = [
  'nervure-atrium',
  'nervure-lanterneau',
  'mat-arborescent',
  'console',
  'sculpture-atrium',
  'suspension-atrium',
  'banque-accueil',
  'totem',
  'borne-info',
  'poteau-file',
  'portemanteau',
  'corbeille',
  'banc-courbe',
  'pupitre-cartel',
  'socle-haut',
  'socle-bas',
  'vitrine',
  'lampadaire',
  'jardiniere-longue',
  'jardiniere-ronde',
  'portique',
  'sculpture-parvis',
  'banc-parc',
  'borne-parc',
  'vasque',
]

export interface DecorPlacement {
  id: DecorId
  /** Position MONDE, élévation du niveau comprise. Même convention que `PropPlacement`. */
  position: Vec3
  /** Euler XYZ en radians — la convention de three et celle de la prop `rotation`. */
  rotation: Vec3
  /**
   * Échelle par AXE : c'est ce qui sépare une pièce d'architecture d'un meuble.
   * Une nervure s'étire sur sa portée, un banc non.
   *
   * ⛔ TOUJOURS strictement positive. Un déterminant négatif retournerait
   * l'enroulement des triangles — et dans un lot FUSIONNÉ, où toutes les pièces
   * partagent un seul matériau et un seul état de `side`, la pièce miroir
   * sortirait retournée sans que rien d'autre ne bouge. On miroite par une
   * rotation de π, jamais par un signe. Un test le vérifie.
   */
  scale: Vec3
  /** `null` pour ce qui n'appartient à aucun niveau. */
  floorId: string | null
}

/**
 * Emprise d'une pièce à l'échelle 1, mesurée sur le GLB.
 *
 * Mêmes conventions que `PropMetrics` : `radius` est le rayon du cylindre
 * englobant, `minY`/`maxY` sont relatifs au point d'ancrage.
 */
export interface DecorMetrics {
  radius: number
  minY: number
  maxY: number
  /**
   * Comment le joueur la rencontre. `null` = il la traverse, et c'est VOULU :
   * une nervure qui naît au-dessus de la tête est hors d'atteinte, lui donner un
   * collider ne ferait que charger la phase large de Rapier.
   */
  collision: 'cylindre' | null
}

/**
 * Mesuré sur le GLB réel par `metriquesDuNoeud`, jamais estimé — et l'épreuve
 * qui le vérifie a servi dès son premier passage.
 *
 * La première valeur écrite ici était `1.14`, prise sur la seule borne X du
 * fichier (±1,1398). C'était FAUX : le rayon du cylindre englobant se mesure
 * depuis l'origine dans le plan XZ, et la pièce déborde aussi en Z (±0,6722).
 * Le vrai rayon vaut `hypot(1.1398, 0.6722) = 1.3166`, soit **16 % de plus**.
 *
 * Une sous-estimation de rayon ne casse aucun test de placement — elle laisse
 * simplement la pièce entrer dans ce qu'elle aurait dû éviter, et ça ne se voit
 * qu'à l'écran, depuis le bon angle, si on passe par là. C'est exactement le
 * défaut que `glbBounds.ts` a été écrit pour fermer, et il l'a fermé.
 */
/**
 * ── `collision` vaut `null` PARTOUT, et c'est une constatation, pas un oubli ──
 *
 * Le mobilier de `props.ts` n'a lui non plus aucun collider : le visiteur
 * traverse déjà les bancs, les socles et les jardinières du musée. Donner des
 * colliders au seul décor produirait un bâtiment où l'on contourne une corbeille
 * et où l'on marche à travers un banc — moins cohérent que l'état actuel, pas
 * plus. C'est un chantier à part, qui doit couvrir les deux couches d'un coup ;
 * le champ existe pour l'accueillir, il n'est pas encore rempli.
 *
 * ⛔ Et il ne devra JAMAIS être rempli pour `balustrade-nervuree` : `ramp.ts`
 * produit déjà `railingColliders`, et un second jeu rendrait l'escalier
 * infranchissable.
 */
export const DECOR_METRICS: Record<DecorId, DecorMetrics> = {
  // Relevé par `node tools/measure-props.ts --decor` sur les kits réels.
  'nervure-atrium': { radius: 1.327, minY: -0.007, maxY: 4.301, collision: null },
  'nervure-lanterneau': { radius: 0.901, minY: -0.004, maxY: 2.603, collision: null },
  'mat-arborescent': { radius: 2.851, minY: -0.005, maxY: 4.001, collision: null },
  console: { radius: 0.742, minY: -0.002, maxY: 0.601, collision: null },
  // minY négatif : ces deux-là PENDENT. Leur ancre est le plan de suspension.
  'sculpture-atrium': { radius: 1.707, minY: -3.001, maxY: 0.006, collision: null },
  'suspension-atrium': { radius: 1.131, minY: -1.304, maxY: 0.002, collision: null },
  'banque-accueil': { radius: 1.136, minY: -0.008, maxY: 1.101, collision: null },
  totem: { radius: 0.465, minY: -0.003, maxY: 3.001, collision: null },
  'borne-info': { radius: 0.347, minY: 0, maxY: 1.407, collision: null },
  'poteau-file': { radius: 0.344, minY: 0, maxY: 0.999, collision: null },
  portemanteau: { radius: 0.479, minY: -0.002, maxY: 1.8, collision: null },
  corbeille: { radius: 0.265, minY: 0, maxY: 0.9, collision: null },
  'banc-courbe': { radius: 1.011, minY: -0.001, maxY: 0.452, collision: null },
  'pupitre-cartel': { radius: 0.369, minY: -0.006, maxY: 1.101, collision: null },
  'socle-haut': { radius: 0.431, minY: -0.002, maxY: 1.404, collision: null },
  'socle-bas': { radius: 0.625, minY: -0.001, maxY: 0.35, collision: null },
  vitrine: { radius: 0.674, minY: -0.001, maxY: 0.9, collision: null },
  lampadaire: { radius: 0.413, minY: -0.01, maxY: 1.802, collision: null },
  'jardiniere-longue': { radius: 0.635, minY: -0.009, maxY: 0.501, collision: null },
  'jardiniere-ronde': { radius: 0.401, minY: -0.001, maxY: 0.8, collision: null },
  portique: { radius: 2.194, minY: -0.001, maxY: 4.998, collision: null },
  'sculpture-parvis': { radius: 1.594, minY: 0, maxY: 4.002, collision: null },
  'banc-parc': { radius: 0.831, minY: 0, maxY: 0.84, collision: null },
  'borne-parc': { radius: 0.304, minY: -0.004, maxY: 0.895, collision: null },
  vasque: { radius: 0.552, minY: 0, maxY: 0.502, collision: null },
}

// ── Réglages ─────────────────────────────────────────────────────────────

/**
 * Pas des nervures le long du pourtour de l'atrium, en mètres.
 *
 * ── Le pas n'est pas un goût : il est BORNÉ PAR LES ANGLES ──
 *
 * Deux nervures voisines ne doivent pas se traverser, donc leurs centres doivent
 * être distants d'au moins deux rayons — 2 × 1,317 = 2,63 m. Sur une ligne
 * droite, un pas de 3 m suffirait. Mais le pourtour d'une trémie tourne, et
 * **la corde qui coupe un angle est plus courte que l'arc qui le contourne** :
 * deux points séparés de `p` le long du périmètre, de part et d'autre d'un coin,
 * ne sont éloignés que de `p/√2` dans le pire cas.
 *
 * D'où la borne : `p ≥ 2r·√2 = 3,73 m`. À 3 m, quatre paires se traversaient —
 * une par coin — et le défaut était invisible en 3D, où deux nervures
 * superposées lisent comme une nervure épaisse.
 *
 * 4 m laisse la marge, donne treize nervures sur les 52,4 m de pourtour, et
 * garde le rythme : trois par côté environ. Plus serré, la colonnade devient une
 * palissade et ferme le vide qu'elle est censée célébrer.
 */
const PAS_NERVURE = 4

/**
 * Recul du pied de la nervure par rapport au bord de la trémie, en mètres.
 *
 * Négatif : la nervure est posée EN RETRAIT du vide, sur la dalle. Elle penche
 * ensuite au-dessus de l'atrium — c'est le porte-à-faux qui fait le geste — mais
 * son pied reste sur le plancher, là où il y a de quoi le porter.
 *
 * 0,55 m tient compte du garde-corps de la trémie (1,10 m de haut) : le pied de
 * la nervure se place DERRIÈRE lui, sans quoi les deux se traverseraient.
 */
const RECUL_NERVURE = 0.55

/**
 * Échelle de la nervure quand elle sert de garde-corps sculpté, aux niveaux qui
 * ne sont pas le dernier.
 *
 * 1,15 / 4,31 ≈ 0,267. La cote visée est celle du garde-corps existant —
 * `RAILING_HEIGHT` vaut 1,10 m — parce que c'est la hauteur à laquelle une pièce
 * borde un vide sans le fermer.
 *
 * Elle doit rester **franchement sous la hauteur d'œil**, qui est de 1,62 m dans
 * ce musée : c'est tout l'enjeu. Au-dessus, on retombe sur la palissade ; en
 * dessous de 0,9 m, la pièce ne borde plus rien et lit comme un plot.
 *
 * L'échelle est UNIFORME et non appliquée au seul axe vertical : écraser la
 * pièce sur sa hauteur détruirait l'effilement, c'est-à-dire ce qui fait
 * qu'elle est une nervure et pas un poteau.
 */
const ECHELLE_GARDE_CORPS = 0.267

// ── Placement ────────────────────────────────────────────────────────────

/**
 * Toutes les pièces de décor du bâtiment.
 *
 * L'ordre est contractuel : il détermine l'ordre de fusion côté rendu, donc la
 * comparabilité de deux exécutions.
 */
export function placeDecor(museum: Museum): DecorPlacement[] {
  const placements: DecorPlacement[] = []

  // ── DEUX RÔLES pour la même pièce, selon le niveau ──
  //
  // Les nervures ont d'abord été posées à pleine hauteur sur les trois niveaux
  // ouverts. Le plan coté validait ce placement — aucun recouvrement — et il
  // avait raison sur ce qu'il mesure. Les captures ont montré ce qu'il ne mesure
  // pas : trente-neuf lames de 4,30 m sur tout le pourtour, à hauteur d'œil,
  // forment une PALISSADE. Depuis l'entrée comme depuis l'escalier, on ne voyait
  // plus l'atrium — on voyait à travers une claire-voie.
  //
  // Les reléguer au seul dernier niveau réglait la palissade et créait le défaut
  // inverse : vues d'en bas à quatorze mètres, elles se réduisaient à trois
  // éclats blancs. Elles ne gênaient plus rien et ne racontaient plus rien.
  //
  // Le défaut n'était donc ni le nombre ni l'étage, mais la HAUTEUR UNIQUE. La
  // même pièce fait deux choses selon ce qu'on lui donne :
  //
  //  - au dernier niveau, à pleine hauteur, elle COURONNE le vide et se lit en
  //    contre-jour sur le puits de lumière. Personne n'a l'œil à cette altitude,
  //    donc elle ne barre aucune vue ;
  //  - aux niveaux inférieurs, ramenée à 1,15 m, elle devient un GARDE-CORPS
  //    SCULPTÉ : sous la ligne de regard (1,62 m), donc elle n'obstrue rien, et
  //    visible depuis tout l'atrium, donc elle donne son rythme à chaque plateau.
  //
  // Un plan vérifie qu'on ne se cogne pas ; il ne vérifie pas qu'on voit. C'est
  // la vue `ligne-de-vue` de `capture.ts` qui garde cet invariant-là.
  const ouverts = museum.floors.filter((f) => f.level >= 0 && f.slabHoles.length > 0)
  const dernier = [...ouverts].sort((a, b) => b.level - a.level)[0]

  for (const floor of ouverts) {
    const couronne = floor.id === dernier?.id
    for (const trou of floor.slabHoles) {
      placements.push(
        ...nervuresDeTremie(floor.id, floor.elevation, trou, couronne ? 1 : ECHELLE_GARDE_CORPS),
      )
      placements.push(...consolesDeTremie(floor.id, floor.elevation, trou))
    }
  }

  placements.push(...lanterneZenithale(museum))
  placements.push(...suspensionsDAtrium(museum))
  placements.push(...mobilierDuHall(museum))
  placements.push(...mobilierDesSalles(museum))
  placements.push(...decorDuParvis(museum))

  return placements
}

// ── Les ancres, et pourquoi elles ne sont pas des coordonnées ─────────────
//
// Rien de ce qui suit n'écrit une position en dur. Le musée est GÉNÉRATIF : le
// nombre de salles, la taille du bâtiment et la position de l'entrée dépendent
// du compte de dépôts GitHub. Une coordonnée écrite à la main serait juste sur
// l'instance du jour et fausse à la suivante — un banc dans un mur, sans qu'un
// seul test bronche. Tout se dérive donc de `slabHoles`, de `footprint` et de
// `spawn`, qui sont les seules choses dont la donnée garantisse le sens.

/** Recul du mobilier par rapport à une paroi ou à un nez de dalle, en mètres. */
const RECUL_PAROI = 1.2

/**
 * Le semis générique : N points en abscisse curviligne sur le pourtour d'un
 * rectangle, tournés vers son centre (ou vers l'extérieur).
 *
 * C'est `pourtourDeTremie` généralisé. La raison d'être est la même et elle a
 * été payée : échantillonner les quatre côtés séparément fait tomber deux points
 * au même angle, et les pièces s'y traversent. Le parcours en abscisse
 * curviligne rend le pas rigoureusement constant, angles compris.
 */
function semisSurPourtour(
  rect: Rect,
  recul: number,
  combien: number,
  demiPas = true,
): { x: number; z: number }[] {
  const x0 = rect.x + recul
  const z0 = rect.z + recul
  const x1 = rect.x + rect.width - recul
  const z1 = rect.z + rect.depth - recul
  const largeur = Math.max(0, x1 - x0)
  const profondeur = Math.max(0, z1 - z0)
  const perimetre = 2 * (largeur + profondeur)
  if (perimetre <= 0 || combien <= 0) return []

  const cotes = [
    { x: x0, z: z0, dx: 1, dz: 0, longueur: largeur },
    { x: x1, z: z0, dx: 0, dz: 1, longueur: profondeur },
    { x: x1, z: z1, dx: -1, dz: 0, longueur: largeur },
    { x: x0, z: z1, dx: 0, dz: -1, longueur: profondeur },
  ]

  const points: { x: number; z: number }[] = []
  for (let i = 0; i < combien; i++) {
    let s = (((i + (demiPas ? 0.5 : 0)) / combien) * perimetre) % perimetre
    for (const c of cotes) {
      if (s <= c.longueur) {
        points.push({ x: c.x + c.dx * s, z: c.z + c.dz * s })
        break
      }
      s -= c.longueur
    }
  }
  return points
}

/** Lacet qui envoie le +X local d'une pièce vers un point. */
function versLePoint(x: number, z: number, cx: number, cz: number): number {
  return Math.atan2(-(cz - z), cx - x)
}

/**
 * Un poseur par REJET — le même parti que `props.ts`, et pour la même raison.
 *
 * ── Pourquoi pas des coordonnées choisies ──
 *
 * La première rédaction de `mobilierDuHall` posait chaque pièce à une cote
 * écrite à la main. Chacune était défendable seule, et l'ensemble ne tenait pas :
 * la banque mordait le mât de 3 cm, les bancs mordaient la banque de 79 cm, et
 * chaque correction en créait une autre ailleurs. Vingt pièces dans une pièce,
 * ça ne se règle pas au décimètre — il y a trop de couples.
 *
 * Le solveur inverse la charge de la preuve : on PROPOSE dans un ordre
 * d'importance, et une pièce n'est retenue que si elle est libre de tout ce qui
 * a déjà été accepté. Ce qui ne rentre pas est simplement abandonné — « on
 * préfère un hall un peu vide à un hall impraticable », mot pour mot la règle
 * de `props.ts`.
 *
 * Aucun aléa : l'ordre de proposition est fixe, donc la sortie l'est aussi.
 */
class Poseur {
  readonly retenus: DecorPlacement[] = []

  /**
   * Les zones interdites, en plus des pièces déjà posées.
   *
   * Champ explicite plutôt que propriété de paramètre : `erasableSyntaxOnly` est
   * actif dans ce dépôt, et la forme courte n'est pas effaçable par un simple
   * retrait des types.
   */
  private readonly interdits: readonly { x: number; z: number; rayon: number }[]

  constructor(interdits: readonly { x: number; z: number; rayon: number }[] = []) {
    this.interdits = interdits
  }

  /** Propose une pièce. Rend `true` si elle a été retenue. */
  essayer(p: DecorPlacement): boolean {
    const r = DECOR_METRICS[p.id].radius * Math.max(p.scale.x, p.scale.z)
    for (const zone of this.interdits) {
      if (Math.hypot(p.position.x - zone.x, p.position.z - zone.z) < r + zone.rayon) return false
    }
    for (const autre of this.retenus) {
      // Deux pièces qui ne partagent aucune tranche de hauteur ne peuvent pas se
      // heurter : une suspension à 4,30 m au-dessus d'un banc est un musée, pas
      // une collision.
      if (!memeTranche(p, autre)) continue
      const ra = DECOR_METRICS[autre.id].radius * Math.max(autre.scale.x, autre.scale.z)
      const d = Math.hypot(p.position.x - autre.position.x, p.position.z - autre.position.z)
      if (d < r + ra) return false
    }
    this.retenus.push(p)
    return true
  }
}

/** Les deux pièces partagent-elles une tranche de hauteur ? */
function memeTranche(a: DecorPlacement, b: DecorPlacement): boolean {
  const ma = DECOR_METRICS[a.id]
  const mb = DECOR_METRICS[b.id]
  const a0 = a.position.y + ma.minY * a.scale.y
  const a1 = a.position.y + ma.maxY * a.scale.y
  const b0 = b.position.y + mb.minY * b.scale.y
  const b1 = b.position.y + mb.maxY * b.scale.y
  return a0 < b1 - 0.01 && b0 < a1 - 0.01
}

function pose(
  id: DecorId,
  x: number,
  y: number,
  z: number,
  lacet: number,
  floorId: string | null,
  echelle = 1,
): DecorPlacement {
  return {
    id,
    position: { x, y, z },
    rotation: { x: 0, y: lacet, z: 0 },
    scale: { x: echelle, y: echelle, z: echelle },
    floorId,
  }
}

/**
 * Les consoles sous le nez de dalle de la trémie.
 *
 * Elles ne portent rien — la dalle tient toute seule — et c'est justement le
 * point : une dalle de béton qui s'arrête net au-dessus d'un vide de douze
 * mètres lit comme une découpe. Une file de corbeaux sous sa rive lui donne une
 * ÉPAISSEUR STRUCTURELLE, qui est ce que l'œil cherche pour croire à la portée.
 *
 * C'est la vue `atrium-nervures` qui les cadre : elle regarde vers le haut
 * depuis le rez-de-chaussée, donc exactement sous les rives.
 */
function consolesDeTremie(floorId: string, elevation: number, trou: Rect): DecorPlacement[] {
  const cx = trou.x + trou.width / 2
  const cz = trou.z + trou.depth / 2
  // Le pas suit celui des nervures — deux rythmes concurrents sur la même rive
  // feraient un battement, et un battement lit comme une erreur de pose.
  const combien = Math.max(4, Math.round((2 * (trou.width + trou.depth)) / PAS_NERVURE))
  return semisSurPourtour(
    { x: trou.x - 0.2, z: trou.z - 0.2, width: trou.width + 0.4, depth: trou.depth + 0.4 },
    0,
    combien,
    false,
  ).map((p) =>
    // Sous la dalle : l'ancrage `mur` pose la pièce par sa face arrière, on la
    // descend donc de sa propre hauteur pour qu'elle affleure la sous-face.
    pose('console', p.x, elevation - DECOR_METRICS.console.maxY, p.z, versLePoint(p.x, p.z, cx, cz), floorId),
  )
}

/**
 * La LANTERNE ZÉNITHALE : la couronne de côtes qui coiffe le puits de lumière.
 *
 * ── Pourquoi elle manquait, et ce qu'elle répare ──
 *
 * La toiture reprend exactement la découpe des dalles : l'atrium débouche donc
 * sur le ciel, ce qui donne la verrière zénithale sans modéliser de verrière.
 * C'est économe et c'est juste — mais vu de dessous, le puits s'arrête sur un
 * TROU. Il n'y a rien qui dise « voici où le bâtiment s'ouvre » : la lumière
 * arrive d'un vide rectangulaire, et le geste le plus fort de tout le plan n'a
 * aucun couronnement.
 *
 * Vingt-quatre côtes posées sur la rive de toiture, penchées vers l'intérieur,
 * font ce couronnement. Elles ne portent rien — la toiture tient toute seule —
 * et c'est très exactement le même parti que les consoles de trémie : ce qui
 * manque à un vide de douze mètres, ce n'est pas de la structure, c'est une
 * ÉPAISSEUR qui dise à l'œil où la matière s'arrête.
 *
 * ── Zéro géométrie neuve ──
 *
 * `nervure-lanterneau` était générée et inutilisée. La toiture percée sert de
 * ceinture, les côtes sont la lanterne : procédural pour ce qui est exact — la
 * rive, qui est déjà là — et Meshy pour ce qui est sculpté. C'est la règle qui a
 * déjà sorti le brise-soleil et le rail d'éclairage de la commande, appliquée
 * dans l'autre sens.
 *
 * ⛔ `floorId: null`, et ce n'est pas un détail. Le culling écarte un plateau
 * avec tout ce qui lui est attaché ; la lanterne appartient à la TOITURE, pas au
 * dernier étage, et l'attacher à celui-ci la ferait disparaître exactement quand
 * on la regarde — de l'extérieur, ou d'en bas depuis le rez-de-chaussée.
 */
function lanterneZenithale(museum: Museum): DecorPlacement[] {
  const haut = [...museum.floors].sort((a, b) => b.elevation - a.elevation)[0]
  const trou = haut?.slabHoles[0]
  if (!haut || !trou) return []

  const cx = trou.x + trou.width / 2
  const cz = trou.z + trou.depth / 2
  // Sur la RIVE de toiture : le sommet du dernier niveau, plus l'épaisseur de
  // couverture. La cote de toiture vit dans `FloorMesh` et le domaine ne peut
  // pas l'importer — on la reprend ici, et l'épreuve d'encadrement la garde.
  const y = haut.elevation + haut.ceilingHeight + EPAISSEUR_TOITURE

  // Le pas se dérive du rayon de la côte À SON ÉCHELLE : deux côtes voisines ne
  // doivent pas se traverser, et la corde qui coupe un angle est plus courte que
  // l'arc — d'où le facteur √2 déjà payé sur la trémie.
  const pas = 2 * DECOR_METRICS['nervure-lanterneau'].radius * ECHELLE_LANTERNE * Math.SQRT2
  const combien = Math.max(8, Math.floor((2 * (trou.width + trou.depth)) / pas))

  return semisSurPourtour(
    {
      x: trou.x - RECUL_LANTERNE,
      z: trou.z - RECUL_LANTERNE,
      width: trou.width + 2 * RECUL_LANTERNE,
      depth: trou.depth + 2 * RECUL_LANTERNE,
    },
    0,
    combien,
  ).map((p) => ({
    id: 'nervure-lanterneau' as DecorId,
    position: { x: p.x, y, z: p.z },
    /*
      ⚠️ Le BASCULEMENT vit dans `z`, et le lacet dans `y`. Ce n'est pas
      interchangeable, et ça se démontre.

      `assemblerLeDecor` compose l'Euler en ordre `XYZ`, donc la matrice vaut
      `Rx·Ry·Rz` : c'est Rz qui s'applique EN PREMIER, dans le repère de la
      pièce, puis le lacet fait pivoter le tout. Un basculement écrit dans `x`
      tomberait après le lacet et coucherait les côtes sur le côté — juste sur
      deux rives de l'oculus, faux sur les deux autres.

      Écrit dans `z`, le basculement penche la pièce vers son propre +X, et c'est
      ce +X que le lacet envoie vers le centre. Les vingt-quatre côtes penchent
      donc toutes vers l'oculus, quel que soit le côté où elles sont posées.

      Signe négatif : `Rz(θ)` envoie +Y vers −X pour θ positif. On veut l'inverse.
    */
    rotation: { x: 0, y: versLePoint(p.x, p.z, cx, cz), z: -BASCULE_LANTERNE },
    scale: { x: ECHELLE_LANTERNE, y: ECHELLE_LANTERNE, z: ECHELLE_LANTERNE },
    floorId: null,
  }))
}

/**
 * Épaisseur de la couverture, en mètres.
 *
 * ⚠️ Recopiée de `ROOF_THICKNESS` (`scene/FloorMesh.tsx`), et c'est délibéré :
 * le domaine ne peut pas importer la scène — c'est la règle de couches de ce
 * dépôt, et l'inverser pour une constante serait payer très cher un octet. Le
 * jour où la toiture change d'épaisseur, la lanterne s'enfoncera ou flottera de
 * l'écart ; l'épreuve d'encadrement de hauteur le dira.
 */
const EPAISSEUR_TOITURE = 0.3

/**
 * Recul de la côte par rapport à la rive de toiture, en mètres.
 *
 * Négatif serait au-dessus du vide, où rien ne la porte. 0,35 m la pose sur la
 * matière tout en la laissant pencher au-dessus de l'oculus : le porte-à-faux
 * EST le geste, comme sur les nervures d'atrium.
 */
const RECUL_LANTERNE = 0.55

/**
 * Échelle des côtes de lanterne.
 *
 * ⚠️ 1,9 et non 1, et le chiffre vient de la vue `lanterne`, pas d'un goût.
 *
 * À l'échelle du modèle — 2,60 m — les côtes existaient : le compteur les
 * comptait, le plan les plaçait, le budget les tenait. Et depuis le
 * rez-de-chaussée, quinze mètres plus bas et à travers un oculus de douze
 * mètres, on n'en voyait que les PIEDS : une frise de plots pâles sur la rive,
 * qui ne couronnait rien. Portées à 4,94 m, leur porte-à-faux entre dans le
 * cadre et la couronne se lit comme une couronne.
 *
 * L'échelle est gratuite : elle ne change pas un triangle. Ce qu'elle coûte est
 * le PAS — une côte 1,9 fois plus large tient 1,9 fois moins de place sur la
 * rive — et c'est pour ça qu'elle entre dans son calcul plutôt que d'être
 * appliquée après coup.
 */
const ECHELLE_LANTERNE = 1.9

/**
 * Basculement des côtes vers l'oculus, en radians.
 *
 * Sans lui, les côtes sont VERTICALES, et vues du rez-de-chaussée on les prend
 * par la tranche : elles rendent une frise de moignons pâles sur la rive, pas
 * une couronne. 26° les fait passer au-dessus du vide, où leur profil se
 * découpe sur le ciel — le seul endroit d'où une côte se lit comme une côte.
 *
 * C'est exactement l'argument du porte-à-faux des nervures d'atrium : ce qui
 * fait la pièce, ce n'est pas qu'elle soit là, c'est qu'elle penche.
 */
const BASCULE_LANTERNE = 0.45

/**
 * Ce qui pend dans le vide de l'atrium.
 *
 * ── La sculpture va au CŒUR DE L'HÉLICE, et c'est la donnée qui le dit ──
 *
 * L'escalier balaie un anneau autour de son centre : `ramp.radius` en donne le
 * rayon. Le disque intérieur, lui, n'est traversé par rien — c'est le seul
 * volume de tout le bâtiment qui soit à la fois central, haut de quatorze
 * mètres, et vide. Une sculpture suspendue de 1,71 m de rayon y tient avec de la
 * marge, et elle se voit depuis les quatre plateaux à la fois.
 *
 * On la suspend sous la TOITURE, pas sous le dernier plancher : c'est le seul
 * plan qui coiffe le vide entier.
 */
function suspensionsDAtrium(museum: Museum): DecorPlacement[] {
  const placements: DecorPlacement[] = []
  const haut = [...museum.floors].sort((a, b) => b.elevation - a.elevation)[0]
  if (!haut) return placements

  const rampe = museum.ramps[0]
  const cx = rampe?.centre.x ?? museum.atrium.x + museum.atrium.width / 2
  const cz = rampe?.centre.z ?? museum.atrium.z + museum.atrium.depth / 2

  // ⛔ Le garde-fou qui manquerait sans lui : si un jour l'hélice se resserre,
  // la sculpture entrerait dedans. On ne la pose que si le cœur est assez large,
  // et sinon on ne la pose PAS — une pièce absente est un manque, une pièce dans
  // l'escalier est un défaut.
  const coeur = (rampe?.radius ?? 0) - DECOR_METRICS['sculpture-atrium'].radius
  if (coeur > 0.6) {
    placements.push(
      pose('sculpture-atrium', cx, haut.elevation + haut.ceilingHeight, cz, 0, null),
    )
  }

  // Les suspensions éclairent le HALL, pas le vide : elles pendent sous le
  // premier plancher, au-dessus du parcours d'entrée.
  const rdc = museum.floors.find((f) => f.level === 0)
  if (rdc) {
    const trou = rdc.slabHoles[0]
    const bordSud = trou ? trou.z + trou.depth : cz + 6
    // ⚠️ Sous le PLAFOND du rez-de-chaussée, et non depuis le plancher de
    // l'étage au-dessus : entre les deux il y a l'épaisseur de dalle, et une
    // suspension accrochée là sortirait de la tranche de son propre niveau —
    // 4,70 m dans un volume qui s'arrête à 4,30.
    const plafond = rdc.elevation + rdc.ceilingHeight
    for (const dx of [-4.5, 0, 4.5]) {
      placements.push(pose('suspension-atrium', cx + dx, plafond, bordSud + 3.4, 0, rdc.id))
    }
  }

  return placements
}

/**
 * Le mobilier du hall du rez-de-chaussée.
 *
 * ── Tout se dérive de la trémie et du spawn ──
 *
 * Le hall n'existe pas comme objet dans la donnée : c'est ce qui reste du
 * plateau quand on a retiré la trémie et les salles. On s'appuie donc sur les
 * deux seules choses que la donnée garantisse — le bord de la trémie, et le
 * point de départ du visiteur, qui est par construction dans un endroit
 * praticable et regarde vers le bâtiment.
 *
 * L'accueil se pose SUR CE PARCOURS, décalé sur le côté : au milieu il barrerait
 * l'entrée, contre le mur il ne se verrait pas.
 */
function mobilierDuHall(museum: Museum): DecorPlacement[] {
  const rdc = museum.floors.find((f) => f.level === 0)
  const trou = rdc?.slabHoles[0]
  if (!rdc || !trou) return []

  const y = rdc.elevation
  const cx = trou.x + trou.width / 2
  const cz = trou.z + trou.depth / 2
  const sud = trou.z + trou.depth // le nez de dalle côté entrée
  const bord = rdc.footprint
  const limiteSud = bord.z + bord.depth - RECUL_PAROI
  const ouest = bord.x + RECUL_PAROI
  const est = bord.x + bord.width - RECUL_PAROI

  // ── Trois bandes, et c'est le POINT DE DÉPART qui les découpe ──
  //
  // Le visiteur naît à `spawn` et regarde le bâtiment. Ce qu'il doit voir sans
  // se retourner est donc DEVANT lui — entre son point de départ et la trémie.
  // La première rédaction posait tout sur la ligne médiane du hall, qui tombe à
  // 60 cm devant la caméra : le mobilier était là, hors champ, sous le nez du
  // visiteur. C'est la capture qui l'a montré, aucun compteur ne pouvait le dire.
  const depart = museum.spawn.floorId === rdc.id ? museum.spawn.position.z : (sud + limiteSud) / 2
  const devant = (sud + depart) / 2 // ce qu'on voit en entrant
  const derriere = (depart + limiteSud) / 2 // ce qu'on découvre en se retournant

  // La zone interdite : l'anneau de nervures qui borde la trémie.
  //
  // ⚠️ Au RAYON DE CE NIVEAU, et non au rayon plein. La même nervure est une
  // couronne de 4,30 m au dernier étage et un garde-corps de 1,15 m ici : réserver
  // le rayon plein sur le rez-de-chaussée sur-réservait 97 cm, et faisait refuser
  // les bancs courbes et les deux jardinières — trois pièces perdues pour une
  // borne dimensionnée sur un autre étage que celui qu'on meuble.
  const rayonNervure = DECOR_METRICS['nervure-atrium'].radius * ECHELLE_GARDE_CORPS
  const p = new Poseur([
    {
      x: cx,
      z: cz,
      rayon: Math.max(trou.width, trou.depth) / 2 + RECUL_NERVURE + rayonNervure,
    },
  ])

  // La banque fait face au visiteur qui entre, donc son +X regarde le sud.
  p.essayer(pose('banque-accueil', cx - 5.4, y, devant, Math.PI / 2, rdc.id))

  // Deux mâts encadrent la traversée. Leur couronne fait 5,70 m d'envergure :
  // posés au large, ils vont chercher la dalle au-dessus du parcours — c'est le
  // geste, un arbre qui porte le plancher.
  for (const x of [cx - 10, cx + 10]) p.essayer(pose('mat-arborescent', x, y, devant, 0, rdc.id))

  // Deux bancs courbes regardent la trémie : on s'y assoit pour voir le vide.
  for (const x of [cx - 4.6, cx + 4.6]) {
    const z = sud + 2.1
    p.essayer(pose('banc-courbe', x, y, z, versLePoint(x, z, cx, cz), rdc.id))
  }

  // Deux jardinières longues bordent le nez de trémie sans le fermer.
  for (const x of [cx - 1.9, cx + 1.9]) {
    p.essayer(pose('jardiniere-longue', x, y, sud + 1.6, 0, rdc.id))
  }

  // La borne d'information se pose EN FACE de la banque, de l'autre côté du
  // parcours, et au niveau du point de départ : c'est là qu'on la cherche.
  p.essayer(pose('borne-info', cx + 7, y, depart, -Math.PI / 2, rdc.id))

  // La file d'attente devant la banque, sur son axe.
  for (let i = 0; i < 4; i++) {
    p.essayer(pose('poteau-file', cx - 7.6 + i * 1.5, y, devant + 2.4, 0, rdc.id))
  }

  // ── Derrière le visiteur : ce qu'on découvre en se retournant ──
  for (const x of [cx - 3.4, cx + 3.4]) p.essayer(pose('totem', x, y, limiteSud - 0.4, 0, rdc.id))
  p.essayer(pose('portemanteau', ouest + 0.6, y, derriere - 0.4, 0, rdc.id))
  p.essayer(pose('corbeille', est - 0.6, y, derriere - 0.4, 0, rdc.id))
  p.essayer(pose('corbeille', ouest + 0.6, y, depart - 1, 0, rdc.id))

  // Les lampadaires tiennent les QUATRE angles du hall, là où le lèche-mur des
  // murs ne va pas et où la lumière zénithale n'arrive plus.
  for (const x of [ouest + 0.8, est - 0.8]) {
    for (const z of [sud + 0.8, limiteSud - 1.0]) p.essayer(pose('lampadaire', x, y, z, 0, rdc.id))
  }

  // Les jardinières rondes ponctuent le passage entre les mâts et la façade.
  for (const x of [cx - 8.6, cx + 8.6]) p.essayer(pose('jardiniere-ronde', x, y, derriere - 0.6, 0, rdc.id))

  return p.retenus
}

/**
 * Le mobilier de salle : ce qu'on trouve DANS une salle d'exposition.
 *
 * Semé sur le pourtour de l'emprise, en retrait des parois — la seule règle qui
 * tienne quel que soit le nombre de salles que le catalogue produira ce jour-là.
 * Le mobilier regarde vers le CENTRE de la salle, comme il le ferait dans un
 * vrai accrochage : un socle tourne le dos au mur, jamais à la salle.
 *
 * ⚠️ Une salle trop petite n'en reçoit AUCUN. C'est le même parti que
 * `props.ts` : « on préfère une salle un peu vide à une salle impraticable ».
 */
function mobilierDesSalles(museum: Museum): DecorPlacement[] {
  const p = new Poseur()
  // La séquence est cyclique : elle donne son rythme sans qu'aucune salle n'ait
  // à connaître son propre inventaire.
  const sequence: DecorId[] = ['socle-haut', 'pupitre-cartel', 'vitrine', 'socle-bas']

  // ⛔ Jamais la réserve. Elle est ENTERRÉE : personne n'y accroche, personne
  // n'y circule, et le §9 en fait délibérément une crypte de béton brut. Y poser
  // des vitrines et des pupitres serait meubler une cave, et c'est l'épreuve
  // « ne pose rien en réserve » qui l'a rappelé au premier passage.
  for (const floor of museum.floors.filter((f) => f.level >= 0)) {
    for (const salle of floor.rooms) {
      const f = salle.footprint
      const cx = f.x + f.width / 2
      const cz = f.z + f.depth / 2
      // Un point tous les 7 m environ de pourtour utile. Plus dense, la salle
      // devient un couloir de mobilier et l'accrochage n'est plus le sujet.
      const utile = 2 * (f.width + f.depth - 4 * RECUL_PAROI)
      const combien = Math.floor(utile / 7)
      if (combien < 2 || f.width < 5 || f.depth < 5) continue

      semisSurPourtour(f, RECUL_PAROI + 0.6, combien).forEach((pt, i) => {
        const id = sequence[i % sequence.length]
        // ⛔ Une salle peut border la trémie, et l'anneau de nervures déborde de
        // la trémie. Un pupitre posé sur le seul pourtour de la SALLE entrait
        // donc de 4 cm dans un garde-corps sculpté — deux modules qui placent
        // contre deux géométries différentes, exactement le défaut que le
        // partage `placeProps(museum, decor)` a déjà corrigé une fois ailleurs.
        if (dansLAnneauDeNervures(floor.slabHoles, pt, DECOR_METRICS[id].radius)) return
        p.essayer(pose(id, pt.x, floor.elevation, pt.z, versLePoint(pt.x, pt.z, cx, cz), floor.id))
      })
    }
  }
  return p.retenus
}

/**
 * Le point tombe-t-il dans la zone que l'anneau de nervures occupe déjà ?
 *
 * L'anneau vit à `RECUL_NERVURE` en dehors de la trémie et déborde de son propre
 * rayon. La zone interdite est donc la trémie DILATÉE de tout cela, plus le
 * rayon de la pièce qu'on veut poser. On mesure contre le rectangle dilaté et
 * non contre chaque nervure : c'est la même réponse, sans dépendre de l'ordre
 * dans lequel les nervures ont été calculées.
 */
function dansLAnneauDeNervures(
  trous: readonly Rect[],
  pt: { x: number; z: number },
  rayonPiece: number,
): boolean {
  // ⚠️ Le rayon PLEIN, pas celui du garde-corps : la même nervure sert de
  // couronne à l'échelle 1 au dernier niveau. Dimensionner la zone interdite sur
  // l'échelle réduite laissait un pupitre entrer de 4 cm dans une couronne — la
  // borne doit être celle du pire cas, pas celle du cas courant.
  const debord = RECUL_NERVURE + DECOR_METRICS['nervure-atrium'].radius + rayonPiece + 0.1
  return trous.some(
    (t) =>
      pt.x > t.x - debord &&
      pt.x < t.x + t.width + debord &&
      pt.z > t.z - debord &&
      pt.z < t.z + t.depth + debord,
  )
}

/**
 * Le parvis : ce qu'on voit AVANT d'entrer, et depuis la vue `exterieur`.
 *
 * ── Pourquoi le portique annonce l'atrium, et pas la porte ──
 *
 * Un portique qui redouble l'entrée ne dit rien qu'un auvent ne dirait. Posé sur
 * l'axe de la TRÉMIE, il annonce le puits de lumière : on franchit deux mâts
 * penchés, et on découvre à l'intérieur le vide qu'ils désignaient. C'est la
 * seule justification qu'un portique doive avoir.
 */
function decorDuParvis(museum: Museum): DecorPlacement[] {
  const rdc = museum.floors.find((f) => f.level === 0)
  const trou = rdc?.slabHoles[0]
  if (!rdc || !trou) return []

  const bord = rdc.footprint
  const cx = trou.x + trou.width / 2
  // Devant la façade d'entrée, sur le parvis : le sol du parc est à l'altitude
  // du rez-de-chaussée, `floorId` reste nul — ces pièces n'appartiennent à aucun
  // plateau et ne doivent pas disparaître avec lui au culling.
  const parvis = bord.z + bord.depth
  const y = rdc.elevation
  const p = new Poseur()

  // Les deux mâts du portique se font face de part et d'autre de l'axe.
  p.essayer(pose('portique', cx - 5.5, y, parvis + 7, 0, null))
  p.essayer(pose('portique', cx + 5.5, y, parvis + 7, Math.PI, null))

  // Le repère : au bout de l'axe, assez loin pour tenir dans le cadre de la vue
  // extérieure et assez près pour qu'on le contourne en arrivant.
  p.essayer(pose('sculpture-parvis', cx, y, parvis + 16, 0, null))
  p.essayer(pose('vasque', cx, y, parvis + 10.5, 0, null))

  // Bancs et bornes bordent l'allée, tournés vers elle.
  for (let i = 0; i < 4; i++) {
    const z = parvis + 4 + i * 4.2
    for (const s of [-1, 1]) {
      p.essayer(pose('banc-parc', cx + s * 9, y, z, s > 0 ? Math.PI : 0, null))
    }
  }
  for (let i = 0; i < 6; i++) {
    const z = parvis + 2.5 + i * 3.1
    for (const s of [-1, 1]) p.essayer(pose('borne-parc', cx + s * 6.2, y, z, 0, null))
  }

  return p.retenus
}

/**
 * Les nervures d'une trémie : un anneau de côtes qui penchent vers le vide.
 *
 * Chacune est tournée pour que son porte-à-faux regarde le CENTRE de la trémie.
 * Le modèle penche dans son axe local +X ; un lacet qui envoie ce +X vers le
 * centre suffit donc, et c'est pour ça que la pièce a été générée penchée plutôt
 * que droite — la faire pencher ici aurait demandé une rotation composée dont
 * l'emprise ne serait plus un cylindre.
 */
function nervuresDeTremie(
  floorId: string,
  elevation: number,
  trou: Rect,
  echelle: number,
): DecorPlacement[] {
  const cx = trou.x + trou.width / 2
  const cz = trou.z + trou.depth / 2
  const placements: DecorPlacement[] = []

  // Le pas suit l'échelle : une pièce trois fois plus petite peut se serrer
  // trois fois plus. Garder le pas de la couronne sur un garde-corps laisserait
  // quatre mètres entre deux plots, ce qui ne borde plus rien — et un pas fixe
  // sur une pièce à taille variable est précisément le genre de constante muette
  // que ce module vient de corriger ailleurs.
  const pas = Math.max(1.5, PAS_NERVURE * echelle)

  for (const point of pourtourDeTremie(trou, RECUL_NERVURE, pas)) {
    // Le lacet qui envoie le +X local vers le centre de la trémie. Un lacet θ
    // envoie +X sur (cos θ, 0, −sin θ), d'où l'atan2 croisé.
    const rotation = Math.atan2(-(cz - point.z), cx - point.x)
    placements.push({
      id: 'nervure-atrium',
      position: { x: point.x, y: elevation, z: point.z },
      rotation: { x: 0, y: rotation, z: 0 },
      scale: { x: echelle, y: echelle, z: echelle },
      floorId,
    })
  }
  return placements
}

/**
 * Points régulièrement espacés le long du POURTOUR d'un rectangle agrandi.
 *
 * ── Pourquoi un parcours du périmètre, et non quatre côtés indépendants ──
 *
 * La première version échantillonnait chaque côté séparément. Sur un carré c'est
 * tentant, et c'est faux : le dernier point du côté nord et le premier du côté
 * est tombent tous deux près du même angle, à quelques centimètres l'un de
 * l'autre. Sur seize nervures cela faisait **quatre paires qui se traversaient**,
 * une par coin — mesuré à 0,32 m de recouvrement par le plan coté.
 *
 * Le défaut ne se voyait pas en 3D : de l'intérieur de l'atrium, deux nervures
 * superposées lisent comme une nervure un peu épaisse. C'est le plan qui l'a
 * montré, et c'est exactement ce pour quoi `tools/plan.ts` existe.
 *
 * On parcourt donc le périmètre comme une seule ligne fermée, en abscisse
 * curviligne. Le pas devient rigoureusement constant, les angles compris, et la
 * colonnade a le rythme qu'on lui demande.
 */
function pourtourDeTremie(trou: Rect, recul: number, pas: number): { x: number; z: number }[] {
  const x0 = trou.x - recul
  const z0 = trou.z - recul
  const x1 = trou.x + trou.width + recul
  const z1 = trou.z + trou.depth + recul
  const largeur = x1 - x0
  const profondeur = z1 - z0

  // Les quatre côtés bout à bout, dans le sens horaire.
  const cotes: { x: number; z: number; dx: number; dz: number; longueur: number }[] = [
    { x: x0, z: z0, dx: 1, dz: 0, longueur: largeur },
    { x: x1, z: z0, dx: 0, dz: 1, longueur: profondeur },
    { x: x1, z: z1, dx: -1, dz: 0, longueur: largeur },
    { x: x0, z: z1, dx: 0, dz: -1, longueur: profondeur },
  ]
  const perimetre = 2 * (largeur + profondeur)
  const combien = Math.max(4, Math.round(perimetre / pas))

  const points: { x: number; z: number }[] = []
  for (let i = 0; i < combien; i++) {
    // Le demi-pas décale le semis pour qu'aucun point ne tombe PILE dans un
    // angle, où la nervure serait à cheval sur deux directions de porte-à-faux.
    let s = ((i + 0.5) / combien) * perimetre
    for (const c of cotes) {
      if (s <= c.longueur) {
        points.push({ x: c.x + c.dx * s, z: c.z + c.dz * s })
        break
      }
      s -= c.longueur
    }
  }
  return points
}
