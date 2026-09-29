/**
 * Le BÉBÉ HÉRISSON du jardin japonais : quinze centimètres de piquants qui
 * trottinent autour de l'étang, s'arrêtent tous les trois pas pour flairer
 * l'herbe, et se roulent en boule quand on s'approche.
 *
 * Il vit au bord de l'eau, sans jamais y entrer : son domaine est l'anneau de
 * pelouse et de fougères autour de l'étang, son nid le creux d'un buis. Il
 * contourne les rochers, les troncs, les bancs et la lanterne, reste sur la
 * pelouse (ni allée, ni parvis) et ne va pas au-delà du mur.
 *
 * Crépusculaire, comme les vrais : dehors presque toute la nuit, rarement le
 * jour (un petit qui a faim sort parfois l'après-midi), jamais l'hiver — il
 * hiberne sous son buis de la mi-novembre à la fin mars (`pelouse.terne`).
 *
 * Pur : l'état entre, l'état sort ; `FauneLayer` ne fait que le montrer.
 */
import { JARDIN, distanceRuisseau } from '../plan/jardin.ts'
import { distanceEtang } from '../plan/koi.ts'
import { blocsDuMobilier } from '../plan/mobilier.ts'
import { distanceRect, generateur, parkPlacements, surUneAllee, terrainDuParc, type Allee } from '../plan/park.ts'
import { MUSEE } from '../plan/musee.ts'
import { PARC } from '../plan/rules.ts'
import type { Rect } from '../plan/types.ts'

/** Son pas de fouille, m/s : dans la vidéo de Philippe, il avance à peine. */
export const VITESSE_HERISSON = 0.13
/** Le visiteur à moins de 1,5 m : il se roule en boule ; il se déroule quand on est à plus de 2,2 m. */
export const PORTEE_BOULE = 1.5
const PORTEE_DEROULE = 2.2
/** En boule, il attend encore de 4 à 7 s après le départ du visiteur. */
const ATTENTE_BOULE = [4, 7] as const
/** Se rouler : une demi-seconde ; se dérouler, prudemment : une seconde et demie. */
const ROULER = 0.5
const DEROULER = 1.5
/** Radians par seconde : il vire court, à petits pas. */
const VIRAGE = 1.8
/** Une trotte de 3 à 9 s, puis il flaire de 2 à 6 s ; arrivé à un but, de 5 à 12 s. */
const TROTTE = [3, 9] as const
const FLAIRE = [2, 6] as const
const FLAIRE_BUT = [5, 12] as const
/** Au nid, il reconsidère sa sortie toutes les 20 à 60 s. */
const SIESTE = [20, 60] as const
/** Son domaine : à moins de 20 m du centre de l'étang, à plus de 60 cm de l'eau. */
const CENTRE: [number, number] = [46, 65]
const DOMAINE = 20
const MARGE_EAU = 0.6

export type EtatHerisson = 'nid' | 'marche' | 'flaire' | 'boule'

export interface Herisson {
  x: number
  z: number
  /** Le cap : il avance vers (cos cap, sin cap) dans le plan (x, z). */
  cap: number
  etat: EtatHerisson
  /** Secondes restantes dans l'état (nid, flaire, trotte, attente en boule). */
  t: number
  /** 0 déroulé, 1 roulé en boule. */
  boule: number
  but: [number, number]
  /** Il rentre au nid. */
  rentre: boolean
  /** Vitesse réelle du dernier pas, m/s : le dandinement s'y cale. */
  vitesse: number
  graine: number
}

