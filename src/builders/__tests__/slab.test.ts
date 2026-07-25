/**
 * Tests des dalles et des garde-corps (spec §8).
 *
 * Le fil conducteur : une dalle est correcte si le joueur ne la traverse pas et
 * ne marche pas au-dessus du vide. Trois familles de preuves :
 *
 *  - la MATIÈRE, mesurée sur la géométrie et jamais sur les paramètres : l'aire
 *    de la face supérieure doit valoir l'emprise moins les trémies ;
 *  - la BOUNDING BOX, seule chose qui attrape le chanfrein d'`ExtrudeGeometry`
 *    (une dalle demandée en 20×20×0,4 en sortirait en 20,2×20,2×0,8) ;
 *  - la COUVERTURE du collider, échantillonnée point par point : un triangle
 *    au-dessus du vide de l'atrium serait un plancher fantôme, et son absence
 *    au-dessus du plein serait un trou par où tomber.
 *
 * Le dernier bloc rejoue tout ça sur `public/data/museum.json`, le vrai musée
 * dérivé des 115 dépôts : c'est la seule preuve qui vaille.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  RAILING_HEIGHT,
  SLAB_GROUP_SHELL,
  SLAB_GROUP_TOP,
  buildRailing,
  buildSlab,
} from '../slab'
import type { RailingSegment, TrimeshCollider } from '../slab'
import type { Museum, Rect } from '../../domain/types'

// ── Outils de mesure ─────────────────────────────────────────────────────

/** Les positions sont stockées en float32 : 0,4 y vaut 0,40000000596. */
const F32 = 1e-4

interface Triangle {
  a: THREE.Vector3
  b: THREE.Vector3
  c: THREE.Vector3
}

/** Triangles d'un collider, tels que Rapier les lira. */
function colliderTriangles(collider: TrimeshCollider): Triangle[] {
  const at = (i: number) =>
    new THREE.Vector3(
      collider.vertices[i * 3],
      collider.vertices[i * 3 + 1],
      collider.vertices[i * 3 + 2],
    )
  const out: Triangle[] = []
  for (let i = 0; i < collider.indices.length; i += 3) {
    out.push({
      a: at(collider.indices[i]),
      b: at(collider.indices[i + 1]),
      c: at(collider.indices[i + 2]),
    })
  }
  return out
}

function geometryTriangles(geometry: THREE.BufferGeometry): Triangle[] {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  if (!index) throw new Error('géométrie non indexée')
  const out: Triangle[] = []
  for (let i = 0; i < index.count; i += 3) {
    out.push({
      a: new THREE.Vector3().fromBufferAttribute(position, index.getX(i)),
      b: new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1)),
      c: new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2)),
    })
  }
  return out
}

/**
 * Aire de la face supérieure, calculée DEPUIS LA GÉOMÉTRIE : on ne retient que
 * les triangles dont les trois sommets sont à y = 0, ce qui exclut d'office les
 * faces latérales (chacune a des sommets aux deux altitudes) et la sous-face.
 */
function topFaceArea(geometry: THREE.BufferGeometry): number {
  let area = 0
  for (const { a, b, c } of geometryTriangles(geometry)) {
    if (Math.abs(a.y) > F32 || Math.abs(b.y) > F32 || Math.abs(c.y) > F32) continue
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2
  }
  return area
}

/**
 * Vrai si un triangle recouvre le point, vu de dessus, arêtes comprises.
 *
 * Deux précautions. D'abord les faces latérales, verticales, se projettent en
 * segments : on les écarte par leur aire projetée nulle, sinon un mur compterait
 * comme un plancher. Ensuite l'inclusion est LARGE, parce qu'un point
 * d'échantillonnage tombe volontiers pile sur une diagonale de triangulation —
 * la face supérieure d'une boîte est coupée en deux par son centre exact, et une
 * inclusion stricte y déclarerait le garde-corps absent.
 */
