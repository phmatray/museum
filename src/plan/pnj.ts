/**
 * Les visiteurs du musée (PNJ) : où ils vont, comment ils y vont, ce qu'ils y font.
 *
 * Un PNJ est un marcheur (`walk.ts`) mené par le même `step()` que le visiteur :
 * mêmes murs, mêmes volées, mêmes obstacles. Il va de toile en toile (au musée)
 * ou de coin calme en coin calme (au jardin), par les chemins de la visite
 * guidée (`grapheEtEntree`, `chemin` : de porte en porte, le mobilier
 * contourné), puis s'arrête et regarde. Devant quelqu'un (le visiteur ou un
 * autre PNJ), il se range à droite ; coincé, il change d'idée.
 *
 * Pur : ni Babylon ni DOM. `avancerPnj` modifie le PNJ en place (douze PNJ à
 * chaque image : pas d'allocation) ; le hasard vient de la graine du PNJ.
 */
import { arriveeDevant, cibleDe } from './arrivee.ts'
import type { Accrochage } from './hang.ts'
import type { Lieu } from './promenade.ts'
import { PARC } from './rules.ts'
import { capVers, chemin, grapheEtEntree } from './tour.ts'
import type { Plan } from './types.ts'
import { step, type Walker } from './walk.ts'

/** Une marche de flâneur, en m/s (celle de la marche « Casual Walk » jouée à sa cadence). */
export const VITESSE_PNJ = 1.15
/** Un point de passage est atteint à cette distance (m). */
const ATTEINT = 0.25
/** Devant soi, à moins de cette distance, quelqu'un fait attendre (m). */
const GENE = 1.1
/** Sans avancer d'au moins ce rapport de la distance prévue pendant `COINCE` s, on change d'idée. */
const PROGRES = 0.3
const COINCE = 2
/** Le temps passé devant une toile, ou dans un coin du jardin (s). */
const REGARD: [number, number] = [6, 16]

export type Activite = 'marche' | 'attente' | 'regarde'
export type Zone = 'musee' | 'jardin'

/** Un point où aller : où se tenir et vers où regarder. */
export interface Destination { surface: string; level: number; x: number; z: number; y: number; cap: number }

export interface Pnj {
  n: number
  /** Le modèle (le GLB `pnj-<modele>`). */
  modele: number
  zone: Zone
  w: Walker
  chemin: [number, number][]
  activite: Activite
  /** Secondes restantes d'attente ou de regard. */
  reste: number
  graine: number
  /** Pour juger qu'il est coincé : temps et distance depuis le dernier relevé. */
  releve: { t: number; x: number; z: number }
}

export interface Monde {
  plan: Plan
  graphe: ReturnType<typeof grapheEtEntree>
  /** Les places devant chaque toile accrochée. */
  toiles: Destination[]
  /** Les coins du jardin (lieux calmes du parc). */
  jardin: Destination[]
}

