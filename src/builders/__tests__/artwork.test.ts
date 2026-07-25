/**
 * LOT 3 — Tests des matrices d'accrochage (spec §7.4 et §9).
 *
 * On teste le CALCUL, pas le rendu : une matrice d'instance est un objet
 * arithmétique, elle se vérifie sans WebGL et c'est la seule partie du lot dont
 * une erreur soit invisible à l'écran sans être visible à l'œil.
 *
 * Le corpus est le MUSÉE RÉEL, ses dix-sept salles et ses cent œuvres. Les
 * assertions sont des invariants — « dans le plan du mur », « du bon côté »,
 * « dans son segment » — et jamais des compteurs : `museum.json` est régénéré à
 * chaque `npm run derive` et un test qui fige « 100 œuvres » passe au rouge dès
 * qu'un dépôt est créé sur GitHub, sans que rien ne soit cassé.
 *
 * Les quatre défauts que ces tests attrapent, tous silencieux au rendu :
 *
 *  - une œuvre posée sur le segment plutôt que sur la face intérieure du mur :
 *    elle est alors NOYÉE dans la maçonnerie, invisible depuis la salle ;
 *  - une œuvre posée du mauvais côté : elle est accrochée dans la salle voisine,
 *    ou dehors, et retournée ;
 *  - un repère indirect : l'image est en MIROIR, ce qu'aucune assertion de
 *    position ne verrait ;
 *  - un `u` mal converti : l'œuvre déborde de son segment, chevauche une porte
 *    ou traverse l'angle.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { usableSegments } from '../../domain/hanging'
import type { Museum, Placement, Wall } from '../../domain/types'
import {
  CANVAS_OFFSET,
  FRAME_BORDER,
  FRAME_DEPTH,
  FRAME_OFFSET,
  canvasMatrix,
  collectHangings,
  frameMatrix,
  wallAxes,
} from '../artwork'
import { WALL_THICKNESS } from '../wall'

// ── Corpus ───────────────────────────────────────────────────────────────

// `import.meta.url` n'est pas un chemin de fichier sous jsdom : on part de la
// racine du projet, qui est le répertoire de travail de vitest.
const musee = JSON.parse(
  readFileSync(resolve(process.cwd(), 'public/data/museum.json'), 'utf8'),
) as Museum

/** Tous les couples (mur, œuvre) du musée réel, avec leur niveau. */
const accroches: { wall: Wall; placement: Placement; floorId: string; elevation: number }[] = []
for (const floor of musee.floors) {
  for (const room of floor.rooms) {
    for (const wall of room.walls) {
      for (const placement of wall.placements) {
        accroches.push({ wall, placement, floorId: floor.id, elevation: floor.elevation })
      }
    }
  }
}

/** Tolérance : on manipule des mètres, le micron suffit largement. */
const EPS = 1e-6

/** Repère décomposé d'une matrice d'instance. */
function decompose(matrix: THREE.Matrix4) {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const echelle = new THREE.Vector3()
  matrix.decompose(position, quaternion, echelle)
  const base = new THREE.Matrix4().makeRotationFromQuaternion(quaternion)
  const droite = new THREE.Vector3().setFromMatrixColumn(base, 0)
  const haut = new THREE.Vector3().setFromMatrixColumn(base, 1)
  const face = new THREE.Vector3().setFromMatrixColumn(base, 2)
  return { position, echelle, droite, haut, face }
}

// ── Garde-fou du corpus ──────────────────────────────────────────────────

describe('corpus', () => {
  it('contient des œuvres accrochées — sinon tout ce fichier ne teste rien', () => {
    expect(accroches.length).toBeGreaterThan(0)
  })

  it('couvre plusieurs orientations de mur, donc plusieurs normales', () => {
    const normales = new Set(
      accroches.map(({ wall }) => `${Math.round(wall.normal.x)},${Math.round(wall.normal.z)}`),
    )
    // Un test qui ne verrait que des murs « nord » ne dirait rien du signe de la
    // normale ni du sens du repère.
    expect(normales.size).toBeGreaterThanOrEqual(3)
  })
})

// ── Position : dans le plan du mur, du bon côté, à la bonne hauteur ──────

