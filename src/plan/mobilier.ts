/**
 * Le mobilier du musée : où poser chaque banc, et comment la marche les évite.
 *
 * « Je trouve que ça manque de mobilier » (Philippe). Chaque pièce est dans le
 * style de son lieu, modelée par `tools/blender/build-mobilier.py` :
 *
 * - dans chaque galerie, une banquette de velours vert capitonné sur chêne
 *   tourné, dans l'axe long de la salle — on s'y assoit face aux grands murs ;
 * - dans la nef, deux paires de longs bancs de chêne et de cuir, entre les
 *   bandes de granit, de part et d'autre de l'allée centrale ;
 * - près de l'entrée, la banque d'accueil de noyer, de laiton et de marbre ;
 * - dans la salle d'honneur, deux bancs doubles de la Casa Batlló, face aux vitrines ;
 * - au jardin, un banc de granit brut au bord de l'étang et trois bancs de
 *   cèdre tournés vers l'eau ou vers le musée.
 *
 * ── Hors des passages ──
 *
 * La visite (`tour.ts`) et Bavette (`promenade.ts`) marchent en ligne droite
 * d'une porte à l'autre et jusqu'au centre de chaque salle. Une banquette posée
 * pile au centre barrerait ces lignes : chacune est décalée juste assez pour
 * les laisser libres (`DEGAGEMENT`, vérifié par les tests). Dans la nef, les
 * diagonales d'une porte à l'autre traversent forcément les bancs : `contourner`
 * y ajoute les points de passage qui les évitent, et `step()` les arrête
 * de toute façon — leurs emprises sont des obstacles du plan (`musee.ts`).
 *
 * Pur : ni three ni React. Les emprises sont celles des modèles Blender.
 */
import { cimaisesDe, emprise as empriseCimaise } from './cimaises.ts'
import { hauteurDuParc } from './relief.ts'
import type { Rect } from './types.ts'

export type PieceMobilier = 'Banquette' | 'BancNef' | 'Accueil' | 'BancBatllo' | 'BancPierre' | 'BancJardin'

/** L'emprise au sol de chaque modèle, à plat : `largeur` selon son x, `profondeur` selon son z (son avant). */
export const DIMENSIONS: Record<PieceMobilier, { largeur: number; profondeur: number }> = {
  Banquette: { largeur: 2.2, profondeur: 0.7 },
  BancNef: { largeur: 2.8, profondeur: 0.6 },
  Accueil: { largeur: 2.9, profondeur: 0.85 },
  BancBatllo: { largeur: 1.4, profondeur: 0.64 },
  BancPierre: { largeur: 1.66, profondeur: 0.56 },
  BancJardin: { largeur: 1.8, profondeur: 0.5 },
}

export interface Meuble {
  piece: PieceMobilier
  /** La surface de `surfaceAt` où il est posé : `<niveau>:<salle>` ou `parc:terrain`. */
  surface: string
  niveau: number
  x: number
  /** La cote du pied : le plancher, ou la pelouse du parc. */
  y: number
  z: number
  /** Lacet, en radians : le modèle regarde +Z, une rotation θ l'envoie vers (sin θ, cos θ). */
  lacet: number
}

const RDC = 0
const ETAGE = 4.8
const [SUD, EST, NORD] = [0, Math.PI / 2, Math.PI]
const PARC = 'parc:terrain'

const dans = (piece: PieceMobilier, surface: string, x: number, z: number, lacet: number): Meuble => {
  const [niveau] = surface.split(':')
  const n = niveau === 'parc' ? RDC : Number(niveau)
  return { piece, surface, niveau: n, x, z, lacet, y: surface === PARC ? hauteurDuParc(x, z) : n === 1 ? ETAGE : RDC }
}

/**
 * Les banquettes des ailes : la même place aux deux niveaux, puisque les portes
 * s'y superposent. Au centre, décalée hors des lignes de porte à porte : vers
 * le nord (salles 1), le sud (salles 3), ou vers le dehors quand trois portes
 * se croisent au centre (salles 2).
 */
