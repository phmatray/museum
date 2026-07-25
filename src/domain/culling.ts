/**
 * LOT 3 — Le culling par étage (spec §9.3).
 *
 * Le §9 plafonne le bâtiment à 150 draw calls. Le bâtiment VIDE en consomme
 * déjà 82 ; les cent œuvres, leurs cadres et les cartels viennent par-dessus.
 * Le seul poste qu'on puisse encore rendre gratuit est celui qu'on ne dessine
 * pas : un visiteur du rez-de-chaussée ne voit ni les murs, ni les toiles, ni
 * les cartels du troisième étage — deux dalles de béton les séparent.
 *
 * Ce module répond à trois questions, et rien d'autre :
 *
 *   1. à quel NIVEAU se tient le joueur (avec hystérésis) ;
 *   2. le contenu d'un plateau donné vaut-il encore la peine d'être dessiné ;
 *   3. quelle BOÎTE tester contre le frustum pour sauter un plateau d'un bloc.
 *
 * Il est PUR — aucun `three`, aucun `react`, aucune horloge — parce que ces
 * trois décisions sont exactement le genre de chose qu'on ne peut pas juger sur
 * une capture d'écran : un plateau qui disparaît une image sur dix à la
 * frontière d'un étage est invisible en photo et insupportable en marchant.
 * Elles se testent donc ici, sans canvas.
 *
 * ── Pourquoi une hystérésis ──
 *
 * Le niveau courant se déduit de l'altitude de l'œil. Sans mémoire, un joueur
 * qui monte une rampe traverse la frontière d'un niveau plusieurs fois par
 * seconde — le pas du contrôleur cinématique et le bruit de la physique
 * suffisent — et TOUT le contenu de deux plateaux clignote au rythme de ses
 * oscillations. La règle retenue : on ne change de niveau qu'après avoir
 * DÉPASSÉ la frontière d'une marge franche. Le seuil de montée et le seuil de
 * descente sont alors distincts, ce qui rend le basculement impossible à faire
 * osciller.
 */
import type { Floor, Museum, Vec2 } from './types'

// ── Réglages ─────────────────────────────────────────────────────────────

/**
 * Écart de niveaux au-delà duquel un plateau ne montre plus que sa dalle.
 *
 * Deux, et pas un : depuis l'atrium, dont la trémie est ouverte sur toute la
 * hauteur, on voit franchement le plateau du dessus et celui du dessous. À un
 * seul niveau de marge, les salles d'en face se videraient sous les yeux du
 * visiteur accoudé au garde-corps. À trois, on ne gagnerait plus rien : le
 * bâtiment n'a que quatre niveaux.
 */
export const CONTENT_LEVEL_RANGE = 2

/**
 * Marge de franchissement du niveau courant, en mètres.
 *
 * Un niveau fait environ 5,1 m (4,7 m sous plafond plus 0,4 m de dalle) et
 * l'œil du visiteur est à 1,6 m de son plancher. Trois quarts de mètre sont
 * donc largement au-dessus du bruit de la physique (quelques millimètres
 * d'enfoncement dans la dalle, quelques centimètres de pas sur une rampe) et
 * très en dessous d'une hauteur d'étage : impossible de rater un changement de
 * niveau réel, impossible d'en fabriquer un faux.
 */
export const LEVEL_HYSTERESIS = 0.75

/**
 * Marge ajoutée autour d'un plateau pour son test de frustum, en mètres.
 *
 * Les cadres saillent de 5 cm hors du mur, les cartels de quelques
 * millimètres, et l'emprise de la dalle est calculée au segment près. Une marge
 * de dix centimètres évite qu'un plateau rasant le bord de l'écran soit sauté
 * alors qu'un de ses cadres y entre encore. Une boîte trop grande ne coûte rien
 * (on dessine un plateau de plus) ; une boîte trop petite fait clignoter le
 * bâtiment.
 */
export const FLOOR_BOX_MARGIN = 0.1

// ── Niveau courant ───────────────────────────────────────────────────────

/** Un plancher et son numéro de niveau. Tout ce dont le suivi a besoin. */
export interface Landing {
  level: number
  elevation: number
}

/** Les planchers du bâtiment, du plus bas au plus haut. */
export function landings(museum: Museum): Landing[] {
  return museum.floors
    .map((floor) => ({ level: floor.level, elevation: floor.elevation }))
    .sort((a, b) => a.elevation - b.elevation)
}

/**
 * Le niveau dont le plancher porte l'altitude `y`, sans mémoire.
 *
 * Le plus haut plancher situé sous le point. C'est la même règle que
 * `visitor.floorAt`, réécrite ici sur des paliers plutôt que sur des `Floor` :
 * le suivi tourne à chaque image et n'a besoin que de deux nombres par niveau.
 */
export function levelAt(paliers: readonly Landing[], y: number): number {
  let courant = paliers[0]?.level ?? 0
  for (const palier of paliers) {
    if (palier.elevation <= y) courant = palier.level
    else break
  }
  return courant
}