describe('canvasMatrix — position', () => {
  it('pose chaque œuvre DANS le plan de son mur', () => {
    for (const { wall, placement } of accroches) {
      const axes = wallAxes(wall)
      const { position } = decompose(canvasMatrix(wall, placement))
      const relatif = position.clone().sub(axes.origin)

      // Le repère du mur est orthonormé : (u, hauteur, saillie) reconstituent
      // exactement la position. Un résidu non nul voudrait dire que l'œuvre est
      // hors du plan vertical du mur.
      const u = relatif.dot(axes.along)
      const saillie = relatif.dot(axes.inward)
      const reconstruit = axes.origin
        .clone()
        .addScaledVector(axes.along, u)
        .addScaledVector(axes.inward, saillie)
      reconstruit.y = position.y

      expect(position.distanceTo(reconstruit)).toBeLessThan(EPS)
    }
  })

  it('pose chaque œuvre à son `u`, mesuré depuis `a`', () => {
    for (const { wall, placement } of accroches) {
      const axes = wallAxes(wall)
      const { position } = decompose(canvasMatrix(wall, placement))
      const u = position.clone().sub(axes.origin).dot(axes.along)
      expect(u).toBeCloseTo(placement.u, 6)
    }
  })

  it('pose chaque œuvre à `centerHeight` au-dessus du plancher DE SON NIVEAU', () => {
    for (const { wall, placement, elevation } of accroches) {
      const { position } = decompose(canvasMatrix(wall, placement))
      // La matrice est dans le repère du niveau : c'est le groupe de scène qui
      // porte l'élévation. Le test refait exactement ce que fait la scène.
      expect(position.y).toBeCloseTo(placement.centerHeight, 6)
      expect(position.y + elevation).toBeCloseTo(elevation + placement.centerHeight, 6)
    }
  })

  it('pose chaque œuvre DU CÔTÉ de `wall.normal`', () => {
    for (const { wall, placement } of accroches) {
      const { position } = decompose(canvasMatrix(wall, placement))
      const relatif = position.clone().sub(new THREE.Vector3(wall.a.x, 0, wall.a.z))
      // Projection sur la normale DÉCLARÉE, pas sur celle qu'on recalcule :
      // c'est le contrat du domaine qui décide où est l'intérieur de la salle.
      const cote = relatif.x * wall.normal.x + relatif.z * wall.normal.z
      expect(cote).toBeGreaterThan(0)
    }
  })
})

// ── Aucune œuvre ne traverse un mur ──────────────────────────────────────

describe('canvasMatrix — pas dans la maçonnerie, pas en lévitation', () => {
  it('laisse la toile DEVANT la face intérieure du mur', () => {
    for (const { wall, placement } of accroches) {
      const axes = wallAxes(wall)
      const { position } = decompose(canvasMatrix(wall, placement))
      const saillie = position.clone().sub(axes.origin).dot(axes.inward)

      // Le segment porte la face EXTÉRIEURE ; le mur occupe [0, WALL_THICKNESS]
      // le long de la normale. En deçà, l'œuvre est noyée dans le mur.
      expect(saillie).toBeGreaterThan(WALL_THICKNESS)
      expect(saillie).toBeCloseTo(CANVAS_OFFSET, 9)
    }
  })

  it('ne laisse pas la toile flotter au milieu de la salle', () => {
    // Une œuvre qui dépasserait de plus de quinze centimètres de la face du mur
    // ne serait plus un accrochage mais un panneau posé devant.
    for (const { wall, placement } of accroches) {
      const axes = wallAxes(wall)
      const { position } = decompose(canvasMatrix(wall, placement))
      const saillie = position.clone().sub(axes.origin).dot(axes.inward)
      expect(saillie - WALL_THICKNESS).toBeLessThan(0.15)
    }
  })

  it('garde le cadre entre la face du mur et la toile', () => {
    for (const { wall, placement } of accroches) {
      const axes = wallAxes(wall)
      const { position, echelle } = decompose(frameMatrix(wall, placement))
      const centre = position.clone().sub(axes.origin).dot(axes.inward)
      const dos = centre - echelle.z / 2
      const face = centre + echelle.z / 2

      // Le dos du cadre affleure la face intérieure du mur — ni encastré, ni
      // décollé — et sa face avant reste derrière le plan de la toile.
      expect(dos).toBeCloseTo(WALL_THICKNESS, 9)
      expect(face).toBeLessThanOrEqual(CANVAS_OFFSET + EPS)
      expect(centre).toBeCloseTo(FRAME_OFFSET, 9)
    }
  })

  it('tient chaque œuvre entre le plancher et le plafond de son mur', () => {
    for (const { wall, placement } of accroches) {
      const bas = placement.centerHeight - placement.height / 2 - FRAME_BORDER
      const haut = placement.centerHeight + placement.height / 2 + FRAME_BORDER
      expect(bas).toBeGreaterThan(0)
      expect(haut).toBeLessThan(wall.height)
    }
  })
})

// ── Aucune œuvre ne sort de son segment ──────────────────────────────────

