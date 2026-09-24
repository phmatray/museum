/**
 * La visite guidée du plan (#31) : l'ordre des salles et le chemin pour y aller.
 *
 * Le chemin n'est pas une spline qui traverse le bâtiment : c'est une suite de
 * points de passage que le visiteur rejoint À PIED, par le même `step()` que le
 * clavier. Les points sont posés de part et d'autre de chaque porte et au-delà
 * des bouts de chaque volée, si bien qu'entre deux points consécutifs on reste
 * dans une même surface rectangulaire : la ligne droite y est sûre, et un mur
 * qui se mettrait en travers arrêterait le visiteur au lieu d'être traversé.
 *
 * Pur : ni three ni React.
 */
import { exposedRooms } from './hang.ts'
import { PASSABLE, flightEnds, surfaceAt } from './rules.ts'
import type { Plan, Rect } from './types.ts'

export interface TourStop {
  roomId: string
  level: number
  name: string
  /** Points de passage depuis l'arrêt précédent (ou l'apparition) ; le dernier est le centre de la salle. */
  points: [number, number][]
}

/** Où l'on en est : l'arrêt visé et le prochain de ses points. */
export interface Curseur {
  stop: number
  point: number
}

/** Distance de part et d'autre d'une porte, et au-delà du bout d'une volée. */
const DEGAGEMENT = 0.8
const AU_BOUT = 1
/** Un point est atteint à moins de 10 cm : un pas de marche fait 1,5 cm. */
const ATTEINT = 0.1

const centre = (r: Rect): [number, number] => [r.x + r.width / 2, r.z + r.depth / 2]

/** Le cap qui regarde de (x, z) vers la cible : l'avant est −z tourné du lacet. */
export const capVers = (w: { x: number; z: number }, x: number, z: number) => Math.atan2(-(x - w.x), -(z - w.z))

/** Les passages entre surfaces : portes et volées, avec leurs points dans le sens a → b. */
function passages(plan: Plan): Map<string, { vers: string; points: [number, number][] }[]> {
  const g = new Map<string, { vers: string; points: [number, number][] }[]>()
  const lier = (a: string, b: string, points: [number, number][]) => {
    g.set(a, [...(g.get(a) ?? []), { vers: b, points }])
    g.set(b, [...(g.get(b) ?? []), { vers: a, points: [...points].reverse() }])
  }
  for (const level of plan.levels)
    for (const o of level.openings) {
      if (!PASSABLE.has(o.kind) || !o.b) continue
      const a = level.rooms.find((r) => r.id === o.a)!
      const [ax, az] = centre(a)
      // Mur vertical (x constant) si la porte est sur un bord est ou ouest de `a`.
      const vertical = Math.abs(o.x - a.x) < 1e-6 || Math.abs(o.x - a.x - a.width) < 1e-6
      const s = vertical ? Math.sign(ax - o.x) : Math.sign(az - o.z)
      const cote = (k: number): [number, number] => vertical ? [o.x + k * DEGAGEMENT, o.z] : [o.x, o.z + k * DEGAGEMENT]
      lier(`${level.id}:${o.a}`, `${level.id}:${o.b}`, [cote(s), cote(-s)])
    }
  for (const f of plan.flights) {
    const { bottom: [bx, bz], top: [tx, tz] } = flightEnds(f)
    const l = Math.hypot(tx - bx, tz - bz)
    const [ux, uz] = [(tx - bx) / l, (tz - bz) / l]
    const bas = surfaceAt(plan, bx, bz, f.bottom)
    const haut = surfaceAt(plan, tx, tz, f.top)
    if (bas && haut) lier(bas, haut, [[bx - ux * AU_BOUT, bz - uz * AU_BOUT], [tx + ux * AU_BOUT, tz + uz * AU_BOUT]])
  }
  return g
}

/** Le plus court chemin en nombre de passages, comme une liste de points. */
function chemin(g: ReturnType<typeof passages>, de: string, a: string): [number, number][] | null {
  const venu = new Map<string, { de: string; points: [number, number][] } | null>([[de, null]])
  const file = [de]
  while (file.length) {
    const n = file.shift()!
    if (n === a) break
    for (const e of g.get(n) ?? []) if (!venu.has(e.vers)) { venu.set(e.vers, { de: n, points: e.points }); file.push(e.vers) }
  }
  if (!venu.has(a)) return null
  const out: [number, number][] = []
  for (let n = a, v = venu.get(n); v; n = v.de, v = venu.get(n)) out.unshift(...v.points)
  return out
}

/**
 * L'itinéraire : depuis le point d'apparition, toujours la salle exposée la
 * plus proche (en passages) qu'on n'a pas encore vue, à égalité dans l'ordre
 * du plan. Le rez-de-chaussée se fait en anneau, puis l'escalier impérial
 * monte à l'étage noble et à la salle d'honneur.
 */
export function buildTourItinerary(plan: Plan): TourStop[] {
  const g = passages(plan)
  const start = surfaceAt(plan, plan.spawn.x, plan.spawn.z, plan.levels.find((l) => l.id === plan.spawn.level)!.elevation)
  if (!start) throw new Error("le point d'apparition n'est sur aucune surface")
  const reste = exposedRooms(plan)
  const out: TourStop[] = []
  let ici = start
  while (reste.length) {
    let meilleur: { i: number; points: [number, number][] } | null = null
    reste.forEach(({ room, level }, i) => {
      const p = chemin(g, ici, `${level.id}:${room.id}`)
      if (p && (!meilleur || p.length < meilleur.points.length)) meilleur = { i, points: p }
    })
    if (!meilleur) throw new Error(`salles inatteignables : ${reste.map((r) => r.room.id).join(', ')}`)
    const { i, points } = meilleur as { i: number; points: [number, number][] }
    const [{ room, level }] = reste.splice(i, 1)
    out.push({ roomId: room.id, level: level.id, name: room.name, points: [...points, centre(room)] })
    ici = `${level.id}:${room.id}`
  }
  return out
}

/** Saute les points déjà atteints de l'arrêt courant ; `point === points.length` : arrivé. */
export function avancer(stops: TourStop[], c: Curseur, w: { x: number; z: number }): Curseur {
  const pts = stops[c.stop]?.points ?? []
  let point = c.point
  while (point < pts.length && Math.hypot(pts[point][0] - w.x, pts[point][1] - w.z) < ATTEINT) point++
  return { stop: c.stop, point }
}