/**
 * Le niveau courant, avec hystérésis.
 *
 * `precedent` est le niveau retenu à l'image d'avant, ou `null` au premier
 * appel. Le changement n'est accepté que si l'œil a franchi la frontière d'au
 * moins `hysteresis` :
 *
 *  - en MONTANT, la frontière est le plancher du niveau visé : il faut avoir la
 *    tête franchement au-dessus de la dalle sur laquelle on arrive ;
 *  - en DESCENDANT, la frontière est le plancher du niveau qu'on quitte : il
 *    faut être franchement passé sous lui.
 *
 * Les deux seuils sont donc séparés de `2 × hysteresis`, et aucune oscillation
 * de la physique ne peut les traverser en boucle. Un saut de plusieurs niveaux
 * (téléportation de la visite guidée, `survol()` de la sonde de développement)
 * est accepté d'un coup : la marge est franchie de très loin.
 */
export function trackLevel(
  paliers: readonly Landing[],
  y: number,
  precedent: number | null,
  hysteresis: number = LEVEL_HYSTERESIS,
): number {
  const brut = levelAt(paliers, y)
  if (precedent === null || brut === precedent) return brut

  if (brut > precedent) {
    const arrivee = paliers.find((palier) => palier.level === brut)
    // Palier inconnu : la donnée a changé sous nos pieds, on suit le brut
    // plutôt que de rester bloqué sur un niveau qui n'existe plus.
    if (arrivee === undefined) return brut
    return y >= arrivee.elevation + hysteresis ? brut : precedent
  }

  const depart = paliers.find((palier) => palier.level === precedent)
  if (depart === undefined) return brut
  return y <= depart.elevation - hysteresis ? brut : precedent
}

/**
 * Le contenu de ce plateau mérite-t-il d'être dessiné ?
 *
 * « Contenu » = les murs des salles, les œuvres et les cartels. La dalle, le
 * garde-corps et la toiture restent TOUJOURS rendus : ils portent la silhouette
 * du bâtiment vu depuis l'atrium, et ce sont eux qui font exister le puits de
 * lumière. Les masquer se verrait immédiatement, et ne rendrait que trois draw
 * calls par étage.
 */
export function contentVisible(
  niveauJoueur: number,
  niveauPlateau: number,
  portee: number = CONTENT_LEVEL_RANGE,
): boolean {
  return Math.abs(niveauJoueur - niveauPlateau) <= portee
}

// ── Boîte englobante d'un plateau ────────────────────────────────────────

/**
 * Boîte alignée sur les axes, en coordonnées MONDE.
 *
 * Volontairement pas un `THREE.Box3` : ce module ne connaît pas `three`. La
 * couche de scène convertit en une ligne, une fois par plateau, au montage.
 */
export interface Box {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export interface FloorBoxOptions {
  /** Épaisseur de la dalle : elle PEND sous l'élévation du niveau. */
  slabThickness: number
  /** Épaisseur de la toiture, pour le dernier niveau seulement. */
  roofThickness?: number
  margin?: number
}

/**
 * Le volume occupé par un plateau, dalle et toiture comprises.
 *
 * En `y` : du dessous de la dalle au plafond — c'est-à-dire au plancher du
 * niveau suivant, qui appartient à CE plateau tant qu'aucune dalle ne le
 * couvre. Le dernier niveau monte jusqu'au dessus de sa toiture.
 *
 * En `x`/`z` : l'emprise de la dalle. Rien d'un niveau n'en sort — les murs
 * extérieurs sont posés sur son bord, les rampes sont un objet à part qui ne
 * passe pas par ce culling.
 */
export function floorBox(floor: Floor, options: FloorBoxOptions): Box {
  const { slabThickness, roofThickness = 0, margin = FLOOR_BOX_MARGIN } = options
  return expand(
    {
      minX: floor.footprint.x,
      minY: floor.elevation - slabThickness,
      minZ: floor.footprint.z,
      maxX: floor.footprint.x + floor.footprint.width,
      maxY: floor.elevation + floor.ceilingHeight + roofThickness,
      maxZ: floor.footprint.z + floor.footprint.depth,
    },
    margin,
  )
}

/**
 * Étend une boîte du volume que son OMBRE peut occuper.
 *
 * C'est la correction qui rend le saut d'un plateau entier honnête. Cacher un
 * objet à three ne le retire pas seulement de l'image : il disparaît AUSSI de
 * la passe d'ombre. Un plateau hors champ dont l'ombre, elle, tombe dans le
 * champ — c'est le cas courant ici, le soleil est zénithal et l'atrium est une
 * trémie ouverte sur toute la hauteur — verrait son ombre s'évanouir d'un coup
 * dès qu'il sort du cadre. On teste donc contre le volume balayé par l'ombre
 * jusqu'au sol du bâtiment, et non contre le seul volume de l'étage.
 *
 * `drift` est le déplacement horizontal de l'ombre par mètre de chute, soit
 * `position.xz / position.y` de la lumière directionnelle visant l'origine.
 */
export function shadowSweptBox(box: Box, baseY: number, drift: Vec2): Box {
  const chute = Math.max(0, box.maxY - baseY)
  // L'ombre part à l'OPPOSÉ de la position du soleil : une source en +x/+z
  // pousse les ombres vers -x/-z.
  const glissementX = -drift.x * chute
  const glissementZ = -drift.z * chute
  return {
    minX: box.minX + Math.min(0, glissementX),
    minY: Math.min(box.minY, baseY),
    minZ: box.minZ + Math.min(0, glissementZ),
    maxX: box.maxX + Math.max(0, glissementX),
    maxY: box.maxY,
    maxZ: box.maxZ + Math.max(0, glissementZ),
  }
}

function expand(box: Box, margin: number): Box {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    minZ: box.minZ - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
    maxZ: box.maxZ + margin,
  }
}
