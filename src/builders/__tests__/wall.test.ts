/**
 * Tests du constructeur de murs (spec §8).
 *
 * Trois familles d'assertions, dans cet ordre d'importance :
 *
 *  - les deux pièges d'`ExtrudeGeometry` : cotes réelles mesurées sur la
 *    BOUNDING BOX 3D, et indices non vides sur le collider ;
 *  - la matière : aire de face conservée, ouvertures réellement traversables
 *    sur toute l'épaisseur, faces orientées vers la salle ;
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
import { WALL_THICKNESS, buildWall, wallLength, wallMatrix } from '../wall'

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
  return { kind: 'door', start, end, height }
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
  return wall.openings.reduce(
    (s, o) => s + (o.end - o.start) * Math.min(o.height, wall.height),
    0,
  )
}

/** Boîte du VIDE d'une ouverture, dans le repère du mur, marges comprises. */
function boiteOuverture(o: Opening, wall: Wall, marge = 0.02): THREE.Box3 {
  return new THREE.Box3(
    // `w` déborde largement de l'épaisseur : « sur toute son épaisseur ».
    new THREE.Vector3(o.start + marge, marge, -1),
    new THREE.Vector3(o.end - marge, Math.min(o.height, wall.height) - marge, 1),
  )
}

function trianglesDansLaBoite(wall: Wall, built: BuiltWall, boite: THREE.Box3): number {
  return trianglesLocaux(wall, built).filter((t) => boite.intersectsTriangle(t)).length
}

// ── Piège n°1 : le biseau ────────────────────────────────────────────────

describe('bevelEnabled', () => {
  it('donne un mur aux cotes exactes : 10 × 4 × 0,2', () => {
    const { geometry } = buildWall(mur())
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    const taille = bb.getSize(new THREE.Vector3())

    expect(taille.x).toBeCloseTo(10, 4)
    expect(taille.y).toBeCloseTo(4, 4)
    expect(taille.z).toBeCloseTo(WALL_THICKNESS, 4)

    // Et posé au bon endroit : de `a`, vers l'intérieur, depuis le plancher.
    expect(bb.min.x).toBeCloseTo(0, 4)
    expect(bb.min.y).toBeCloseTo(0, 4)
    expect(bb.max.z).toBeCloseTo(0, 4)
    expect(bb.min.z).toBeCloseTo(-WALL_THICKNESS, 4)
  })

  it('reste exact quand le mur est percé', () => {
    const { geometry } = buildWall(mur({ openings: [porte(4, 6)] }))
    geometry.computeBoundingBox()
    const taille = geometry.boundingBox!.getSize(new THREE.Vector3())
    expect(taille.x).toBeCloseTo(10, 4)
    expect(taille.y).toBeCloseTo(4, 4)
    expect(taille.z).toBeCloseTo(WALL_THICKNESS, 4)
  })

  it('témoin : le défaut de three débordait bien de 0,2 m par direction', () => {
    // Ce test ne teste pas notre code, il documente le piège : si un jour
    // three change ce défaut, les assertions ci-dessus resteront valides mais
    // celle-ci tombera, et on saura pourquoi le commentaire n'a plus lieu d'être.
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
    expect(taille.z).toBeCloseTo(0.6, 4) // trois fois l'épaisseur demandée
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
        { kind: 'bay', start: 17.8, end: 20.2, height: 3.7 },
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
    const w = mur({ openings: [{ kind: 'door', start: -3, end: 2, height: 99 }] })
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
        expect(d).toBeLessThan(WALL_THICKNESS + 1e-4)
      }
    }
  })

  it('volume signé positif : aucun miroir, aucune face retournée', () => {
    const w = mur({ openings: [porte(4, 6)] })
    const attendu = (40 - 2 * 2.1) * WALL_THICKNESS
    expect(volumeSigne(buildWall(w))).toBeCloseTo(attendu, 3)
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
    expect(bb.max.z).toBeCloseTo(WALL_THICKNESS, 4)
    expect(volumeSigne(built)).toBeCloseTo((40 - 2 * 2.1) * WALL_THICKNESS, 3)
    expect(aireFaceInterieure(w, built)).toBeCloseTo(40 - 2 * 2.1, 3)
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

  it('respecte les cotes du plan : longueur × hauteur × 0,2', () => {
    for (const w of murs) {
      const built = buildWall(w)
      built.geometry.computeBoundingBox()
      const taille = built.geometry.boundingBox!.getSize(new THREE.Vector3())
      // Tous les murs du musée sont alignés sur les axes : la boîte du monde
      // porte donc directement les trois cotes, à l'ordre près.
      const cotes = [taille.x, taille.y, taille.z].sort((a, b) => a - b)
      expect(cotes[0], w.id).toBeCloseTo(WALL_THICKNESS, 3)
      expect(cotes[1], w.id).toBeCloseTo(Math.min(w.height, wallLength(w)), 3)
      expect(cotes[2], w.id).toBeCloseTo(Math.max(w.height, wallLength(w)), 3)
    }
  })

  it('laisse passer par chacune de ses ouvertures', () => {
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

  it('n’émet aucun triangle dégénéré', () => {
    for (const w of murs) {
      for (const t of triangles(buildWall(w))) {
        expect(t.getArea(), w.id).toBeGreaterThan(1e-7)
      }
    }
  })
})
