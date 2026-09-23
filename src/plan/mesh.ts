/**
 * L'extrusion d'un niveau en boîtes, sans three.
 *
 * Le plan est fait de rectangles alignés : ses murs, linteaux et dalles sont des
 * parallélépipèdes alignés aussi. On les calcule ici, en nombres, pour que les
 * portes ouvertes se vérifient par un test ; la scène ne fait qu'instancier.
 *
 * Un niveau porte aussi ce qui PART de son plancher sans atteindre le suivant :
 * au rez-de-chaussée, le palier et les trois volées de l'escalier impérial.
 */
import { guardrails, subtract, type Interval } from './geometry.ts'
import { EXT, INT } from './svg.ts'
import type { Flight, Opening, Plan, Rect } from './types.ts'
import { wallSegments } from './walk.ts'

/** Hauteur sous linteau : une porte est un trou de 2,40 m, le mur continue au-dessus. */
const LINTEAU = 2.4
const GARDE_CORPS = 1
const EP_GARDE_CORPS = 0.05
const EPS = 1e-6

const contient = (r: Rect, x: number, z: number) =>
  x >= r.x - EPS && x <= r.x + r.width + EPS && z >= r.z - EPS && z <= r.z + r.depth + EPS

/**
 * Les marches d'une volée, du bas vers le haut : pour chacune, l'intervalle
 * qu'elle couvre le long de la montée (en coordonnées du plan) et la cote de
 * son dessus. Le nez de la marche k est à k·g du départ, g = run / (risers − 1)
 * comme pour Blondel ; la première et la dernière n'ont qu'un demi-giron, pour
 * que les 15 marches tiennent entre le départ et l'arrivée.
 */
function marches(f: Flight): { de: number; a: number; dessus: number }[] {
  const nordSud = f.direction === 'north' || f.direction === 'south'
  const run = nordSud ? f.depth : f.width
  const g = run / (f.risers - 1)
  const h = (f.top - f.bottom) / f.risers
  return Array.from({ length: f.risers }, (_, k) => {
    const [u, v] = [Math.max(0, (k - 0.5) * g), Math.min(run, (k + 0.5) * g)]
    const [de, a] =
      f.direction === 'north' ? [f.z + f.depth - v, f.z + f.depth - u]
      : f.direction === 'south' ? [f.z + u, f.z + v]
      : f.direction === 'east' ? [f.x + u, f.x + v]
      : [f.x + f.width - v, f.x + f.width - u]
    return { de, a, dessus: f.bottom + (k + 1) * h }
  })
}

/** Boîte alignée. (x, y, z) est son CENTRE ; w court selon x, h selon y, d selon z. */
export interface Box {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  kind: 'wall' | 'slab' | 'lintel' | 'step' | 'landing' | 'railing' | 'glass'
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

