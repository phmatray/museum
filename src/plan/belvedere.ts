/**
 * Le BELVÉDÈRE du fond du jardin, et le ROJI qui y mène.
 *
 * ── Pourquoi ──
 *
 * Le jardin se lisait d'un seul regard depuis le portique : une pelouse plate,
 * l'étang, le mur de brique, le ciel. Rien ne tirait l'œil au-delà, aucun point
 * d'où voir le tout, aucune allée qui cadre quoi que ce soit. Le belvédère en
 * est la réponse de composition :
 *
 * - un REPÈRE : une terrasse de pierre de 2,70 m dans l'angle sud-est, un
 *   pavillon de thé (azumaya) dessus, qu'on voit de l'autre bout de l'étang et
 *   dont la lanterne brille la nuit — on a envie d'y aller ;
 * - une COMPRESSION : on n'y monte pas par la pelouse. Le roji, l'allée étroite
 *   du chemin de thé, part du pont, passe une petite porte couverte et file
 *   entre une palissade de bambou (kenninji-gaki), qui cache l'eau et le musée,
 *   et le mur d'enceinte sous les érables ;
 * - une RÉVÉLATION : l'escalier monte dos au jardin ; en haut, on se retourne,
 *   et l'on a d'un coup l'étang au premier plan, la cascade, les érables
 *   rouges, et au fond la façade et sa verrière — une PERCÉE où l'on a
 *   éclairci les grands arbres (`dansLaPercee`) ;
 * - un RETOUR : une seconde volée descend à l'ouest, vers l'étang, et des pas
 *   japonais longent la rive sud jusqu'à l'axe de l'entrée, face à la façade
 *   encadrée : la promenade fait une boucle, elle ne finit pas en cul-de-sac.
 *
 * La terrasse est le relief du parc (`relief.ts` lit `coteDuBelvedere`) : on y
 * marche comme sur une butte, les murs et le parapet sont des obstacles du
 * rez-de-chaussée, comme ceux de la baraque du chantier.
 *
 * Tout vit dans `belvedere.json`, lu aussi par `tools/blender/build-belvedere.py`.
 * Pur : ni three ni React.
 */
import BELVEDERE_JSON from './belvedere.json' with { type: 'json' }
import type { Box } from './mesh.ts'
import type { Rect } from './types.ts'

type Axe = 'x' | 'z'
type Point = [number, number]

export const BELVEDERE = BELVEDERE_JSON as unknown as {
  emprise: Rect
  /** La cote du dallage de la terrasse. */
  cote: number
  mur: number
  fondation: number
  parapet: { haut: number; epaisseur: number; chaperon: number; debord: number }
  escaliers: { id: string; axe: Axe; v: number; u0: number; pied: number }[]
  escalier: { largeur: number; marches: number; limon: number; garde: number }
  /** Le parement des murs : assises en bossage, qui reculent (le fruit, m/m) en montant. */
  talus: { saillie: number; fruit: number; assise: [number, number]; bloc: [number, number]; joint: number; bosse: number }
  banc: { x: number; z: number; longueur: number; profondeur: number; hauteur: number }
  lanterne: { x: number; z: number; cote: number }
  /** La fosse de l'érable de la terrasse : `haut`, la bordure au-dessus du dallage ; `terre`, la mousse sous son arête. */
  fosse: { x: number; z: number; cote: number; bordure: number; haut: number; terre: number }
  /** Le tracé des pas japonais de la rive sud, du pied de la volée ouest à l'axe de l'entrée. */
  rive: Point[]
  pavillon: { x: number; z: number; cote: number; poteau: number; egout: number; faitage: number; debord: number; banc: { profondeur: number; hauteur: number } }
  roji: { x: number; z0: number; largeur: number; ondulation: number }
  palissade: { x: number; z0: number; z1: number; haut: number; epaisseur: number }
  porte: { z: number; passage: number; poteau: number; haut: number }
  percee: { x: number; z: number; de: number; a: number; portee: number }
  /** Plantés à dessein ; `lacet` fixe l'orientation (le lierre regarde le dehors du mur), sinon elle est tirée. */
  sujets: { espece: 'erable-rouge' | 'erable-vert' | 'buis' | 'azalee' | 'fougere' | 'lierre' | 'herbes'; x: number; z: number; scale: number; belvedere?: boolean; lacet?: number }[]
}