function coversFromAbove(t: Triangle, x: number, z: number): boolean {
  const eps = 1e-9
  const area2 = (t.b.x - t.a.x) * (t.c.z - t.a.z) - (t.c.x - t.a.x) * (t.b.z - t.a.z)
  if (Math.abs(area2) < eps) return false

  const side = (px: number, pz: number, qx: number, qz: number) =>
    (qx - px) * (z - pz) - (qz - pz) * (x - px)
  const d1 = side(t.a.x, t.a.z, t.b.x, t.b.z)
  const d2 = side(t.b.x, t.b.z, t.c.x, t.c.z)
  const d3 = side(t.c.x, t.c.z, t.a.x, t.a.z)
  return (
    (d1 >= -eps && d2 >= -eps && d3 >= -eps) ||
    (d1 <= eps && d2 <= eps && d3 <= eps)
  )
}

function isCovered(triangles: Triangle[], x: number, z: number): boolean {
  return triangles.some((t) => coversFromAbove(t, x, z))
}

/** Grille de points strictement intérieurs à un rectangle. */
function samplesInside(rect: Rect, steps = 7): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      out.push({
        x: rect.x + (rect.width * i) / steps,
        z: rect.z + (rect.depth * j) / steps,
      })
    }
  }
  return out
}

function totalLength(segments: RailingSegment[]): number {
  return segments.reduce(
    (sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z),
    0,
  )
}

function size(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox()
  return geometry.boundingBox!.getSize(new THREE.Vector3())
}

const rect = (x: number, z: number, width: number, depth: number): Rect => ({
  x,
  z,
  width,
  depth,
})

/**
 * Aire des triangles d'un groupe de matériau, projetée sur le plan horizontal.
 * Une face verticale y compte pour zéro : c'est ce qui distingue le dessus et le
 * dessous (aire pleine) de la tranche (aire nulle).
 */
function groupHorizontalArea(
  geometry: THREE.BufferGeometry,
  groupIndex: number,
): number {
  const group = geometry.groups.find((g) => g.materialIndex === groupIndex)
  if (!group) return 0
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()!
  let area = 0
  for (let i = group.start; i < group.start + group.count; i += 3) {
    const p = [0, 1, 2].map((k) => {
      const id = index.getX(i + k)
      return new THREE.Vector2(position.getX(id), position.getZ(id))
    })
    area += Math.abs(
      (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (p[1].y - p[0].y),
    ) / 2
  }
  return area
}

// ── Groupes de matériau ──────────────────────────────────────────────────

/**
 * Le dessus d'une dalle est le sol d'un niveau, son dessous est le plafond du
 * niveau d'en dessous. Un seul matériau pour les deux donnait un plafond en
 * lames de parquet dans la vue d'accueil et un bandeau de bois en façade.
 */
describe('buildSlab — groupes de matériau', () => {
  it('sépare le dessus de la coque en deux groupes, et deux seulement', () => {
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    const indices = geometry.groups.map((g) => g.materialIndex).sort()
    expect(indices).toEqual([SLAB_GROUP_TOP, SLAB_GROUP_SHELL])
  })

  it('les groupes pavent l’index sans trou ni recouvrement', () => {
    // Un groupe est une plage contiguë : s'ils ne se touchent pas exactement,
    // des triangles ne sont rendus par AUCUN matériau et disparaissent.
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    const groups = [...geometry.groups].sort((a, b) => a.start - b.start)
    expect(groups[0].start).toBe(0)
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i].start).toBe(groups[i - 1].start + groups[i - 1].count)
    }
    const last = groups[groups.length - 1]
    expect(last.start + last.count).toBe(geometry.getIndex()!.count)
  })

  it('le groupe du dessus ne porte QUE la face supérieure', () => {
    // 364 m² d'emprise utile. La face du dessus seule les couvre une fois ; si
    // le dessous s'y était glissé, on en compterait 728.
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    expect(groupHorizontalArea(geometry, SLAB_GROUP_TOP)).toBeCloseTo(364, 3)
  })

  it('le groupe de la coque porte le dessous, donc la même aire projetée', () => {
    // La tranche est verticale : son aire projetée est nulle. Ce qui reste dans
    // ce groupe à l'horizontale est exactement la sous-face.
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    expect(groupHorizontalArea(geometry, SLAB_GROUP_SHELL)).toBeCloseTo(364, 3)
  })

  it('le réordonnancement de l’index ne perd aucun triangle', () => {
    // Séparer les groupes impose de réordonner l'index. Le collider lit
    // l'ensemble des triangles : en perdre un ouvrirait un trou dans le sol.
    const { geometry, collider } = buildSlab(
      rect(-10, -10, 20, 20),
      [rect(-3, -3, 6, 6)],
      0.4,
    )
    expect(collider.indices.length).toBe(geometry.getIndex()!.count)
    expect(collider.indices.length % 3).toBe(0)
  })
})

