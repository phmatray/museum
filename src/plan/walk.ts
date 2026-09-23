/**
 * La marche d'un visiteur dans le plan, sans moteur physique.
 *
 * Le plan est fait de rectangles alignés : ses murs sont des segments, et un
 * visiteur est un cercle de 0,30 m qui glisse contre eux. Pas besoin de Rapier
 * pour ça, et la marche se teste comme le reste du plan : des nombres entrent,
 * des nombres sortent. La 3D ne fait que poser la caméra là où `step` la rend.
 */
import { VITESSE_HATE, VITESSE_MARCHE } from '../domain/locomotion.ts'
import { edges, sameLine, subtract, type Edge, type Interval, type Segment } from './geometry.ts'
import { PASSABLE } from './rules.ts'
import type { Plan } from './types.ts'

const RAYON = 0.3

export interface Walker {
  level: number
  x: number
  z: number
  y: number
  yaw: number
}

/**
 * Les murs d'un niveau : arêtes des salles, du périmètre et des obstacles,
 * fusionnées par droite — une cloison partagée par deux salles n'est qu'un mur —
 * puis percées de chaque ouverture praticable. Une baie reste un mur.
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
      .map((o) => {
        const c = axis === 'x' ? o.x : o.z
        return [c - o.width / 2, c + o.width / 2]
      })
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

/**
 * Un pas de marche de durée `dt`. `yaw` est le cap absolu (0 = −z, comme
 * `directionMarche`), `forward`/`strafe` dans [−1, 1].
 *
 * On découpe le déplacement en sous-pas d'au plus un demi-rayon : à 3,8 m/s et
 * dt = 0,1 s, on avancerait de 0,38 m d'un coup, plus que le rayon — le centre
 * sauterait de l'autre côté d'un mur et serait repoussé du mauvais côté.
 */
export function step(
  plan: Plan,
  walker: Walker,
  input: { forward: number; strafe: number; yaw: number; hate?: boolean },
  dt: number,
): Walker {
  const level = plan.levels.find((l) => l.id === walker.level)
  if (!level) throw new Error(`niveau inconnu : ${walker.level}`)
  // ponytail: murs recalculés à chaque pas, à mettre en cache par niveau si le profil le montre.
  const murs = wallSegments(plan, walker.level)

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
    p.x += dx / n
    p.z += dz / n
    // Deux passes : sortir d'un mur peut enfoncer dans l'autre, dans un angle.
    repousser(p, murs)
    repousser(p, murs)
  }
  // ponytail: sol plat au niveau du plancher ; volées et paliers viendront avec l'étage.
  return { level: walker.level, x: p.x, z: p.z, y: level.elevation, yaw }
}