describe('accrochage — chaque œuvre reste dans son segment', () => {
  it('tient les deux bords de la toile dans un segment utile du mur', () => {
    for (const { wall, placement } of accroches) {
      const segments = usableSegments(wall)
      const gauche = placement.u - placement.width / 2
      const droite = placement.u + placement.width / 2
      const contenu = segments.some((s) => gauche >= s.start - EPS && droite <= s.end + EPS)
      expect(contenu, `${wall.id} / ${placement.key}`).toBe(true)
    }
  })

  it('tient les deux bords du CADRE dans la longueur du mur', () => {
    // Le cadre déborde de la toile de `FRAME_BORDER` de chaque côté : la marge
    // d'angle de l'accrochage doit l'absorber, sinon un cadre dépasse à l'angle.
    for (const { wall, placement } of accroches) {
      const longueur = wallAxes(wall).length
      expect(placement.u - placement.width / 2 - FRAME_BORDER).toBeGreaterThan(0)
      expect(placement.u + placement.width / 2 + FRAME_BORDER).toBeLessThan(longueur)
    }
  })

  it('ne fait chevaucher aucun cadre sur un même mur', () => {
    const parMur = new Map<string, Placement[]>()
    for (const { wall, placement, floorId } of accroches) {
      const cle = `${floorId}/${wall.id}`
      const liste = parMur.get(cle)
      if (liste === undefined) parMur.set(cle, [placement])
      else liste.push(placement)
    }

    for (const [cle, liste] of parMur) {
      const spans = liste
        .map((p) => ({
          start: p.u - p.width / 2 - FRAME_BORDER,
          end: p.u + p.width / 2 + FRAME_BORDER,
        }))
        .sort((a, b) => a.start - b.start)
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].start, cle).toBeGreaterThanOrEqual(spans[i - 1].end - EPS)
      }
    }
  })
})

// ── Orientation ──────────────────────────────────────────────────────────

describe('canvasMatrix — orientation', () => {
  it('fait regarder la toile vers la salle', () => {
    for (const { wall, placement } of accroches) {
      const { face } = decompose(canvasMatrix(wall, placement))
      const normale = new THREE.Vector3(wall.normal.x, 0, wall.normal.z).normalize()
      // Le quad de `PlaneGeometry` regarde son +Z local : il doit coïncider avec
      // la normale intérieure. Un signe inversé rendrait la face arrière, donc
      // rien du tout avec un matériau `FrontSide`.
      expect(face.dot(normale)).toBeGreaterThan(1 - 1e-6)
    }
  })

  it('garde la toile parfaitement verticale', () => {
    for (const { wall, placement } of accroches) {
      const { haut, face } = decompose(canvasMatrix(wall, placement))
      expect(haut.dot(new THREE.Vector3(0, 1, 0))).toBeGreaterThan(1 - 1e-6)
      // La normale reste horizontale : une toile penchée serait un défaut
      // d'accrochage qu'aucune position ne révèle.
      expect(Math.abs(face.y)).toBeLessThan(EPS)
    }
  })

  it("n'affiche AUCUNE œuvre en miroir", () => {
    for (const { wall, placement } of accroches) {
      // Un repère indirect (déterminant négatif) retourne l'image de gauche à
      // droite. C'est le seul défaut de ce fichier qui ne déplace rien.
      expect(canvasMatrix(wall, placement).determinant()).toBeGreaterThan(0)
      const { droite, haut, face } = decompose(canvasMatrix(wall, placement))
      expect(new THREE.Vector3().crossVectors(droite, haut).dot(face)).toBeCloseTo(1, 9)
    }
  })

  it('donne au cadre exactement la même orientation que la toile', () => {
    for (const { wall, placement } of accroches) {
      const toile = decompose(canvasMatrix(wall, placement))
      const cadre = decompose(frameMatrix(wall, placement))
      expect(cadre.face.dot(toile.face)).toBeCloseTo(1, 9)
      expect(cadre.droite.dot(toile.droite)).toBeCloseTo(1, 9)
    }
  })
})

// ── Échelle ──────────────────────────────────────────────────────────────

