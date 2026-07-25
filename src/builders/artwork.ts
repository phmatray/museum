/**
 * LOT 3 — De l'accrochage aux matrices d'instance (spec §7.4 et §9.1).
 *
 * `domain/hanging.ts` a déjà tout décidé : chaque `Placement` connaît son mur,
 * son `u` le long de ce mur, sa hauteur d'axe et sa taille. Ce module ne fait
 * qu'une chose — traduire ces nombres en `Matrix4` — et il la fait sans react,
 * sans `@react-three/fiber` et sans canvas, comme tout ce qui vit dans
 * `builders/`. C'est ce qui permet de vérifier sur les cent œuvres du musée réel
 * qu'aucune ne traverse un mur, dans un test qui ne dessine rien.
 *
 * ── Convention de repère ──
 *
 * Sortie en x/z monde, `y = 0` au plancher DU NIVEAU — la même que `buildWall`
 * et `buildSlab`. La scène n'a plus qu'à poser son groupe à `floor.elevation`.
 *
 * ── Là où ça se joue : la face du mur ──
 *
 * Le segment `[a, b]` d'un mur porte sa face EXTÉRIEURE ; le volume s'enfonce
 * ensuite de `WALL_THICKNESS` du côté de `normal`, c'est-à-dire vers l'intérieur
 * de la salle (voir `builders/wall.ts`). Accrocher une œuvre sur le segment la
 * noierait donc DANS la maçonnerie : invisible depuis la salle, et parfaitement
 * silencieux. Toutes les cotes de ce fichier sont mesurées depuis le segment et
 * partent d'au moins `WALL_THICKNESS`.
 *
 * Aucun aléa, aucune horloge : deux appels sur la même entrée produisent les
 * mêmes matrices, coefficient pour coefficient.
 */
import * as THREE from 'three'

import type { Floor, Placement, RepoKey, Wall } from '../domain/types'
import { WALL_THICKNESS } from './wall'

// ── Cotes de l'accrochage ────────────────────────────────────────────────

/** Largeur de la bordure visible autour de la toile, en mètres. */
export const FRAME_BORDER = 0.06

/** Épaisseur du cadre, c'est-à-dire sa saillie hors du mur, en mètres. */
export const FRAME_DEPTH = 0.05

/** Centre du cadre, mesuré depuis le segment du mur le long de sa normale. */
export const FRAME_OFFSET = WALL_THICKNESS + FRAME_DEPTH / 2

/**
 * Plan de la toile, mesuré depuis le segment du mur.
 *
 * On se pose devant le cadre, plus quatre millimètres : assez pour qu'aucune
 * erreur d'arrondi en float32 ne fasse clignoter la toile contre le fond du
 * cadre, assez peu pour ne pas se voir en rasant le mur du regard.
 */
export const CANVAS_OFFSET = WALL_THICKNESS + FRAME_DEPTH + 0.004

/** En deçà, un mur est dégénéré : son repère n'a plus de sens. */
const EPS = 1e-9

// ── Repère d'un mur ──────────────────────────────────────────────────────

export interface WallAxes {
  /** Extrémité `a` du mur, dans le repère du NIVEAU (y = 0 au plancher). */
  origin: THREE.Vector3
  /** Direction `a → b`, unitaire. C'est l'axe des `u`. */
  along: THREE.Vector3
  /** Normale intérieure, exactement unitaire et exactement perpendiculaire. */
  inward: THREE.Vector3
  length: number
}

/**
 * Repère orthonormé d'un mur, reconstruit depuis ses seules extrémités.
 *
 * Même parti pris que `builders/wall.ts`, et pour la même raison : `wall.normal`
 * est arrondie au micromètre par `layout.ts`, elle sert donc à choisir le CÔTÉ
 * et jamais d'axe. La perpendiculaire est recalculée depuis `a → b`, sans quoi
 * la toile serait très légèrement gauchie par rapport au mur qui la porte — un
 * défaut invisible de face, flagrant en rasant le mur du regard.
 *
 * Un mur dégénéré renvoie un repère arbitraire mais FINI : un `NaN` dans une
 * matrice d'instance rend la bounding sphere `NaN`, ce qui désactive
 * silencieusement le frustum culling et fait disparaître tout le lot.
 */
export function wallAxes(wall: Wall): WallAxes {
  const dx = wall.b.x - wall.a.x
  const dz = wall.b.z - wall.a.z
  const length = Math.hypot(dx, dz)
  const origin = new THREE.Vector3(wall.a.x, 0, wall.a.z)

  if (length < EPS) {
    return {
      origin,
      along: new THREE.Vector3(1, 0, 0),
      inward: new THREE.Vector3(0, 0, -1),
      length: 0,
    }
  }

  const along = new THREE.Vector3(dx / length, 0, dz / length)
  // Perpendiculaire canonique, celle que produit `layout.ts` : (dir.z, −dir.x).
  const inward = new THREE.Vector3(along.z, 0, -along.x)
  if (inward.x * wall.normal.x + inward.z * wall.normal.z < 0) inward.negate()

  return { origin, along, inward, length }
}

