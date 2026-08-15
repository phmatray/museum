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

export type DecorId = 'nervure-atrium'

/** Ordre canonique, contractuel comme `PROP_IDS`. */
export const DECOR_IDS: readonly DecorId[] = ['nervure-atrium']

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
export const DECOR_METRICS: Record<DecorId, DecorMetrics> = {
  'nervure-atrium': { radius: 1.317, minY: 0, maxY: 4.31, collision: null },
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
    }
  }
  return placements
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