const AILES: [string, string, number, number][] = [
  ['r-o1', 'e-o1', 8, 4.7], ['r-e2', 'e-e2', 42.2, 20], ['r-e3', 'e-e3', 40, 35.3],
  // Les galeries 2 de l'ouest ont leur cimaise dans la moitié ouest (cimaises.ts) :
  // la banquette passe dans l'angle nord-est, hors des lignes de la porte du hall, et regarde la salle.
  ['r-o2', 'e-o2', 12.6, 15.8],
]

export const MOBILIER: Meuble[] = [
  ...AILES.flatMap(([rdc, etage, x, z]) => [dans('Banquette', `0:${rdc}`, x, z, SUD), dans('Banquette', `1:${etage}`, x, z, SUD)]),
  // Là où un seul des deux niveaux a une cimaise (cimaises.ts), la banquette de
  // l'autre garde sa place ; celle de la salle à cimaise se tourne vers elle.
  dans('Banquette', '0:r-o3', 8, 35.3, SUD),
  dans('Banquette', '1:e-o3', 5.5, 31, SUD),
  dans('Banquette', '1:e-e1', 40, 4.7, SUD),
  dans('Banquette', '0:r-e1', 42.6, 8.4, NORD),
  // La galerie du nord, traversée d'ouest en est par z = 6 : la cimaise au nord de l'axe, la banquette au sud, face à elle.
  dans('Banquette', '0:r-n', 24, 8.4, NORD),
  // La nef : entre le filet de granit (x = 20, 28) et l'allée centrale (22,4–25,6),
  // dans les deux travées qui ne font face à aucune porte (z 26–29,5 et 29,5–33).
  // Entre les deux, sur la bande de granit, on traverse la nef d'un mur à l'autre.
  ...[21.2, 26.8].flatMap((x) => [27.6, 31.35].map((z) => dans('BancNef', '0:hall', x, z, EST))),
  // L'accueil, dans l'angle sud-est du hall, tourné vers l'ouest : on le voit en entrant, sur sa droite.
  dans('Accueil', '0:hall', 30.5, 37.8, -EST),
  // La salle d'honneur : au sud de l'axe des portes (z = 6), face aux vitrines du mur nord.
  dans('BancBatllo', '1:honneur', 21, 8.3, NORD),
  dans('BancBatllo', '1:honneur', 27, 8.3, NORD),
  // Le jardin : le granit sur la rive nord de l'étang, entre les fougères, face à l'eau…
  dans('BancPierre', PARC, 42.5, 53.9, SUD),
  // … le cèdre sur la rive ouest, sous l'érable et près de la lanterne, face à l'étang,
  dans('BancJardin', PARC, 29.4, 62, EST),
  // et sur la pelouse du sud, entre les buis, deux bancs qui regardent la façade.
  dans('BancJardin', PARC, 36.5, 47.6, NORD),
  dans('BancJardin', PARC, 13.5, 47.6, NORD),
  // Là où les accès du nord, de l'ouest et de l'est touchent le chemin de ceinture,
  // un banc, dos au musée, tourné vers le parc : l'allée mène quelque part. Un peu
  // à côté de l'axe, qui reste un passage le long de la façade.
  dans('BancJardin', PARC, 56.6, 22.6, EST),
  dans('BancJardin', PARC, -8.6, 22.6, -EST),
  dans('BancJardin', PARC, 26.6, -8.6, NORD),
]

/** L'emprise au sol d'un meuble posé : son rectangle tourné, aligné sur les axes. */
export function emprise(m: Meuble): Rect {
  const { largeur, profondeur } = DIMENSIONS[m.piece]
  const [c, s] = [Math.abs(Math.cos(m.lacet)), Math.abs(Math.sin(m.lacet))]
  const [w, d] = [c * largeur + s * profondeur, s * largeur + c * profondeur]
  return { x: m.x - w / 2, z: m.z - d / 2, width: w, depth: d }
}

