/**
 * La promenade de Bavette : où va le chat, par où, et ce qu'il fait arrivé.
 *
 * Bavette n'est plus une pièce sur un socle : il se promène, dans le musée et
 * dans le parc. Il va d'un LIEU CALME à l'autre — devant une toile, sous un
 * arbre, sur le palier de l'escalier, au bout d'un balcon —, s'y arrête, s'y
 * assoit parfois, puis repart.
 *
 * Il marche par le même `step()` que le visiteur : il ne traverse ni un mur ni
 * un obstacle, monte l'escalier sur la pente de ses volées, et reste dans le
 * terrain du parc. Ses chemins suivent le graphe des passages de la visite
 * guidée (`tour.ts`), complété de l'entrée vers le parc ; dehors, il contourne
 * le bâtiment par ses angles plutôt que de buter contre la façade.
 *
 * Pur et semé : une graine donne toujours la même promenade, et les tests la
 * rejouent. Ni three ni React.
 */
import { presDeLEau } from './jardin.ts'
import { OBSTACLES_PORTIQUE } from './facade.ts'
import { DIMENSIONS, MOBILIER, blocsDuMobilier, contournement, contourner as eviter } from './mobilier.ts'
import type { Parc } from './park.ts'
import { PARC, PASSABLE, surfaceAt } from './rules.ts'
import { capVers, chemin, passages } from './tour.ts'
import type { Plan } from './types.ts'
import { step, type Walker } from './walk.ts'

/**
 * Le pas de Bavette, m/s, relevé sur une vidéo de lui marchant dans l'herbe
 * (0,41 à 0,45 m/s). C'est aussi la vitesse à laquelle `Marche` est cuite
 * (FOULEE / PERIODE du script Blender : 0,40 m en 28/30 s) : à ce pas, elle
 * joue à `timeScale = 1`.
 */
export const VITESSE_CHAT = 0.4 / (28 / 30)
/** Radians par seconde : il tourne en arc, jamais sur place. */
const VIRAGE = 2.2
/** Un point de passage est atteint à 25 cm. */
const ATTEINT = 0.25
/** Sans avancer pendant ce temps, il renonce et choisit ailleurs. */
const PATIENCE = 2.5
/** L'arrêt, en secondes : de quoi respirer, ou de quoi s'asseoir. */
const PAUSE = [6, 30] as const
/** Assez long pour s'asseoir : se poser prend 1,2 s, se relever autant. */
const PAUSE_ASSISE = 9
const SE_POSER = 1.5
const SE_LEVER = 1.6
/** Un lieu calme se tient à l'écart des portes : on ne s'arrête pas dans un passage. */
const LOIN_DES_PORTES = 2
/** Le dernier pas se fait droit sur le lieu, pour y arriver dans le bon sens. */
const APPROCHE = 0.8

export type Posture = 'marche' | 'debout' | 'assis'

export interface Lieu {
  surface: string
  x: number
  z: number
  /** Le cap où regarder une fois arrivé (0 = −z, comme `Walker.yaw`). */
  cap: number
  genre: 'toile' | 'hall' | 'palier' | 'balcon' | 'arbre' | 'banc'
}

export interface Promenade {
  walker: Walker
  /** Les points de passage qui restent, le lieu compris. */
  points: [number, number][]
  lieu: Lieu
  /** Secondes d'arrêt restantes, et la durée totale de cet arrêt. */
  pause: number
  duree: number
  /** Secondes sans avancer. */
  bloque: number
  /** Vitesse réelle du dernier pas, m/s : la marche se cale dessus. */
  vitesse: number
  /** L'état du générateur : la promenade est une fonction de sa graine. */
  graine: number
}

/** mulberry32 : un tirage dans [0, 1) et l'état suivant. */
function tirer(etat: number): [number, number] {
  const s = (etat + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s]
}

