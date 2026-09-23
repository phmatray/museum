/**
 * L'extrusion d'un niveau en boîtes, sans three.
 *
 * Le plan est fait de rectangles alignés : ses murs, linteaux et dalles sont des
 * parallélépipèdes alignés aussi. On les calcule ici, en nombres, pour que les
 * portes ouvertes se vérifient par un test ; la scène ne fait qu'instancier.
 */
import { EXT, INT } from './svg.ts'
import type { Plan } from './types.ts'
import { wallSegments } from './walk.ts'

/** Hauteur sous linteau : une porte est un trou de 2,40 m, le mur continue au-dessus. */
const LINTEAU = 2.4

/** Boîte alignée. (x, y, z) est son CENTRE ; w court selon x, h selon y, d selon z. */
export interface Box {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  kind: 'wall' | 'slab' | 'lintel'
}

export function meshLevel(plan: Plan, levelId: number): Box[] {
  const level = plan.levels.find((l) => l.id === levelId)
  if (!level) return []
  const haut = level.elevation + plan.storey - plan.slab

  // Un mur sur la droite `at`, de `s` à `t`, entre `y0` et `y1`. La façade (le
  // périmètre) déborde de EXT dehors et de INT dedans, comme sur le plan SVG ;
  // une cloison fait ±INT. Aux coins de l'emprise, on prolonge de EXT pour
  // fermer l'angle extérieur que les deux façades laisseraient vide.
  const boite = (axis: 'x' | 'z', at: number, s: number, t: number, y0: number, y1: number, kind: Box['kind']): Box => {
    const [long, large] = axis === 'x' ? [plan.width, plan.depth] : [plan.depth, plan.width]
    const [a, b] = Math.abs(at) < 1e-6 ? [-EXT, INT] : Math.abs(at - large) < 1e-6 ? [-INT, EXT] : [-INT, INT]
    if (Math.abs(s) < 1e-6) s = -EXT
    if (Math.abs(t - long) < 1e-6) t = long + EXT
    const [c, l, e, ep] = [(s + t) / 2, t - s, at + (a + b) / 2, b - a]
    const y = { y: (y0 + y1) / 2, h: y1 - y0, kind }
    return axis === 'x' ? { x: c, z: e, w: l, d: ep, ...y } : { x: e, z: c, w: ep, d: l, ...y }
  }

  const out: Box[] = [
    { x: plan.width / 2, y: level.elevation - plan.slab / 2, z: plan.depth / 2, w: plan.width, h: plan.slab, d: plan.depth, kind: 'slab' },
  ]
  // ponytail: les arêtes des balcons deviennent des murs pleine hauteur ; à exclure quand l'étage sera extrudé.
  for (const m of wallSegments(plan, levelId, false))
    out.push(m.z1 === m.z2
      ? boite('x', m.z1, m.x1, m.x2, level.elevation, haut, 'wall')
      : boite('z', m.x1, m.z1, m.z2, level.elevation, haut, 'wall'))

  for (const o of level.openings) {
    if (o.kind !== 'door' && o.kind !== 'entrance') continue
    const r = level.rooms.find((s) => s.id === o.a)
    if (!r) continue
    // L'ouverture est centrée sur une arête de sa salle : verticale si c'est l'ouest ou l'est.
    const vertical = Math.abs(o.x - r.x) < 1e-6 || Math.abs(o.x - r.x - r.width) < 1e-6
    const [at, c] = vertical ? [o.x, o.z] : [o.z, o.x]
    out.push(boite(vertical ? 'z' : 'x', at, c - o.width / 2, c + o.width / 2, level.elevation + LINTEAU, haut, 'lintel'))
  }
  return out
}