/** Les emprises d'un niveau, comme obstacles de la marche — le parc compte au rez-de-chaussée. */
export const obstaclesDuMobilier = (niveau: number): Rect[] => MOBILIER.filter((m) => m.niveau === niveau).map(emprise)

// ── Contourner ──────────────────────────────────────────────────────────────

type Point = [number, number]

/** Le rayon du visiteur (`walk.ts`), plus une marge : on frôle un banc, on ne s'y frotte pas. */
const MARGE = 0.3 + 0.15
/**
 * Les coins de contournement, au-delà de la marge : un pas de l'un à l'autre
 * longe le banc sans le toucher, même quand le chat, qui tourne en arc, coupe
 * le virage — il vise le coin suivant dès qu'il est à 25 cm de celui-ci.
 */
const COIN = MARGE + 0.35

const gonfler = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, width: r.width + 2 * m, depth: r.depth + 2 * m })
const coins = (r: Rect): Point[] => [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]]

/** Le segment [a, b] coupe-t-il le rectangle ? (Liang–Barsky) */
export function coupe(a: Point, b: Point, r: Rect): boolean {
  let [t0, t1] = [0, 1]
  const d = [b[0] - a[0], b[1] - a[1]]
  const bornes: [number, number][] = [[-d[0], a[0] - r.x], [d[0], r.x + r.width - a[0]], [-d[1], a[1] - r.z], [d[1], r.z + r.depth - a[1]]]
  for (const [p, q] of bornes) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

/**
 * Le plus court chemin de a à b qui ne coupe aucun bloc, par les nœuds donnés
 * (Dijkstra sur le graphe de visibilité). Rend les points à suivre, b compris ;
 * `[b]` si la ligne droite est libre, ou si rien ne passe.
 */
export function contournement(a: Point, b: Point, blocs: Rect[], noeuds: Point[]): Point[] {
  const libre = (p: Point, q: Point) => blocs.every((r) => !coupe(p, q, r))
  if (libre(a, b)) return [b]
  const n = [a, b, ...noeuds]
  const dist = n.map(() => Infinity)
  const venu = n.map(() => -1)
  const fait = n.map(() => false)
  dist[0] = 0
  for (;;) {
    let i = -1
    for (let k = 0; k < n.length; k++) if (!fait[k] && dist[k] < Infinity && (i < 0 || dist[k] < dist[i])) i = k
    if (i < 0 || i === 1) break
    fait[i] = true
    for (let k = 0; k < n.length; k++) {
      if (fait[k] || !libre(n[i], n[k])) continue
      const d = dist[i] + Math.hypot(n[k][0] - n[i][0], n[k][1] - n[i][1])
      if (d < dist[k]) [dist[k], venu[k]] = [d, i]
    }
  }
  if (venu[1] < 0) return [b]
  const out: Point[] = []
  for (let k = 1; k > 0; k = venu[k]) out.unshift(n[k])
  return out
}

/** Les blocs et les coins du mobilier d'une surface — cimaises comprises : de quoi le contourner, ou l'ajouter à d'autres blocs. */
export function blocsDuMobilier(surface: string): { blocs: Rect[]; noeuds: Point[] } {
  const [niveau, salle] = surface.split(':')
  const cimaises = niveau === 'parc' ? [] : cimaisesDe(Number(niveau), salle).map(empriseCimaise)
  const e = [...MOBILIER.filter((m) => m.surface === surface).map(emprise), ...cimaises]
  const blocs = e.map((r) => gonfler(r, MARGE))
  // Un coin pris dans un autre meuble ne mène nulle part.
  const noeuds = e.flatMap((r) => coins(gonfler(r, COIN))).filter(([x, z]) => blocs.every((r) => !coupe([x, z], [x, z], r)))
  return { blocs, noeuds }
}

/** De a à b dans une même surface, en contournant son mobilier : les points à suivre, b compris. */
export function contourner(surface: string, a: Point, b: Point): Point[] {
  const { blocs, noeuds } = blocsDuMobilier(surface)
  return contournement(a, b, blocs, noeuds)
}