// ── Aire ─────────────────────────────────────────────────────────────────

describe('buildSlab — matière', () => {
  it('une trémie 6×6 dans une dalle 20×20 laisse 364 m²', () => {
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    expect(topFaceArea(geometry)).toBeCloseTo(364, 3)
  })

  it('une dalle sans trou garde toute son aire', () => {
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [], 0.4)
    expect(topFaceArea(geometry)).toBeCloseTo(400, 3)
  })

  it('deux trous se soustraient tous les deux', () => {
    const { geometry } = buildSlab(
      rect(0, 0, 20, 20),
      [rect(2, 2, 3, 3), rect(12, 12, 4, 4)],
      0.4,
    )
    expect(topFaceArea(geometry)).toBeCloseTo(400 - 9 - 16, 3)
  })

  it('un trou touchant le bord se soustrait comme un autre', () => {
    // La trémie mord l'arête ouest : le contour du trou et celui de l'emprise
    // sont confondus sur 6 m. Le cas dégénère la triangulation sans la casser.
    const { geometry } = buildSlab(rect(0, 0, 20, 20), [rect(0, 5, 6, 6)], 0.4)
    expect(topFaceArea(geometry)).toBeCloseTo(364, 3)
  })

  it('ignore les trous dégénérés plutôt que de les refuser', () => {
    const { geometry, railingSegments } = buildSlab(
      rect(0, 0, 20, 20),
      [rect(5, 5, 0, 4), rect(8, 8, 2, 2)],
      0.4,
    )
    expect(topFaceArea(geometry)).toBeCloseTo(396, 3)
    expect(railingSegments).toHaveLength(4)
  })

  it('refuse une épaisseur nulle ou négative', () => {
    expect(() => buildSlab(rect(0, 0, 20, 20), [], 0)).toThrow(RangeError)
    expect(() => buildSlab(rect(0, 0, 20, 20), [], -0.4)).toThrow(RangeError)
  })
})

// ── Bounding box : le test qui attrape le chanfrein ──────────────────────

describe('buildSlab — bounding box', () => {
  it('une dalle 20×20×0,4 mesure 20×20×0,4, et pas 20,2×20,2×0,8', () => {
    // `bevelEnabled` vaut true par défaut : sans `false` explicite, on obtient
    // 20,2 m d'emprise (bevelSize 0,1 sur chaque bord) et 0,8 m d'épaisseur
    // (bevelThickness 0,2 sur chaque face). Aucun calcul d'aire ne le voit.
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    const s = size(geometry)
    expect(s.x).toBeCloseTo(20, 4)
    expect(s.y).toBeCloseTo(0.4, 4)
    expect(s.z).toBeCloseTo(20, 4)
  })

  it('est posée face supérieure en y = 0, épaisseur pendant sous le niveau', () => {
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [], 0.4)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.max.y).toBeCloseTo(0, 4)
    expect(box.min.y).toBeCloseTo(-0.4, 4)
  })

  it('ne construit pas la dalle en miroir : un trou décentré reste du bon côté', () => {
    // Le passage du monde (x, z) au plan de la Shape inverse un axe. Une erreur
    // de signe donnerait une dalle correcte en aire mais avec le trou symétrique.
    const { geometry } = buildSlab(rect(0, 0, 20, 20), [rect(1, 1, 4, 4)], 0.4)
    const triangles = geometryTriangles(geometry)
    expect(isCovered(triangles, 3, 3)).toBe(false) // dans le trou
    expect(isCovered(triangles, 17, 17)).toBe(true) // dans le coin opposé
    expect(isCovered(triangles, 3, 17)).toBe(true)
    expect(isCovered(triangles, 17, 3)).toBe(true)
  })
})

// ── Indexation : sans elle, le joueur traverse le sol ────────────────────

