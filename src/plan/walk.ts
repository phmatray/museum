/**
 * La marche d'un visiteur dans le plan, sans moteur physique.
 *
 * Le plan est fait de rectangles alignés : ses murs sont des segments, et un
 * visiteur est un cercle de 0,30 m qui glisse contre eux. Pas besoin de Rapier
 * pour ça, et la marche se teste comme le reste du plan : des nombres entrent,
 * des nombres sortent. La 3D ne fait que poser la caméra là où `step` la rend.
 *
 * ── Les surfaces ──
 *
 * Le visiteur est toujours sur une SURFACE : une salle d'un niveau, le palier,
 * ou une volée (les noms de `surfaceAt`). Une volée est un plan incliné : sa
 * cote est `flightElevation`, sans marche ni saut. On ne change de cote que par
 * le départ ou l'arrivée d'une volée — ses côtés sont des garde-corps, lus dans
 * `guardrails` comme ceux du palier et des balcons.
 */
import { VITESSE_HATE, VITESSE_MARCHE } from '../domain/locomotion.ts'
import { edges, guardrails, isNordSud, sameLine, subtract, type Edge, type Interval, type Segment } from './geometry.ts'
import { PASSABLE, flightElevation, flightEnds, surfaceAt } from './rules.ts'
import type { Flight, Plan, Rect } from './types.ts'

const RAYON = 0.3

export interface Walker {
  /** Le niveau dont relève la surface : celui du plancher sous le pied, ou sous la volée. */
  level: number
  /** `<niveau>:<salle>`, `palier:<id>` ou `volee:<id>`. */
  surface: string
  x: number
  z: number
  y: number
  yaw: number
}

const EPS = 1e-6

/** L'arête de départ (cote `bottom`) ou d'arrivée (cote `top`) d'une volée, comme un trou sur sa droite. */
function bout(f: Flight, cote: number): { axis: 'x' | 'z'; at: number; span: Interval } | null {
  const bas = Math.abs(f.bottom - cote) < EPS
  if (!bas && Math.abs(f.top - cote) > EPS) return null
  const ends = flightEnds(f)
  const [x, z] = bas ? ends.bottom : ends.top
  return isNordSud(f)
    ? { axis: 'x', at: z, span: [f.x, f.x + f.width] }
    : { axis: 'z', at: x, span: [f.z, f.z + f.depth] }
}

/**
 * Les murs d'un niveau : arêtes des salles, du périmètre et des obstacles,
 * fusionnées par droite — une cloison partagée par deux salles n'est qu'un mur —
 * puis percées de chaque ouverture praticable et de chaque bout de volée posé
 * au plancher (l'arrivée sur un balcon). Une baie reste un mur.
 * `obstacles = false` pour la 3D : sous le palier, on se cogne, mais on ne bâtit pas.
 */
export function wallSegments(plan: Plan, levelId: number, obstacles = true): Segment[] {
  const level = plan.levels.find((l) => l.id === levelId)
  if (!level) return []
  const toutes = [...level.rooms, { x: 0, z: 0, width: plan.width, depth: plan.depth }, ...(obstacles ? level.obstacles : [])].flatMap(edges)

  const droites: Edge[][] = []
  for (const e of toutes) {
    const d = droites.find((g) => sameLine(g[0], e))
    if (d) d.push(e)
    else droites.push([e])
  }

  const out: Segment[] = []
  for (const d of droites) {
    const { axis, at } = d[0]
    // Union des étendues : trier, puis recoller ce qui se touche.
    const union: Interval[] = []
    for (const [s, t] of d.map((e) => e.span).sort((a, b) => a[0] - b[0])) {
      const der = union[union.length - 1]
      if (der && s <= der[1]) der[1] = Math.max(der[1], t)
      else union.push([s, t])
    }
    // Une ouverture est centrée sur l'arête qui la porte : même droite, donc.
    const trous: Interval[] = level.openings
      .filter((o) => PASSABLE.has(o.kind) && Math.abs((axis === 'x' ? o.z : o.x) - at) < 1e-6)
      .map((o): Interval => {
        const c = axis === 'x' ? o.x : o.z
        return [c - o.width / 2, c + o.width / 2]
      })
    for (const f of plan.flights) {
      const b = bout(f, level.elevation)
      if (b && b.axis === axis && Math.abs(b.at - at) < EPS) trous.push(b.span)
    }
    for (const span of union)
      for (const [s, t] of subtract(span, trous))
        out.push(axis === 'x' ? { x1: s, z1: at, x2: t, z2: at } : { x1: at, z1: s, x2: at, z2: t })
  }
  return out
}

/** Repousse le cercle hors de chaque segment plus proche que le rayon. */
function repousser(p: { x: number; z: number }, murs: Segment[]) {
  for (const m of murs) {
    const dx = m.x2 - m.x1
    const dz = m.z2 - m.z1
    const t = Math.max(0, Math.min(1, ((p.x - m.x1) * dx + (p.z - m.z1) * dz) / (dx * dx + dz * dz)))
    const nx = p.x - (m.x1 + t * dx)
    const nz = p.z - (m.z1 + t * dz)
    const d = Math.hypot(nx, nz)
    // Centre pile sur le mur : direction de sortie inconnue. Le sous-pas l'évite.
    if (d >= RAYON || d < 1e-9) continue
    p.x += (nx / d) * (RAYON - d)
    p.z += (nz / d) * (RAYON - d)
  }
}

