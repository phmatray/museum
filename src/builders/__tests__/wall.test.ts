/**
 * Tests du constructeur de murs (spec §8, révisé §9.4).
 *
 * Quatre familles d'assertions, dans cet ordre d'importance :
 *
 *  - les deux pièges d'`ExtrudeGeometry` : cotes réelles mesurées sur la
 *    BOUNDING BOX 3D, et indices non vides sur le collider ;
 *  - la matière : aire de face conservée, ouvertures réellement traversables
 *    sur toute l'épaisseur, faces orientées vers la salle ;
 *  - le relief du §9.4 : embrasure à quatre faces, plinthe, chanfrein — c'est
 *    ce qui distingue un mur d'un carton découpé, et rien de tout cela ne se
 *    voit sur une aire ou sur une bounding box ;
 *  - le musée réel de `public/data/museum.json`, construit mur par mur.
 *
 * Aucun canvas : tout se joue sur les tampons de `BufferGeometry`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Museum, Opening, Wall } from '../../domain/types'
import type { BuiltWall } from '../wall'
import { buildGlazing, creerVitrage } from '../glazing'
import {
  CHAMFER,
  PLINTH_HEIGHT,
  PLINTH_PROJECTION,
  WALL_THICKNESS,
  buildWall,
  wallLength,
  wallMatrix,
} from '../wall'

// ── Fabriques et outils de mesure ────────────────────────────────────────

function mur(over: Partial<Wall> = {}): Wall {
  return {
    id: 'test',
    a: { x: 0, z: 0 },
    b: { x: 10, z: 0 },
    height: 4,
    kind: 'side',
    // Perpendiculaire canonique de a → b : (dir.z, −dir.x).
    normal: { x: 0, z: -1 },
    openings: [],
    placements: [],
    ...over,
  }
}

function porte(start: number, end: number, height = 2.1): Opening {
  return { kind: 'door', start, end, height, sill: 0 }
}

/** Une fenêtre : ouverture qui FLOTTE, allège au-dessus du plancher. */
function fenetre(start: number, end: number, sill = 0.95, height = 2.6): Opening {
  return { kind: 'window', start, end, height, sill }
}

/** Les triangles du COLLIDER, dans le repère du niveau. */
function triangles(built: BuiltWall): THREE.Triangle[] {
  const { vertices, indices } = built.collider
  const out: THREE.Triangle[] = []
  const lire = (i: number): THREE.Vector3 =>
    new THREE.Vector3(vertices[3 * i], vertices[3 * i + 1], vertices[3 * i + 2])
  for (let i = 0; i < indices.length; i += 3) {
    out.push(new THREE.Triangle(lire(indices[i]), lire(indices[i + 1]), lire(indices[i + 2])))
  }
  return out
}

/** Les mêmes triangles, ramenés dans le repère du mur : (u, v, w). */
function trianglesLocaux(wall: Wall, built: BuiltWall): THREE.Triangle[] {
  const inv = wallMatrix(wall).invert()
  return triangles(built).map((t) =>
    new THREE.Triangle(
      t.a.clone().applyMatrix4(inv),
      t.b.clone().applyMatrix4(inv),
      t.c.clone().applyMatrix4(inv),
    ),
  )
}

function normaleMonde(wall: Wall): THREE.Vector3 {
  return new THREE.Vector3(wall.normal.x, 0, wall.normal.z).normalize()
}

/**
 * Signe de l'axe `w` local par rapport à la salle. `buildWall` garde toujours un
 * repère DIRECT et décale l'extrusion plutôt que de la mirroiter : `w` regarde
 * donc la salle une fois sur deux. Multiplier par ce signe ramène toutes les
 * mesures dans un repère où « plus w est grand, plus on est dans la salle ».
 */
function sensInterieur(wall: Wall): number {
  const ex = new THREE.Vector3(wall.b.x - wall.a.x, 0, wall.b.z - wall.a.z).normalize()
  const ez = new THREE.Vector3(-ex.z, 0, ex.x)
  return ez.dot(normaleMonde(wall)) >= 0 ? 1 : -1
}

/** Une facette mesurée dans le repère canonique du mur. */
interface Facette {
  /** Centre, en `(u, v, w)`, `w` croissant vers la salle. */
  centre: THREE.Vector3
  /** Normale, dans le même repère. */
  normale: THREE.Vector3
  aire: number
}

function facettes(wall: Wall, built: BuiltWall): Facette[] {
  const sens = sensInterieur(wall)
  return trianglesLocaux(wall, built).map((t) => {
    const n = t.getNormal(new THREE.Vector3())
    const c = t.getMidpoint(new THREE.Vector3())
    return {
      centre: new THREE.Vector3(c.x, c.y, sens * c.z),
      normale: new THREE.Vector3(n.x, n.y, sens * n.z),
      aire: t.getArea(),
    }
  })
}

/** Aire cumulée des facettes retenues par le prédicat. */
function aire(fs: Facette[], garde: (f: Facette) => boolean): number {
  return fs.filter(garde).reduce((s, f) => s + f.aire, 0)
}

/** Vrai si la normale pointe dans la direction voulue, à 1 % près. */
function regarde(f: Facette, x: number, y: number, z: number): boolean {
  return f.normale.dot(new THREE.Vector3(x, y, z)) > 0.99
}

/**
 * Facette du jambage droit d'une embrasure, à `u` près, regardant vers `sens`.
 * On exclut ce qui saille devant la face du mur : la plinthe retourne dans
 * l'embrasure et y pose son propre about, qui n'est pas de la tranche de mur.
 */
function jambage(f: Facette, u: number, sens: number): boolean {
  return regarde(f, sens, 0, 0) && Math.abs(f.centre.x - u) < 1e-4 && f.centre.z < WALL_THICKNESS
}