describe('buildSlab — collider', () => {
  it('la géométrie est indexée, contrairement à la sortie brute d’ExtrudeGeometry', () => {
    const { geometry } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    expect(geometry.getIndex()).not.toBeNull()
    expect(geometry.getIndex()!.count % 3).toBe(0)
  })

  it('le collider expose des Uint32Array non vides', () => {
    const { collider } = buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    expect(collider.indices).toBeInstanceOf(Uint32Array)
    expect(collider.vertices).toBeInstanceOf(Float32Array)
    expect(collider.indices.length).toBeGreaterThan(0)
    expect(collider.indices.length % 3).toBe(0)
    expect(collider.vertices.length % 3).toBe(0)
  })

  it('la soudure conserve les triangles et ne pointe que sur des sommets réels', () => {
    const { geometry, collider } = buildSlab(
      rect(-10, -10, 20, 20),
      [rect(-3, -3, 6, 6)],
      0.4,
    )
    // Même nombre de faces qu'au rendu : souder les positions ne supprime rien.
    expect(collider.indices.length).toBe(geometry.getIndex()!.count)
    // ... mais moins de sommets, sinon la soudure n'aurait servi à rien.
    const vertexCount = collider.vertices.length / 3
    expect(vertexCount).toBeLessThan(geometry.getAttribute('position').count)
    for (const i of collider.indices) {
      expect(i).toBeLessThan(vertexCount)
    }
  })

  it('aucun triangle du collider ne couvre le vide de la trémie', () => {
    const hole = rect(-3, -3, 6, 6)
    const { collider } = buildSlab(rect(-10, -10, 20, 20), [hole], 0.4)
    const triangles = colliderTriangles(collider)

    for (const p of samplesInside(hole)) {
      expect(isCovered(triangles, p.x, p.z)).toBe(false)
    }
    // Contrôle en miroir : sans lui, le test passerait aussi avec un collider vide.
    for (const p of [
      { x: -8, z: -8 },
      { x: 8, z: 8 },
      { x: 0, z: -6 },
      { x: -6, z: 0 },
    ]) {
      expect(isCovered(triangles, p.x, p.z)).toBe(true)
    }
  })

  it('deux trous restent deux vides', () => {
    const holes = [rect(2, 2, 3, 3), rect(12, 12, 4, 4)]
    const { collider } = buildSlab(rect(0, 0, 20, 20), holes, 0.4)
    const triangles = colliderTriangles(collider)
    for (const hole of holes) {
      for (const p of samplesInside(hole)) {
        expect(isCovered(triangles, p.x, p.z)).toBe(false)
      }
    }
    expect(isCovered(triangles, 10, 10)).toBe(true)
  })

  it('un trou touchant le bord reste un vide', () => {
    const hole = rect(0, 5, 6, 6)
    const { collider } = buildSlab(rect(0, 0, 20, 20), [hole], 0.4)
    const triangles = colliderTriangles(collider)
    for (const p of samplesInside(hole)) {
      expect(isCovered(triangles, p.x, p.z)).toBe(false)
    }
    expect(isCovered(triangles, 10, 8)).toBe(true)
  })

  it('est déterministe : deux appels donnent le même maillage', () => {
    const build = () => buildSlab(rect(-10, -10, 20, 20), [rect(-3, -3, 6, 6)], 0.4)
    const a = build()
    const b = build()
    expect(Array.from(a.collider.vertices)).toEqual(Array.from(b.collider.vertices))
    expect(Array.from(a.collider.indices)).toEqual(Array.from(b.collider.indices))
  })
})

// ── Garde-corps ──────────────────────────────────────────────────────────

describe('buildSlab — périmètre des trémies', () => {
  it('une trémie 6×6 donne 24 m de garde-corps', () => {
    const { railingSegments } = buildSlab(
      rect(-10, -10, 20, 20),
      [rect(-3, -3, 6, 6)],
      0.4,
    )
    expect(railingSegments).toHaveLength(4)
    expect(totalLength(railingSegments)).toBeCloseTo(24, 6)
  })

  it('le contour est fermé : aucun coin ouvert par où tomber', () => {
    const { railingSegments } = buildSlab(rect(0, 0, 20, 20), [rect(4, 4, 6, 8)], 0.4)
    for (let i = 0; i < railingSegments.length; i++) {
      const current = railingSegments[i]
      const next = railingSegments[(i + 1) % railingSegments.length]
      expect(current.b).toEqual(next.a)
    }
  })

  it('une dalle sans trou n’a pas de garde-corps', () => {
    expect(buildSlab(rect(0, 0, 20, 20), [], 0.4).railingSegments).toEqual([])
  })
})

