/**
 * LOT SCULPTURES — le socle a les cotes demandées, et il est solide.
 *
 * Les deux épreuves visent les deux pièges d'`ExtrudeGeometry` documentés au §8
 * du spec parent, qui échouent tous deux EN SILENCE : le biseau, que seule une
 * bounding box 3D détecte, et l'absence d'index, qui vide le collider.
 */
import { describe, expect, it } from 'vitest'

import { buildPlinth } from '../plinth'

describe('buildPlinth', () => {
  it('a exactement les cotes demandées — le biseau est le piège', () => {
    const { geometry } = buildPlinth(1.1, 1.1, 0.25)
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    expect(b.max.x - b.min.x).toBeCloseTo(1.1, 6)
    expect(b.max.z - b.min.z).toBeCloseTo(1.1, 6)
    // 0,25 et non 0,65 : sans `bevelEnabled: false`, le chanfrein s'ajoute sur
    // les deux faces et l'épaisseur demandée sort au plus du double.
    expect(b.max.y - b.min.y).toBeCloseTo(0.25, 6)
  })

  it('pose sa base en y = 0 et son dessus à la hauteur demandée', () => {
    const { geometry } = buildPlinth(1.1, 1.1, 0.25)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 6)
    expect(geometry.boundingBox!.max.y).toBeCloseTo(0.25, 6)
  })

  it('est centré sur son origine en plan', () => {
    const { geometry } = buildPlinth(1.1, 0.8, 0.25)
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(0, 6)
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0, 6)
  })

  it('rend une géométrie INDEXÉE — sans quoi le collider est vide', () => {
    const { geometry } = buildPlinth(1.1, 1.1, 0.25)
    expect(geometry.getIndex()).not.toBeNull()
  })

  it('rend un collider non vide, en Uint32Array', () => {
    const { collider } = buildPlinth(1.1, 1.1, 0.25)
    expect(collider.indices).toBeInstanceOf(Uint32Array)
    expect(collider.indices.length).toBeGreaterThan(0)
    expect(collider.vertices.length).toBeGreaterThan(0)
    expect(collider.indices.length % 3).toBe(0)
    // Les huit coins d'une boîte, une fois soudés.
    expect(collider.vertices.length / 3).toBe(8)
  })

  it('refuse une cote non positive plutôt que de rendre un socle dégénéré', () => {
    expect(() => buildPlinth(0, 1.1, 0.25)).toThrow(RangeError)
    expect(() => buildPlinth(1.1, 1.1, 0)).toThrow(RangeError)
    expect(() => buildPlinth(1.1, -1, 0.25)).toThrow(RangeError)
  })

  it('est déterministe, sommet pour sommet', () => {
    const a = buildPlinth(1.1, 1.1, 0.25).geometry.getAttribute('position').array
    const b = buildPlinth(1.1, 1.1, 0.25).geometry.getAttribute('position').array
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('distingue ses trois axes — une permutation ne doit pas passer', () => {
    /*
      TROIS cotes distinctes, vérifiées SÉPARÉMENT par axe.

      `buildPlinth(width, depth, height)` appelle `new THREE.BoxGeometry(width,
      height, depth)` : trois axes, deux conventions d'ordre différentes, et
      rien dans le nom des paramètres ne signale l'inversion. Avec un socle
      carré, permuter la largeur et la profondeur laisse passer TOUS les autres
      tests — mesuré. Le centrage ne suffit pas non plus : il est symétrique
      quelle que soit la cote assignée à chaque axe.
    */
    const { geometry } = buildPlinth(1.4, 0.8, 0.25)
    geometry.computeBoundingBox()
    const b = geometry.boundingBox!
    expect(b.max.x - b.min.x).toBeCloseTo(1.4, 6) // largeur → X
    expect(b.max.z - b.min.z).toBeCloseTo(0.8, 6) // profondeur → Z
    expect(b.max.y - b.min.y).toBeCloseTo(0.25, 6) // hauteur → Y
  })
})