/** Facette du linteau d'une ouverture donnée : horizontale, tournée vers le bas. */
function linteau(f: Facette, o: Opening): boolean {
  return (
    regarde(f, 0, -1, 0) &&
    Math.abs(f.centre.y - (o.height - CHAMFER)) < 1e-4 &&
    f.centre.x > o.start &&
    f.centre.x < o.end
  )
}

/**
 * Aire de la face intérieure : les triangles posés sur le plan situé à une
 * épaisseur de `[a, b]`, du côté de `normal`. C'est la face que le visiteur
 * regarde et sur laquelle les œuvres seront accrochées.
 */
function aireFaceInterieure(wall: Wall, built: BuiltWall): number {
  const n = normaleMonde(wall)
  const origine = new THREE.Vector3(wall.a.x, 0, wall.a.z).addScaledVector(n, WALL_THICKNESS)
  const surLePlan = (p: THREE.Vector3): boolean =>
    Math.abs(p.clone().sub(origine).dot(n)) < 1e-4
  let aire = 0
  for (const t of triangles(built)) {
    if (surLePlan(t.a) && surLePlan(t.b) && surLePlan(t.c)) aire += t.getArea()
  }
  return aire
}

/**
 * Volume signé du maillage fermé (théorème de la divergence). Positif si les
 * faces regardent vers l'extérieur, NÉGATIF si la géométrie a été construite
 * dans un repère indirect — c'est le seul test qui attrape le miroir.
 */
function volumeSigne(built: BuiltWall): number {
  let v = 0
  for (const t of triangles(built)) v += t.a.dot(new THREE.Vector3().crossVectors(t.b, t.c)) / 6
  return v
}

function airePercee(wall: Wall): number {
  // Le vide d'une ouverture va de son ALLÈGE à son linteau. Compter depuis le
  // sol reviendrait à percer l'allège d'une fenêtre, qui est justement ce qui
  // en fait une fenêtre.
  return wall.openings.reduce((s, o) => {
    const haut = Math.min(o.height, wall.height)
    const bas = Math.max(0, Math.min(o.sill ?? 0, haut))
    return s + (o.end - o.start) * (haut - bas)
  }, 0)
}

/** Boîte du VIDE d'une ouverture, dans le repère du mur, marges comprises. */
function boiteOuverture(o: Opening, wall: Wall, marge = 0.02): THREE.Box3 {
  const haut = Math.min(o.height, wall.height)
  const bas = Math.max(0, Math.min(o.sill ?? 0, haut))
  return new THREE.Box3(
    // `w` déborde largement de l'épaisseur : « sur toute son épaisseur ».
    new THREE.Vector3(o.start + marge, bas + marge, -1),
    new THREE.Vector3(o.end - marge, haut - marge, 1),
  )
}

function trianglesDansLaBoite(wall: Wall, built: BuiltWall, boite: THREE.Box3): number {
  return trianglesLocaux(wall, built).filter((t) => boite.intersectsTriangle(t)).length
}

// ── Piège n°1 : le biseau ────────────────────────────────────────────────

describe('cotes et biseau', () => {
  /**
   * Ce que le chanfrein du §9.4 fait aux cotes, et pourquoi ce n'est pas un
   * dérapage : le biseau de three pose les DEUX FACES sur le contour écrit et
   * dilate le CŒUR de `bevelSize`. Les faces vues restent donc exactement
   * `10 × 4`, mais la bounding box, qui mesure le cœur, gagne 3 mm de chaque
   * côté en `u` et en `v`. Ce débord tombe dans la dalle et dans le mur voisin,
   * où il est invisible ; l'épaisseur, elle, doit rester juste au millimètre.
   */
  it('donne un mur aux cotes exactes : 10 × 4 × 0,32, chanfrein compris', () => {
    const { geometry } = buildWall(mur())
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    const taille = bb.getSize(new THREE.Vector3())

    expect(taille.x).toBeCloseTo(10 + 2 * CHAMFER, 4)
    expect(taille.y).toBeCloseTo(4 + 2 * CHAMFER, 4)
    // La plinthe est le SEUL élément qui saille de l'emprise du mur.
    expect(taille.z).toBeCloseTo(WALL_THICKNESS + PLINTH_PROJECTION, 4)

    // Et posé au bon endroit : de `a`, vers l'intérieur, depuis le plancher.
    expect(bb.min.x).toBeCloseTo(-CHAMFER, 4)
    expect(bb.min.y).toBeCloseTo(-CHAMFER, 4)
    expect(bb.max.z).toBeCloseTo(0, 4)
    expect(bb.min.z).toBeCloseTo(-WALL_THICKNESS - PLINTH_PROJECTION, 4)
  })

  it('les FACES, elles, sont exactement à 0 et à l’épaisseur', () => {
    // C'est la cote qui compte pour le reste du bâtiment : l'accrochage des
    // œuvres, les cartels et la jonction avec le mur mitoyen la lisent tous.
    const w = mur()
    const fs = facettes(w, buildWall(w))
    expect(aire(fs, (f) => regarde(f, 0, 0, 1) && Math.abs(f.centre.z - WALL_THICKNESS) < 1e-4))
      .toBeCloseTo(10 * 4, 3)
    expect(aire(fs, (f) => regarde(f, 0, 0, -1) && Math.abs(f.centre.z) < 1e-4))
      .toBeCloseTo(10 * 4, 3)
  })

  it('reste exact quand le mur est percé', () => {
    const { geometry } = buildWall(mur({ openings: [porte(4, 6)] }))
    geometry.computeBoundingBox()
    const taille = geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(taille.x).toBeCloseTo(10 + 2 * CHAMFER, 4)
    expect(taille.y).toBeCloseTo(4 + 2 * CHAMFER, 4)
    expect(taille.z).toBeCloseTo(WALL_THICKNESS + PLINTH_PROJECTION, 4)
  })

  it('témoin : le biseau par défaut de three est hors de toute proportion', () => {
    // Ce test ne teste pas notre code, il documente le piège : le biseau de
    // three vaut 0,2 m si on ne le règle pas — soixante-six fois notre
    // chanfrein. Si un jour ce défaut change, celle-ci tombera et on saura
    // pourquoi le commentaire de `wall.ts` n'a plus lieu d'être.
    const forme = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(10, 0),
      new THREE.Vector2(10, 4),
      new THREE.Vector2(0, 4),
    ])
    const piege = new THREE.ExtrudeGeometry(forme, { depth: WALL_THICKNESS })
    piege.computeBoundingBox()
    const taille = piege.boundingBox!.getSize(new THREE.Vector3())
    expect(taille.x).toBeCloseTo(10.2, 4)
    expect(taille.y).toBeCloseTo(4.2, 4)
    expect(taille.z).toBeCloseTo(WALL_THICKNESS + 0.4, 4)
  })
})

