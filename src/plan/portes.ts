/**
 * L'habillage des portes : chambranles de pierre, embrasures, noms des salles.
 *
 * Comme à Orsay ou au Louvre, chaque porte est encadrée sur ses deux faces
 * d'une architrave moulurée qui pose sur deux plinthes (modèle
 * `tools/blender/build-chambranle.py`). Côté nef et balcons, un entablement la
 * coiffe et porte, en lettres de bronze, le nom de la salle où l'on entre.
 * L'embrasure — l'épaisseur du mur vue en passant — est doublée de pierre.
 *
 * Tout reste HORS du passage : les pièces sont posées sur la face du mur, de
 * part et d'autre de la baie ; seule la doublure de l'embrasure (2 cm) empiète
 * sur l'ouverture, et la marche (`walk.ts`) ne lit que le plan.
 *
 * Côté salle d'honneur, ses deux portes sont laissées telles quelles : la voûte
 * Batlló a ses propres baies. Leur face côté galerie est encadrée comme les
 * autres — sans quoi c'étaient les deux seules portes de galerie en simple trou.
 * Pur : ni three ni React.
 */
import type { Box } from './mesh.ts'
import { EXT, INT } from './svg.ts'
import type { Opening, Plan, Room } from './types.ts'

/** Sous linteau (`LINTEAU` de `mesh.ts`). */
export const LINTEAU = 2.4
/** Largeur de l'architrave, hauteur et largeur de la plinthe (`build-chambranle.py`). */
export const ARCHITRAVE = 0.22
export const PLINTHE = { h: 0.32, l: ARCHITRAVE + 0.03 }
/** La frise de l'entablement, où l'on grave le nom, et sa saillie. */
export const FRISE = { h: 0.36, saillie: 0.035 }
/** La doublure de pierre de l'embrasure. */
export const DOUBLURE = 0.02
/** Le parement de pierre du hall (`parement.ts`) épaissit le mur côté nef. */
const PEAU = 0.03
const EPS = 1e-6

export type NomPiece = 'Chambranle' | 'Entablement' | 'Plinthe'

/** Une pièce du modèle, posée : son origine au pied de la face, +z local sortant du mur. */
export interface Piece {
  nom: NomPiece
  x: number
  y: number
  z: number
  /** Rotation autour de y qui tourne le +z local vers la salle. */
  lacet: number
  /** Largeur de la baie : le chambranle et l'entablement s'élargissent. */
  largeur: number
}

/** Le nom d'une salle, gravé sur la frise au-dessus de sa porte, côté nef. */
export interface Enseigne {
  salle: string
  level: number
  x: number
  y: number
  z: number
  lacet: number
  /** Longueur de la frise, que le texte ne doit pas dépasser. */
  longueur: number
}

export interface Portes {
  pieces: Piece[]
  embrasures: Box[]
  enseignes: Enseigne[]
}

const nef = (r: Room | undefined) => r?.kind === 'hall' || r?.kind === 'balcony'

export function portes(plan: Plan): Portes {
  const out: Portes = { pieces: [], embrasures: [], enseignes: [] }
  for (const level of plan.levels) {
    const salle = (id: string | null) => level.rooms.find((r) => r.id === id)
    for (const o of level.openings) {
      if (o.kind !== 'door' && o.kind !== 'entrance') continue
      const honneur = [salle(o.a), salle(o.b)].find((r) => r?.kind === 'honneur')
      habiller(plan, level.elevation, level.id, o, salle(o.a)!, salle(o.b), out, honneur)
    }
  }
  return out
}

/** `sauf` : la salle dont la face reste nue, et l'embrasure avec (la salle d'honneur). */
function habiller(plan: Plan, y: number, levelId: number, o: Opening, a: Room, b: Room | undefined, out: Portes, sauf?: Room) {
  // Une ouverture est centrée sur une arête de sa salle : sur x = cte si c'est l'ouest ou l'est.
  const vertical = Math.abs(o.x - a.x) < EPS || Math.abs(o.x - a.x - a.width) < EPS
  const at = vertical ? o.x : o.z
  const centreA = vertical ? a.x + a.width / 2 : a.z + a.depth / 2
  const versA = Math.sign(centreA - at)
  const perimetre = Math.abs(at) < EPS || Math.abs(at - (vertical ? plan.width : plan.depth)) < EPS
  /** Un point du plan : `u` le long du mur, `v` à travers. */
  const point = (u: number, v: number): [number, number] => (vertical ? [v, u] : [u, v])
  const c = vertical ? o.z : o.x

  // Les deux faces finies du mur, côté a et côté b (dehors, pour l'entrée).
  const faces = [
    { sens: versA, salle: a, face: at + versA * (INT + (nef(a) ? PEAU : 0)) },
    { sens: -versA, salle: b, face: at - versA * (perimetre ? EXT : INT + (nef(b) ? PEAU : 0)) },
  ]
  for (const { sens, salle, face } of faces) {
    if (salle === undefined || salle === sauf) continue // l'entrée : dehors, c'est le portique (facade.ts)
    const [nx, nz] = point(0, sens)
    const lacet = Math.atan2(nx, nz)
    const poser = (nom: NomPiece, u = c): Piece => {
      const [px, pz] = point(u, face)
      return { nom, x: px, y, z: pz, lacet, largeur: o.width }
    }
    const decale = o.width / 2 + PLINTHE.l / 2
    out.pieces.push(poser('Chambranle'), poser('Plinthe', c - decale), poser('Plinthe', c + decale))
    if (!nef(salle)) continue
    out.pieces.push(poser('Entablement'))
    // L'autre salle : celle où mène la porte. L'entrée ne mène qu'au dehors.
    const mene = salle === a ? b : a
    if (mene !== undefined && o.kind === 'door') {
      const [ex, ez] = point(c, face + sens * (FRISE.saillie + 0.003))
      out.enseignes.push({
        salle: mene.id, level: levelId, x: ex, y: y + LINTEAU + ARCHITRAVE + FRISE.h / 2, z: ez, lacet,
        longueur: o.width + 2 * ARCHITRAVE,
      })
    }
  }

  if (sauf) return
  // L'embrasure : deux joues et une sous-face de pierre, d'une face finie à l'autre.
  const [v0, v1] = [Math.min(faces[0].face, faces[1].face), Math.max(faces[0].face, faces[1].face)]
  const pave = (u0: number, u1: number, y0: number, y1: number): Box => {
    const [x0, z0] = point(u0, v0)
    const [x1, z1] = point(u1, v1)
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, kind: 'wall' }
  }
  const [s, t] = [c - o.width / 2, c + o.width / 2]
  out.embrasures.push(
    pave(s, s + DOUBLURE, y, y + LINTEAU - DOUBLURE),
    pave(t - DOUBLURE, t, y, y + LINTEAU - DOUBLURE),
    pave(s, t, y + LINTEAU - DOUBLURE, y + LINTEAU),
  )
}
