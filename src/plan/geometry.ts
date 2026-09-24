/**
 * Ce que le plan implique sans le dire : les garde-corps.
 *
 * Toute surface en hauteur — balcon, palier, volée — est bordée de garde-corps
 * partout où elle ne touche ni un mur, ni une autre surface de même cote, ni le
 * départ ou l'arrivée d'une volée. On ne les dessine pas à la main : oublier
 * d'en ouvrir un devant une volée, c'est exactement le défaut qui a rendu
 * l'ancien escalier inaccessible. Le plan SVG et la 3D les lisent ici.
 */
import { flightEnds } from './rules.ts'
import type { Flight, Plan, Rect } from './types.ts'

export interface Segment {
  x1: number
  z1: number
  x2: number
  z2: number
}

/**
 * Un segment de garde-corps : `guardrails()` connaît déjà, au moment de le
 * construire, la surface qu'il borde et sa cote (#27) — il les rend avec le
 * segment plutôt que de laisser l'appelant les redeviner par le milieu.
 */
export interface GuardrailSegment extends Segment {
  /** Cote de la surface que ce segment borde (le palier, le balcon, la volée). */
  elevation: number
  /** `'flight'` : suit les marches d'une volée, en gradins. `'flat'` : rampe plane (palier, balcon). */
  kind: 'flight' | 'flat'
}

export type Interval = [number, number]
export type Edge = { axis: 'x' | 'z'; at: number; span: Interval }

const EPS = 1e-6

/** Une volée court-elle nord-sud (vs est-ouest) ? #28 : un seul point de vérité. */
export function isNordSud(f: Flight): boolean {
  return f.direction === 'north' || f.direction === 'south'
}

export function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let out: Interval[] = [base]
  for (const [a, b] of cuts)
    out = out.flatMap(([s, e]): Interval[] =>
      b <= s || a >= e ? [[s, e]] : ([[s, a], [b, e]] as Interval[]).filter(([u, v]) => v - u > EPS))
  return out
}

/** Les quatre arêtes d'un rectangle : `axis` est la direction de l'arête. */
export function edges(r: Rect): Edge[] {
  return [
    { axis: 'x', at: r.z, span: [r.x, r.x + r.width] },
    { axis: 'x', at: r.z + r.depth, span: [r.x, r.x + r.width] },
    { axis: 'z', at: r.x, span: [r.z, r.z + r.depth] },
    { axis: 'z', at: r.x + r.width, span: [r.z, r.z + r.depth] },
  ]
}

export const sameLine = (a: Edge, b: Edge) => a.axis === b.axis && Math.abs(a.at - b.at) < EPS

/**
 * Garde-corps des surfaces en hauteur dont la cote de départ tombe dans le
 * niveau `levelId` (du plancher inclus au plancher suivant exclu).
 */
export function guardrails(plan: Plan, levelId: number): GuardrailSegment[] {
  const level = plan.levels.find((l) => l.id === levelId)
  if (!level) return []
  const inLevel = (e: number) => e >= level.elevation - EPS && e < level.elevation + plan.storey - EPS

  const hautes: { rect: Rect; elevation: number; ends: Edge[]; kind: GuardrailSegment['kind'] }[] = []
  for (const l of plan.levels)
    for (const r of l.rooms) if (r.kind === 'balcony') hautes.push({ rect: r, elevation: l.elevation, ends: [], kind: 'flat' })
  for (const l of plan.landings) hautes.push({ rect: l, elevation: l.elevation, ends: [], kind: 'flat' })
  for (const f of plan.flights) {
    const [n, s, w, e] = edges(f)
    hautes.push({ rect: f, elevation: f.bottom, ends: isNordSud(f) ? [n, s] : [w, e], kind: 'flight' })
  }

  // Les murs : les arêtes des salles qui ne sont pas des balcons, à tout niveau.
  // ponytail: un mur est supposé continu sur toute la hauteur, vrai pour ce bâtiment.
  const murs = plan.levels.flatMap((l) => l.rooms.filter((r) => r.kind !== 'balcony').flatMap(edges))

  const out: GuardrailSegment[] = []
  for (const h of hautes) {
    if (!inLevel(h.elevation)) continue
    for (const e of edges(h.rect)) {
      if (h.ends.some((x) => sameLine(x, e))) continue
      const cuts: Interval[] = []
      for (const m of murs) if (sameLine(m, e)) cuts.push(m.span)
      // Surfaces voisines de même cote, et bouts de volées posés sur cette arête.
      for (const o of hautes) {
        if (o === h) continue
        for (const f of edges(o.rect)) {
          if (!sameLine(f, e)) continue
          if (Math.abs(o.elevation - h.elevation) < EPS && !o.ends.length) cuts.push(f.span)
          if (o.ends.some((x) => sameLine(x, f))) cuts.push(f.span)
        }
      }
      for (const f of plan.flights) {
        const { top } = flightEnds(f)
        if (Math.abs(f.top - h.elevation) > EPS) continue
        const onLine = e.axis === 'x' ? Math.abs(top[1] - e.at) < EPS : Math.abs(top[0] - e.at) < EPS
        if (onLine) cuts.push(e.axis === 'x' ? [f.x, f.x + f.width] : [f.z, f.z + f.depth])
      }
      for (const [s, t] of subtract(e.span, cuts))
        out.push(e.axis === 'x'
          ? { x1: s, z1: e.at, x2: t, z2: e.at, elevation: h.elevation, kind: h.kind }
          : { x1: e.at, z1: s, x2: e.at, z2: t, elevation: h.elevation, kind: h.kind })
    }
  }
  return out
}