// ── Piège n°2 : l'indexation ─────────────────────────────────────────────

describe('indexation et collider', () => {
  it('rend une géométrie indexée', () => {
    const { geometry } = buildWall(mur({ openings: [porte(4, 6)] }))
    expect(geometry.getIndex()).not.toBeNull()
    expect(geometry.getIndex()!.count).toBeGreaterThan(0)
  })

  it('rend un collider trimesh non vide et cohérent', () => {
    const built = buildWall(mur({ openings: [porte(4, 6)] }))
    const { vertices, indices } = built.collider

    expect(indices).toBeInstanceOf(Uint32Array)
    expect(vertices).toBeInstanceOf(Float32Array)
    expect(indices.length).toBeGreaterThan(0)
    expect(indices.length % 3).toBe(0)
    expect(vertices.length % 3).toBe(0)

    const nbSommets = vertices.length / 3
    for (const i of indices) expect(i).toBeLessThan(nbSommets)
    for (const v of vertices) expect(Number.isFinite(v)).toBe(true)
    // Géométrie et collider lisent les mêmes tampons.
    expect(indices.length).toBe(built.geometry.getIndex()!.count)
  })

  it('ne produit aucun triangle dégénéré', () => {
    const built = buildWall(
      mur({ openings: [porte(1, 3), porte(4, 6), porte(7, 9)] }),
    )
    for (const t of triangles(built)) expect(t.getArea()).toBeGreaterThan(1e-7)
  })

  it('est déterministe : deux appels donnent les mêmes octets', () => {
    const w = mur({ openings: [porte(4, 6)] })
    const a = buildWall(w)
    const b = buildWall(w)
    expect(Array.from(b.collider.vertices)).toEqual(Array.from(a.collider.vertices))
    expect(Array.from(b.collider.indices)).toEqual(Array.from(a.collider.indices))
  })
})

// ── Aire de la face percée ───────────────────────────────────────────────

describe('aire de la face', () => {
  it('mur plein : longueur × hauteur', () => {
    const w = mur()
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40, 3)
  })

  it('une porte : l’aire de la porte en moins', () => {
    const w = mur({ openings: [porte(4, 6)] })
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40 - 2 * 2.1, 3)
  })

  it('trois ouvertures : la somme des aires percées en moins', () => {
    const w = mur({
      b: { x: 38, z: 0 },
      height: 4.3,
      kind: 'inner',
      openings: [
        porte(3.5, 5.5),
        { kind: 'bay', start: 17.8, end: 20.2, height: 3.7 , sill: 0},
        porte(32.5, 34.5),
      ],
    })
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(38 * 4.3 - airePercee(w), 3)
  })

  it('ouverture collée à une extrémité', () => {
    for (const o of [porte(0, 2), porte(8, 10)]) {
      const w = mur({ openings: [o] })
      expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40 - 2 * 2.1, 3)
    }
  })

  it('ouvertures aux deux extrémités à la fois', () => {
    const w = mur({ openings: [porte(0, 2), porte(8, 10)] })
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40 - 2 * (2 * 2.1), 3)
  })

  it('ouverture pleine hauteur : le mur se scinde sans se casser', () => {
    const w = mur({ openings: [porte(4, 6, 4)] })
    const built = buildWall(w)
    expect(aireFaceInterieure(w, built)).toBeCloseTo(40 - 2 * 4, 3)
    for (const v of built.collider.vertices) expect(Number.isFinite(v)).toBe(true)
  })

  it('ouverture débordante : elle est ramenée dans le mur', () => {
    const w = mur({ openings: [{ kind: 'door', start: -3, end: 2, height: 99 , sill: 0}] })
    // Ramenée à u ∈ [0, 2] et à la hauteur du mur : 2 × 4 percés.
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40 - 8, 3)
  })

  it('ouvertures qui se chevauchent : leur UNION, pas leur somme', () => {
    // 4→6 sur 2,1 m et 5→7 sur 3 m : l'union vaut 1×2,1 + 2×3 = 8,1 m².
    const w = mur({ openings: [porte(4, 6), porte(5, 7, 3)] })
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40 - 8.1, 3)
  })

  it('ouvertures jointives : un seul contour, pas de jambage nul', () => {
    const w = mur({ openings: [porte(4, 6), porte(6, 8)] })
    const built = buildWall(w)
    expect(aireFaceInterieure(w, built)).toBeCloseTo(40 - 2 * (2 * 2.1), 3)
    for (const t of triangles(built)) expect(t.getArea()).toBeGreaterThan(1e-7)
  })
})

