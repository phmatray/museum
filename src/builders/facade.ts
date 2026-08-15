/**
 * LOT 9 — Le BRISE-SOLEIL : le peigne de lames qui fait la façade.
 *
 * ── Pourquoi la façade avait besoin de ça et de rien d'autre ──
 *
 * Vue de l'extérieur, le musée était une boîte de béton percée de meurtrières.
 * Le défaut n'était pas la matière ni la lumière — c'était qu'une façade de
 * trente mètres n'avait AUCUNE échelle intermédiaire : on passait du bâtiment
 * entier au trou de fenêtre, sans rien entre les deux. L'œil n'a alors aucun
 * moyen d'estimer la taille de ce qu'il regarde.
 *
 * Un peigne de lames verticales donne exactement cette échelle manquante, et
 * c'est le geste le plus reconnaissable de Calatrava après la nervure : une
 * répétition dense d'éléments minces, blancs, qui rayent la masse et la font
 * lire comme une structure plutôt que comme un mur.
 *
 * ── Le pas dérive du rythme des JOURS, il ne le concurrence pas ──
 *
 * `PAS_LAME` est un DIVISEUR de l'entraxe des fenêtres, et pas une valeur
 * choisie pour elle-même. C'est ce qui évite un BATTEMENT : deux rythmes proches
 * mais non commensurables sur trente mètres de façade produisent une figure de
 * moiré que l'œil lit immédiatement comme une erreur, alors que deux lames par
 * travée se lisent comme une intention.
 *
 * ── Ce que les lames font à la lumière, et pourquoi c'est le seul endroit ──
 *
 * Elles PORTENT l'ombre, et c'est le seul endroit du bâtiment où la carte
 * d'ombre a la résolution pour ça. La caméra du soleil est orthographique de
 * demi-côté ~23 m sur 2048 pixels, soit **22,8 mm par texel**. Ce qui décide
 * n'est pas la taille de l'occulteur mais sa PORTÉE :
 *
 *   côte de lanterne   0,10 m de large, 14 m jusqu'au sol   → barre dure qui nage
 *   lame de façade     0,08 m de large, 0,10 m jusqu'au mur → flou de 2 cm, net
 *
 * Les rayures d'ombre sur une façade claire sont l'image Calatrava par
 * excellence, et elles ne coûtent ici aucune qualité parce que le récepteur est
 * à dix centimètres de l'occulteur.
 *
 * Ce fichier est pur : il ne connaît ni React ni la scène, il transforme des
 * `Wall` en `BufferGeometry` et se teste sans canvas.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { Wall } from '../domain/types'
import { WALL_THICKNESS } from './wall'

/**
 * Entraxe des lames, en mètres.
 *
 * La MOITIÉ de `WINDOW_PITCH` (4,20 m), soit deux lames par travée de fenêtre.
 *
 * Le quart avait été essayé d'abord, et c'était trop : à 1,05 m, le peigne
 * cessait de filtrer pour MASQUER. On ne lisait plus ni le béton, ni les jours,
 * ni la masse du bâtiment — juste une palissade continue sur trois niveaux, ce
 * qui est le même défaut que les nervures d'atrium avaient produit à l'intérieur.
 *
 * Un brise-soleil doit laisser voir ce qu'il protège. À 2,10 m il donne son
 * rythme à la façade et laisse le mur exister entre deux lames, tout en restant
 * commensurable avec l'entraxe des fenêtres — la condition qui évite le
 * battement.
 */
export const PAS_LAME = 2.1

/** Épaisseur de la lame, dans le sens du mur. */
export const LAME_EPAISSEUR = 0.08

/**
 * Jeu entre le parement du mur et le bord intérieur de la lame.
 *
 * Il fait l'ombre. Collée au mur, une lame ne projette rien et devient une
 * nervure plate ; à dix centimètres, elle décolle et le soleil passe derrière.
 */
export const LAME_JEU = 0.1

/**
 * Profondeur de la lame — aux extrémités, puis à mi-hauteur.
 *
 * La variation est l'os, encore : une lame de section constante est un tasseau.
 * Le ventre à mi-hauteur lui donne la même logique que la nervure d'atrium, et
 * c'est ce qui fait que les deux appartiennent au même bâtiment.
 *
 * Ramenées de 0,26 / 0,44 à 0,16 / 0,30 en même temps que le pas : une lame
 * profonde vue de biais présente sa TRANCHE, et à quarante-quatre centimètres
 * elle bouchait à elle seule ce que l'espacement venait de rouvrir.
 */
export const LAME_PROFONDEUR_BOUT = 0.16
export const LAME_PROFONDEUR_VENTRE = 0.30

/** Nombre de stations verticales du balayage. 4 suffit pour lire le galbe. */
const STATIONS = 4

/**
 * Retrait en pied et en tête, en mètres.
 *
 * La lame ne touche ni le sol ni la dalle du dessus : elle est SUSPENDUE devant
 * la façade. C'est ce qui la fait lire comme un élément rapporté — une lame qui
 * bute des deux côtés se lit comme un renfort de mur.
 */
const RETRAIT = 0.35

/**
 * Les murs qui reçoivent des lames.
 *
 * `enclosure` ferme le pourtour là où aucune salle ne le fait ; les murs de
 * salle `outer` sont sur le pourtour eux aussi. Les deux ensemble décrivent la
 * façade, et c'est déjà ce que fait `buildGlazing` pour les vitres — on ramasse
 * la même liste, pour que jours et lames soient d'accord.
 */