describe('buildRailing', () => {
  const hole = rect(-3, -3, 6, 6)
  const perimeter = buildSlab(rect(-10, -10, 20, 20), [hole], 0.4).railingSegments

  it('mesure exactement la hauteur demandée, main courante comprise', () => {
    const { geometry } = buildRailing(perimeter, RAILING_HEIGHT)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.y).toBeCloseTo(0, 4)
    expect(box.max.y).toBeCloseTo(RAILING_HEIGHT, 4)
  })

  it('épouse le périmètre de la trémie sans déborder', () => {
    const { geometry } = buildRailing(perimeter, RAILING_HEIGHT)
    const s = size(geometry)
    // 6 m de côté, plus la demi-section de la main courante de chaque bord.
    expect(s.x).toBeCloseTo(6.08, 4)
    expect(s.z).toBeCloseTo(6.08, 4)
  })

  it('a un collider : sans lui, le garde-corps est décoratif et le joueur tombe', () => {
    const { geometry, collider } = buildRailing(perimeter, RAILING_HEIGHT)
    expect(geometry.getIndex()).not.toBeNull()
    expect(collider.indices).toBeInstanceOf(Uint32Array)
    expect(collider.indices.length).toBeGreaterThan(0)
    expect(collider.indices.length).toBe(geometry.getIndex()!.count)
    const vertexCount = collider.vertices.length / 3
    for (const i of collider.indices) expect(i).toBeLessThan(vertexCount)
  })

  it('barre bien chaque segment : le collider couvre la ligne du garde-corps', () => {
    const triangles = colliderTriangles(buildRailing(perimeter, RAILING_HEIGHT).collider)
    for (const segment of perimeter) {
      const mx = (segment.a.x + segment.b.x) / 2
      const mz = (segment.a.z + segment.b.z) / 2
      expect(isCovered(triangles, mx, mz)).toBe(true)
    }
  })

  it('produit un maillage unique, pas un garde-corps par segment', () => {
    const one = buildRailing([perimeter[0]], RAILING_HEIGHT)
    const four = buildRailing(perimeter, RAILING_HEIGHT)
    expect(four.geometry.getIndex()!.count).toBe(one.geometry.getIndex()!.count * 4)
  })

  it('accepte une liste vide sans produire de géométrie invalide', () => {
    const { geometry, collider } = buildRailing([], RAILING_HEIGHT)
    expect(geometry.getIndex()).not.toBeNull()
    expect(geometry.getIndex()!.count).toBe(0)
    expect(collider.indices.length).toBe(0)
  })

  it('ignore les segments de longueur nulle', () => {
    const degenerate: RailingSegment = { a: { x: 1, z: 1 }, b: { x: 1, z: 1 } }
    const withNoise = buildRailing([...perimeter, degenerate], RAILING_HEIGHT)
    const clean = buildRailing(perimeter, RAILING_HEIGHT)
    expect(withNoise.geometry.getIndex()!.count).toBe(clean.geometry.getIndex()!.count)
  })

  it('refuse une hauteur qui ne laisse pas la place à la main courante', () => {
    expect(() => buildRailing(perimeter, 0.05)).toThrow(RangeError)
  })
})

// ── Le vrai musée ────────────────────────────────────────────────────────