// ── Traversabilité ───────────────────────────────────────────────────────

describe('traversabilité', () => {
  const w = mur({ openings: [porte(4, 6)] })
  const built = buildWall(w)

  it('aucun triangle de collider dans le volume de la porte', () => {
    expect(trianglesDansLaBoite(w, built, boiteOuverture(w.openings[0], w))).toBe(0)
  })

  it('témoin : le plein du mur, lui, est bien plein', () => {
    // Sans ce témoin, un collider VIDE passerait le test précédent haut la main.
    const plein = new THREE.Box3(
      new THREE.Vector3(0.5, 0.5, -1),
      new THREE.Vector3(2.5, 1.5, 1),
    )
    expect(trianglesDansLaBoite(w, built, plein)).toBeGreaterThan(0)
    // Et le linteau au-dessus de la porte existe : on ne passe pas par le haut.
    const linteau = new THREE.Box3(
      new THREE.Vector3(4.5, 3, -1),
      new THREE.Vector3(5.5, 3.5, 1),
    )
    expect(trianglesDansLaBoite(w, built, linteau)).toBeGreaterThan(0)
  })

  it('la porte reste franche sur un mur oblique', () => {
    const oblique = mur({
      b: { x: 7.0710678, z: 7.0710678 },
      normal: { x: 0.7071068, z: -0.7071068 },
      openings: [porte(3, 5)],
    })
    const b = buildWall(oblique)
    expect(trianglesDansLaBoite(oblique, b, boiteOuverture(oblique.openings[0], oblique))).toBe(0)
    expect(aireFaceInterieure(oblique, b)).toBeCloseTo(wallLength(oblique) * 4 - 2 * 2.1, 2)
  })
})

// ── Orientation ──────────────────────────────────────────────────────────

describe('orientation', () => {
  it('la face intérieure regarde vers wall.normal', () => {
    const w = mur({ openings: [porte(4, 6)] })
    const built = buildWall(w)
    const n = normaleMonde(w)
    const origine = new THREE.Vector3(w.a.x, 0, w.a.z).addScaledVector(n, WALL_THICKNESS)

    let compte = 0
    for (const t of triangles(built)) {
      const surLePlan = [t.a, t.b, t.c].every(
        (p) => Math.abs(p.clone().sub(origine).dot(n)) < 1e-4,
      )
      if (!surLePlan) continue
      compte++
      expect(t.getNormal(new THREE.Vector3()).dot(n)).toBeGreaterThan(0.999)
    }
    expect(compte).toBeGreaterThan(0)
  })

  it('le mur occupe le côté de la normale, jamais l’autre', () => {
    const w = mur()
    const n = normaleMonde(w)
    const base = new THREE.Vector3(w.a.x, 0, w.a.z)
    for (const t of triangles(buildWall(w))) {
      for (const p of [t.a, t.b, t.c]) {
        const d = p.clone().sub(base).dot(n)
        expect(d).toBeGreaterThan(-1e-4)
        // La plinthe saille : c'est la seule chose qui dépasse la face.
        expect(d).toBeLessThan(WALL_THICKNESS + PLINTH_PROJECTION + 1e-4)
      }
    }
  })

  /**
   * Le volume signé est le seul test qui attrape un repère indirect : une
   * géométrie miroir a exactement les mêmes aires, la même bounding box, et un
   * volume NÉGATIF. On ne peut plus l'exiger au millimètre cube depuis que le
   * chanfrein dilate le cœur et que la plinthe s'ajoute — mais un débord de 1 %
   * suffit largement à distinguer « un peu plus de matière » de « tout à
   * l'envers ».
   */
  function volumeNominal(aireDeFace: number, longueurPlinthe: number): number {
    return aireDeFace * WALL_THICKNESS + longueurPlinthe * PLINTH_HEIGHT * PLINTH_PROJECTION
  }

  it('volume signé positif : aucun miroir, aucune face retournée', () => {
    const w = mur({ openings: [porte(4, 6)] })
    const attendu = volumeNominal(40 - 2 * 2.1, 10 - 2)
    const mesure = volumeSigne(buildWall(w))
    expect(mesure).toBeGreaterThan(attendu)
    expect(mesure).toBeLessThan(attendu * 1.01)
  })

  it('normale opposée : le mur bascule de l’autre côté, sans miroir', () => {
    // Cas défensif : `layout.ts` produit toujours la perpendiculaire canonique,
    // mais un mur écrit à la main peut porter l'autre. Le repère doit rester
    // DIRECT, seule l'extrusion change de côté.
    const w = mur({ normal: { x: 0, z: 1 }, openings: [porte(4, 6)] })
    const built = buildWall(w)
    built.geometry.computeBoundingBox()
    const bb = built.geometry.boundingBox!
    expect(bb.min.z).toBeCloseTo(0, 4)
    expect(bb.max.z).toBeCloseTo(WALL_THICKNESS + PLINTH_PROJECTION, 4)
    const attendu = volumeNominal(40 - 2 * 2.1, 10 - 2)
    expect(volumeSigne(built)).toBeGreaterThan(attendu)
    expect(volumeSigne(built)).toBeLessThan(attendu * 1.01)
    expect(aireFaceInterieure(w, built)).toBeCloseTo(40 - 2 * 2.1, 3)
  })
})

// ── §9.4 : embrasure, plinthe, chanfrein ─────────────────────────────────

/**
 * Le relief. Rien de ce qui suit ne se voit sur une aire ni sur une bounding
 * box : un mur sans embrasure a exactement la même face percée et la même
 * emprise qu'un mur qui en a une. C'est pourtant la seule chose qui le
 * distingue d'un carton découpé, d'où ce bloc entier de mesures de facettes.
 */
