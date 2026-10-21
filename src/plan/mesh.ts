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
import { edges, guardrails, isNordSud, sameLine, subtract, type Interval, type Segment } from './geometry.ts'
import { contains, flightElevation, flightEnds, overlapArea } from './rules.ts'
import { EXT, INT } from './svg.ts'
import type { Flight, Opening, Plan, Rect } from './types.ts'
import { wallSegments } from './walk.ts'

/** Hauteur sous linteau : une porte est un trou de 2,40 m, le mur continue au-dessus. */
const LINTEAU = 2.4
/** Le parapet plâtré qui borde une trémie côté vide. */
const PARAPET = 1
const GARDE_CORPS = 1
/** Le verre du garde-corps : un feuilleté de 15 mm, posé 4 cm au-dessus du sol. */
const EP_VERRE = 0.015
const SABOT = 0.04
const PANNEAU_MAX = 1.5
const JOINT = 0.02
/** La main courante : un méplat d'acier de 5 × 4 cm. */
const MAIN_L = 0.05
const MAIN_H = 0.04
/** La main courante murale : à 7 cm du mur, 90 cm au-dessus des marches, une console tous les 1,20 m. */
const MAIN_MUR = 0.07
const MAIN_MUR_H = 0.9
const CONSOLE = 1.2
const EPS = 1e-6

/**
 * Les marches d'une volée, du bas vers le haut : pour chacune, l'intervalle
 * qu'elle couvre le long de la montée (en coordonnées du plan) et la cote de
 * son dessus. Les `risers` marches se partagent la volée à parts égales : le
 * dessus de la marche k est au haut de la rampe que suit `flightElevation` au
 * fond de la marche, si bien que le pied du visiteur n'est jamais au-dessus
 * d'une marche, et au plus une contremarche en dessous.
 */
function marches(f: Flight): { de: number; a: number; dessus: number; h: number }[] {
  const nordSud = isNordSud(f)
  const giron = (nordSud ? f.depth : f.width) / f.risers
  const h = (f.top - f.bottom) / f.risers
  return Array.from({ length: f.risers }, (_, k) => {
    const [u, v] = [k * giron, (k + 1) * giron]
    const [de, a] =
      f.direction === 'north' ? [f.z + f.depth - v, f.z + f.depth - u]
      : f.direction === 'south' ? [f.z + u, f.z + v]
      : f.direction === 'east' ? [f.x + u, f.x + v]
      : [f.x + f.width - v, f.x + f.width - u]
    return { de, a, dessus: f.bottom + (k + 1) * h, h }
  })
}

/** `r` moins `t` : au plus quatre rectangles, bandes nord et sud pleines, puis l'ouest et l'est de `t`. */
export function decouper(r: Rect, t: Rect): Rect[] {
  if (overlapArea(r, t) <= EPS) return [r]
  const [x0, x1, z0, z1] = [r.x, r.x + r.width, r.z, r.z + r.depth]
  const [tz0, tz1] = [Math.max(z0, t.z), Math.min(z1, t.z + t.depth)]
  const out: Rect[] = [
    { x: x0, z: z0, width: r.width, depth: tz0 - z0 },
    { x: x0, z: tz1, width: r.width, depth: z1 - tz1 },
    { x: x0, z: tz0, width: Math.max(x0, t.x) - x0, depth: tz1 - tz0 },
    { x: Math.min(x1, t.x + t.width), z: tz0, width: x1 - Math.min(x1, t.x + t.width), depth: tz1 - tz0 },
  ]
  return out.filter((m) => m.width > EPS && m.depth > EPS)
}

/** Boîte alignée. (x, y, z) est son CENTRE ; w court selon x, h selon y, d selon z. */
export interface Box {
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  kind: 'wall' | 'slab' | 'lintel' | 'step' | 'landing' | 'railing' | 'handrail' | 'glass'
  /**
   * Pente du dessus et du dessous le long du grand côté horizontal (x si w > d,
   * sinon z), en mètres par mètre : un garde-corps rampant. Les faces d'about
   * restent verticales — c'est un cisaillement, pas une rotation.
   */
  pente?: number
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

  // Une dalle par salle : à l'étage, le vide du hall n'en a pas. Une volée qui
  // arrive d'en dessous y perce sa trémie : la dalle se découpe autour.
  const tremies = plan.flights.filter((f) => Math.abs(f.top - level.elevation) < EPS && level.rooms.some((r) => overlapArea(r, f) > EPS))
  const out: Box[] = level.rooms.flatMap((r) =>
    tremies.reduce<Rect[]>((morceaux, t) => morceaux.flatMap((m) => decouper(m, t)), [r]).map((m) =>
      pave(m.x, m.x + m.width, level.elevation - plan.slab, level.elevation, m.z, m.z + m.depth, 'slab')))
  // Le long d'un mur, un bout de mur bouche l'épaisseur de dalle retirée ; côté
  // vide, un parapet plâtré d'un mètre. L'arrivée de la volée reste ouverte.
  for (const t of tremies) {
    const { top } = flightEnds(t)
    for (const e of edges(t)) {
      if (e.axis === 'x' ? Math.abs(top[1] - e.at) < EPS : Math.abs(top[0] - e.at) < EPS) continue
      const mur = level.rooms.some((r) => edges(r).some((m) => sameLine(m, e) && m.span[0] <= e.span[0] + EPS && m.span[1] >= e.span[1] - EPS))
      out.push(boite(e.axis, e.at, e.span[0], e.span[1], level.elevation - plan.slab, level.elevation + (mur ? 0 : PARAPET), 'wall'))
    }
  }