const { emprise: E, cote: H, mur: M, escalier: S, pavillon: P, palissade: F, porte: G, roji: J, talus: T } = BELVEDERE
const [X0, X1, Z0, Z1] = [E.x, E.x + E.width, E.z, E.z + E.depth]

/** Le rectangle de (u0, v0) à (u1, v1) dans le repère d'une volée. */
const rectUV = (axe: Axe, u0: number, u1: number, v0: number, v1: number): Rect =>
  axe === 'z' ? { x: v0, z: u0, width: v1 - v0, depth: u1 - u0 } : { x: u0, z: v0, width: u1 - u0, depth: v1 - v0 }
const pointUV = (axe: Axe, u: number, v: number): Point => (axe === 'z' ? [v, u] : [u, v])

/** Les volées : chacune monte de son pied (`u0`) au bord de la terrasse (`u1`). */
export const VOLEES = BELVEDERE.escaliers.map((e) => {
  const u1 = e.axe === 'z' ? Z0 : X0
  return {
    ...e, u1,
    rect: rectUV(e.axe, e.u0, u1, e.v, e.v + S.largeur),
    emprise: rectUV(e.axe, e.u0, u1, e.v - S.limon, e.v + S.largeur + S.limon),
    /** En haut, un pas après le parapet ; en bas, 60 cm avant la première marche. */
    haut: pointUV(e.axe, u1 + M + 0.8, e.v + S.largeur / 2),
    bas: pointUV(e.axe, e.u0 - 0.6, e.v + S.largeur / 2),
  }
})
const [NORD, OUEST] = VOLEES
/** L'escalier du roji (nord). */
export const VOLEE: Rect = NORD.rect
export const HAUT_DE_L_ESCALIER: Point = NORD.haut
/** Le pied de l'escalier, dans l'axe du roji. */
export const PIED_DE_L_ESCALIER: Point = [J.x, NORD.u0 - 0.6]
/** La volée de la rive (ouest). */
export const HAUT_DE_LA_VOLEE_OUEST: Point = OUEST.haut
export const PIED_DE_LA_VOLEE_OUEST: Point = OUEST.bas
/** D'où l'on voit le mieux : le coin nord-ouest de la terrasse. */
export const POINT_DE_VUE: Point = [X0 + M + 1.1, Z0 + M + 1.4]
/** Tout ce qui est bâti au sol : la terrasse, ses volées et leurs limons. */
export const EMPRISE_BELVEDERE: Rect[] = [E, ...VOLEES.map((v) => v.emprise)]

const dedans = (r: Rect, x: number, z: number) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth

/**
 * La fosse de l'érable de la terrasse : un arbre ne sort pas du dallage. Un
 * carré de terre moussue, cerné d'une bordure de pierre, adossé au parapet sud
 * (il y penche). Bordure comprise ; elle arrête la marche.
 */
export const FOSSE: Rect = (() => {
  const { x, z, cote } = BELVEDERE.fosse
  return { x: x - cote / 2, z: z - cote / 2, width: cote, depth: cote }
})()
/** La cote de la mousse, dans la fosse : un peu sous l'arête de sa bordure. */
export const TERRE_DE_LA_FOSSE = H + BELVEDERE.fosse.haut - BELVEDERE.fosse.terre

/** Vrai sur le bâti du belvédère (terrasse, volées, limons), élargi de `marge`. */
export const dansLeBelvedere = (x: number, z: number, marge = 0) =>
  EMPRISE_BELVEDERE.some((r) => x > r.x - marge && x < r.x + r.width + marge && z > r.z - marge && z < r.z + r.depth + marge)

/**
 * La cote du sol du belvédère, ou `null` hors de lui : la terrasse, de niveau,
 * et les volées, en plan incliné du pied au dallage (la marche les monte comme
 * les volées du musée, sans sauter de marche en marche).
 */
export function coteDuBelvedere(x: number, z: number): number | null {
  if (dedans(FOSSE, x, z)) return TERRE_DE_LA_FOSSE
  if (dedans(E, x, z)) return H
  for (const v of VOLEES) {
    if (!dedans(v.rect, x, z)) continue
    const u = v.axe === 'z' ? z : x
    return v.pied + (H - v.pied) * Math.min(1, (u - v.u0) / (v.u1 - v.u0))
  }
  return null
}

