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
import { BELVEDERE, HAUT_DE_LA_VOLEE_OUEST, HAUT_DE_L_ESCALIER, PIED_DE_LA_VOLEE_OUEST, PIED_DE_L_ESCALIER, POINT_DE_VUE } from './belvedere.ts'
import { SEUIL_CHANTIER } from './chantier.ts'
import { OBSTACLES_PORTIQUE } from './facade.ts'
import { exposedRooms } from './hang.ts'
import { contourner } from './mobilier.ts'
import { MUSEE } from './musee.ts'
import { PARC, PASSABLE, flightEnds, surfaceAt } from './rules.ts'
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
export function passages(plan: Plan): Map<string, { vers: string; points: [number, number][] }[]> {
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

type Point = [number, number]
type Graphe = ReturnType<typeof passages>

/** Les passages de la visite, plus l'entrée : du hall au parc, au-delà du portique (Bavette, et le dernier arrêt de la visite). */
export function grapheEtEntree(plan: Plan): Graphe {
  const g = passages(plan)
  const lier = (a: string, b: string, points: [number, number][]) => {
    g.set(a, [...(g.get(a) ?? []), { vers: b, points }])
    g.set(b, [...(g.get(b) ?? []), { vers: a, points: [...points].reverse() }])
  }
  const devant = Math.max(plan.depth, ...OBSTACLES_PORTIQUE.map((o) => o.z + o.depth)) + 0.8
  for (const level of plan.levels)
    for (const o of level.openings)
      // Côté hall, le point de passage est au-delà des battants ouverts de l'entrée
      // (1,55 m) : plus près, le chemin vers un coin du hall coupait un battant.
      if (o.kind === 'entrance' && o.b === null) lier(`${level.id}:${o.a}`, PARC, [[o.x, o.z - 2.6], [o.x, o.z - 0.8], [o.x, devant]])
  return g
}

/** Le plus court chemin en nombre de passages : la suite des passages, chacun avec la surface d'où il part. */
export function etapes(g: Graphe, de: string, a: string): { de: string; points: Point[] }[] | null {
  const venu = new Map<string, { de: string; points: Point[] } | null>([[de, null]])
  const file = [de]
  while (file.length) {
    const n = file.shift()!
    if (n === a) break
    for (const e of g.get(n) ?? []) if (!venu.has(e.vers)) { venu.set(e.vers, { de: n, points: e.points }); file.push(e.vers) }
  }
  if (!venu.has(a)) return null
  const out: { de: string; points: Point[] }[] = []
  for (let n = a, v = venu.get(n); v; n = v.de, v = venu.get(n)) out.unshift(v)
  return out
}

/**
 * Le chemin comme une liste de points : ceux des passages, et entre deux
 * passages — dans une même surface — de quoi contourner son mobilier. Depuis
 * `depuis` s'il est donné (dans la surface `de`), jusqu'à `jusqua` (dans `a`).
 */
export function chemin(g: Graphe, de: string, a: string, depuis?: Point, jusqua?: Point): Point[] | null {
  const suite = etapes(g, de, a)
  if (!suite) return null
  const out: Point[] = []
  let ici = depuis
  for (const e of suite) {
    out.push(...(ici ? contourner(e.de, ici, e.points[0]) : [e.points[0]]), ...e.points.slice(1))
    ici = e.points[e.points.length - 1]
  }
  if (jusqua) out.push(...(ici ? contourner(a, ici, jusqua) : [jusqua]))
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
  let la: Point = [plan.spawn.x, plan.spawn.z]
  while (reste.length) {
    let meilleur: { i: number; passages: number } | null = null
    reste.forEach(({ room, level }, i) => {
      const e = etapes(g, ici, `${level.id}:${room.id}`)
      if (e && (!meilleur || e.length < meilleur.passages)) meilleur = { i, passages: e.length }
    })
    if (!meilleur) throw new Error(`salles inatteignables : ${reste.map((r) => r.room.id).join(', ')}`)
    const [{ room, level }] = reste.splice((meilleur as { i: number }).i, 1)
    const vers = `${level.id}:${room.id}`
    const points = chemin(g, ici, vers, la, centre(room))!
    out.push({ roomId: room.id, level: level.id, name: room.name, points })
    ici = vers
    la = centre(room)
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

/**
 * Le dernier arrêt, après la salle d'honneur : on redescend, on sort par
 * l'entrée, et l'on finit dans la baraque du chantier (`chantier.ts`), face au
 * pignon du fond où pendent les dernières étapes du journal.
 */
export function arretDuChantier(plan: Plan, depuis: TourStop): TourStop {
  const la = depuis.points[depuis.points.length - 1]
  const points = chemin(grapheEtEntree(plan), `${depuis.level}:${depuis.roomId}`, PARC, la, SEUIL_CHANTIER.dehors)
  if (!points) throw new Error('la baraque du chantier est inatteignable')
  return { roomId: 'chantier', level: 0, name: 'Chantier du musée', points: [...points, SEUIL_CHANTIER.dedans] }
}

/**
 * Le tout dernier arrêt : le belvédère (`belvedere.ts`). De la baraque, on
 * longe la ceinture jusqu'à l'accès est, on passe le pont, la porte du roji,
 * on le suit entre la palissade et le mur, on monte l'escalier dos au jardin,
 * et l'on s'arrête au coin de la terrasse, face à l'étang et à la façade. Des points de passage à la main — la
 * pelouse n'a pas de graphe —, chaque ligne droite contournant les bancs et les
 * lampadaires (`contourner`).
 */
export function arretDuBelvedere(depuis: TourStop): TourStop {
  const [px, pz] = PIED_DE_L_ESCALIER
  const etapes: Point[] = [
    SEUIL_CHANTIER.dedans, SEUIL_CHANTIER.dehors, [19, 53], [57.5, 49.5], [59.6, 40], [59.6, 21.4], [70.5, 20], [78.5, 20],
    [px, 21], [px, pz], HAUT_DE_L_ESCALIER, POINT_DE_VUE,
  ]
  const points: Point[] = []
  for (let i = 1; i < etapes.length; i++) points.push(...contourner(PARC, etapes[i - 1], etapes[i]))
  if (depuis.roomId !== 'chantier') throw new Error('le belvédère se visite après la baraque du chantier')
  return { roomId: 'belvedere', level: 0, name: 'Le belvédère', points }
}

/**
 * Le retour : on descend la volée ouest du belvédère, on suit les pas japonais
 * de la rive sud, et l'on finit sur l'axe de l'entrée, face à la façade que
 * deux érables encadrent — la visite boucle sur le musée, elle ne s'arrête pas
 * au bout d'un cul-de-sac.
 */
export function arretDeLaRive(depuis: TourStop): TourStop {
  if (depuis.roomId !== 'belvedere') throw new Error('la rive sud se prend en descendant du belvédère')
  const etapes: Point[] = [POINT_DE_VUE, HAUT_DE_LA_VOLEE_OUEST, PIED_DE_LA_VOLEE_OUEST, ...BELVEDERE.rive, [24, 75], [24, 74]]
  const points: Point[] = []
  for (let i = 1; i < etapes.length; i++) points.push(...contourner(PARC, etapes[i - 1], etapes[i]))
  return { roomId: 'rive', level: 0, name: 'La rive sud', points }
}

/** L'itinéraire du musée publié, calculé une fois : `PlanPlayer` le marche, le cartouche le lit. */
const SALLES = buildTourItinerary(MUSEE)
const CHANTIER = arretDuChantier(MUSEE, SALLES[SALLES.length - 1])
const TERRASSE = arretDuBelvedere(CHANTIER)
export const VISITE = [...SALLES, CHANTIER, TERRASSE, arretDeLaRive(TERRASSE)]
