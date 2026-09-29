/**
 * Ce que le visiteur PEUT voir, lu dans le plan : on ne dessine que ça.
 *
 * ── Les zones ──
 *
 * Une galerie (ou la salle d'honneur) est une zone de son niveau. La NEF — le
 * hall, ses balcons, le palier et les volées — n'en fait qu'une, sur toute sa
 * hauteur : on y voit les deux niveaux à la fois. Tout le reste est le PARC.
 *
 * ── Ce qui est visible : des portails ──
 *
 * Une zone est visible s'il existe une chaîne d'ouvertures qui y mène depuis
 * celle du visiteur ET qu'une ligne droite franchit toutes, dans l'ordre. Les
 * voisines directes le sont donc toujours, une enfilade de portes alignées
 * aussi ; un coude, jamais.
 *
 * Le test est fait vue de dessus, en ignorant l'épaisseur des murs et la
 * hauteur des baies : il ne peut que voir TROP. C'est le bon sens de l'erreur —
 * une salle cachée à tort surgirait au passage d'une porte, une salle dessinée
 * pour rien ne coûte que quelques triangles.
 */
import type { Plan, Rect } from './types.ts'

export const NEF = 'nef'
export const PARC = 'parc'
export type Zone = string

/** Tolérance autour d'un volume, en mètres : un objet posé sur une cloison est des deux côtés. */
const MARGE = 0.3

const dans = (r: Rect, x0: number, z0: number, x1: number, z1: number, m: number) =>
  x1 >= r.x - m && x0 <= r.x + r.width + m && z1 >= r.z - m && z0 <= r.z + r.depth + m

/** Le rectangle de la nef : l'emprise commune du hall et des balcons. */
export function emprise(plan: Plan): Rect {
  const salles = plan.levels.flatMap((l) => l.rooms).filter((r) => r.kind === 'hall' || r.kind === 'balcony')
  const x = Math.min(...salles.map((r) => r.x))
  const z = Math.min(...salles.map((r) => r.z))
  return { x, z, width: Math.max(...salles.map((r) => r.x + r.width)) - x, depth: Math.max(...salles.map((r) => r.z + r.depth)) - z }
}

const zoneDeSalle = (plan: Plan, id: string | null): Zone => {
  if (id === null) return PARC
  const r = plan.levels.flatMap((l) => l.rooms).find((s) => s.id === id)
  return r === undefined || r.kind === 'hall' || r.kind === 'balcony' ? NEF : id
}

/** Une ouverture vue d'en haut : son segment, et les deux zones qu'elle relie. */
interface Portail {
  zones: [Zone, Zone]
  seg: [number, number, number, number]
}

/** Chaque ouverture élargie d'un peu, pour ne jamais rater une ligne rasante. */
const JEU = 0.15

function portails(plan: Plan): Portail[] {
  const salles = plan.levels.flatMap((l) => l.rooms)
  return plan.levels.flatMap((l) =>
    l.openings.map((o): Portail => {
      // Une ouverture posée sur une arête verticale (x constant) court selon z.
      const vertical = salles.some((r) => (r.x === o.x || r.x + r.width === o.x) && o.z > r.z && o.z < r.z + r.depth)
      const d = o.width / 2 + JEU
      return {
        // Une baie sur le vide (la salle d'honneur) donne sur la nef.
        zones: [zoneDeSalle(plan, o.a), o.kind === 'bay' && o.b === null ? NEF : zoneDeSalle(plan, o.b)],
        seg: vertical ? [o.x, o.z - d, o.x, o.z + d] : [o.x - d, o.z, o.x + d, o.z],
      }
    }),
  )
}

const ECHANTILLONS = 24

/**
 * Existe-t-il une ligne droite qui franchit toutes les ouvertures de la chaîne,
 * dans l'ordre ? La première et la dernière sont échantillonnées, celles du
 * milieu testées exactement. Deux ouvertures se franchissent toujours.
 */