/** Le niveau dont relève une cote : le plus haut dont le plancher est dessous. */
function niveauDe(plan: Plan, cote: number): number {
  const dessous = plan.levels.filter((l) => l.elevation <= cote + EPS)
  if (!dessous.length) throw new Error(`aucun niveau sous la cote ${cote}`)
  return dessous.reduce((a, b) => (b.elevation > a.elevation ? b : a)).id
}

/** Strictement dedans : un point sur l'arête n'a pas encore franchi le bout d'une volée. */
const dedans = (r: Rect, x: number, z: number) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth

/** Ce qu'il faut savoir d'une surface pour y marcher. */
function lire(plan: Plan, surface: string) {
  const i = surface.indexOf(':')
  const [genre, id] = [surface.slice(0, i), surface.slice(i + 1)]
  let niveau: number
  let volee: Flight | undefined
  let cote: (x: number, z: number) => number
  if (genre === 'volee') {
    const f = plan.flights.find((f) => f.id === id)
    if (!f) throw new Error(`volée inconnue : ${surface}`)
    volee = f
    niveau = niveauDe(plan, f.bottom)
    cote = (x, z) => flightElevation(f, x, z)
  } else if (genre === 'palier') {
    const l = plan.landings.find((l) => l.id === id)
    if (!l) throw new Error(`palier inconnu : ${surface}`)
    niveau = niveauDe(plan, l.elevation)
    cote = () => l.elevation
  } else {
    const level = plan.levels.find((l) => String(l.id) === genre)
    if (!level) throw new Error(`niveau inconnu : ${surface}`)
    niveau = level.id
    cote = () => level.elevation
  }
  // Les obstacles ne ferment que le plancher : le palier passe au-dessus du sien.
  // ponytail: les garde-corps d'un niveau arrêtent aussi son plancher — vrai ici, où
  // tout ce qu'ils bordent au-dessus du sol est déclaré en obstacle.
  // ponytail: murs recalculés à chaque pas et à chaque changement de surface, à mettre en cache si le profil le montre.
  const murs = [...wallSegments(plan, niveau, !volee && genre !== 'palier'), ...guardrails(plan, niveau)]
  return { niveau, volee, cote, murs }
}

/**
 * Un pas de marche de durée `dt`. `yaw` est le cap absolu (0 = −z, comme
 * `directionMarche`), `forward`/`strafe` dans [−1, 1].
 *
 * On découpe le déplacement en sous-pas d'au plus un demi-rayon : à 6 m/s et
 * dt = 0,1 s, on avancerait de 0,6 m d'un coup, deux fois le rayon — le centre
 * sauterait de l'autre côté d'un mur et serait repoussé du mauvais côté.
 */
export function step(
  plan: Plan,
  walker: Walker,
  input: { forward: number; strafe: number; yaw: number; hate?: boolean },
  dt: number,
): Walker {
  let surface = walker.surface
  let s = lire(plan, surface)

  const { forward: a, strafe: c, yaw } = input
  const norme = Math.max(1, Math.hypot(a, c))
  const v = (input.hate ? VITESSE_HATE : VITESSE_MARCHE) * dt / norme
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const dx = (-a * sin + c * cos) * v
  const dz = (-a * cos - c * sin) * v

  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (RAYON / 2)))
  const p = { x: walker.x, z: walker.z }
  for (let i = 0; i < n; i++) {
    const avant = { ...p }
    p.x += dx / n
    p.z += dz / n
    // Deux passes : sortir d'un mur peut enfoncer dans l'autre, dans un angle.
    repousser(p, s.murs)
    repousser(p, s.murs)
    // L'entrée est un trou dans la façade, mais dehors il n'y a encore ni sol
    // ni parvis : on reste dans l'emprise.
    // ponytail: bornage à l'emprise, à retirer quand le parvis existera.
    p.x = Math.min(Math.max(p.x, RAYON), plan.width - RAYON)
    p.z = Math.min(Math.max(p.z, RAYON), plan.depth - RAYON)

    let suivante: string | null
    if (s.volee) {
      // Sortir d'une volée, c'est franchir un de ses bouts : on pose le pied à sa cote.
      suivante = dedans(s.volee, p.x, p.z) ? surface : surfaceAt(plan, p.x, p.z, s.cote(p.x, p.z))
    } else {
      // Les côtés d'une volée sont des garde-corps : y entrer, c'est passer par un bout à notre cote.
      const e = s.cote(p.x, p.z)
      const f = plan.flights.find((f) => dedans(f, p.x, p.z) && (Math.abs(f.bottom - e) < EPS || Math.abs(f.top - e) < EPS))
      suivante = f ? `volee:${f.id}` : surfaceAt(plan, p.x, p.z, e)
    }
    // Plus de sol sous le pied (le vide du hall, si un garde-corps manquait) : on n'y va pas.
    if (!suivante) Object.assign(p, avant)
    else if (suivante !== surface) {
      surface = suivante
      s = lire(plan, surface)
    }
  }
  return { level: s.niveau, surface, x: p.x, z: p.z, y: s.cote(p.x, p.z), yaw }
}