/**
 * Orientation d'une œuvre posée sur ce mur.
 *
 * Le quad de `PlaneGeometry` regarde son `+Z` local : on envoie donc `+Z` sur la
 * normale intérieure, et l'œuvre fait face à la salle. `+X` vaut `up × normale`
 * et NON la direction du mur : ce produit vectoriel garantit un repère DIRECT,
 * alors que prendre `a → b` donnerait un repère indirect une fois sur deux,
 * c'est-à-dire une image en MIROIR sur la moitié des murs du bâtiment. Un titre
 * en miroir, personne ne le voit sur une capture d'écran ; tout le monde le voit
 * dans le musée.
 */
function orientation(axes: WallAxes): THREE.Matrix4 {
  const up = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(up, axes.inward)
  return new THREE.Matrix4().makeBasis(right, up, axes.inward)
}

// ── Matrices d'instance ──────────────────────────────────────────────────

/**
 * Matrice d'instance de la TOILE, dans le repère du niveau.
 *
 * Échelle `(width, height, 1)` sur un quad unité : la géométrie est partagée par
 * les cent œuvres, seule la matrice change. C'est toute la raison pour laquelle
 * un étage entier tient en un draw call.
 */
export function canvasMatrix(wall: Wall, placement: Placement): THREE.Matrix4 {
  return placementMatrix(
    wall,
    placement,
    CANVAS_OFFSET,
    new THREE.Vector3(placement.width, placement.height, 1),
  )
}

/**
 * Matrice d'instance du CADRE, dans le repère du niveau.
 *
 * Le cadre est une boîte unité posée derrière la toile et débordant de
 * `FRAME_BORDER` sur ses quatre côtés. La bordure est AJOUTÉE (`w + 2b`) et non
 * multipliée : une mise à l'échelle ordinaire donnerait à une œuvre trois fois
 * plus large un cadre trois fois plus épais, alors qu'ici la marge visible vaut
 * exactement `b` pour toutes les œuvres. C'est ce qui permet de tenir les cent
 * cadres avec UNE géométrie et UN draw call par étage.
 */
export function frameMatrix(wall: Wall, placement: Placement): THREE.Matrix4 {
  return placementMatrix(
    wall,
    placement,
    FRAME_OFFSET,
    new THREE.Vector3(
      placement.width + 2 * FRAME_BORDER,
      placement.height + 2 * FRAME_BORDER,
      FRAME_DEPTH,
    ),
  )
}

function placementMatrix(
  wall: Wall,
  placement: Placement,
  offset: number,
  scale: THREE.Vector3,
): THREE.Matrix4 {
  const axes = wallAxes(wall)
  const position = axes.origin
    .clone()
    .addScaledVector(axes.along, placement.u)
    .addScaledVector(axes.inward, offset)
  position.y += placement.centerHeight

  // `makeBasis` puis `setPosition` puis `scale` compose T · R · S : l'échelle
  // s'applique dans le repère de l'œuvre, la translation reste celle du centre.
  return orientation(axes).setPosition(position).scale(scale)
}

// ── Relevé d'un niveau ───────────────────────────────────────────────────

export interface Hanging {
  /** Unique dans le niveau. Une même œuvre peut être accrochée deux fois. */
  id: string
  key: RepoKey
  atlas: number
  layer: number
  /** Matrices dans le repère du niveau. */
  canvas: THREE.Matrix4
  frame: THREE.Matrix4
  /** Centre de la toile en coordonnées MONDE, pour le seul test de distance. */
  centre: THREE.Vector3
}

/**
 * Toutes les œuvres d'un niveau, à plat et prêtes à instancier.
 *
 * L'ordre est celui du fichier — salles, puis murs, puis placements — donc
 * stable d'un chargement à l'autre : deux exécutions attribuent le même index
 * d'instance à la même œuvre, ce qui rend la scène reproductible et comparable
 * d'une capture à l'autre.
 */
export function collectHangings(floor: Floor): Hanging[] {
  const hangings: Hanging[] = []
  for (const room of floor.rooms) {
    for (const wall of room.walls) {
      for (const placement of wall.placements) {
        const canvas = canvasMatrix(wall, placement)
        const centre = new THREE.Vector3().setFromMatrixPosition(canvas)
        // Le seul endroit du fichier qui quitte le repère du niveau : le test
        // de distance du LOD proche se fait forcément dans le monde.
        centre.y += floor.elevation
        hangings.push({
          id: `${wall.id}#${placement.key}`,
          key: placement.key,
          atlas: placement.atlas,
          layer: placement.layer,
          canvas,
          frame: frameMatrix(wall, placement),
          centre,
        })
      }
    }
  }
  return hangings
}