const loinDesPortes = (plan: Plan, niveau: number, x: number, z: number) =>
  plan.levels.find((l) => l.id === niveau)!.openings.every((o) => !PASSABLE.has(o.kind) || Math.hypot(o.x - x, o.z - z) > LOIN_DES_PORTES)

/**
 * Les lieux où il fait bon s'arrêter.
 *
 * Devant chaque mur des salles exposées, à 1,3 m, face à la toile ; aux quatre
 * coins calmes du hall ; sur le palier, entre les départs des volées ; au bout
 * des balcons ; au pied des arbres proches du musée, sous leur houppier ; et
 * au bout des bancs.
 */
/** Au jardin : ses coins tranquilles, et leur distance minimale à l'étang et au ruisseau. */
const LIEUX_DEHORS = 24
const LOIN_DE_L_EAU = 2
/** Du bout d’un banc au chat : au-delà de la marge de contournement (`mobilier.ts`), pour en repartir. */
const AU_BOUT_DU_BANC = 0.6
/** Un banc « au bord de l’eau » : à moins de 8 m de l’étang. */
const BORD_DE_L_EAU = 8

export function lieuxCalmes(plan: Plan, parc: Parc): Lieu[] {
  const out: Lieu[] = []
  const ajouter = (niveau: number, elevation: number, x: number, z: number, cap: number, genre: Lieu['genre']) => {
    const surface = surfaceAt(plan, x, z, elevation)
    if (surface && loinDesPortes(plan, niveau, x, z)) out.push({ surface, x, z, cap, genre })
  }
  for (const level of plan.levels) {
    for (const r of level.rooms) {
      const [cx, cz] = [r.x + r.width / 2, r.z + r.depth / 2]
      if (r.kind === 'gallery' || r.kind === 'honneur') {
        const d = 1.3
        ajouter(level.id, level.elevation, cx, r.z + d, 0, 'toile')
        ajouter(level.id, level.elevation, cx, r.z + r.depth - d, Math.PI, 'toile')
        ajouter(level.id, level.elevation, r.x + d, cz, Math.PI / 2, 'toile')
        ajouter(level.id, level.elevation, r.x + r.width - d, cz, -Math.PI / 2, 'toile')
      } else if (r.kind === 'hall') {
        // Les coins sud, à l'écart de l'axe de l'entrée, tournés vers l'escalier.
        for (const [fx, fz] of [[0.2, 0.62], [0.8, 0.62], [0.2, 0.9], [0.8, 0.9]])
          ajouter(level.id, level.elevation, r.x + fx * r.width, r.z + fz * r.depth, 0, 'hall')
      } else if (r.kind === 'balcony') {
        const long = r.depth > r.width
        ajouter(level.id, level.elevation, long ? cx : r.x + r.width * 0.25, long ? r.z + r.depth * 0.3 : cz, long ? Math.PI : 0, 'balcon')
      }
    }
  }
  for (const l of plan.landings) {
    // Entre le départ d'une volée latérale et l'arrivée de la centrale, face au hall.
    for (const fx of [0.28, 0.72]) {
      const [x, z] = [l.x + fx * l.width, l.z + l.depth * 0.45]
      if (plan.flights.every((f) => Math.abs(f.x + f.width / 2 - x) > 1.2)) out.push({ surface: `palier:${l.id}`, x, z, cap: Math.PI, genre: 'palier' })
    }
  }
  // Sous les arbres et au pied des massifs proches : un chat ne va pas au bout du
  // terrain, ni au bord de l'eau (le jardin a des berges que la marche ne borne
  // qu'à peu près). Les plus proches du musée seulement : le jardin compte
  // autant de coins que les salles, pas huit fois plus, sinon il n'en sort plus.
  const [bx, bz] = [plan.width / 2, plan.depth / 2]
  const dehors: (Lieu & { d: number })[] = []
  for (const p of parc.plantations) {
    const d = Math.hypot(p.x - bx, p.z - bz)
    if (d > Math.max(plan.width, plan.depth) / 2 + 30) continue
    const [dx, dz] = [bx - p.x, bz - p.z]
    const [x, z] = [p.x + (dx / d) * p.rayon * 0.6, p.z + (dz / d) * p.rayon * 0.6]
    if (presDeLEau(x, z, LOIN_DE_L_EAU) || surfaceAt(plan, x, z, 0) !== PARC) continue
    dehors.push({ surface: PARC, x, z, cap: capVers({ x, z }, p.x, p.z) + Math.PI, genre: 'arbre', d })
  }
  // Au bout d'un banc — un chat aime faire la sieste au pied d'un banc —, tourné vers ce qu'il regarde :
  // ceux de la salle d'honneur et ceux du bord de l'étang. Pas ceux de la nef, qui bordent un
  // passage, ni ceux de la pelouse, si près de l'entrée qu'ils l'attireraient dehors à chaque fois.
  const bancs: Lieu[] = []
  for (const m of MOBILIER) {
    const bout = DIMENSIONS[m.piece].largeur / 2 + AU_BOUT_DU_BANC
    const [x, z] = [m.x + Math.cos(m.lacet) * bout, m.z - Math.sin(m.lacet) * bout]
    const auBordDeLEau = m.surface === PARC && presDeLEau(x, z, BORD_DE_L_EAU) && !presDeLEau(x, z, LOIN_DE_L_EAU)
    if ((m.piece === 'BancBatllo' || auBordDeLEau) && loinDesPortes(plan, m.niveau, x, z))
      bancs.push({ surface: m.surface, x, z, cap: m.lacet + Math.PI, genre: 'banc' })
  }
  // Les bancs du jardin prennent la place d'autant d'arbres : le jardin garde son compte de coins.
  dehors.sort((a, b) => a.d - b.d || a.x - b.x)
  const arbres = LIEUX_DEHORS - bancs.filter((l) => l.surface === PARC).length
  for (const l of dehors.slice(0, arbres)) out.push({ surface: l.surface, x: l.x, z: l.z, cap: l.cap, genre: l.genre })
  out.push(...bancs)
  return out
}