export function mursDeFacade(enclosure: readonly Wall[], mursDeSalle: readonly Wall[]): Wall[] {
  return [...enclosure, ...mursDeSalle.filter((w) => w.kind === 'outer')]
}

/**
 * Le peigne d'un niveau, en UNE géométrie.
 *
 * Les coordonnées sont celles des murs — monde en XZ, LOCALES en Y, l'origine
 * étant le plancher du niveau. C'est la convention de `buildWall`, et elle
 * permet de monter le peigne dans le même groupe décalé que l'enveloppe.
 *
 * Rend `null` quand il n'y a pas de façade : un niveau enterré n'en a pas, et
 * un maillage vide coûterait un draw call pour rien.
 */
export function buildBriseSoleil(murs: readonly Wall[], hauteur: number): THREE.BufferGeometry | null {
  const bas = RETRAIT
  const haut = hauteur - RETRAIT
  if (haut - bas < 0.5) return null

  const lames: THREE.BufferGeometry[] = []

  for (const mur of murs) {
    const dx = mur.b.x - mur.a.x
    const dz = mur.b.z - mur.a.z
    const longueur = Math.hypot(dx, dz)
    if (longueur < PAS_LAME) continue

    const ux = dx / longueur
    const uz = dz / longueur
    // La normale du mur pointe vers l'INTÉRIEUR de la salle : la façade est donc
    // du côté opposé. S'en remettre au signe plutôt qu'au sens de parcours est
    // ce qui rend le calcul indépendant de la façon dont le mur a été écrit.
    const ox = -mur.normal.x
    const oz = -mur.normal.z

    // Le semis est CENTRÉ sur le mur : partir de son extrémité laisserait un
    // reste bâtard à l'autre bout, et c'est ce reste que l'œil accroche.
    const combien = Math.floor(longueur / PAS_LAME)
    if (combien === 0) continue
    const marge = (longueur - (combien - 1) * PAS_LAME) / 2

    for (let i = 0; i < combien; i++) {
      const s = marge + i * PAS_LAME
      if (devantUnPassage(mur, s)) continue
      lames.push(uneLame(mur.a.x + ux * s, mur.a.z + uz * s, ux, uz, ox, oz, bas, haut))
    }
  }

  if (lames.length === 0) return null
  const geometry = lames.length === 1 ? lames[0] : mergeGeometries(lames, false)
  for (const l of lames) if (l !== geometry) l.dispose()
  if (geometry === null) return null
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Vrai si une lame posée à l'abscisse `s` barrerait un passage.
 *
 * Une lame devant une fenêtre est le principe même du brise-soleil. Une lame
 * devant une PORTE est un obstacle, et sur la façade d'entrée ce serait un
 * obstacle en travers du seul chemin qui compte. On ne teste donc que les
 * ouvertures qui descendent au sol.
 */
function devantUnPassage(mur: Wall, s: number): boolean {
  return mur.openings.some(
    (o) => o.sill <= 0.01 && s > o.start - LAME_EPAISSEUR && s < o.end + LAME_EPAISSEUR,
  )
}

/**
 * Une lame : un prisme vertical à section variable, balayé sur `STATIONS`.
 *
 * Quatre sommets par station, quatre faces latérales entre deux stations, plus
 * les deux bouchons. Le galbe vient de la profondeur, qui suit un sinus — nul
 * aux extrémités, plein au ventre.
 */
function uneLame(
  x: number,
  z: number,
  ux: number,
  uz: number,
  ox: number,
  oz: number,
  bas: number,
  haut: number,
): THREE.BufferGeometry {
  const demi = LAME_EPAISSEUR / 2
  const positions: number[] = []

  for (let k = 0; k < STATIONS; k++) {
    const t = k / (STATIONS - 1)
    const y = bas + (haut - bas) * t
    const profondeur =
      LAME_PROFONDEUR_BOUT + (LAME_PROFONDEUR_VENTRE - LAME_PROFONDEUR_BOUT) * Math.sin(Math.PI * t)
    const dedans = WALL_THICKNESS / 2 + LAME_JEU
    const dehors = dedans + profondeur

    // Quatre coins, dans l'ordre : intérieur-gauche, intérieur-droit,
    // extérieur-droit, extérieur-gauche. L'ordre est ce qui rend l'enroulement
    // des faces prévisible plus bas.
    for (const [r, c] of [
      [dedans, -demi],
      [dedans, demi],
      [dehors, demi],
      [dehors, -demi],
    ] as [number, number][]) {
      positions.push(x + ox * r + ux * c, y, z + oz * r + uz * c)
    }
  }

  const indices: number[] = []
  for (let k = 0; k < STATIONS - 1; k++) {
    const a = k * 4
    const b = (k + 1) * 4
    for (let f = 0; f < 4; f++) {
      const g = (f + 1) % 4
      indices.push(a + f, b + f, b + g, a + f, b + g, a + g)
    }
  }
  // Bouchons haut et bas. Sans eux la lame est un tube ouvert, et son bout se
  // voit noir en contre-plongée.
  const dernier = (STATIONS - 1) * 4
  indices.push(0, 2, 1, 0, 3, 2)
  indices.push(dernier, dernier + 1, dernier + 2, dernier, dernier + 2, dernier + 3)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}