/** Le hasard du PNJ (mulberry32), qui fait avancer sa graine. */
function hasard(p: Pnj): number {
  p.graine = (p.graine + 0x6d2b79f5) >>> 0
  let t = p.graine
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Ce que les PNJ peuvent viser : les places devant les toiles, les coins calmes du jardin. */
export function monde(plan: Plan, accrochage: Accrochage | null, lieux: readonly Lieu[]): Monde {
  const toiles: Destination[] = []
  for (const r of accrochage?.rooms ?? [])
    for (const p of r.placements) {
      const c = cibleDe(p.key, accrochage!, [])
      const a = c && arriveeDevant(plan, c)
      if (a) toiles.push({ surface: a.surface, level: a.level, x: a.x, z: a.z, y: a.y, cap: a.yaw })
    }
  const jardin = lieux.filter((l) => l.surface === PARC && !l.couchette).map((l) => ({ surface: l.surface, level: 0, x: l.x, z: l.z, y: 0, cap: l.cap }))
  return { plan, graphe: grapheEtEntree(plan), toiles, jardin }
}

const choix = <T>(p: Pnj, l: readonly T[]): T => l[Math.floor(hasard(p) * l.length)]

/** Choisit une destination atteignable et le chemin pour y aller ; rien s'il n'y en a pas. */
function partir(m: Monde, p: Pnj): void {
  const liste = p.zone === 'musee' ? m.toiles : m.jardin
  for (let essai = 0; essai < 6 && liste.length > 0; essai++) {
    const d = choix(p, liste)
    if (Math.hypot(d.x - p.w.x, d.z - p.w.z) < 2) continue
    const pts = chemin(m.graphe, p.w.surface, d.surface, [p.w.x, p.w.z], [d.x, d.z])
    if (!pts) continue
    p.chemin = pts
    p.activite = 'marche'
    p.releve = { t: 0, x: p.w.x, z: p.w.z }
    destinations.set(p, d)
    return
  }
  p.activite = 'attente'
  p.reste = 2
}

/** La destination en cours de chaque PNJ (hors de l'objet : il reste un simple état sérialisable). */
const destinations = new WeakMap<Pnj, Destination>()

/** Les PNJ du début : postés devant des toiles (musée) ou dans des coins du jardin, en train de regarder. */
export function pnjInitiaux(m: Monde, combien: { musee: number; jardin: number }, modeles: number, graine: number): Pnj[] {
  const out: Pnj[] = []
  const prendre = (zone: Zone, liste: Destination[], k: number) => {
    for (let i = 0; i < k && liste.length > 0; i++) {
      const n = out.length
      const p: Pnj = {
        n, modele: n % modeles, zone, chemin: [], activite: 'regarde', reste: 0, graine: (graine + n * 7919) >>> 0,
        w: { level: 0, surface: '', x: 0, z: 0, y: 0, yaw: 0 }, releve: { t: 0, x: 0, z: 0 },
      }
      // Des places toutes différentes : on avance dans la liste d'un pas premier avec la taille.
      const d = liste[(Math.floor(hasard(p) * liste.length) + i * 37) % liste.length]
      p.w = { level: d.level, surface: d.surface, x: d.x, z: d.z, y: d.y, yaw: d.cap }
      p.reste = REGARD[0] + hasard(p) * (REGARD[1] - REGARD[0])
      out.push(p)
    }
  }
  prendre('musee', m.toiles, combien.musee)
  prendre('jardin', m.jardin, combien.jardin)
  return out
}

/** Quelqu'un est-il juste devant (même niveau, à moins de GENE, dans le demi-cône avant) ? */
function gene(p: Pnj, autres: readonly { x: number; z: number; level: number }[]): boolean {
  const fx = -Math.sin(p.w.yaw)
  const fz = -Math.cos(p.w.yaw)
  for (const o of autres) {
    if (o.level !== p.w.level) continue
    const dx = o.x - p.w.x
    const dz = o.z - p.w.z
    const d = Math.hypot(dx, dz)
    if (d < 1e-6 || d > GENE) continue
    if ((dx * fx + dz * fz) / d > 0.5) return true
  }
  return false
}

/** Une image de vie du PNJ (`dt` en s) ; `autres` : le visiteur et les autres PNJ. */
export function avancerPnj(m: Monde, p: Pnj, dt: number, autres: readonly { x: number; z: number; level: number }[]): void {
  if (p.activite !== 'marche') {
    p.reste -= dt
    if (p.reste <= 0) partir(m, p)
    return
  }
  while (p.chemin.length > 0 && Math.hypot(p.chemin[0][0] - p.w.x, p.chemin[0][1] - p.w.z) < ATTEINT) p.chemin.shift()
  if (p.chemin.length === 0) {
    // Arrivé : on se tourne vers ce qu'on est venu voir.
    const d = destinations.get(p)
    if (d) p.w.yaw = d.cap
    p.activite = 'regarde'
    p.reste = REGARD[0] + hasard(p) * (REGARD[1] - REGARD[0])
    return
  }
  const [tx, tz] = p.chemin[0]
  p.w.yaw = capVers(p.w, tx, tz)
  // Quelqu'un devant : on se range à droite en ralentissant (deux PNJ face à face s'évitent
  // ainsi tous deux, au lieu de s'attendre l'un l'autre sans fin).
  const g = gene(p, autres)
  p.w = step(m.plan, p.w, { forward: g ? 0.35 : 1, strafe: g ? 0.9 : 0, yaw: p.w.yaw, vitesse: VITESSE_PNJ }, dt)
  // Coincé (une chaise, un autre PNJ arrêté sur le chemin) : on change d'idée.
  p.releve.t += dt
  if (p.releve.t >= COINCE) {
    const fait = Math.hypot(p.w.x - p.releve.x, p.w.z - p.releve.z)
    if (fait < PROGRES * VITESSE_PNJ * p.releve.t) partir(m, p)
    p.releve = { t: 0, x: p.w.x, z: p.w.z }
  }
}
