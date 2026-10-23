/**
 * Les visiteurs du musée (PNJ) : où ils vont, et ce qu'ils y font.
 *
 * Comment ils y vont n'est pas ici : un `Pilote` les mène (en jeu, la foule de Recast sur
 * le navmesh tiré du plan, `babylon/navigation.ts`) et recopie leur position dans `p.w` à
 * chaque image. Le navmesh est percé de tout ce qui arrête la marche (murs, mobilier,
 * troncs, massifs, l'eau : `plan/navigation.ts`) ; la foule contourne les autres PNJ et
 * le visiteur. Ici on décide seulement : au musée, aller de toile en toile, s'arrêter et
 * regarder ; au jardin, suivre le circuit de la visite (belvédère puis rive sud, bouclé
 * vers la baraque) dans un sens ou dans l'autre, avec parfois une halte à un point de vue.
 * Coincé, on change d'idée.
 *
 * Pur : ni Babylon ni DOM. `avancerPnj` modifie le PNJ en place ; le hasard vient de la
 * graine du PNJ.
 */
import { arriveeDevant, cibleDe } from './arrivee.ts'
import type { Accrochage } from './hang.ts'
import type { Lieu } from './promenade.ts'
import { contourner } from './mobilier.ts'
import { hauteurDuParc } from './relief.ts'
import { PARC as SURFACE_PARC, surfaceAt } from './rules.ts'
import { VISITE } from './tour.ts'
import type { Plan } from './types.ts'

/** Une marche de flâneur, en m/s (celle de la marche « Casual Walk » jouée à sa cadence). */
export const VITESSE_PNJ = 1.15
/** Un but est atteint à cette distance au sol (m). */
const ATTEINT = 0.35
/** Sans avancer d'au moins ce rapport de la distance prévue pendant `COINCE` s, on change d'idée. */
const PROGRES = 0.3
const COINCE = 3
/** Le temps passé devant une toile, ou dans un coin du jardin (s). */
const REGARD: [number, number] = [6, 16]
/** Au jardin, à chaque point du circuit : la chance de s'arrêter regarder, puis celle de rebrousser chemin. */
const HALTE = 0.1
const DEMI_TOUR = 0.3

export type Activite = 'marche' | 'attente' | 'regarde'
export type Zone = 'musee' | 'jardin'

/** Un point où aller : où se tenir et vers où regarder. */
export interface Destination { surface: string; level: number; x: number; z: number; y: number; cap: number }

/** Où est le PNJ : ses pieds et son cap (0 = −z, comme le marcheur de `walk.ts`). */
export interface Pose { x: number; y: number; z: number; yaw: number }

export type Point3 = [x: number, y: number, z: number]

/** Ce qui mène les PNJ sur le sol (la foule de Recast, en jeu). */
export interface Pilote {
  /** L'envoie au point du sol le plus proche de (x, y, z) ; rend ce point, ou null s'il n'y en a pas. */
  aller(p: Pnj, x: number, y: number, z: number): Point3 | null
  /** L'arrête là où il est. */
  arreter(p: Pnj): void
}

/**
 * Les modèles montrés (`public/assets/pnj/pnj-<n>.glb`, `tools/generer-pnj.ts`). Écartés : ceux dont
 * Meshy a raté le squelette, que leur peau trahit dès l'attente bras ballants (maquettes.test.ts) :
 * pnj-2 (tête et racines des bras mal posées : cou de girafe, épaules en portemanteau), pnj-3
 * (rigué bras le long du corps : son jean suit ses mains). À régénérer (`--seul=<n>`), puis à remettre ici.
 */
export const MODELES_PNJ: readonly number[] = [0, 1, 4, 5, 6, 7]

export interface Pnj {
  n: number
  /** Le rang du modèle dans `MODELES_PNJ`. */
  modele: number
  zone: Zone
  w: Pose
  /** Le point du sol visé, quand il marche. */
  but: Point3 | null
  /** Ce qu'il est venu voir, une fois arrivé. */
  destination: Destination | null
  activite: Activite
  /** Secondes restantes d'attente ou de regard. */
  reste: number
  graine: number
  /** Pour juger qu'il est coincé : temps et distance depuis le dernier relevé. */
  releve: { t: number; x: number; z: number }
  /** Au jardin : le point visé du circuit et le sens de marche (±1). */
  etape: number
  sens: 1 | -1
}

export interface Monde {
  plan: Plan
  /** Les places devant chaque toile accrochée. */
  toiles: Destination[]
  /** Les coins du jardin (lieux calmes du parc). */
  jardin: Destination[]
  /** Le circuit du jardin (boucle fermée), et ses points au niveau du parc (où l'on peut apparaître). */
  circuit: [number, number][]
  departs: number[]
}

/** La boucle du jardin : le belvédère et la rive sud de la visite guidée, refermée vers son début. */
export function circuitDuJardin(): [number, number][] {
  const pts = VISITE.filter((s) => s.roomId === 'belvedere' || s.roomId === 'rive').flatMap((s) => s.points)
  return [...pts, ...contourner(SURFACE_PARC, pts[pts.length - 1], pts[0]).slice(0, -1)]
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
  const jardin = lieux.filter((l) => l.surface === SURFACE_PARC && !l.couchette)
    .map((l) => ({ surface: l.surface, level: 0, x: l.x, z: l.z, y: hauteurDuParc(l.x, l.z), cap: l.cap }))
  const circuit = circuitDuJardin()
  const departs = circuit.flatMap(([x, z], i) => (surfaceAt(plan, x, z, 0) === SURFACE_PARC ? [i] : []))
  return { plan, toiles, jardin, circuit, departs }
}

