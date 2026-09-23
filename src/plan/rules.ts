/**
 * Les RÈGLES qu'un architecte vérifierait sur le plan, avant toute 3D.
 *
 * ── Pourquoi ce fichier existe ──
 *
 * L'ancien musée passait 782 tests et restait un mauvais bâtiment : les tests
 * vérifiaient chaque pièce séparément, jamais la visite. Ces règles portent sur
 * ce qu'un visiteur vit : peut-il atteindre chaque salle, passe-t-il dans chaque
 * porte, se cogne-t-il la tête sous le palier, l'escalier est-il confortable,
 * y a-t-il de quoi accrocher la collection.
 *
 * `checkPlan` rend la liste des violations, en français, avec leurs cotes. Une
 * liste vide veut dire que le plan est constructible.
 */
import type { Flight, Level, Opening, Plan, Rect, Room } from './types.ts'

/** Seuils, en mètres. */
export const NORMES = {
  porte: 1.8,
  entree: 2.4,
  passageOuvert: 2.4,
  /** Distance minimale entre une ouverture et l'angle de la salle. */
  retourDeMur: 0.3,
  hauteurLibre: 2.2,
  contremarche: [0.15, 0.18],
  giron: [0.28, 0.35],
  /** Formule de Blondel : 2h + g. */
  blondel: [0.6, 0.66],
  emmarchement: 1.4,
  /** Accrochage : une œuvre tous les 2,60 m de mur, un mètre libre dans chaque angle. */
  pasAccrochage: 2.6,
  angle: 1,
  /** Dégagement de part et d'autre d'une ouverture, où l'on n'accroche pas. */
  dégagement: 0.6,
  capaciteMinSalle: 6,
  margeCollection: 1.2,
} as const

const EPS = 1e-6
export const PASSABLE = new Set<Opening['kind']>(['door', 'entrance', 'open'])

/** (x, z) est-il dans `r`, bords compris à `eps` près ? */
export const contains = (r: Rect, x: number, z: number, eps = EPS) =>
  x >= r.x - eps && x <= r.x + r.width + eps && z >= r.z - eps && z <= r.z + r.depth + eps

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z))

/**
 * L'arête de `room` qui porte le point (x, z) : son axe et son étendue le long
 * de cet axe. `null` si le point n'est sur aucune arête.
 */
function edgeAt(room: Rect, x: number, z: number): { axis: 'x' | 'z'; from: number; to: number } | null {
  const onV = Math.abs(x - room.x) < EPS || Math.abs(x - room.x - room.width) < EPS
  const onH = Math.abs(z - room.z) < EPS || Math.abs(z - room.z - room.depth) < EPS
  if (onV && z > room.z && z < room.z + room.depth) return { axis: 'z', from: room.z, to: room.z + room.depth }
  if (onH && x > room.x && x < room.x + room.width) return { axis: 'x', from: room.x, to: room.x + room.width }
  return null
}

/** Mur accrochable d'une salle : périmètre, moins les ouvertures et leur dégagement, moins les angles. */
export function capacity(room: Room, level: Level): number {
  const perdu = level.openings
    .filter((o) => o.a === room.id || o.b === room.id)
    .reduce((s, o) => s + o.width + 2 * NORMES.dégagement, 0)
  const utile = 2 * (room.width + room.depth) - perdu - 8 * NORMES.angle
  return Math.max(0, Math.floor(utile / NORMES.pasAccrochage))
}

const exposes = (r: Room) => r.kind === 'gallery' || r.kind === 'honneur'

/** Cote du dessus d'une volée au point (x, z), pente constante. */
export function flightElevation(f: Flight, x: number, z: number): number {
  const t =
    f.direction === 'north' ? (f.z + f.depth - z) / f.depth
    : f.direction === 'south' ? (z - f.z) / f.depth
    : f.direction === 'east' ? (x - f.x) / f.width
    : (f.x + f.width - x) / f.width
  return f.bottom + Math.min(1, Math.max(0, t)) * (f.top - f.bottom)
}

/** Milieux des arêtes de départ et d'arrivée d'une volée. */
export function flightEnds(f: Flight): { bottom: [number, number]; top: [number, number] } {
  const cx = f.x + f.width / 2
  const cz = f.z + f.depth / 2
  switch (f.direction) {
    case 'north': return { bottom: [cx, f.z + f.depth], top: [cx, f.z] }
    case 'south': return { bottom: [cx, f.z], top: [cx, f.z + f.depth] }
    case 'east': return { bottom: [f.x, cz], top: [f.x + f.width, cz] }
    case 'west': return { bottom: [f.x + f.width, cz], top: [f.x, cz] }
  }
}