describe('échelles', () => {
  it('donne à la toile exactement la taille décidée par le domaine', () => {
    for (const { wall, placement } of accroches) {
      const { echelle } = decompose(canvasMatrix(wall, placement))
      expect(echelle.x).toBeCloseTo(placement.width, 9)
      expect(echelle.y).toBeCloseTo(placement.height, 9)
      expect(echelle.z).toBeCloseTo(1, 9)
    }
  })

  it('donne au cadre une bordure CONSTANTE, quelle que soit la taille', () => {
    // Le point de la boîte unité mise à l'échelle en `w + 2b` : si la bordure
    // était multipliée au lieu d'être ajoutée, ce test verrait la marge varier
    // du simple au triple entre la plus petite et la plus grande œuvre.
    const marges = new Set<number>()
    for (const { wall, placement } of accroches) {
      const toile = decompose(canvasMatrix(wall, placement))
      const cadre = decompose(frameMatrix(wall, placement))
      const margeX = (cadre.echelle.x - toile.echelle.x) / 2
      const margeY = (cadre.echelle.y - toile.echelle.y) / 2
      expect(margeX).toBeCloseTo(FRAME_BORDER, 9)
      expect(margeY).toBeCloseTo(FRAME_BORDER, 9)
      expect(cadre.echelle.z).toBeCloseTo(FRAME_DEPTH, 9)
      marges.add(Math.round(margeX * 1e6))
    }
    expect(marges.size).toBe(1)
  })

  it('couvre bien des tailles d’œuvres différentes', () => {
    // Garde-fou du test précédent : une bordure constante sur des œuvres toutes
    // identiques ne prouverait rien.
    const largeurs = new Set(accroches.map(({ placement }) => Math.round(placement.width * 100)))
    expect(largeurs.size).toBeGreaterThan(1)
  })
})

// ── Cas dégénérés ────────────────────────────────────────────────────────

describe('wallAxes — robustesse', () => {
  it('renvoie un repère orthonormé DIRECT sur tous les murs du musée', () => {
    for (const floor of musee.floors) {
      for (const room of floor.rooms) {
        for (const wall of room.walls) {
          const { along, inward, length } = wallAxes(wall)
          if (length === 0) continue
          expect(along.length()).toBeCloseTo(1, 9)
          expect(inward.length()).toBeCloseTo(1, 9)
          expect(Math.abs(along.dot(inward))).toBeLessThan(EPS)
          // La normale recalculée doit pointer du même côté que celle déclarée.
          expect(inward.x * wall.normal.x + inward.z * wall.normal.z).toBeGreaterThan(0)
        }
      }
    }
  })

  it('ne lève pas sur un mur de longueur nulle', () => {
    const degenere: Wall = {
      id: 'nul',
      a: { x: 3, z: 3 },
      b: { x: 3, z: 3 },
      height: 3,
      kind: 'inner',
      normal: { x: 0, z: 1 },
      openings: [],
      placements: [],
    }
    const axes = wallAxes(degenere)
    expect(axes.length).toBe(0)
    expect(Number.isFinite(axes.along.x)).toBe(true)
    expect(Number.isFinite(axes.inward.z)).toBe(true)
  })
})

// ── Relevé du niveau ─────────────────────────────────────────────────────

describe('collectHangings', () => {
  it('relève toutes les œuvres du niveau, une fois chacune', () => {
    for (const floor of musee.floors) {
      const attendu = floor.rooms.reduce(
        (total, room) => total + room.walls.reduce((n, wall) => n + wall.placements.length, 0),
        0,
      )
      expect(collectHangings(floor).length).toBe(attendu)
    }
  })

  it('donne un identifiant unique à chaque accrochage du niveau', () => {
    // Une clé de dépôt seule ne suffirait pas : rien n'interdit à la curation
    // d'accrocher deux fois le même dépôt dans le bâtiment.
    for (const floor of musee.floors) {
      const ids = collectHangings(floor).map((h) => h.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('exprime le centre en coordonnées MONDE, élévation comprise', () => {
    for (const floor of musee.floors) {
      for (const hanging of collectHangings(floor)) {
        const local = new THREE.Vector3().setFromMatrixPosition(hanging.canvas)
        expect(hanging.centre.y).toBeCloseTo(local.y + floor.elevation, 9)
        expect(hanging.centre.x).toBeCloseTo(local.x, 9)
        expect(hanging.centre.z).toBeCloseTo(local.z, 9)
      }
    }
  })

  it('produit un relevé DÉTERMINISTE : deux appels, le même ordre', () => {
    for (const floor of musee.floors) {
      const a = collectHangings(floor).map((h) => `${h.id}:${h.layer}`)
      const b = collectHangings(floor).map((h) => `${h.id}:${h.layer}`)
      expect(a).toEqual(b)
    }
  })

  it('reporte la couche du placement sans la réinventer', () => {
    for (const floor of musee.floors) {
      const parId = new Map(collectHangings(floor).map((h) => [h.id, h]))
      for (const room of floor.rooms) {
        for (const wall of room.walls) {
          for (const placement of wall.placements) {
            const hanging = parId.get(`${wall.id}#${placement.key}`)
            expect(hanging?.layer).toBe(placement.layer)
            expect(hanging?.atlas).toBe(placement.atlas)
          }
        }
      }
    }
  })
})