export function traversable(segments: readonly (readonly number[])[], premiers = ECHANTILLONS): boolean {
  if (segments.length <= 2) return true
  const [a, c] = [segments[0], segments[segments.length - 1]]
  const milieu = segments.slice(1, -1)
  for (let i = 0; i <= premiers; i++)
    for (let j = 0; j <= ECHANTILLONS; j++) {
      const [ax, az] = [a[0] + ((a[2] - a[0]) * i) / premiers, a[1] + ((a[3] - a[1]) * i) / premiers]
      const [cx, cz] = [c[0] + ((c[2] - c[0]) * j) / ECHANTILLONS, c[1] + ((c[3] - c[1]) * j) / ECHANTILLONS]
      const [dx, dz] = [cx - ax, cz - az]
      let t0 = 0
      const ok = milieu.every(([px, pz, qx, qz]) => {
        // Intersection de a→c (paramètre t) avec le segment p→q (paramètre u).
        const [ex, ez] = [qx - px, qz - pz]
        const den = dx * ez - dz * ex
        if (Math.abs(den) < 1e-9) return false
        const t = ((px - ax) * ez - (pz - az) * ex) / den
        const u = ((px - ax) * dz - (pz - az) * dx) / den
        if (u < 0 || u > 1 || t < t0 || t > 1) return false
        t0 = t
        return true
      })
      if (ok) return true
    }
  return false
}

const cache = new WeakMap<Plan, Portail[]>()

/** Le rayon autour de l'œil qu'on couvre : de quoi faire quelques pas avant le prochain calcul. */
export const RAYON_OEIL = 0.4

/**
 * Les zones visibles depuis `depuis` : celles qu'atteint une chaîne d'ouvertures
 * `traversable`. Avec `oeil` (x, z), la chaîne part de l'œil plutôt que de toute
 * la zone : d'un coin de galerie, on ne voit pas par toutes les portes du hall.
 * L'œil est une petite croix de `RAYON_OEIL`, pour couvrir les pas qui séparent
 * deux calculs, et le regard porte dans toutes les directions : se retourner ne
 * découvre rien de caché.
 */
export function zonesVisibles(plan: Plan, depuis: Iterable<Zone>, oeil?: { x: number; z: number }): Set<Zone> {
  let tous = cache.get(plan)
  if (tous === undefined) cache.set(plan, (tous = portails(plan)))
  const r = RAYON_OEIL
  const croix = oeil && [
    [oeil.x - r, oeil.z, oeil.x + r, oeil.z],
    [oeil.x, oeil.z - r, oeil.x, oeil.z + r],
  ]
  const vues = new Set<Zone>()
  const explorer = (zone: Zone, chaine: Portail[], chemin: Zone[]) => {
    vues.add(zone)
    for (const p of tous) {
      const i = p.zones.indexOf(zone)
      if (i < 0 || chaine.includes(p)) continue
      const suite = p.zones[1 - i]
      if (chemin.includes(suite)) continue
      const c = [...chaine, p]
      const segs = c.map((q) => q.seg)
      const ok = croix ? croix.some((s) => traversable([s, ...segs], 4)) : traversable(segs)
      if (ok) explorer(suite, c, [...chemin, suite])
    }
  }
  for (const z of depuis) explorer(z, [], [z])
  return vues
}

/**
 * Les zones qu'un volume touche (boîte englobante, en coordonnées monde), à
 * `marge` près. Ce qui dépasse le haut de l'étage — les toits — se voit aussi
 * du parc, qui a du relief.
 */
export function zonesDuVolume(
  plan: Plan,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  marge = MARGE,
): Zone[] {
  const out: Zone[] = []
  const nef = emprise(plan)
  const niveaux = [...plan.levels].sort((a, b) => a.elevation - b.elevation)
  niveaux.forEach((l, i) => {
    const bas = i === 0 ? -Infinity : l.elevation - marge
    const haut = i === niveaux.length - 1 ? Infinity : niveaux[i + 1].elevation + marge
    if (max.y < bas || min.y > haut) return
    for (const r of l.rooms)
      if (r.kind !== 'hall' && r.kind !== 'balcony' && dans(r, min.x, min.z, max.x, max.z, marge)) out.push(r.id)
  })
  if (dans(nef, min.x, min.z, max.x, max.z, marge)) out.push(NEF)
  // Strictement hors de l'emprise : une toile du mur de façade reste dans sa salle, le mur, lui, dépasse.
  const dehors = min.x < 0 || min.z < 0 || max.x > plan.width || max.z > plan.depth
  const toit = niveaux[niveaux.length - 1].elevation + plan.storey - 2 * plan.slab
  if (dehors || max.y >= toit) out.push(PARC)
  return out
}