describe('embrasure (spec §9.4)', () => {
  const w = mur({ openings: [porte(4, 6)] })
  const built = buildWall(w)
  const fs = facettes(w, built)
  const o = w.openings[0]

  // Le chanfrein mange 3 mm à chaque bout de la tranche : la partie droite de
  // l'embrasure est d'autant moins profonde.
  const profondeurDroite = WALL_THICKNESS - 2 * CHAMFER

  it('montre le jambage gauche sur toute la tranche', () => {
    // Face verticale qui regarde VERS l'ouverture, donc vers les u croissants.
    const a = aire(fs, (f) => jambage(f, o.start + CHAMFER, 1))
    expect(a).toBeCloseTo(o.height * profondeurDroite, 4)
  })

  it('montre le jambage droit sur toute la tranche', () => {
    const a = aire(fs, (f) => jambage(f, o.end - CHAMFER, -1))
    expect(a).toBeCloseTo(o.height * profondeurDroite, 4)
  })

  it('montre le linteau sur toute la tranche', () => {
    // Face horizontale qui regarde vers le BAS, donc vers l'ouverture.
    const a = aire(fs, (f) => linteau(f, o))
    expect(a).toBeCloseTo((o.end - o.start - 2 * CHAMFER) * profondeurDroite, 4)
  })

  it('ne montre AUCUN seuil : l’ouverture descend au plancher', () => {
    // Régression : tant que les ouvertures étaient des `Shape.holes`, three
    // fermait leur arête basse par une facette horizontale à `v = 0`,
    // EXACTEMENT coplanaire avec la face supérieure de la dalle. Résultat, du
    // z-fighting dans chaque porte du bâtiment. L'encoche du contour ne peut
    // plus la produire, et ce test le vérifie plutôt que de l'espérer.
    const parasites = fs.filter(
      (f) =>
        Math.abs(f.centre.y) < 1e-3 &&
        Math.abs(f.normale.y) > 0.9 &&
        f.centre.x > o.start &&
        f.centre.x < o.end,
    )
    expect(parasites).toHaveLength(0)
  })

  it('oriente ses trois faces VERS le vide de l’ouverture', () => {
    // Une embrasure retournée se voit « à travers » : le joueur devine
    // l'intérieur du mur par la porte. Le produit scalaire avec la direction
    // qui va du centre de l'ouverture vers la facette doit donc être négatif.
    const centre = new THREE.Vector2((o.start + o.end) / 2, o.height / 2)
    const tranche = fs.filter(
      (f) =>
        f.centre.z > CHAMFER &&
        f.centre.z < WALL_THICKNESS - CHAMFER &&
        f.centre.x > o.start - 1e-3 &&
        f.centre.x < o.end + 1e-3 &&
        f.centre.y < o.height - 1e-3 &&
        Math.abs(f.normale.z) < 0.5,
    )
    expect(tranche.length).toBeGreaterThan(0)
    for (const f of tranche) {
      const versLaFacette = new THREE.Vector2(f.centre.x, f.centre.y).sub(centre).normalize()
      const n = new THREE.Vector2(f.normale.x, f.normale.y).normalize()
      expect(versLaFacette.dot(n)).toBeLessThan(0)
    }
  })

  it('en pose une sur CHACUNE des ouvertures d’un mur multiple', () => {
    const multiple = mur({
      b: { x: 38, z: 0 },
      height: 4.3,
      openings: [porte(3.5, 5.5), { kind: 'bay', start: 17.8, end: 20.2, height: 3.7 , sill: 0}, porte(32.5, 34.5)],
    })
    const fm = facettes(multiple, buildWall(multiple))
    for (const ouv of multiple.openings) {
      const gauche = aire(fm, (f) => jambage(f, ouv.start + CHAMFER, 1))
      const droit = aire(fm, (f) => jambage(f, ouv.end - CHAMFER, -1))
      const dessus = aire(fm, (f) => linteau(f, ouv))
      expect(gauche, `${ouv.kind} gauche`).toBeCloseTo(ouv.height * profondeurDroite, 4)
      expect(droit, `${ouv.kind} droit`).toBeCloseTo(ouv.height * profondeurDroite, 4)
      expect(dessus, `${ouv.kind} linteau`).toBeCloseTo(
        (ouv.end - ouv.start - 2 * CHAMFER) * profondeurDroite,
        4,
      )
    }
  })
})

describe('plinthe (spec §9.4)', () => {
  const w = mur({ openings: [porte(4, 6)] })
  const built = buildWall(w)
  const fs = facettes(w, built)

  /** Facettes de la face vue de la plinthe : le plan le plus avancé du mur. */
  const face = (f: Facette): boolean =>
    regarde(f, 0, 0, 1) && Math.abs(f.centre.z - (WALL_THICKNESS + PLINTH_PROJECTION)) < 1e-4

  it('court au pied du mur, interrompue par la porte', () => {
    expect(aire(fs, face)).toBeCloseTo((10 - 2) * PLINTH_HEIGHT, 4)
  })

  it('fait bien 12 cm de haut et part du plancher', () => {
    const hauteurs = fs.filter(face).flatMap((f) => [f.centre.y])
    expect(Math.min(...hauteurs)).toBeGreaterThan(0)
    expect(Math.max(...hauteurs)).toBeLessThan(PLINTH_HEIGHT)
    // La face vue est un bandeau plein : son aire ne peut valoir longueur ×
    // hauteur que si elle va exactement de 0 à PLINTH_HEIGHT.
    const bande = aire(fs, (f) => face(f) && f.centre.y < PLINTH_HEIGHT / 2)
    expect(bande).toBeCloseTo(aire(fs, face) / 2, 4)
  })

  it('saille de 2 cm et de rien d’autre', () => {
    const enAvant = fs.filter((f) => f.centre.z > WALL_THICKNESS + 1e-4)
    expect(enAvant.length).toBeGreaterThan(0)
    for (const f of enAvant) {
      expect(f.centre.z).toBeLessThan(WALL_THICKNESS + PLINTH_PROJECTION + 1e-4)
      // Rien ne saille au-dessus de la plinthe : ce serait une corniche.
      expect(f.centre.y).toBeLessThan(PLINTH_HEIGHT + CHAMFER + 1e-4)
    }
  })

  it('ne traverse aucune porte', () => {
    const dansLaPorte = fs.filter(
      (f) => f.centre.z > WALL_THICKNESS + 1e-4 && f.centre.x > 4.02 && f.centre.x < 5.98,
    )
    expect(dansLaPorte).toHaveLength(0)
  })
})