/** La marche d'escalier : sa hauteur et son giron (les deux volées ont la même course). */
export const MARCHE = { haut: (H - NORD.pied) / S.marches, giron: (NORD.u1 - NORD.u0) / S.marches }

/** Un intervalle [a, b] privé de ses trous. */
function percer(a: number, b: number, trous: Point[]): Point[] {
  let out: Point[] = [[a, b]]
  for (const [ta, tb] of trous)
    out = out.flatMap(([c, d]): Point[] => (tb <= c || ta >= d ? [[c, d]] : ([[c, ta], [tb, d]] as Point[]).filter(([p, q]) => q - p > 1e-6)))
  return out
}

type Cote = 'n' | 's' | 'o' | 'e'
/** Un pan de mur : son rectangle, et le côté vers lequel regarde sa face vue. */
interface Pan { x0: number; x1: number; z0: number; z1: number; cote: Cote }

/** Les pans des quatre murs, percés là où une volée arrive (limons compris). */
const PANS: Pan[] = (() => {
  const trous = (axe: Axe): Point[] => VOLEES.filter((v) => v.axe === axe).map((v) => [v.v - S.limon, v.v + S.largeur + S.limon])
  return [
    ...percer(Z0, Z1, trous('x')).map(([a, b]): Pan => ({ x0: X0, x1: X0 + M, z0: a, z1: b, cote: 'o' })),
    { x0: X1 - M, x1: X1, z0: Z0, z1: Z1, cote: 'e' },
    { x0: X0 + M, x1: X1 - M, z0: Z1 - M, z1: Z1, cote: 's' },
    ...percer(X0 + M, X1 - M, trous('z')).map(([a, b]): Pan => ({ x0: a, x1: b, z0: Z0, z1: Z0 + M, cote: 'n' })),
  ]
})()

/** Le pied du mur, où le parement déborde le plus : la marche s'arrête avant. */
const PIED_DU_TALUS = 0.2
const ecarte = (p: Pan): Rect => {
  const d = PIED_DU_TALUS
  const [x0, x1, z0, z1] = [p.x0 - (p.cote === 'o' ? d : 0), p.x1 + (p.cote === 'e' ? d : 0), p.z0 - (p.cote === 'n' ? d : 0), p.z1 + (p.cote === 's' ? d : 0)]
  return { x: x0, z: z0, width: x1 - x0, depth: z1 - z0 }
}

/**
 * Ce qui arrête la marche : les murs (percés des volées) et le pied de leur
 * talus, les limons, les poteaux et le banc du pavillon, le banc de pierre et
 * la lanterne de la terrasse, la palissade du roji et sa porte. Du haut, les
 * murs sont le parapet ; d'en bas, ils sont le mur.
 */
export const OBSTACLES_BELVEDERE: Rect[] = (() => {
  const t = F.epaisseur / 2
  const [ga, gb] = [J.x - G.passage / 2, J.x + G.passage / 2]
  const p = P.cote / 2
  const { banc: B, lanterne: L } = BELVEDERE
  return [
    ...PANS.map(ecarte),
    // Les limons, jusqu'au parapet : dans l'épaisseur du mur aussi.
    ...VOLEES.flatMap((v) => [
      rectUV(v.axe, v.u0, v.u1 + M, v.v - S.limon, v.v),
      rectUV(v.axe, v.u0, v.u1 + M, v.v + S.largeur, v.v + S.largeur + S.limon),
    ]),
    // Les poteaux du pavillon, et son banc le long du côté sud.
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => ({ x: P.x + u * p - P.poteau / 2, z: P.z + v * p - P.poteau / 2, width: P.poteau, depth: P.poteau })),
    { x: P.x - p + P.poteau / 2, z: P.z + p - P.poteau / 2 - P.banc.profondeur, width: P.cote - P.poteau, depth: P.banc.profondeur },
    // Le banc de pierre et la lanterne de la terrasse.
    { x: B.x - B.longueur / 2, z: B.z - B.profondeur / 2, width: B.longueur, depth: B.profondeur },
    { x: L.x - L.cote / 2, z: L.z - L.cote / 2, width: L.cote, depth: L.cote },
    // La fosse de l'érable.
    FOSSE,
    // La palissade du roji, côté ruisseau, et la porte : deux poteaux, deux ailes jusqu'à la palissade et au mur d'enceinte.
    { x: F.x - t, z: F.z0, width: F.epaisseur, depth: F.z1 - F.z0 },
    { x: F.x - t, z: G.z - t, width: ga - (F.x - t), depth: F.epaisseur },
    { x: gb, z: G.z - t, width: X1 + 2 - gb, depth: F.epaisseur },
    ...[ga, gb].map((x) => ({ x: x - G.poteau / 2, z: G.z - G.poteau / 2, width: G.poteau, depth: G.poteau })),
  ]
})()