const choix = <T>(p: Pnj, l: readonly T[]): T => l[Math.floor(hasard(p) * l.length)]

/** En route vers `but` (déjà posé sur le sol par le pilote). */
function enRoute(p: Pnj, but: Point3, destination: Destination | null): void {
  p.but = but
  p.destination = destination
  p.activite = 'marche'
  p.releve = { t: 0, x: p.w.x, z: p.w.z }
}

/** Choisit une destination atteignable et y envoie le PNJ ; sinon, il attend un peu. */
function partir(m: Monde, p: Pnj, pilote: Pilote): void {
  if (p.zone === 'jardin' && m.circuit.length > 1) {
    // Le point suivant du circuit, dans le sens de marche (un point hors du sol est sauté).
    const n = m.circuit.length
    for (let essai = 0; essai < n; essai++) {
      p.etape = (p.etape + p.sens + n) % n
      const [x, z] = m.circuit[p.etape]
      const but = pilote.aller(p, x, hauteurDuParc(x, z), z)
      if (but) return enRoute(p, but, null)
    }
  } else {
    const liste = p.zone === 'musee' ? m.toiles : m.jardin
    for (let essai = 0; essai < 6 && liste.length > 0; essai++) {
      const d = choix(p, liste)
      if (Math.hypot(d.x - p.w.x, d.z - p.w.z) < 2) continue
      const but = pilote.aller(p, d.x, d.y, d.z)
      if (but) return enRoute(p, but, d)
    }
  }
  pilote.arreter(p)
  p.but = null
  p.activite = 'attente'
  p.reste = 2
}

const nouveau = (n: number, modeles: number, zone: Zone, graine: number): Pnj => ({
  n, modele: n % modeles, zone, w: { x: 0, y: 0, z: 0, yaw: 0 }, but: null, destination: null, activite: 'regarde', reste: 0,
  graine: (graine + n * 7919) >>> 0, releve: { t: 0, x: 0, z: 0 }, etape: 0, sens: 1,
})

/** Les PNJ du début : postés devant des toiles (musée) ou le long du circuit du jardin, en train de regarder. */
export function pnjInitiaux(m: Monde, combien: { musee: number; jardin: number }, modeles: number, graine: number): Pnj[] {
  const out: Pnj[] = []
  const prendre = (zone: Zone, liste: Destination[], k: number) => {
    for (let i = 0; i < k && liste.length > 0; i++) {
      const p = nouveau(out.length, modeles, zone, graine)
      // Des places toutes différentes : on avance dans la liste d'un pas premier avec la taille.
      const d = liste[(Math.floor(hasard(p) * liste.length) + i * 37) % liste.length]
      p.w = { x: d.x, y: d.y, z: d.z, yaw: d.cap }
      p.reste = REGARD[0] + hasard(p) * (REGARD[1] - REGARD[0])
      out.push(p)
    }
  }
  prendre('musee', m.toiles, combien.musee)
  if (m.circuit.length > 1 && m.departs.length > 0) {
    for (let i = 0; i < combien.jardin; i++) {
      const p = nouveau(out.length, modeles, 'jardin', graine)
      // Répartis le long de la boucle, dans les deux sens.
      p.etape = m.departs[Math.floor(((i + hasard(p) * 0.5) / combien.jardin) * m.departs.length) % m.departs.length]
      p.sens = hasard(p) < 0.5 ? 1 : -1
      const [x, z] = m.circuit[p.etape]
      p.w = { x, y: hauteurDuParc(x, z), z, yaw: hasard(p) * Math.PI * 2 }
      p.reste = 1 + hasard(p) * 6
      out.push(p)
    }
  } else prendre('jardin', m.jardin, combien.jardin)
  return out
}

/** Une image de vie du PNJ (`dt` en s), sa position déjà mise à jour par le pilote. */
export function avancerPnj(m: Monde, p: Pnj, dt: number, pilote: Pilote): void {
  if (p.activite !== 'marche' || !p.but) {
    p.reste -= dt
    if (p.reste <= 0) partir(m, p, pilote)
    return
  }
  if (Math.hypot(p.but[0] - p.w.x, p.but[2] - p.w.z) < ATTEINT) {
    pilote.arreter(p)
    p.but = null
    if (p.zone === 'jardin' && m.circuit.length > 1) {
      if (hasard(p) < HALTE) {
        p.activite = 'regarde'
        p.reste = REGARD[0] + hasard(p) * (REGARD[1] - REGARD[0])
        if (hasard(p) < DEMI_TOUR) p.sens = p.sens === 1 ? -1 : 1
      } else partir(m, p, pilote)
      return
    }
    // Arrivé : on se tourne vers ce qu'on est venu voir.
    if (p.destination) p.w.yaw = p.destination.cap
    p.activite = 'regarde'
    p.reste = REGARD[0] + hasard(p) * (REGARD[1] - REGARD[0])
    return
  }
  // Coincé (un attroupement devant une porte, le visiteur planté sur le chemin) : on change d'idée.
  p.releve.t += dt
  if (p.releve.t >= COINCE) {
    const fait = Math.hypot(p.w.x - p.releve.x, p.w.z - p.releve.z)
    p.releve = { t: 0, x: p.w.x, z: p.w.z }
    if (fait < PROGRES * VITESSE_PNJ * COINCE) partir(m, p, pilote)
  }
}