/** mulberry32 : un tirage dans [0, 1) et l'état suivant (comme `promenade.ts`). */
function tirer(etat: number): [number, number] {
  const s = (etat + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}
const entre = (u: number, [a, b]: readonly [number, number]) => a + u * (b - a)

interface Rond { x: number; z: number; r: number }

/** Ce qui l'arrête, calculé une fois : les troncs, les boules, les rochers, la lanterne, les bancs. */
let terrain: { ronds: Rond[]; blocs: Rect[]; allees: Allee[]; bords: Rect; nids: [number, number][]; buts: [number, number][] } | null = null
function monde() {
  if (terrain) return terrain
  const parc = parkPlacements(MUSEE)
  const ronds: Rond[] = [{ x: JARDIN.lanterne.x, z: JARDIN.lanterne.z, r: 0.5 }, ...JARDIN.pas.map(([x, z]) => ({ x, z, r: 0.45 }))]
  for (const p of parc.plantations) {
    if (p.espece === 'petales' || p.espece === 'fougere') continue
    ronds.push({ x: p.x, z: p.z, r: p.espece.startsWith('erable') ? 0.3 * p.scale : p.rayon * (p.espece.startsWith('rocher') ? 0.9 : 0.6) })
  }
  const t = terrainDuParc(MUSEE)
  terrain = {
    ronds,
    blocs: blocsDuMobilier(PARC).blocs,
    allees: parc.allees,
    // Le terrain moins un mètre ; le musée et son parvis (5 m) plus un mètre.
    bords: { x: t.x + 1, z: t.z + 1, width: t.width - 2, depth: t.depth - 2 },
    nids: [],
    buts: [],
  }
  const monParc = parc.plantations.filter((p) => Math.hypot(p.x - CENTRE[0], p.z - CENTRE[1]) < DOMAINE - 1)
  // Le nid : au bord d'un buis ou d'une azalée ; les buts : le bord des massifs et des fougères.
  for (const p of monParc) {
    const bord = p.espece === 'fougere' ? 0.2 : p.rayon * 0.6 + 0.12
    for (let k = 0; k < 4; k++) {
      const a = k * (Math.PI / 2) + p.rotation
      const q: [number, number] = [p.x + Math.cos(a) * bord, p.z + Math.sin(a) * bord]
      if (!libre(q[0], q[1])) continue
      if (p.espece === 'buis' || p.espece === 'azalee') terrain.nids.push(q)
      terrain.buts.push(q)
    }
  }
  // Et la pelouse ouverte, une grille de 3 m.
  for (let x = CENTRE[0] - DOMAINE; x <= CENTRE[0] + DOMAINE; x += 3)
    for (let z = CENTRE[1] - DOMAINE; z <= CENTRE[1] + DOMAINE; z += 3) if (libre(x, z)) terrain.buts.push([x, z])
  return terrain
}

const PARVIS: Rect = { x: -6, z: -6, width: MUSEE.width + 12, depth: MUSEE.depth + 12 }

/** Vrai s'il peut mettre la patte en (x, z) : dans son domaine, au sec, hors de tout obstacle. */
export function libre(x: number, z: number): boolean {
  const m = monde()
  if (Math.hypot(x - CENTRE[0], z - CENTRE[1]) > DOMAINE) return false
  if (distanceRect(m.bords, x, z) > 0 || distanceRect(PARVIS, x, z) <= 0) return false
  if (distanceEtang(x, z) < MARGE_EAU || distanceRuisseau(x, z) < MARGE_EAU) return false
  if (m.ronds.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) return false
  // Pas sur les allées : leurs dalles et leurs bordures dépassent de la pelouse, il y marcherait dedans.
  if (surUneAllee(m.allees, x, z, 0.35)) return false
  return m.blocs.every((b) => distanceRect(b, x, z) > 0.05)
}

/** La ligne droite de a à b est-elle libre ? (un pas tous les 25 cm) */
function voie(a: [number, number], b: [number, number]): boolean {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25)
  for (let i = 1; i <= n; i++) if (!libre(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false
  return true
}

/** Son nid : toujours le même buis, d'une session à l'autre. */
export function nid(): [number, number] {
  const n = monde().nids
  return n[Math.floor(generateur('herisson:nid')() * n.length)]
}

/**
 * L'envie de sortir, de 0 à 1 : pleine la nuit (`jour` = 0), faible en plein
 * jour, nulle en hibernation. `jour` est celui de `gameStore.ciel`.
 */
export function activite(jour: number, hiberne: boolean): number {
  if (hiberne) return 0
  const j = Math.min(1, Math.max(0, (jour - 0.1) / 0.5))
  return 1 - 0.85 * j * j * (3 - 2 * j)
}

/** Un but proche (moins de 8 m), atteignable en ligne droite ; faute de mieux, n'importe lequel. */
function choisirBut(h: Herisson): { but: [number, number]; graine: number } {
  const ici: [number, number] = [h.x, h.z]
  const proches = monde().buts.filter((b) => {
    const d = Math.hypot(b[0] - h.x, b[1] - h.z)
    return d > 1 && d < 8
  })
  let graine = h.graine
  // Quelques essais au hasard suffisent : la plupart des buts proches se voient.
  for (let k = 0; k < 6 && proches.length; k++) {
    let u: number
    ;[u, graine] = tirer(graine)
    const b = proches[Math.floor(u * proches.length)]
    if (voie(ici, b)) return { but: b, graine }
  }
  // Coincé : un pas de côté, dans une direction libre.
  for (let k = 0; k < 8; k++) {
    let u: number
    ;[u, graine] = tirer(graine)
    const a = u * 2 * Math.PI
    const b: [number, number] = [h.x + Math.cos(a) * 1.5, h.z + Math.sin(a) * 1.5]
    if (voie(ici, b)) return { but: b, graine }
  }
  return { but: ici, graine }
}

/** Rentrer : droit au nid s'il le voit, sinon un détour (le prochain arrêt redemandera le nid). */
function prochainBut(h: Herisson): { but: [number, number]; graine: number } {
  return h.rentre && voie([h.x, h.z], nid()) ? { but: nid(), graine: h.graine } : choisirBut(h)
}

/** Le hérisson au début d'une session : dehors quelque part, s'il est d'humeur, sinon au nid. */
export function herissonInitial(envie: number, graine = 1): Herisson {
  const [u, g1] = tirer(graine >>> 0)
  const [v, g2] = tirer(g1)
  const [x, z] = nid()
  const h: Herisson = { x, z, cap: v * 2 * Math.PI, etat: 'nid', t: entre(v, SIESTE), boule: 0, but: [x, z], rentre: false, vitesse: 0, graine: g2 }
  if (u >= envie) return h
  // Dehors : sur un but au hasard du domaine, en train de flairer.
  const buts = monde().buts
  const [w, g3] = tirer(g2)
  const [bx, bz] = buts[Math.floor(w * buts.length)]
  return { ...h, x: bx, z: bz, but: [bx, bz], etat: 'flaire', t: entre(v, FLAIRE), graine: g3 }
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Un pas de vie, de durée `dt`. `visiteur` : où il se tient, s'il est dehors
 * à hauteur d'homme ; `envie` : `activite()` du moment.
 */
export function avancerHerisson(h: Herisson, dt: number, visiteur: { x: number; z: number } | null, envie: number): Herisson {
  let { graine } = h
  let u: number
  const loin = visiteur ? Math.hypot(visiteur.x - h.x, visiteur.z - h.z) : Infinity

  if (h.etat === 'nid') {
    const t = h.t - dt
    if (t > 0) return { ...h, t, vitesse: 0 }
    ;[u, graine] = tirer(graine)
    const [v, g] = tirer(graine)
    if (u >= envie) return { ...h, t: entre(v, SIESTE), graine: g, vitesse: 0 }
    const s = choisirBut({ ...h, graine: g })
    return { ...h, etat: 'marche', rentre: false, t: entre(v, TROTTE), but: s.but, graine: s.graine, vitesse: 0 }
  }

  // Quelqu'un tout près : en boule, et on attend qu'il s'éloigne.
  if (h.etat !== 'boule' && loin < PORTEE_BOULE) {
    ;[u, graine] = tirer(graine)
    return { ...h, etat: 'boule', t: entre(u, ATTENTE_BOULE), graine, vitesse: 0, boule: Math.min(1, h.boule + dt / ROULER) }
  }
  if (h.etat === 'boule') {
    let t = h.t
    if (loin < PORTEE_DEROULE) {
      ;[u, graine] = tirer(graine)
      t = Math.max(t, entre(u, ATTENTE_BOULE))
    } else t -= dt
    if (t > 0) return { ...h, t, graine, vitesse: 0, boule: Math.min(1, h.boule + dt / ROULER) }
    const boule = Math.max(0, h.boule - dt / DEROULER)
    if (boule > 0) return { ...h, t: 0, graine, vitesse: 0, boule }
    // Déroulé : il flaire un instant, puis file ailleurs.
    ;[u, graine] = tirer(graine)
    return { ...h, etat: 'flaire', t: entre(u, FLAIRE), boule: 0, graine, vitesse: 0 }
  }

  if (h.etat === 'flaire') {
    const t = h.t - dt
    if (t > 0) return { ...h, t, vitesse: 0 }
    ;[u, graine] = tirer(graine)
    // Pas d'humeur à rester dehors : il rentre.
    const rentre = h.rentre || u < (1 - envie) * 0.7
    const [v, g] = tirer(graine)
    const s = prochainBut({ ...h, rentre, graine: g })
    return { ...h, etat: 'marche', rentre, but: s.but, t: entre(v, TROTTE), graine: s.graine, vitesse: 0 }
  }

  // En marche : vers le but, en zigzaguant un peu du museau.
  const [bx, bz] = h.but
  const d = Math.hypot(bx - h.x, bz - h.z)
  if (d < 0.15) {
    if (h.rentre && Math.hypot(bx - nid()[0], bz - nid()[1]) < 0.01) {
      ;[u, graine] = tirer(graine)
      return { ...h, etat: 'nid', t: entre(u, SIESTE), rentre: false, graine, vitesse: 0 }
    }
    ;[u, graine] = tirer(graine)
    return { ...h, etat: 'flaire', t: entre(u, FLAIRE_BUT), graine, vitesse: 0 }
  }
  const t = h.t - dt
  if (t <= 0 && !h.rentre) {
    ;[u, graine] = tirer(graine)
    return { ...h, etat: 'flaire', t: entre(u, FLAIRE), graine, vitesse: 0 }
  }
  const ecart = angle(Math.atan2(bz - h.z, bx - h.x) - h.cap)
  const cap = h.cap + Math.sign(ecart) * Math.min(Math.abs(ecart), VIRAGE * dt)
  // Il ralentit pour virer, et part d'un pas plus lent quand il ne va pas droit au but.
  const v = VITESSE_HERISSON * Math.max(0.2, Math.cos(Math.min(Math.abs(ecart), Math.PI / 2)))
  const [x, z] = [h.x + Math.cos(cap) * v * dt, h.z + Math.sin(cap) * v * dt]
  if (!libre(x, z)) {
    // Buté (le but était derrière un obstacle, ou il a coupé un virage) : il cherche ailleurs.
    const s = choisirBut(h)
    return { ...h, t, but: s.but, graine: s.graine, vitesse: 0, cap: cap + Math.PI / 4 }
  }
  return { ...h, x, z, cap, t, vitesse: dt > 0 ? v : 0 }
}