/** Les passages de la visite, plus l'entrée : du hall au parc, au-delà du portique. */
function graphe(plan: Plan) {
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

/**
 * Dehors, de a à b sans traverser le musée : par les angles de son emprise
 * (portique compris), plus court chemin sur ce petit graphe de visibilité —
 * où les bancs du jardin sont des blocs de plus, avec leurs coins.
 */
function contourner(plan: Plan, a: [number, number], b: [number, number]): [number, number][] {
  const m = 0.6
  const bati = [{ x: 0, z: 0, width: plan.width, depth: plan.depth }, ...OBSTACLES_PORTIQUE].map((r) => ({ x: r.x - m, z: r.z - m, width: r.width + 2 * m, depth: r.depth + 2 * m }))
  const e = 2.5
  const sud = Math.max(plan.depth, ...OBSTACLES_PORTIQUE.map((o) => o.z + o.depth)) + e
  const bancs = blocsDuMobilier(PARC)
  const angles: [number, number][] = [[-e, -e], [plan.width + e, -e], [plan.width + e, sud], [-e, sud]]
  return contournement(a, b, [...bati, ...bancs.blocs], [...angles, ...bancs.noeuds])
}

/** Les points de passage de la surface `de` jusqu'au lieu, `null` s'il est inatteignable. */
export function itineraire(plan: Plan, de: Pick<Walker, 'surface' | 'x' | 'z'>, lieu: Lieu): [number, number][] | null {
  // ponytail: graphe recalculé à chaque destination — une par arrêt, soit toutes les dix secondes.
  // Dedans, le chemin contourne le mobilier de chaque salle ; dehors, c'est `contourner` qui s'en charge.
  const pts = chemin(graphe(plan), de.surface, lieu.surface, de.surface === PARC ? undefined : [de.x, de.z])
  if (!pts) return null
  const approche: [number, number] = [lieu.x + Math.sin(lieu.cap) * APPROCHE, lieu.z + Math.cos(lieu.cap) * APPROCHE]
  const bruts: [number, number][] = [...pts, approche, [lieu.x, lieu.z]]
  // Dehors, chaque tronçon contourne le bâtiment et les bancs ; dedans, le dernier, vers le lieu, le mobilier.
  const out: [number, number][] = []
  let ici: [number, number] = [de.x, de.z]
  const dehors = (p: [number, number]) => surfaceAt(plan, p[0], p[1], 0) === PARC
  bruts.forEach((p, k) => {
    out.push(...(dehors(ici) && dehors(p) ? contourner(plan, ici, p) : k === pts.length ? eviter(lieu.surface, ici, p) : [p]))
    ici = p
  })
  return out
}

/**
 * Le prochain lieu : plutôt proche (en mètres de chemin), jamais celui d'où il part ;
 * une fois sur trois, là où se tient le visiteur — un chat vient voir.
 */
function choisir(plan: Plan, lieux: readonly Lieu[], p: Pick<Promenade, 'walker' | 'lieu' | 'graine'>, visiteur?: string): { lieu: Lieu; points: [number, number][]; graine: number } | null {
  let graine = p.graine
  let u: number
  ;[u, graine] = tirer(graine)
  const longueur = (pts: [number, number][]) => pts.reduce((s, q, i) => s + Math.hypot(q[0] - (i ? pts[i - 1][0] : p.walker.x), q[1] - (i ? pts[i - 1][1] : p.walker.z)), 0)
  const candidats = lieux
    .filter((l) => l !== p.lieu)
    .map((l) => ({ l, points: itineraire(plan, p.walker, l) }))
    .filter((c): c is { l: Lieu; points: [number, number][] } => c.points !== null)
  const pres = visiteur ? candidats.filter((c) => c.l.surface === visiteur) : []
  const pool = pres.length && u < 1 / 3 ? pres : candidats
  if (!pool.length) return null
  // Plutôt près : à 6 m, huit fois moins probable qu’à côté ; à 30 m, deux cents fois.
  const poids = pool.map((c) => 1 / (1 + longueur(c.points) / 6) ** 3)
  ;[u, graine] = tirer(graine)
  let r = u * poids.reduce((a, b) => a + b, 0)
  let i = 0
  while (i < pool.length - 1 && (r -= poids[i]) > 0) i++
  return { lieu: pool[i].l, points: pool[i].points, graine }
}

/** Le chat posé sur un lieu, au repos. */
export function poser(plan: Plan, lieu: Lieu, graine: number, pause = 6): Promenade {
  const [niveau] = lieu.surface.split(':')
  const level = plan.levels.find((l) => String(l.id) === niveau)
  const cote = lieu.surface.startsWith('palier:') ? plan.landings.find((l) => `palier:${l.id}` === lieu.surface)!.elevation : level?.elevation ?? 0
  const a: Walker = { level: level?.id ?? 0, surface: lieu.surface, x: lieu.x, z: lieu.z, y: cote, yaw: lieu.cap }
  // Un pas nul : `step` règle le niveau et la cote de la surface.
  const walker = step(plan, a, { forward: 0, strafe: 0, yaw: lieu.cap }, 0)
  return { walker, points: [], lieu, pause, duree: pause, bloque: 0, vitesse: 0, graine: graine >>> 0 }
}

/** Le départ d'une session : dans la salle où l'on entre, pour qu'on le croise. */
export function promenadeInitiale(plan: Plan, lieux: readonly Lieu[], graine: number): Promenade {
  const level = plan.levels.find((l) => l.id === plan.spawn.level)!
  const accueil = surfaceAt(plan, plan.spawn.x, plan.spawn.z, level.elevation)
  const ici = lieux.filter((l) => l.surface === accueil)
  const pool = ici.length ? ici : lieux
  const [u, g] = tirer(graine >>> 0)
  return poser(plan, pool[Math.floor(u * pool.length)], g)
}

/** Ce que fait le corps : l'arrêt long passe par l'assise, et s'en relève avant de repartir. */
export function posture(p: Promenade): Posture {
  if (p.points.length) return 'marche'
  const ecoule = p.duree - p.pause
  return p.duree >= PAUSE_ASSISE && ecoule >= SE_POSER && p.pause >= SE_LEVER ? 'assis' : 'debout'
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Un pas de promenade, de durée `dt`. `visiteur` : la surface où il se tient, s'il est là. */
export function avancerPromenade(plan: Plan, lieux: readonly Lieu[], p: Promenade, dt: number, visiteur?: string): Promenade {
  if (!p.points.length) {
    const pause = p.pause - dt
    if (pause > 0) return { ...p, pause, vitesse: 0 }
    const suite = choisir(plan, lieux, p, visiteur)
    if (!suite) return { ...p, pause: 2, duree: 2, vitesse: 0, graine: tirer(p.graine)[1] }
    return { ...p, ...suite, bloque: 0, pause: 0, duree: 0 }
  }
  const w = p.walker
  const [cx, cz] = p.points[0]
  const voulu = capVers(w, cx, cz)
  const ecart = angle(voulu - w.yaw)
  const cap = w.yaw + Math.sign(ecart) * Math.min(Math.abs(ecart), VIRAGE * dt)
  // Il ralentit dans les virages serrés plutôt que de pivoter sur place.
  const v = VITESSE_CHAT * Math.max(0.25, Math.cos(Math.min(Math.abs(ecart), Math.PI / 2)))
  const n = step(plan, w, { forward: 1, strafe: 0, yaw: cap, vitesse: v }, dt)
  const fait = Math.hypot(n.x - w.x, n.z - w.z)
  const bloque = dt > 0 && fait < 0.3 * v * dt ? p.bloque + dt : 0
  let points = p.points
  if (Math.hypot(cx - n.x, cz - n.z) < ATTEINT) points = points.slice(1)
  let { pause, duree, graine } = p
  if (!points.length || bloque > PATIENCE) {
    // Arrivé — ou coincé : il s'arrête là, et repartira ailleurs.
    let u: number
    ;[u, graine] = tirer(graine)
    duree = pause = bloque > PATIENCE ? 2 : PAUSE[0] + u * (PAUSE[1] - PAUSE[0])
    points = []
  }
  return { ...p, walker: n, points, pause, duree, bloque: points.length ? bloque : 0, vitesse: dt > 0 ? fait / dt : 0, graine }
}

/**
 * Le visiteur REGARDE-t-il Bavette ? À moins de `portee` mètres, le chat dans
 * un cône de 30° autour du regard. En 3D : un chat se regarde vers le bas.
 */
export function regardeBavette(oeil: { x: number; y: number; z: number }, regard: { x: number; y: number; z: number }, chat: { x: number; y: number; z: number }, portee = 3): boolean {
  const [dx, dy, dz] = [chat.x - oeil.x, chat.y - oeil.y, chat.z - oeil.z]
  const d = Math.hypot(dx, dy, dz)
  const n = Math.hypot(regard.x, regard.y, regard.z)
  if (d > portee || d < 1e-6 || n < 1e-9) return false
  return (dx * regard.x + dy * regard.y + dz * regard.z) / (d * n) > Math.cos((30 * Math.PI) / 180)
}

/** Le cartel de Bavette, affiché quand on le regarde de près. */
export const CARTEL_BAVETTE = {
  title: 'Bavette',
  author: 'Philippe Matray',
  year: 2026,
  ligne: 'Il se promène librement dans le musée et dans le jardin.',
  medium: 'Modèle 3D par IA (Meshy, d’après photographie), animé dans Blender',
} as const