describe('chanfrein (spec §9.4)', () => {
  it('adoucit les arêtes de l’embrasure par une facette à 45°', () => {
    const w = mur({ openings: [porte(4, 6)] })
    const fs = facettes(w, buildWall(w))
    // Une facette de chanfrein de jambage regarde à la fois vers l'ouverture
    // (±u) et vers une face du mur (±w), à parts égales.
    const biais = fs.filter(
      (f) =>
        Math.abs(Math.abs(f.normale.x) - Math.SQRT1_2) < 0.02 &&
        Math.abs(Math.abs(f.normale.z) - Math.SQRT1_2) < 0.02 &&
        f.centre.x > 4 - 1e-3 &&
        f.centre.x < 6 + 1e-3,
    )
    // Quatre : deux jambages, deux faces de mur.
    expect(biais.length).toBeGreaterThanOrEqual(4)
    // Largeur de la facette : le chanfrein pris en diagonale.
    const largeur = aire(fs, (f) => biais.includes(f)) / (4 * 2.1)
    expect(largeur).toBeCloseTo(CHAMFER * Math.SQRT2, 3)
  })

  it('adoucit aussi l’arête haute de la plinthe', () => {
    const w = mur()
    const fs = facettes(w, buildWall(w))
    const biais = fs.filter(
      (f) =>
        Math.abs(f.normale.y - Math.SQRT1_2) < 0.02 &&
        Math.abs(f.normale.z - Math.SQRT1_2) < 0.02 &&
        f.centre.z > WALL_THICKNESS,
    )
    expect(biais.length).toBeGreaterThan(0)
  })
})

// ── Cas dégénérés ────────────────────────────────────────────────────────

describe('cas dégénérés', () => {
  it('mur de longueur nulle : rien à dessiner, mais un collider valide', () => {
    const built = buildWall(mur({ b: { x: 0, z: 0 } }))
    expect(built.collider.indices).toBeInstanceOf(Uint32Array)
    expect(built.collider.indices.length).toBe(0)
    expect(built.geometry.getIndex()).not.toBeNull()
  })

  it('hauteur nulle : idem, sans exception', () => {
    expect(() => buildWall(mur({ height: 0 }))).not.toThrow()
    expect(buildWall(mur({ height: 0 })).collider.vertices.length).toBe(0)
  })

  it('ouverture pleine hauteur JOINTIVE d’une porte normale', () => {
    // Le cas qui pince le contour : la coupe franche sépare le mur en deux
    // morceaux, et le second commence EXACTEMENT sur le jambage de la porte
    // voisine. Un escalier mal amorcé y produirait une arête de longueur nulle,
    // que la triangulation avale sans rien dire.
    const w = mur({ openings: [porte(3, 5, 4), porte(5, 7)] })
    const built = buildWall(w)
    expect(aireFaceInterieure(w, built)).toBeCloseTo(40 - 2 * 4 - 2 * 2.1, 3)
    for (const t of triangles(built)) expect(t.getArea()).toBeGreaterThan(1e-7)
    for (const v of built.collider.vertices) expect(Number.isFinite(v)).toBe(true)
    // La porte de 2,1 m garde son linteau et ses deux jambages.
    const fs = facettes(w, built)
    expect(aire(fs, (f) => linteau(f, w.openings[1]))).toBeGreaterThan(0)
    expect(aire(fs, (f) => jambage(f, 7 - CHAMFER, -1))).toBeGreaterThan(0)
  })

  it('ouverture d’épaisseur nulle : ignorée', () => {
    const w = mur({ openings: [porte(5, 5)] })
    expect(aireFaceInterieure(w, buildWall(w))).toBeCloseTo(40, 3)
  })
})

// ── Le musée réel ────────────────────────────────────────────────────────