  const volees = plan.flights.filter((f) => bande(f.bottom))

  // Un garde-corps de 1,00 m au-dessus de la surface qu'il borde : des panneaux
  // de verre clair d'au plus 1,50 m, et une main courante continue par-dessus.
  // Le long d'une volée, les deux suivent sa pente d'un seul trait (`pente`),
  // comme un vrai garde-corps rampant, au lieu de gradins marche par marche.
  // guardrails() rend déjà la cote et le type de la surface portée (#27).
  const rails: Box[] = []
  const auSol: Segment[] = []
  /** Le garde-corps d'un segment, le sol passant de `y0` en `s` à `y1` en `t`. */
  const garde = (long: boolean, at: number, s: number, t: number, y0: number, y1: number) => {
    const pente = (y1 - y0) / (t - s)
    const sol = (u: number) => y0 + pente * (u - s)
    const le_long = (u: number, v: number, bas: number, h: number, ep: number, kind: Box['kind']): Box => {
      const y = sol((u + v) / 2) + bas + h / 2
      const b: Box = long
        ? { x: (u + v) / 2, y, z: at, w: v - u, h, d: ep, kind }
        : { x: at, y, z: (u + v) / 2, w: ep, h, d: v - u, kind }
      return pente === 0 ? b : { ...b, pente }
    }
    const n = Math.ceil((t - s) / PANNEAU_MAX - EPS)
    for (let i = 0; i < n; i++) {
      const [u, v] = [s + ((t - s) * i) / n, s + ((t - s) * (i + 1)) / n]
      rails.push(le_long(u + (i > 0 ? JOINT / 2 : 0), v - (i < n - 1 ? JOINT / 2 : 0), SABOT, GARDE_CORPS - SABOT - MAIN_H, EP_VERRE, 'railing'))
    }
    rails.push(le_long(s, t, GARDE_CORPS - MAIN_H, MAIN_H, MAIN_L, 'handrail'))
  }
  for (const g of guardrails(plan, levelId)) {
    const long = g.z1 === g.z2
    const [at, s, t] = long ? [g.z1, g.x1, g.x2] : [g.x1, g.z1, g.z2]
    if (g.kind === 'flight') {
      const [mx, mz] = [(g.x1 + g.x2) / 2, (g.z1 + g.z2) / 2]
      const f = volees.find((f) => contains(f, mx, mz) && (long ? !isNordSud(f) : isNordSud(f)))
      if (!f) throw new Error(`garde-corps de volée sans volée : ${JSON.stringify(g)}`)
      const cote = (u: number) => (long ? flightElevation(f, u, at) : flightElevation(f, at, u))
      garde(long, at, s, t, cote(s), cote(t))
      continue
    }
    if (Math.abs(g.elevation - level.elevation) < EPS) auSol.push(g)
    garde(long, at, s, t, g.elevation, g.elevation)
  }

  // Un garde-corps posé au plancher remplace le mur sur le vide (le bord d'un
  // balcon), une baie est vitrée : on les retire des murs, droite par droite.
  // Un garde-corps plus haut (le palier) laisse le mur de dessous entier.
  const baies = level.openings.filter((o) => o.kind === 'bay').map(poser).filter((b) => b !== null)
  // Une lucarne perce le mur à sa hauteur : le mur est retiré sur sa largeur, puis rebâti dessous et dessus.
  const lucarnes = level.openings.filter((o) => o.kind === 'lucarne').flatMap((o) => {
    const p = poser(o)
    return p ? [{ ...p, y0: o.cote ?? level.elevation, y1: (o.cote ?? level.elevation) + (o.hauteur ?? 1) }] : []
  })
  for (const m of wallSegments(plan, levelId, false)) {
    const axis = m.z1 === m.z2 ? 'x' : 'z'
    const [at, span]: [number, Interval] = axis === 'x' ? [m.z1, [m.x1, m.x2]] : [m.x1, [m.z1, m.z2]]
    const cuts: Interval[] = [
      ...auSol
        .filter((g) => (axis === 'x' ? g.z1 === g.z2 && Math.abs(g.z1 - at) < EPS : g.x1 === g.x2 && Math.abs(g.x1 - at) < EPS))
        .map((g): Interval => (axis === 'x' ? [g.x1, g.x2] : [g.z1, g.z2])),
      ...baies.filter((b) => b.axis === axis && Math.abs(b.at - at) < EPS).map((b): Interval => [b.s, b.t]),
      ...lucarnes.filter((b) => b.axis === axis && Math.abs(b.at - at) < EPS).map((b): Interval => [b.s, b.t]),
    ]
    for (const [s, t] of subtract(span, cuts)) out.push(boite(axis, at, s, t, level.elevation, haut, 'wall'))
  }
  for (const b of baies) out.push(boite(b.axis, b.at, b.s, b.t, level.elevation, haut, 'glass'))
  for (const l of lucarnes) out.push(
    boite(l.axis, l.at, l.s, l.t, level.elevation, l.y0, 'wall'),
    boite(l.axis, l.at, l.s, l.t, l.y1, haut, 'wall'),
  )

