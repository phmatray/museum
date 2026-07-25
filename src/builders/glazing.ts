/**
 * Le VITRAGE des fenêtres.
 *
 * ── Pourquoi c'est nécessaire, et pas cosmétique ──
 *
 * Percer un mur ne fait pas une fenêtre, ça fait un TROU. Sans vitre, on voit le
 * parc au travers d'une découpe franche, sans reflet, sans épaisseur, et l'œil
 * lit un décor découpé au cutter plutôt qu'un bâtiment. Le reflet est ce qui
 * fait la fenêtre : c'est lui qui dit qu'il y a une surface là où on croit ne
 * rien voir.
 *
 * ── Un maillage par niveau, pas un par fenêtre ──
 *
 * Toutes les vitres d'un plateau sont fusionnées en une géométrie et partagent
 * un matériau : un draw call pour trente-trois fenêtres. Un `<mesh>` par jour en
 * aurait coûté trente-trois, sur un budget déjà dépassé.
 *
 * ── Ce qu'on ne fait PAS ──
 *
 * Pas de `transmission`, malgré son réalisme. Elle impose à three de rendre la
 * scène une seconde fois dans un tampon de transmission, à chaque image :
 * c'est une passe complète pour un effet que le reflet d'environnement approche
 * déjà à un coût nul. Le §9 ne tient pas le doublement du rendu.
 */
import * as THREE from 'three'

import type { Wall } from '../domain/types'
import { WALL_THICKNESS, wallLength, wallMatrix } from './wall'

/**
 * Retrait de la vitre par rapport au nu extérieur du mur.
 *
 * Une vitre posée au milieu de l'embrasure, et non affleurante : c'est là que se
 * pose une menuiserie réelle, et c'est aussi ce qui donne au tableau une
 * profondeur visible de part et d'autre. Affleurante, l'embrasure de 32 cm
 * qu'on a construite ne se lirait plus que d'un seul côté.
 */
const RETRAIT = WALL_THICKNESS / 2

/** Jeu périphérique : la vitre est portée par une feuillure, pas soudée au béton. */
const JEU = 0.02

export interface Vitrage {
  geometry: THREE.BufferGeometry
  /** Nombre de jours réellement vitrés. Zéro ⇒ ne rien monter. */
  count: number
}

/**
 * Construit les vitres de tous les jours d'une liste de murs.
 *
 * Les murs sont supposés être ceux d'UN niveau, exprimés dans le repère de ce
 * niveau (`y = 0` au plancher) — exactement ce que consomme déjà `buildWall`.
 */
export function buildGlazing(walls: readonly Wall[]): Vitrage {
  const morceaux: THREE.BufferGeometry[] = []

  for (const wall of walls) {
    const longueur = wallLength(wall)
    if (longueur < 1e-6) continue
    const matrice = wallMatrix(wall)

    for (const o of wall.openings) {
      // Seules les ouvertures qui FLOTTENT sont vitrées. Une porte est un
      // passage : y poser une vitre reviendrait à murer le bâtiment.
      const haut = Math.min(o.height, wall.height)
      const bas = Math.max(0, Math.min(o.sill ?? 0, haut))
      if (o.kind !== 'window' || bas <= 0 || haut - bas <= JEU * 2) continue

      const u0 = Math.max(0, Math.min(o.start, o.end)) + JEU
      const u1 = Math.min(longueur, Math.max(o.start, o.end)) - JEU
      if (u1 - u0 <= 0) continue

      const g = new THREE.PlaneGeometry(u1 - u0, haut - bas - 2 * JEU)
      // `PlaneGeometry` naît dans le plan XY, centrée. On la place dans le plan
      // du mur (u, v) et on la recule d'un demi-mur sur `w`.
      g.translate((u0 + u1) / 2, (bas + haut) / 2, RETRAIT)
      g.applyMatrix4(matrice)
      morceaux.push(g)
    }
  }

  return { geometry: fusionner(morceaux), count: morceaux.length }
}

/**
 * Matériau de vitrage.
 *
 * Le reflet vient de `scene.environment`, déjà monté pour le garde-corps de
 * l'atrium : la vitre ne coûte donc aucune lumière, aucune passe, aucune shadow
 * map. `roughness` très bas et `metalness` nul, c'est ce qui distingue un verre
 * d'un plastique dépoli.
 */
export function creerVitrage(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#dceaf2',
    // Assez opaque pour se voir, assez transparent pour qu'on regarde dehors —
    // ce qui est tout l'objet de la fenêtre.
    transparent: true,
    opacity: 0.16,
    roughness: 0.04,
    metalness: 0,
    // Une vitre se regarde des deux côtés, et depuis l'intérieur du bâtiment
    // c'est même le cas le plus fréquent.
    side: THREE.DoubleSide,
    // Le reflet est relevé : à l'intensité d'environnement du bâtiment (0,45),
    // une vitre à 1,0 ne réfléchit presque rien et redevient un trou.
    envMapIntensity: 2.4,
    // Sans quoi la vitre masquerait dans le tampon de profondeur ce qu'on est
    // censé voir au travers, et le parc disparaîtrait derrière un voile bleu.
    depthWrite: false,
  })
}

/** Concatène des `PlaneGeometry` : mêmes attributs, même ordre, toujours. */
function fusionner(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const noms = ['position', 'normal', 'uv'] as const
  const merged = new THREE.BufferGeometry()

  if (parts.length === 0) {
    for (const nom of noms) {
      merged.setAttribute(
        nom,
        new THREE.BufferAttribute(new Float32Array(0), nom === 'uv' ? 2 : 3),
      )
    }
    merged.setIndex(new THREE.BufferAttribute(new Uint32Array(0), 1))
    return merged
  }

  for (const nom of noms) {
    const itemSize = parts[0].getAttribute(nom).itemSize
    const total = parts.reduce((s, p) => s + p.getAttribute(nom).count, 0)
    const data = new Float32Array(total * itemSize)
    let offset = 0
    for (const p of parts) {
      const attr = p.getAttribute(nom)
      for (let i = 0; i < attr.count * itemSize; i++) data[offset++] = attr.array[i] as number
    }
    merged.setAttribute(nom, new THREE.BufferAttribute(data, itemSize))
  }

  const total = parts.reduce((s, p) => s + (p.getIndex()?.count ?? 0), 0)
  const indices = new Uint32Array(total)
  let curseur = 0
  let decalage = 0
  for (const p of parts) {
    const idx = p.getIndex()
    if (idx) for (let i = 0; i < idx.count; i++) indices[curseur++] = idx.getX(i) + decalage
    decalage += p.getAttribute('position').count
    p.dispose()
  }
  merged.setIndex(new THREE.BufferAttribute(indices, 1))
  return merged
}