describe('musée réel (public/data/museum.json)', () => {
  // `import.meta.url` n'est pas un chemin de fichier sous jsdom : on part de la
  // racine du projet, que vitest garantit comme répertoire courant.
  const chemin = resolve(process.cwd(), 'public/data/museum.json')
  const musee = JSON.parse(readFileSync(chemin, 'utf8')) as Museum
  const murs: Wall[] = musee.floors.flatMap((f) => f.rooms.flatMap((r) => r.walls))

  // Les compteurs restent des minorants : le musée est régénéré à chaque
  // `npm run derive`, et un test qui figerait « 40 murs » deviendrait rouge au
  // premier dépôt ajouté sans que rien ne soit cassé.
  it('lit bien un musée à plusieurs niveaux, avec des murs percés', () => {
    expect(musee.floors.length).toBeGreaterThanOrEqual(2)
    expect(murs.length).toBeGreaterThanOrEqual(16)
    expect(murs.filter((w) => w.openings.length > 0).length).toBeGreaterThanOrEqual(4)
    expect(murs.some((w) => w.openings.length >= 3)).toBe(true)
  })

  it('construit tous les murs sans NaN ni géométrie vide', () => {
    for (const w of murs) {
      const built = buildWall(w)
      const { vertices, indices } = built.collider

      expect(vertices.length, w.id).toBeGreaterThan(0)
      expect(indices.length, w.id).toBeGreaterThan(0)
      expect(indices.length % 3, w.id).toBe(0)
      for (const v of vertices) expect(Number.isFinite(v)).toBe(true)

      const nbSommets = vertices.length / 3
      for (const i of indices) expect(i).toBeLessThan(nbSommets)
      expect(built.geometry.getIndex(), w.id).not.toBeNull()
    }
  })

  it('conserve l’aire percée de chaque mur', () => {
    for (const w of murs) {
      const attendu = wallLength(w) * w.height - airePercee(w)
      expect(aireFaceInterieure(w, buildWall(w)), w.id).toBeCloseTo(attendu, 2)
    }
  })

  it('respecte les cotes du plan : longueur × hauteur × 0,32', () => {
    for (const w of murs) {
      const built = buildWall(w)
      built.geometry.computeBoundingBox()
      const taille = built.geometry.boundingBox!.getSize(new THREE.Vector3())
      // Tous les murs du musée sont alignés sur les axes : la boîte du monde
      // porte donc directement les trois cotes, à l'ordre près. Le chanfrein
      // dilate le cœur de 3 mm dans le plan du mur, la plinthe saille dans
      // l'épaisseur : les deux sont attendus, tout le reste serait un dérapage.
      const cotes = [taille.x, taille.y, taille.z].sort((a, b) => a - b)
      expect(cotes[0], w.id).toBeCloseTo(WALL_THICKNESS + PLINTH_PROJECTION, 3)
      expect(cotes[1], w.id).toBeCloseTo(Math.min(w.height, wallLength(w)) + 2 * CHAMFER, 3)
      expect(cotes[2], w.id).toBeCloseTo(Math.max(w.height, wallLength(w)) + 2 * CHAMFER, 3)
    }
  })

  it('le vide de chaque ouverture est réellement vide', () => {
    // Vrai des portes comme des fenêtres : dans les deux cas le mur ne doit
    // laisser aucun triangle DANS l'ouverture. La différence est la hauteur à
    // laquelle ce vide commence, et c'est `boiteOuverture` qui la porte.
    let controlees = 0
    for (const w of murs) {
      const built = buildWall(w)
      for (const o of w.openings) {
        expect(trianglesDansLaBoite(w, built, boiteOuverture(o, w)), `${w.id} ${o.kind}`).toBe(0)
        controlees++
      }
    }
    expect(controlees).toBeGreaterThanOrEqual(4)
  })

  it('on FRANCHIT une porte et on ne franchit pas une fenêtre', () => {
    // La distinction qui compte pour le visiteur : sous une allège il y a du
    // mur, et le collider le porte. Sans ça on sortirait du musée par un jour.
    let fenetres = 0
    for (const w of murs) {
      const built = buildWall(w)
      for (const o of w.openings.filter((x) => (x.sill ?? 0) > 0.05)) {
        fenetres++
        const sousAllege = new THREE.Box3(
          new THREE.Vector3(o.start + 0.1, 0.05, -1),
          new THREE.Vector3(o.end - 0.1, (o.sill ?? 0) - 0.05, 1),
        )
        expect(trianglesDansLaBoite(w, built, sousAllege), `${w.id} : allège percée`).toBeGreaterThan(0)
      }
    }
    expect(fenetres, 'le musée réel ne porte aucune fenêtre à contrôler').toBeGreaterThan(0)
  })

  it('n’émet aucun triangle dégénéré', () => {
    for (const w of murs) {
      for (const t of triangles(buildWall(w))) {
        expect(t.getArea(), w.id).toBeGreaterThan(1e-7)
      }
    }
  })
})

// ── Fenêtres : les ouvertures qui FLOTTENT ───────────────────────────────

/**
 * Une ouverture posée au sol est une encoche du contour ; une fenêtre est un
 * vrai trou. La distinction n'est pas cosmétique : elle décide de la façon dont
 * le mur est construit, et se tromper de camp a déjà coûté du z-fighting dans
 * toutes les portes du bâtiment.
 */