  for (const o of level.openings) {
    if (o.kind !== 'door' && o.kind !== 'entrance' && o.kind !== 'service') continue
    const p = poser(o)
    if (!p) continue
    // Une porte de palier : son seuil est au-dessus du plancher, le mur reste plein dessous.
    const seuil = o.cote ?? level.elevation
    if (seuil > level.elevation + EPS) out.push(boite(p.axis, p.at, p.s, p.t, level.elevation, seuil, 'wall'))
    out.push(boite(p.axis, p.at, p.s, p.t, seuil + (o.hauteur ?? LINTEAU), haut, 'lintel'))
  }

  for (const l of plan.landings.filter((l) => bande(l.elevation)))
    out.push(pave(l.x, l.x + l.width, l.elevation - plan.slab, l.elevation, l.z, l.z + l.depth, 'landing'))

  // Chaque marche pose sur sa part de paillasse : une dalle en escalier dessous,
  // faute de boîte inclinée. La première pose sur le sol ou le palier.
  for (const f of volees) {
    const nordSud = isNordSud(f)
    for (const { de, a, dessus, h } of marches(f)) {
      const [x0, x1, z0, z1] = nordSud ? [f.x, f.x + f.width, de, a] : [de, a, f.z, f.z + f.depth]
      out.push(pave(x0, x1, dessus - h, dessus, z0, z1, 'step'))
      if (dessus - h > f.bottom + EPS) out.push(pave(x0, x1, dessus - h - plan.slab, dessus - h, z0, z1, 'slab'))
    }
  }
  // Côté mur, une volée n'a pas de garde-corps : une main courante scellée au
  // mur, à 90 cm au-dessus du nez des marches, sur des consoles tous les 1,20 m.
  for (const f of volees) {
    // Pas les salles d'un étage tout entier sous la volée : leurs murs n'y montent pas.
    const salles = plan.levels.filter((l) => l.elevation + plan.storey >= f.bottom - EPS).flatMap((l) => l.rooms.filter((r) => r.kind !== 'balcony'))
    const nordSud = isNordSud(f)
    const [s, t] = nordSud ? [f.z, f.z + f.depth] : [f.x, f.x + f.width]
    const cotes = nordSud ? [f.x, f.x + f.width] : [f.z, f.z + f.depth]
    for (const at of cotes) {
      // Le côté longe un mur si une salle (pas un balcon) a une arête sur cette droite, en face de la volée.
      const mur = salles.some((r) => nordSud
        ? [r.x, r.x + r.width].some((x) => Math.abs(x - at) < EPS) && r.z < t - EPS && r.z + r.depth > s + EPS
        : [r.z, r.z + r.depth].some((z) => Math.abs(z - at) < EPS) && r.x < t - EPS && r.x + r.width > s + EPS)
      if (!mur) continue
      const dedans = at === cotes[0] ? 1 : -1
      const axe = at + dedans * (INT + MAIN_MUR)
      const sol = (u: number) => (nordSud ? flightElevation(f, axe, u) : flightElevation(f, u, axe))
      const pente = (sol(t) - sol(s)) / (t - s)
      const y = (sol(s) + sol(t)) / 2 + MAIN_MUR_H
      out.push(nordSud
        ? { x: axe, y, z: (s + t) / 2, w: MAIN_L, h: MAIN_H, d: t - s, kind: 'handrail', pente }
        : { x: (s + t) / 2, y, z: axe, w: t - s, h: MAIN_H, d: MAIN_L, kind: 'handrail', pente })
      const n = Math.ceil((t - s) / CONSOLE)
      for (let i = 0; i <= n; i++) {
        const u = s + 0.15 + ((t - s - 0.3) * i) / n
        const [c, ep] = [at + dedans * (INT + MAIN_MUR / 2), MAIN_MUR]
        const yc = sol(u) + MAIN_MUR_H - MAIN_H / 2 - 0.02
        out.push(nordSud
          ? { x: c, y: yc, z: u, w: ep, h: 0.03, d: 0.02, kind: 'handrail' }
          : { x: u, y: yc, z: c, w: 0.02, h: 0.03, d: ep, kind: 'handrail' })
      }
    }
  }
  out.push(...rails)
  return out
}