/**
 * Le nœud (salle ou palier) sur lequel on pose le pied en (x, z) à la cote
 * `elevation` : `<niveau>:<salle>` ou `palier:<id>`. Une volée se nomme
 * `volee:<id>`, mais on n'y arrive que par ses bouts (voir `walk.ts`).
 */
export function surfaceAt(plan: Plan, x: number, z: number, elevation: number): string | null {
  for (const level of plan.levels) {
    if (Math.abs(level.elevation - elevation) > EPS) continue
    const room = level.rooms.find((r) => contains(r, x, z))
    if (room) return `${level.id}:${room.id}`
  }
  const landing = plan.landings.find((l) => Math.abs(l.elevation - elevation) < EPS && contains(l, x, z))
  return landing ? `palier:${landing.id}` : null
}

/** Tous les nœuds atteignables depuis le point d'apparition. */
export function reachable(plan: Plan): Set<string> {
  const edges = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    edges.set(a, [...(edges.get(a) ?? []), b])
    edges.set(b, [...(edges.get(b) ?? []), a])
  }
  for (const level of plan.levels)
    for (const o of level.openings)
      if (PASSABLE.has(o.kind) && o.b) link(`${level.id}:${o.a}`, `${level.id}:${o.b}`)
  for (const f of plan.flights) {
    const { bottom, top } = flightEnds(f)
    const lo = surfaceAt(plan, bottom[0], bottom[1], f.bottom)
    const hi = surfaceAt(plan, top[0], top[1], f.top)
    if (lo) link(lo, `volee:${f.id}`)
    if (hi) link(hi, `volee:${f.id}`)
  }
  const start = plan.levels.find((l) => l.id === plan.spawn.level)
  const room = start?.rooms.find((r) => contains(r, plan.spawn.x, plan.spawn.z))
  const seen = new Set<string>()
  const todo = room ? [`${start!.id}:${room.id}`] : []
  while (todo.length) {
    const n = todo.pop()!
    if (seen.has(n)) continue
    seen.add(n)
    todo.push(...(edges.get(n) ?? []))
  }
  return seen
}

interface Surface {
  nom: string
  rect: Rect
  /** Cote du sol en (x, z). */
  floor: (x: number, z: number) => number
  /** Ce qu'on retire de la surface : obstacles, volées qui en partent. */
  holes: Rect[]
}

function surfaces(plan: Plan): Surface[] {
  const out: Surface[] = []
  for (const level of plan.levels) {
    const departs = plan.flights.filter((f) => Math.abs(f.bottom - level.elevation) < EPS)
    for (const r of level.rooms)
      out.push({ nom: `${r.name} (${level.name})`, rect: r, floor: () => level.elevation, holes: [...level.obstacles, ...departs] })
  }
  for (const l of plan.landings) out.push({ nom: `palier ${l.id}`, rect: l, floor: () => l.elevation, holes: [] })
  for (const f of plan.flights) out.push({ nom: `volée ${f.id}`, rect: f, floor: (x, z) => flightElevation(f, x, z), holes: [] })
  return out
}

/**
 * Hauteur libre, par échantillonnage tous les 25 cm : sous chaque point où l'on
 * peut marcher, la sous-face la plus basse de ce qui passe au-dessus.
 */
function headroom(plan: Plan): string[] {
  const all = surfaces(plan)
  const out: string[] = []
  const step = 0.25
  for (const s of all) {
    const pires = new Map<string, { h: number; x: number; z: number }>()
    for (let x = s.rect.x + step / 2; x < s.rect.x + s.rect.width; x += step)
      for (let z = s.rect.z + step / 2; z < s.rect.z + s.rect.depth; z += step) {
        if (s.holes.some((h) => contains(h, x, z, 0))) continue
        const sol = s.floor(x, z)
        for (const o of all) {
          if (o === s || !contains(o.rect, x, z, 0)) continue
          const dessous = o.floor(x, z) - plan.slab
          if (dessous <= sol + EPS) continue
          const libre = dessous - sol
          const pire = pires.get(o.nom)
          if (libre < NORMES.hauteurLibre && (!pire || libre < pire.h)) pires.set(o.nom, { h: libre, x, z })
        }
      }
    for (const [nom, p] of pires)
      out.push(`hauteur libre de ${p.h.toFixed(2)} m sur ${s.nom} sous ${nom}, en (${p.x}, ${p.z}) : il faut ${NORMES.hauteurLibre} m ou un obstacle`)
  }
  return out
}