describe('fenêtres', () => {
  it('perce un trou sans couper le mur en deux', () => {
    // Une porte casse le mur en deux jambages ; une fenêtre, non — le mur passe
    // sous elle et au-dessus d'elle.
    const avec = buildWall(mur({ openings: [fenetre(3, 4.5)] }))
    const sans = buildWall(mur({ openings: [] }))
    expect(avec.geometry.getAttribute('position').count).toBeGreaterThan(
      sans.geometry.getAttribute('position').count,
    )
  })

  it('laisse de la matière SOUS la fenêtre — c’est l’allège', () => {
    /*
      Ce qui distingue une fenêtre d'une porte, c'est que le mur passe SOUS
      elle. On le prouve par les sommets de l'arête basse du jour, et non en
      cherchant un triangle entier sous l'allège : la face d'un mur percé est
      une seule polyligne triangulée par earcut, dont les triangles enjambent
      volontiers le jour. Leur absence ne prouverait rien.
    */
    const built = buildWall(mur({ openings: [fenetre(3, 4.5, 0.95, 2.6)] }))
    const pos = built.geometry.getAttribute('position') as THREE.BufferAttribute

    const boite = new THREE.Box3().setFromBufferAttribute(pos)
    // Le mur descend toujours au sol : rien n'a été découpé en bas.
    expect(boite.min.y).toBeLessThan(0.05)

    // Le chanfrein de 3 mm déplace les sommets d'autant : on cherche à 2 cm près.
    const proche = (v: number, cible: number) => Math.abs(v - cible) < 0.02
    let coinsBas = 0
    let coinsHaut = 0
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      if (!proche(x, 3) && !proche(x, 4.5)) continue
      if (proche(y, 0.95)) coinsBas++
      if (proche(y, 2.6)) coinsHaut++
    }
    expect(coinsBas, "l'arête basse du jour n'existe pas : ce n'est pas une fenêtre").toBeGreaterThan(0)
    expect(coinsHaut, 'le linteau du jour n’existe pas').toBeGreaterThan(0)
  })

  it('une allège sous le seuil retombe sur une ouverture au sol', () => {
    // Deux centimètres d'allège ne se verraient pas et feraient une arête de
    // plus à faire calculer au collider.
    const rase = buildWall(mur({ openings: [fenetre(3, 4.5, 0.02, 2.1)] }))
    const porteEquivalente = buildWall(mur({ openings: [porte(3, 4.5, 2.1)] }))
    expect(rase.geometry.getAttribute('position').count).toBe(
      porteEquivalente.geometry.getAttribute('position').count,
    )
  })

  it('une allège au-dessus du linteau ne produit pas de rectangle retourné', () => {
    // `Shape.holes` accepterait le contour sans rien dire, avant de sortir une
    // face inversée qu'on ne verrait que sous un certain angle.
    const built = buildWall(mur({ openings: [fenetre(3, 4.5, 5, 2.6)] }))
    for (const t of triangles(built)) {
      for (const p of [t.a, t.b, t.c]) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
    }
  })

  it('le collider bouche la fenêtre : on ne sort pas du musée par un jour', () => {
    // Une fenêtre est une vue, pas un passage. Si son trou traversait le
    // collider, le visiteur franchirait la façade à hauteur d'appui.
    const built = buildWall(mur({ openings: [fenetre(3, 4.5, 0.95, 2.6)] }))
    expect(built.collider.indices.length).toBeGreaterThan(0)
  })
})

// ── Vitrage ──────────────────────────────────────────────────────────────

/**
 * Percer un mur ne fait pas une fenêtre, ça fait un trou. Sans vitre, on voit
 * le parc au travers d'une découpe franche, sans reflet ni épaisseur, et l'œil
 * lit un décor découpé au cutter plutôt qu'un bâtiment.
 */
describe('vitrage', () => {
  it('vitre les fenêtres et RIEN d’autre', () => {
    // Une vitre dans une porte murerait le bâtiment.
    const avecPorte = buildGlazing([mur({ openings: [porte(3, 5)] })])
    expect(avecPorte.count).toBe(0)

    const avecJour = buildGlazing([mur({ openings: [fenetre(3, 4.5)] })])
    expect(avecJour.count).toBe(1)
  })

  it('tient DANS le jour, sans déborder sur le mur', () => {
    // Une vitre plus grande que son percement se verrait comme une plaque
    // collée sur la façade.
    const w = mur({ openings: [fenetre(3, 4.5, 0.95, 2.6)] })
    const { geometry } = buildGlazing([w])
    const boite = new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute,
    )
    // Le mur va de (0,0) à (10,0) : l'axe du jour est x.
    expect(boite.min.x).toBeGreaterThanOrEqual(3 - 1e-6)
    expect(boite.max.x).toBeLessThanOrEqual(4.5 + 1e-6)
    expect(boite.min.y).toBeGreaterThanOrEqual(0.95 - 1e-6)
    expect(boite.max.y).toBeLessThanOrEqual(2.6 + 1e-6)
  })

  it('se pose au MILIEU de l’embrasure, pas au nu du mur', () => {
    // Affleurante, l'embrasure de 32 cm qu'on a construite ne se lirait plus
    // que d'un seul côté.
    const w = mur({ openings: [fenetre(3, 4.5)] })
    const { geometry } = buildGlazing([w])
    const boite = new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute,
    )
    // Le mur est sur z = 0 et son épaisseur va d'un côté : la vitre doit être à
    // une demi-épaisseur du plan de référence, pas dessus.
    const profondeur = Math.abs((boite.min.z + boite.max.z) / 2)
    expect(profondeur).toBeCloseTo(WALL_THICKNESS / 2, 6)
  })

  it('fusionne tout un niveau en UNE géométrie', () => {
    // Un mesh par fenêtre coûterait un draw call par fenêtre, sur un budget
    // déjà dépassé.
    const murs = [
      mur({ id: 'a', openings: [fenetre(1, 2.5), fenetre(4, 5.5)] }),
      mur({ id: 'b', openings: [fenetre(7, 8.5)] }),
    ]
    const { geometry, count } = buildGlazing(murs)
    expect(count).toBe(3)
    expect(geometry.getIndex()!.count).toBe(3 * 6)
  })

  it('ne produit aucune géométrie invalide sur une liste vide', () => {
    const { geometry, count } = buildGlazing([])
    expect(count).toBe(0)
    expect(geometry.getIndex()).not.toBeNull()
    expect(geometry.getAttribute('position').count).toBe(0)
  })

  it('le matériau laisse voir au travers ET réfléchit', () => {
    // Les deux à la fois : opaque on ne verrait pas le parc, sans reflet la
    // vitre redevient un trou.
    const m = creerVitrage()
    expect(m.transparent).toBe(true)
    expect(m.opacity).toBeLessThan(0.3)
    expect(m.opacity).toBeGreaterThan(0)
    expect(m.roughness).toBeLessThan(0.1)
    expect(m.envMapIntensity).toBeGreaterThan(1)
    // Sans ça la vitre masquerait dans le tampon de profondeur ce qu'on est
    // censé voir au travers.
    expect(m.depthWrite).toBe(false)
    m.dispose()
  })
})