describe('sur le musée réel (public/data/museum.json)', () => {
  const museum = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/data/museum.json'), 'utf8'),
  ) as Museum
  const thickness = museum.config.building.slabThickness

  /**
   * On lit les cotes DANS le fichier au lieu de les figer ici : le musée est
   * redérivé des dépôts réels, son emprise et son atrium bougent à chaque
   * exécution du pipeline. Ce qui doit rester vrai, ce sont les invariants —
   * plusieurs niveaux, un atrium non dégénéré, et un atrium qui tient dans
   * l'emprise de chaque niveau, sans quoi la trémie déborderait du bâtiment.
   */
  it('a une forme exploitable : plusieurs niveaux, un atrium inscrit dans l’emprise', () => {
    expect(museum.floors.length).toBeGreaterThanOrEqual(2)
    expect(museum.atrium.width).toBeGreaterThan(0)
    expect(museum.atrium.depth).toBeGreaterThan(0)

    for (const floor of museum.floors) {
      expect(museum.atrium.x).toBeGreaterThanOrEqual(floor.footprint.x)
      expect(museum.atrium.z).toBeGreaterThanOrEqual(floor.footprint.z)
      expect(museum.atrium.x + museum.atrium.width).toBeLessThanOrEqual(
        floor.footprint.x + floor.footprint.width,
      )
      expect(museum.atrium.z + museum.atrium.depth).toBeLessThanOrEqual(
        floor.footprint.z + floor.footprint.depth,
      )
    }
  })

  it.each(museum.floors.map((floor) => [floor.id, floor] as const))(
    'niveau %s : dalle pleine, trémies vides, garde-corps posé',
    (_id, floor) => {
      const { geometry, collider, railingSegments } = buildSlab(
        floor.footprint,
        floor.slabHoles,
        thickness,
      )

      // Emprise et épaisseur exactes : aucun chanfrein parasite.
      const s = size(geometry)
      expect(s.x).toBeCloseTo(floor.footprint.width, 4)
      expect(s.z).toBeCloseTo(floor.footprint.depth, 4)
      expect(s.y).toBeCloseTo(thickness, 4)

      // Aire mesurée sur la géométrie = emprise − trémies.
      const holesArea = floor.slabHoles.reduce((sum, h) => sum + h.width * h.depth, 0)
      expect(topFaceArea(geometry)).toBeCloseTo(
        floor.footprint.width * floor.footprint.depth - holesArea,
        2,
      )

      // Le plancher existe pour Rapier.
      expect(collider.indices.length).toBeGreaterThan(0)

      const triangles = colliderTriangles(collider)
      for (const hole of floor.slabHoles) {
        for (const p of samplesInside(hole)) {
          expect(isCovered(triangles, p.x, p.z)).toBe(false)
        }
      }
      // Un point de l'anneau des salles, à mi-chemin entre le coin de l'atrium
      // et le coin du bâtiment : plein quoi qu'il arrive aux cotes du musée.
      const ringX = (museum.atrium.x + museum.atrium.width + floor.footprint.x + floor.footprint.width) / 2
      const ringZ = (museum.atrium.z + museum.atrium.depth + floor.footprint.z + floor.footprint.depth) / 2
      expect(isCovered(triangles, ringX, ringZ)).toBe(true)

      // 4 segments par trémie, et un garde-corps qui tient debout.
      expect(railingSegments).toHaveLength(floor.slabHoles.length * 4)
      if (railingSegments.length > 0) {
        const railing = buildRailing(railingSegments, RAILING_HEIGHT)
        expect(railing.collider.indices.length).toBeGreaterThan(0)
      }
    },
  )

  it('chaque niveau porte exactement le périmètre de ses trémies en garde-corps', () => {
    // L'atrium est traversant : tout niveau qui le surplombe doit être ceinturé
    // sur son périmètre entier, sans quoi le joueur tombe par le côté manquant.
    // La réserve, en bas, est pleine : aucune trémie, donc aucun garde-corps.
    const perimeterOf = (r: Rect) => 2 * (r.width + r.depth)

    for (const floor of museum.floors) {
      const { railingSegments } = buildSlab(floor.footprint, floor.slabHoles, thickness)
      const expected = floor.slabHoles.reduce((sum, hole) => sum + perimeterOf(hole), 0)
      expect(totalLength(railingSegments)).toBeCloseTo(expected, 6)
    }

    // Et l'invariant qui compte vraiment : la réserve est pleine, les niveaux
    // au-dessus sont percés de l'atrium.
    const [reserve, ...above] = [...museum.floors].sort((a, b) => a.level - b.level)
    expect(reserve.slabHoles).toHaveLength(0)
    for (const floor of above) {
      expect(floor.slabHoles).toContainEqual(museum.atrium)
    }
  })
})