  const bande = (e: number) => e >= level.elevation - EPS && e < level.elevation + plan.storey - EPS
  /** Une boîte alignée, par ses bornes. */
  const pave = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: Box['kind']): Box =>
    ({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, kind })
  /** Une ouverture est centrée sur une arête de sa salle : verticale si c'est l'ouest ou l'est. */
  const poser = (o: Opening) => {
    const r = level.rooms.find((s) => s.id === o.a)
    if (!r) return null
    const vertical = Math.abs(o.x - r.x) < EPS || Math.abs(o.x - r.x - r.width) < EPS
    const [at, c] = vertical ? [o.x, o.z] : [o.z, o.x]
    return { axis: vertical ? 'z' as const : 'x' as const, at, s: c - o.width / 2, t: c + o.width / 2 }
  }

  // Une dalle par salle : à l'étage, le vide du hall n'en a pas.
  const out: Box[] = level.rooms.map((r) =>
    pave(r.x, r.x + r.width, level.elevation - plan.slab, level.elevation, r.z, r.z + r.depth, 'slab'))

  // Les garde-corps remplacent les murs sur le vide (le bord d'un balcon), une
  // baie est vitrée : on les retire des murs, droite par droite.
  const rails = guardrails(plan, levelId)
  const baies = level.openings.filter((o) => o.kind === 'bay').map(poser).filter((b) => b !== null)
  for (const m of wallSegments(plan, levelId, false)) {
    const axis = m.z1 === m.z2 ? 'x' : 'z'
    const [at, span]: [number, Interval] = axis === 'x' ? [m.z1, [m.x1, m.x2]] : [m.x1, [m.z1, m.z2]]
    const cuts: Interval[] = [
      ...rails
        .filter((g) => (axis === 'x' ? g.z1 === g.z2 && Math.abs(g.z1 - at) < EPS : g.x1 === g.x2 && Math.abs(g.x1 - at) < EPS))
        .map((g): Interval => (axis === 'x' ? [g.x1, g.x2] : [g.z1, g.z2])),
      ...baies.filter((b) => b.axis === axis && Math.abs(b.at - at) < EPS).map((b): Interval => [b.s, b.t]),
    ]
    for (const [s, t] of subtract(span, cuts)) out.push(boite(axis, at, s, t, level.elevation, haut, 'wall'))
  }
  for (const b of baies) out.push(boite(b.axis, b.at, b.s, b.t, level.elevation, haut, 'glass'))

  for (const o of level.openings) {
    if (o.kind !== 'door' && o.kind !== 'entrance') continue
    const p = poser(o)
    if (p) out.push(boite(p.axis, p.at, p.s, p.t, level.elevation + LINTEAU, haut, 'lintel'))
  }

  for (const l of plan.landings.filter((l) => bande(l.elevation)))
    out.push(pave(l.x, l.x + l.width, l.elevation - plan.slab, l.elevation, l.z, l.z + l.depth, 'landing'))

  // Chaque marche pose sur sa part de paillasse : une dalle en escalier dessous,
  // faute de boîte inclinée. La première pose sur le sol ou le palier.
  const volees = plan.flights.filter((f) => bande(f.bottom))
  for (const f of volees) {
    const h = (f.top - f.bottom) / f.risers
    const nordSud = f.direction === 'north' || f.direction === 'south'
    for (const { de, a, dessus } of marches(f)) {
      const [x0, x1, z0, z1] = nordSud ? [f.x, f.x + f.width, de, a] : [de, a, f.z, f.z + f.depth]
      out.push(pave(x0, x1, dessus - h, dessus, z0, z1, 'step'))
      if (dessus - h > f.bottom + EPS) out.push(pave(x0, x1, dessus - h - plan.slab, dessus - h, z0, z1, 'slab'))
    }
  }

  // Un garde-corps de 1,00 m au-dessus de la surface qu'il borde ; le long d'une
  // volée, il suit ses marches, par gradins.
  const e = EP_GARDE_CORPS / 2
  for (const g of rails) {
    const long = g.z1 === g.z2
    const [mx, mz] = [(g.x1 + g.x2) / 2, (g.z1 + g.z2) / 2]
    const f = volees.find((f) => contient(f, mx, mz) && (long ? f.direction === 'east' || f.direction === 'west' : f.direction === 'north' || f.direction === 'south'))
    if (f) {
      const [s, t] = long ? [g.x1, g.x2] : [g.z1, g.z2]
      for (const { de, a, dessus } of marches(f)) {
        const [u, v] = [Math.max(s, de), Math.min(t, a)]
        if (v - u < EPS) continue
        const y0 = dessus - (f.top - f.bottom) / f.risers
        out.push(long ? pave(u, v, y0, dessus + GARDE_CORPS, g.z1 - e, g.z1 + e, 'railing') : pave(g.x1 - e, g.x1 + e, y0, dessus + GARDE_CORPS, u, v, 'railing'))
      }
      continue
    }
    const cote =
      plan.landings.find((l) => bande(l.elevation) && contient(l, mx, mz))?.elevation ??
      plan.levels.find((l) => bande(l.elevation) && l.rooms.some((r) => r.kind === 'balcony' && contient(r, mx, mz)))?.elevation
    if (cote === undefined) continue
    out.push(long
      ? pave(g.x1, g.x2, cote, cote + GARDE_CORPS, g.z1 - e, g.z1 + e, 'railing')
      : pave(g.x1 - e, g.x1 + e, cote, cote + GARDE_CORPS, g.z1, g.z2, 'railing'))
  }
  return out
}