export function checkPlan(plan: Plan, collection: number): string[] {
  const out: string[] = []

  for (const level of plan.levels) {
    const ids = new Set(level.rooms.map((r) => r.id))
    level.rooms.forEach((r, i) => {
      if (r.x < -EPS || r.z < -EPS || r.x + r.width > plan.width + EPS || r.z + r.depth > plan.depth + EPS)
        out.push(`${r.id} (${level.name}) déborde de l'emprise`)
      for (const other of level.rooms.slice(i + 1))
        if (overlapArea(r, other) > EPS) out.push(`${r.id} et ${other.id} se chevauchent (${level.name})`)
    })

    for (const o of level.openings) {
      const nom = `ouverture ${o.a}/${o.b ?? 'extérieur'} (${level.name})`
      const a = level.rooms.find((r) => r.id === o.a)
      const b = o.b ? level.rooms.find((r) => r.id === o.b) : null
      if (!a || (o.b && !ids.has(o.b))) { out.push(`${nom} : salle inconnue`); continue }
      const ea = edgeAt(a, o.x, o.z)
      const eb = b ? edgeAt(b, o.x, o.z) : ea
      if (!ea || !eb || ea.axis !== eb.axis) { out.push(`${nom} : pas posée sur une arête commune`); continue }
      const from = Math.max(ea.from, eb.from)
      const to = Math.min(ea.to, eb.to)
      const c = ea.axis === 'z' ? o.z : o.x
      const marge = o.kind === 'open' ? 0 : NORMES.retourDeMur
      if (c - o.width / 2 < from + marge - EPS || c + o.width / 2 > to - marge + EPS)
        out.push(`${nom} : dépasse le mur commun (${from}–${to}) ou colle à l'angle`)
      const min = o.kind === 'door' ? NORMES.porte : o.kind === 'entrance' ? NORMES.entree : o.kind === 'open' ? NORMES.passageOuvert : 0
      if (o.width < min) out.push(`${nom} : ${o.width} m de passage, il en faut ${min}`)
    }

    for (const r of level.rooms.filter(exposes)) {
      const c = capacity(r, level)
      if (c < NORMES.capaciteMinSalle) out.push(`${r.name} (${level.name}) n'accroche que ${c} œuvres`)
    }
  }

  for (const f of plan.flights) {
    const h = (f.top - f.bottom) / f.risers
    const run = f.direction === 'north' || f.direction === 'south' ? f.depth : f.width
    const large = f.direction === 'north' || f.direction === 'south' ? f.width : f.depth
    const g = run / (f.risers - 1)
    if (h < NORMES.contremarche[0] || h > NORMES.contremarche[1]) out.push(`volée ${f.id} : contremarche de ${h.toFixed(3)} m`)
    if (g < NORMES.giron[0] || g > NORMES.giron[1]) out.push(`volée ${f.id} : giron de ${g.toFixed(3)} m`)
    if (2 * h + g < NORMES.blondel[0] || 2 * h + g > NORMES.blondel[1]) out.push(`volée ${f.id} : 2h + g = ${(2 * h + g).toFixed(3)} m, hors Blondel`)
    if (large < NORMES.emmarchement) out.push(`volée ${f.id} : emmarchement de ${large} m`)
    const { bottom, top } = flightEnds(f)
    if (!surfaceAt(plan, bottom[0], bottom[1], f.bottom)) out.push(`volée ${f.id} : ne part d'aucun sol à ${f.bottom} m`)
    if (!surfaceAt(plan, top[0], top[1], f.top)) out.push(`volée ${f.id} : n'arrive sur aucun sol à ${f.top} m`)
  }

  const vus = reachable(plan)
  if (vus.size === 0) out.push("le point d'apparition n'est dans aucune salle")
  for (const level of plan.levels)
    for (const r of level.rooms)
      if (!vus.has(`${level.id}:${r.id}`)) out.push(`${r.name} (${level.name}) est inaccessible`)

  out.push(...headroom(plan))

  const total = plan.levels.reduce((s, l) => s + l.rooms.filter(exposes).reduce((t, r) => t + capacity(r, l), 0), 0)
  const requis = Math.ceil(collection * NORMES.margeCollection)
  if (total < requis) out.push(`capacité de ${total} œuvres pour une collection de ${collection} : il en faut ${requis}`)

  return out
}