/**
 * La percée : un secteur ouvert depuis la terrasse vers l'étang et la façade,
 * où les grands arbres ont été éclaircis. Les boules et les azalées y restent :
 * elles font le premier plan, sous le regard.
 */
export function dansLaPercee(x: number, z: number): boolean {
  const { x: cx, z: cz, de, a, portee } = BELVEDERE.percee
  const d = Math.hypot(x - cx, z - cz)
  if (d > portee || d < 1) return false
  let angle = (Math.atan2(z - cz, x - cx) * 180) / Math.PI
  if (angle > 0) angle -= 360
  return angle >= de && angle <= a
}

/** Un aléa dans [0, 1) haché de deux nombres : le même mur, pierre pour pierre. */
const hache = (a: number, b = 0) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** Un pas japonais : une dalle de granit plate, posée sur la pelouse. */
export interface PasJaponais { x: number; z: number; rayon: number; lacet: number }

/**
 * Les pas japonais de la rive sud (tobi-ishi) : une pierre plate tous les
 * 65 à 75 cm, en léger quinconce, de 40 à 55 cm, le long de `rive`.
 */
export const PAS_DE_LA_RIVE: PasJaponais[] = (() => {
  const out: PasJaponais[] = []
  const r = BELVEDERE.rive
  let s = 0.35
  let k = 0
  for (let i = 1; i < r.length; i++) {
    const [[ax, az], [bx, bz]] = [r[i - 1], r[i]]
    const l = Math.hypot(bx - ax, bz - az)
    const [ux, uz] = [(bx - ax) / l, (bz - az) / l]
    for (; s < l; s += 0.65 + 0.1 * hache(k, 3), k++) {
      const e = (k % 2 ? 1 : -1) * (0.08 + 0.08 * hache(k, 1))
      out.push({ x: ax + ux * s - uz * e, z: az + uz * s + ux * e, rayon: 0.2 + 0.075 * hache(k, 2), lacet: hache(k, 4) * Math.PI * 2 })
    }
    s -= l
  }
  return out
})()

/**
 * Les pierres du belvédère, en boîtes (la pierre du parvis et du chaperon du
 * mur d'enceinte, `ParkLayer`) :
 *
 * - les murs de soutènement, fondés sous le sol le plus bas de leur pied, et
 *   leur PAREMENT en bossage : des assises de hauteur inégale, des blocs de
 *   longueur inégale à joints croisés, chacun sa bosse ; chaque assise recule
 *   sur celle d'en dessous (le fruit), le mur s'évase vers son pied ;
 * - le bandeau, le parapet et son chaperon ; le dallage ; le banc de pierre ;
 * - les seize marches de chaque volée et leurs limons, en redans comme le mur
 *   d'enceinte.
 *
 * Le dallage et les marches (`slab`, `step`) prennent la pierre foulée du
 * parvis, le reste celle du mur.
 */
export function pierresDuBelvedere(sol: (x: number, z: number) => number): Box[] {
  const out: Box[] = []
  const boite = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, kind: Box['kind'] = 'wall'): Box =>
    ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: z1 - z0, h: y1 - y0, kind })
  const boiteR = (r: Rect, y0: number, y1: number, kind: Box['kind'] = 'wall') => boite(r.x, r.x + r.width, r.z, r.z + r.depth, y0, y1, kind)
  const bas = (x0: number, x1: number, z0: number, z1: number) => {
    let m = Infinity
    for (let x = x0; x <= x1 + 1e-6; x += 0.5) for (let z = z0; z <= z1 + 1e-6; z += 0.5) m = Math.min(m, sol(x, z))
    return m - BELVEDERE.fondation
  }
  const { haut, epaisseur: e, chaperon, debord } = BELVEDERE.parapet
  const piedDe = (p: Pan) => bas(p.x0 - 0.3, p.x1 + 0.3, p.z0 - 0.3, p.z1 + 0.3)

  // Le noyau des murs, le parapet et son chaperon (leur face extérieure affleure celle du mur).
  for (const p of PANS) {
    out.push(boite(p.x0, p.x1, p.z0, p.z1, piedDe(p), H))
    const [pa, pb, pc, pd] = p.cote === 'o' ? [p.x0, p.x0 + e, p.z0, p.z1] : p.cote === 'e' ? [p.x1 - e, p.x1, p.z0, p.z1] : p.cote === 'n' ? [p.x0, p.x1, p.z0, p.z0 + e] : [p.x0, p.x1, p.z1 - e, p.z1]
    out.push(boite(pa, pb, pc, pd, H, H + haut))
    out.push(boite(pa - debord, pb + debord, pc - debord, pd + debord, H + haut, H + haut + chaperon))
  }

  // Le parement en bossage, assise par assise, du plus bas pied au bandeau.
  const couronne = H - 0.22
  const assises: Point[] = []
  for (let y = Math.min(...PANS.map(piedDe)), k = 0; y < couronne - 0.05; k++) {
    const h = T.assise[0] + (T.assise[1] - T.assise[0]) * hache(k, 11)
    const y1 = couronne - y - h < 0.25 ? couronne : y + h
    assises.push([y, y1])
    y = y1
  }
  for (const p of PANS) {
    const pied = piedDe(p)
    const graine = p.cote.charCodeAt(0) + p.x0 + p.z0
    // Le long de la face vue : l'abscisse `s` court sur x (nord, sud) ou z (ouest, est).
    const long = p.cote === 'n' || p.cote === 's'
    const [s0, s1] = long ? [p.x0, p.x1] : [p.z0, p.z1]
    const face = p.cote === 'o' ? p.x0 : p.cote === 'e' ? p.x1 : p.cote === 'n' ? p.z0 : p.z1
    const dehors = p.cote === 'o' || p.cote === 'n' ? -1 : 1
    /** Une pierre de `s` à `t` le long de la face, en saillie de `v`, de `y0` à `y1`. */
    const pierre = (s: number, t: number, v: number, y0: number, y1: number) => {
      const [v0, v1] = [face - dehors * 0.05, face + dehors * v]
      return long ? boite(s, t, Math.min(v0, v1), Math.max(v0, v1), y0, y1) : boite(Math.min(v0, v1), Math.max(v0, v1), s, t, y0, y1)
    }
    /** Aux angles du belvédère, l'ouest et l'est retournent sur le nord et le sud : pas d'encoche. */
    const bouts = (v: number): Point => [s0 - (!long && Math.abs(s0 - Z0) < 1e-6 ? v : 0), s1 + (!long && Math.abs(s1 - Z1) < 1e-6 ? v : 0)]
    assises.forEach(([y0, y1], c) => {
      if (y1 <= pied) return
      const saillie = T.saillie + T.fruit * (couronne - y1)
      const [a, b] = bouts(saillie)
      const [ya, yb] = [Math.max(y0, pied) + (y0 > pied ? T.joint / 2 : 0), y1 - T.joint / 2]
      // Joints croisés : chaque assise commence par un bloc tronqué.
      let l = (T.bloc[0] + (T.bloc[1] - T.bloc[0]) * hache(c, graine)) * (0.3 + 0.7 * hache(c, 5))
      for (let s = a, k = 0; s < b - 1e-3; k++) {
        // Pas de bout de bloc de moins de 25 cm au bout du pan : le dernier s'allonge.
        const fin = b - (s + l) < 0.25 ? b : s + l
        out.push(pierre(s + (s > a ? T.joint / 2 : 0), fin - (fin < b ? T.joint / 2 : 0), saillie + T.bosse * hache(c * 31 + k, graine + 7), ya, yb))
        s = fin
        l = T.bloc[0] + (T.bloc[1] - T.bloc[0]) * hache(c * 31 + k, graine + 3)
      }
    })
    // Le bandeau, en saillie sur la dernière assise : il couronne le parement.
    const sb = T.saillie + T.bosse + 0.03
    out.push(pierre(...bouts(sb), sb, couronne, H - 0.04))
  }

  // Le dallage, 12 cm d'épaisseur, arasé à la cote.
  out.push(boite(X0 + M, X1 - M, Z0 + M, Z1 - M, H - 0.12, H, 'slab'))
  // La fosse de l'érable : quatre bordures posées sur le dallage (le parapet ferme le sud,
  // la bordure sud le rejoint), la terre moussue à part (`terreDeLaFosse`).
  {
    const { bordure: b, haut: hb } = BELVEDERE.fosse
    const [fx0, fx1, fz0, fz1] = [FOSSE.x, FOSSE.x + FOSSE.width, FOSSE.z, FOSSE.z + FOSSE.depth]
    out.push(boite(fx0, fx1, fz0, fz0 + b, H - 0.02, H + hb))
    out.push(boite(fx0, fx0 + b, fz0 + b, fz1, H - 0.02, H + hb))
    out.push(boite(fx1 - b, fx1, fz0 + b, fz1, H - 0.02, H + hb))
  }
  // Le banc de pierre : une dalle sur deux dés, face à la façade.
  const { banc: B } = BELVEDERE
  const [bx0, bx1, bz0, bz1] = [B.x - B.longueur / 2, B.x + B.longueur / 2, B.z - B.profondeur / 2, B.z + B.profondeur / 2]
  out.push(boite(bx0, bx1, bz0, bz1, H + B.hauteur - 0.1, H + B.hauteur))
  for (const x of [bx0 + 0.3, bx1 - 0.3]) out.push(boite(x - 0.13, x + 0.13, bz0 + 0.06, bz1 - 0.06, H, H + B.hauteur - 0.1))

  // Les volées : le palier dans l'épaisseur du mur, les marches, les limons en redans.
  for (const v of VOLEES) {
    const [va, vb] = [v.v, v.v + S.largeur]
    const [la, lb] = [va - S.limon, vb + S.limon]
    out.push(boiteR(rectUV(v.axe, v.u1, v.u1 + M, va, vb), H - 0.12, H, 'slab'))
    const r0 = rectUV(v.axe, v.u0 - 0.3, v.u0 + 0.3, la, lb)
    const pied = bas(r0.x, r0.x + r0.width, r0.z, r0.z + r0.depth)
    for (let i = 0; i < S.marches; i++) {
      const [nez, dessus] = [v.u0 + i * MARCHE.giron, v.pied + (i + 1) * MARCHE.haut]
      out.push(boiteR(rectUV(v.axe, nez, v.u1, va, vb), pied, dessus, 'step'))
      for (const [a, b] of [[la, va], [vb, lb]]) {
        out.push(boiteR(rectUV(v.axe, nez, nez + MARCHE.giron, a, b), pied, dessus + S.garde))
        out.push(boiteR(rectUV(v.axe, nez, nez + MARCHE.giron, a - debord, b + debord), dessus + S.garde, dessus + S.garde + chaperon))
      }
    }
    // Dans l'épaisseur du mur, les limons rejoignent le parapet.
    for (const [a, b] of [[la, va], [vb, lb]]) {
      const r = rectUV(v.axe, v.u1, v.u1 + M, a, b)
      out.push(boiteR(r, bas(r.x, r.x + r.width, r.z, r.z + r.depth), H + haut))
      out.push(boiteR(rectUV(v.axe, v.u1 - debord, v.u1 + M + debord, a - debord, b + debord), H + haut, H + haut + chaperon))
    }
  }
  return out
}

/** La terre moussue de la fosse, entre ses bordures : une boîte arasée à la cote de la mousse. */
export function terreDeLaFosse(): Box {
  const { bordure: b } = BELVEDERE.fosse
  const [x0, x1, z0, z1] = [FOSSE.x + b, FOSSE.x + FOSSE.width - b, FOSSE.z + b, FOSSE.z + FOSSE.depth]
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: (H - 0.02 + TERRE_DE_LA_FOSSE) / 2, w: x1 - x0, d: z1 - z0, h: TERRE_DE_LA_FOSSE - H + 0.02, kind: 'slab' }
}
