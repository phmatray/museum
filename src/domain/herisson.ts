/**
 * Les HÉRISSONS du jardin japonais : une mère, ses deux petits, et un vieux
 * qui vit à part. Vingt centimètres de piquants (vingt-six pour les grands)
 * qui trottinent autour de l'étang, s'arrêtent tous les trois pas pour flairer
 * l'herbe, et se roulent en boule quand on s'approche — chacun pour soi.
 *
 * Les petits suivent leur mère à un mètre ou deux, s'écartent pour flairer,
 * puis la rattrapent en trottinant ; ils partagent son buis. Le vieux a le
 * sien, loin du leur, et court la lisière de la pelouse, plus loin de l'eau.
 * Aucun ne marche sur un autre.
 *
 * Il vit au bord de l'eau, sans jamais y entrer : son domaine est l'anneau de
 * pelouse et de fougères autour de l'étang, son nid le creux d'un buis. Il
 * contourne les rochers, les troncs, les bancs et la lanterne, reste sur la
 * pelouse (ni allée, ni parvis) et ne va pas au-delà du mur.
 *
 * Crépusculaire, comme les vrais : au plus actif à la brune et à l'aube, quand
 * le soleil rase l'horizon et qu'on y voit encore ; dehors une bonne part de la
 * nuit ; rarement le jour (un petit qui a faim sort parfois l'après-midi) ;
 * jamais l'hiver — il hiberne sous son buis de la mi-novembre à la fin mars
 * (`pelouse.terne`).
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

/**
 * Sa taille : le modèle mesure quinze centimètres, le hérisson du jardin vingt
 * (« on ne le trouve jamais », Philippe). Tout ce qui tient à son corps suit.
 */
export const ECHELLE_HERISSON = 4 / 3
/**
 * Son pas de fouille, m/s : dans la vidéo de Philippe, il avance à peine
 * (13 cm/s à quinze centimètres). Plus grand, il va un peu plus vite, comme la
 * racine de sa taille (à allure égale, un animal plus long allonge le pas).
 */
export const VITESSE_HERISSON = 0.13 * Math.sqrt(ECHELLE_HERISSON)
/** Du centre au museau, m. */
export const DEMI_LONGUEUR = 0.075 * ECHELLE_HERISSON
export type Role = 'mere' | 'petit' | 'solitaire'

/** Un individu : sa taille, son pas, son pelage, et son heure. */
export interface Individu {
  nom: string
  role: Role
  /** Rapport au modèle de quinze centimètres. */
  echelle: number
  /** Son pas de fouille, m/s (comme la racine de sa taille). */
  vitesse: number
  /** Du centre au museau, m. */
  demiLongueur: number
  /** 0 le pelage brun des petits, 1 celui, plus clair et plus gris, des adultes. */
  teinte: number
  /** Son avance sur le soleil, en degrés d'élévation (1° ≈ 6 min à la brune) : ils ne sortent pas tous à la même seconde. */
  decalage: number
}

function individu(nom: string, role: Role, centimetres: number, teinte: number, decalage: number): Individu {
  const echelle = centimetres / 15
  return { nom, role, echelle, vitesse: 0.13 * Math.sqrt(echelle), demiLongueur: 0.075 * echelle, teinte, decalage }
}

/**
 * La famille, dans l'ordre de `window.__FAUNE__` : la mère (26 cm), le petit
 * qu'on a trouvé le premier (20 cm, celui de #196), sa sœur (18,5 cm), et le
 * vieux solitaire (27 cm).
 */
export const FAMILLE: readonly Individu[] = [
  individu('la mère', 'mere', 26, 1, 0),
  individu('le petit', 'petit', 20, 0, 0.5),
  individu('la petite', 'petit', 18.5, 0.15, -0.4),
  individu('le vieux', 'solitaire', 27, 1, 1),
]

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
/** Les petits : 90 cm derrière leur mère, et 35 cm de côté (l'un à gauche, l'autre à droite). */
const SUITE = [0.9, 0.35] as const
/** À plus de 80 cm de leur place, ils trottinent (40 % plus vite) ; à plus de 3 m de leur mère, ils cessent de flâner. */
const RATTRAPE = 0.8
const PERDU = 3
/** Une chance sur trois, en finissant de flairer, de s'écarter pour flairer ailleurs, à moins de 3 m de leur mère. */
const FLANER = 0.33
/** Au nid, un petit regarde si sa mère est sortie toutes les 4 à 12 s. */
const GUET = [4, 12] as const
/** Le vieux : des buts jusqu'à 10 m, de préférence à plus de 10 m du centre de l'étang. */
const LOIN = 10
/** Deux hérissons ne s'approchent pas à moins de la somme de leurs demi-longueurs, plus 5 cm. */
const ECART = 0.05
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
  /** Qui c'est : son rang dans `FAMILLE`. */
  qui: number
  /** Un petit qui s'est écarté de sa mère pour flairer. */
  flane: boolean
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

interface Nid { p: [number, number]; plante: number; buis: boolean }
/** Les obstacles ronds rangés par cases d'un mètre : quatre hérissons, des heures de simulation, il faut aller vite. */
const CASE = 1
const cle = (i: number, j: number) => (i + 1024) * 2048 + (j + 1024)

/** Ce qui l'arrête, calculé une fois : les troncs, les boules, les rochers, la lanterne, les bancs. */
let terrain: { ronds: Map<number, Rond[]>; blocs: Rect[]; allees: Allee[]; bords: Rect; nids: Nid[]; buts: [number, number][] } | null = null
function monde() {
  if (terrain) return terrain
  const parc = parkPlacements(MUSEE)
  const tous: Rond[] = [{ x: JARDIN.lanterne.x, z: JARDIN.lanterne.z, r: 0.5 }, ...JARDIN.pas.map(([x, z]) => ({ x, z, r: 0.45 }))]
  for (const p of parc.plantations) {
    if (p.espece === 'petales' || p.espece === 'fougere') continue
    tous.push({ x: p.x, z: p.z, r: p.espece.startsWith('erable') ? 0.3 * p.scale : p.rayon * (p.espece.startsWith('rocher') ? 0.9 : 0.6) })
  }
  const ronds = new Map<number, Rond[]>()
  for (const o of tous) {
    if (Math.hypot(o.x - CENTRE[0], o.z - CENTRE[1]) > DOMAINE + o.r) continue
    for (let i = Math.floor((o.x - o.r) / CASE); i <= Math.floor((o.x + o.r) / CASE); i++)
      for (let j = Math.floor((o.z - o.r) / CASE); j <= Math.floor((o.z + o.r) / CASE); j++) {
        const k = cle(i, j)
        const c = ronds.get(k)
        if (c) c.push(o)
        else ronds.set(k, [o])
      }
  }
  // Seuls comptent les allées et les meubles de son domaine.
  const pres = (x: number, z: number, r: number) => Math.hypot(x - CENTRE[0], z - CENTRE[1]) < DOMAINE + r
  const t = terrainDuParc(MUSEE)
  terrain = {
    ronds,
    blocs: blocsDuMobilier(PARC).blocs.filter((b) => distanceRect(b, CENTRE[0], CENTRE[1]) < DOMAINE + 1),
    allees: parc.allees.filter((s) => pres(s.a.x, s.a.z, Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) + s.largeur)),
    // Le terrain moins un mètre ; le musée et son parvis (5 m) plus un mètre.
    bords: { x: t.x + 1, z: t.z + 1, width: t.width - 2, depth: t.depth - 2 },
    nids: [],
    buts: [],
  }
  const monParc = parc.plantations.filter((p) => Math.hypot(p.x - CENTRE[0], p.z - CENTRE[1]) < DOMAINE - 1)
  // Le nid : au bord d'un buis ou d'une azalée ; les buts : le bord des massifs et des fougères.
  for (const [i, p] of monParc.entries()) {
    const bord = p.espece === 'fougere' ? 0.2 : p.rayon * 0.6 + 0.12
    for (let k = 0; k < 4; k++) {
      const a = k * (Math.PI / 2) + p.rotation
      const q: [number, number] = [p.x + Math.cos(a) * bord, p.z + Math.sin(a) * bord]
      if (!libre(q[0], q[1])) continue
      if (p.espece === 'buis' || p.espece === 'azalee') terrain.nids.push({ p: q, plante: i, buis: p.espece === 'buis' })
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
export function libre(x: number, z: number, echelle = ECHELLE_HERISSON): boolean {
  const m = monde()
  if (Math.hypot(x - CENTRE[0], z - CENTRE[1]) > DOMAINE) return false
  if (distanceRect(m.bords, x, z) > 0 || distanceRect(PARVIS, x, z) <= 0) return false
  if (distanceEtang(x, z) < MARGE_EAU || distanceRuisseau(x, z) < MARGE_EAU) return false
  if (m.ronds.get(cle(Math.floor(x / CASE), Math.floor(z / CASE)))?.some((o) => Math.hypot(o.x - x, o.z - z) < o.r)) return false
  // Pas sur les allées : leurs dalles et leurs bordures dépassent de la pelouse, il y marcherait dedans.
  if (surUneAllee(m.allees, x, z, 0.35)) return false
  // Le banc, la lanterne : pas un flanc contre le pied (sa demi-largeur, 5 cm à quinze centimètres).
  return m.blocs.every((b) => distanceRect(b, x, z) > 0.05 * echelle)
}

/** La ligne droite de a à b est-elle libre ? (un pas tous les 25 cm) */
function voie(a: [number, number], b: [number, number], echelle = ECHELLE_HERISSON): boolean {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25)
  for (let i = 1; i <= n; i++) if (!libre(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, echelle)) return false
  return true
}

/**
 * Son nid : toujours le même buis, d'une session à l'autre. La mère a celui du
 * petit de #196 ; ses petits, un autre creux du même buis chacun ; le vieux,
 * un buis à plus de 10 m du leur.
 */
const lesNids: [number, number][] = []
export function nid(qui = 1): [number, number] {
  if (lesNids[qui]) return lesNids[qui]
  const n = monde().nids
  const famille = n[Math.floor(generateur('herisson:nid')() * n.length)]
  let ici = famille.p
  if (FAMILLE[qui].role === 'petit') {
    const autres = n.filter((c) => c.plante === famille.plante && c !== famille)
    if (autres.length) ici = autres[(qui - 1) % autres.length].p
  } else if (FAMILLE[qui].role === 'solitaire') {
    const loin = n.filter((c) => Math.hypot(c.p[0] - famille.p[0], c.p[1] - famille.p[1]) > 10)
    const buis = loin.filter((c) => c.buis)
    const choix = buis.length ? buis : loin.length ? loin : n
    ici = choix[Math.floor(generateur('herisson:nid:vieux')() * choix.length)].p
  }
  return (lesNids[qui] = ici)
}

/**
 * L'envie de sortir, de 0 à 1, selon la hauteur du soleil (degrés, celle de
 * `gameStore.ciel.elevation`) : pleine à la brune et à l'aube, du soleil à 4°
 * au-dessus de l'horizon jusqu'au crépuscule civil (−6°) ; encore forte en
 * pleine nuit (0,8) ; faible en plein jour (0,15) ; nulle en hibernation.
 */
export function activite(elevation: number, hiberne: boolean): number {
  if (hiberne) return 0
  const lisse = (a: number, b: number) => {
    const t = Math.min(1, Math.max(0, (elevation - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  // Le fond : la nuit sous −10°, le jour au-dessus de 12°.
  const fond = 0.8 - 0.65 * lisse(-10, 12)
  // La bosse du crépuscule : un plateau de −6° à +4°, fondu sur 5° de chaque côté.
  const brune = lisse(-11, -6) * (1 - lisse(4, 9))
  return fond + (1 - fond) * brune
}

/**
 * Un but proche (moins de 8 m), atteignable en ligne droite ; faute de mieux,
 * n'importe lequel. Le vieux va plus loin (10 m) et préfère la lisière ; un
 * petit qui flâne ne s'écarte pas à plus de 3 m de `pres` (sa mère).
 */
function choisirBut(h: Herisson, pres?: Herisson): { but: [number, number]; graine: number } {
  const ici: [number, number] = [h.x, h.z]
  const { echelle, role } = FAMILLE[h.qui]
  const portee = role === 'solitaire' ? LOIN : 8
  let proches = monde().buts.filter((b) => {
    const d = Math.hypot(b[0] - h.x, b[1] - h.z)
    return d > (pres ? 0.5 : 1) && d < portee && (!pres || Math.hypot(b[0] - pres.x, b[1] - pres.z) < PERDU)
  })
  let graine = h.graine
  let u: number
  if (role === 'solitaire') {
    const lisiere = proches.filter((b) => Math.hypot(b[0] - CENTRE[0], b[1] - CENTRE[1]) > LOIN)
    ;[u, graine] = tirer(graine)
    if (lisiere.length && u < 0.8) proches = lisiere
  }
  // Quelques essais au hasard suffisent : la plupart des buts proches se voient.
  for (let k = 0; k < 6 && proches.length; k++) {
    ;[u, graine] = tirer(graine)
    const b = proches[Math.floor(u * proches.length)]
    if (voie(ici, b, echelle)) return { but: b, graine }
  }
  // Coincé : un pas de côté, dans une direction libre.
  for (let k = 0; k < 8; k++) {
    ;[u, graine] = tirer(graine)
    const a = u * 2 * Math.PI
    const b: [number, number] = [h.x + Math.cos(a) * 1.5, h.z + Math.sin(a) * 1.5]
    if (voie(ici, b, echelle)) return { but: b, graine }
  }
  return { but: ici, graine }
}

/**
 * Le chemin du retour : le nombre de pas de 50 cm jusqu'au nid, en
 * contournant l'étang et les massifs (un parcours en largeur sur une grille qui
 * couvre son domaine). Calculé une fois par nid.
 */
const PAS_CARTE = 0.5
const N_CARTE = Math.ceil((2 * DOMAINE) / PAS_CARTE) + 1
const [X_CARTE, Z_CARTE] = [CENTRE[0] - DOMAINE, CENTRE[1] - DOMAINE]
const cartes = new Map<string, Float32Array>()
function carteVers([nx, nz]: [number, number]): Float32Array {
  const cle = `${nx},${nz}`
  const deja = cartes.get(cle)
  if (deja) return deja
  const c = new Float32Array(N_CARTE * N_CARTE).fill(Infinity)
  const file: number[] = []
  // Le départ : les quatre cases autour du nid.
  const [i0, j0] = [Math.floor((nx - X_CARTE) / PAS_CARTE), Math.floor((nz - Z_CARTE) / PAS_CARTE)]
  for (const [i, j] of [[i0, j0], [i0 + 1, j0], [i0, j0 + 1], [i0 + 1, j0 + 1]])
    if (libre(X_CARTE + i * PAS_CARTE, Z_CARTE + j * PAS_CARTE)) {
      c[j * N_CARTE + i] = 0
      file.push(j * N_CARTE + i)
    }
  for (let k = 0; k < file.length; k++) {
    const q = file[k]
    const [i, j] = [q % N_CARTE, Math.floor(q / N_CARTE)]
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [a, b] = [i + di, j + dj]
      if (a < 0 || b < 0 || a >= N_CARTE || b >= N_CARTE || c[b * N_CARTE + a] !== Infinity) continue
      if (!libre(X_CARTE + a * PAS_CARTE, Z_CARTE + b * PAS_CARTE)) {
        c[b * N_CARTE + a] = -1
        continue
      }
      c[b * N_CARTE + a] = c[q] + 1
      file.push(b * N_CARTE + a)
    }
  }
  cartes.set(cle, c)
  return c
}
/** Combien de pas jusqu'au nid depuis (x, z) : la meilleure des quatre cases voisines. */
function versLeNid(carte: Float32Array, x: number, z: number): number {
  const [i, j] = [Math.floor((x - X_CARTE) / PAS_CARTE), Math.floor((z - Z_CARTE) / PAS_CARTE)]
  let d = Infinity
  for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
    const v = a >= 0 && b >= 0 && a < N_CARTE && b < N_CARTE ? carte[b * N_CARTE + a] : -1
    if (v >= 0 && v < d) d = v
  }
  return d
}

/**
 * Rentrer : droit au nid s'il le voit ; sinon vers le but visible le plus près
 * de chez lui, à pied (il contourne l'étang au lieu d'errer sur sa rive) ;
 * faute de mieux, un détour (le prochain arrêt redemandera le nid).
 */
function prochainBut(h: Herisson): { but: [number, number]; graine: number } {
  if (!h.rentre) return choisirBut(h)
  const chez = nid(h.qui)
  const { echelle } = FAMILLE[h.qui]
  if (voie([h.x, h.z], chez, echelle)) return { but: chez, graine: h.graine }
  const carte = carteVers(chez)
  const ici = versLeNid(carte, h.x, h.z)
  const pistes = monde()
    .buts.filter((b) => Math.hypot(b[0] - h.x, b[1] - h.z) < 8)
    .map((b) => ({ b, d: versLeNid(carte, b[0], b[1]) }))
    .filter((p) => p.d < ici - 2)
    .sort((p, q) => p.d - q.d)
  for (const p of pistes.slice(0, 8)) if (voie([h.x, h.z], p.b, echelle)) return { but: p.b, graine: h.graine }
  return choisirBut(h)
}

/** Où un petit se tient derrière sa mère : un peu de côté, l'un à gauche, l'autre à droite. */
function derriere(mere: Herisson, qui: number): [number, number] {
  const cote = qui % 2 ? 1 : -1
  const [c, s] = [Math.cos(mere.cap), Math.sin(mere.cap)]
  return [mere.x - c * SUITE[0] - s * SUITE[1] * cote, mere.z - s * SUITE[0] + c * SUITE[1] * cote]
}

/** Dehors (pas au nid). */
const dehors = (h: Herisson) => h.etat !== 'nid'
/** La mère est dehors, et pas sur le chemin du retour. */
const sortie = (m: Herisson | undefined): m is Herisson => !!m && dehors(m) && !m.rentre
/** La distance minimale entre deux hérissons. */
export const ecartMinimal = (a: Herisson, b: Herisson) => FAMILLE[a.qui].demiLongueur + FAMILLE[b.qui].demiLongueur + ECART
/**
 * Un pas en (x, z) le mettrait-il sur un autre ? On refuse de s'approcher sous
 * l'écart minimal, jamais de s'éloigner : deux bêtes collées se décollent.
 */
function gene(h: Herisson, x: number, z: number, famille: readonly Herisson[]): boolean {
  return famille.some((f) => {
    if (f.qui === h.qui || !dehors(f)) return false
    const d = Math.hypot(f.x - x, f.z - z)
    return d < ecartMinimal(h, f) && d < Math.hypot(f.x - h.x, f.z - h.z)
  })
}

/** Le hérisson au début d'une session : dehors quelque part, s'il est d'humeur, sinon au nid. */
export function herissonInitial(envie: number, graine = 1, qui = 1): Herisson {
  const [u, g1] = tirer(graine >>> 0)
  const [v, g2] = tirer(g1)
  const [x, z] = nid(qui)
  const h: Herisson = { x, z, cap: v * 2 * Math.PI, etat: 'nid', t: entre(v, SIESTE), boule: 0, but: [x, z], rentre: false, vitesse: 0, graine: g2, qui, flane: false }
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
 * à hauteur d'homme ; `envie` : `activite()` du moment ; `famille` : les
 * autres hérissons (lui compris ou non), pour suivre la mère et ne marcher sur
 * personne. Seul (`famille` vide), un petit vit sa vie comme dans #196.
 */
export function avancerHerisson(h: Herisson, dt: number, visiteur: { x: number; z: number } | null, envie: number, famille: readonly Herisson[] = []): Herisson {
  let { graine } = h
  let u: number
  const ind = FAMILLE[h.qui]
  const loin = visiteur ? Math.hypot(visiteur.x - h.x, visiteur.z - h.z) : Infinity
  const mere = ind.role === 'petit' ? famille.find((f) => FAMILLE[f.qui].role === 'mere') : undefined
  const dm = mere ? Math.hypot(mere.x - h.x, mere.z - h.z) : Infinity
  // Sa mère dehors, qu'elle rentre ou non : il la suit.
  const guide = mere && dehors(mere) ? mere : undefined

  if (h.etat === 'nid') {
    const t = h.t - dt
    if (t > 0) return { ...h, t, vitesse: 0 }
    ;[u, graine] = tirer(graine)
    const [v, g] = tirer(graine)
    // Pas deux à la sortie du même creux : il attend que la place se libère.
    const occupe = famille.some((f) => f.qui !== h.qui && dehors(f) && Math.hypot(f.x - h.x, f.z - h.z) < ecartMinimal(h, f))
    if (mere) {
      // Un petit sort quand sa mère est sortie : il la guette.
      if (!sortie(mere) || occupe) return { ...h, t: entre(v, GUET), graine: g, vitesse: 0 }
      return { ...h, etat: 'marche', rentre: false, flane: false, t: entre(v, TROTTE), but: derriere(mere, h.qui), graine: g, vitesse: 0 }
    }
    if (u >= envie || occupe) return { ...h, t: entre(v, SIESTE), graine: g, vitesse: 0 }
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
    // Un petit qui a perdu sa mère de vue n'achève pas de flairer.
    const t = guide && dm > PERDU ? 0 : h.t - dt
    if (t > 0) return { ...h, t, vitesse: 0 }
    ;[u, graine] = tirer(graine)
    const [v, g] = tirer(graine)
    if (mere) {
      // Sa mère est rentrée : il rentre. Sinon il la suit (jusque chez eux), ou s'écarte un peu pour flairer.
      if (!guide) {
        const s = prochainBut({ ...h, rentre: true, graine: g })
        return { ...h, etat: 'marche', rentre: true, flane: false, but: s.but, t: entre(v, TROTTE), graine: s.graine, vitesse: 0 }
      }
      const flane = u < FLANER && dm < PERDU
      const s = flane ? choisirBut({ ...h, graine: g }, guide) : { but: derriere(guide, h.qui), graine: g }
      return { ...h, etat: 'marche', rentre: false, flane, but: s.but, t: entre(v, TROTTE), graine: s.graine, vitesse: 0 }
    }
    // Pas d'humeur à rester dehors : il rentre.
    const rentre = h.rentre || u < (1 - envie) * 0.7
    const s = prochainBut({ ...h, rentre, graine: g })
    return { ...h, etat: 'marche', rentre, but: s.but, t: entre(v, TROTTE), graine: s.graine, vitesse: 0 }
  }

  // En marche : vers le but, en zigzaguant un peu du museau. Un petit suit sa mère à la trace.
  let { but, flane, rentre } = h
  if (guide) {
    rentre = false
    if (flane && dm > PERDU) flane = false
    if (!flane) but = derriere(guide, h.qui)
  } else if (mere && !rentre) {
    const s = prochainBut({ ...h, rentre: true })
    ;[rentre, flane, but, graine] = [true, false, s.but, s.graine]
  }
  const suit = !!guide && !flane
  const [bx, bz] = but
  const d = Math.hypot(bx - h.x, bz - h.z)
  if (d < (suit ? 0.3 : 0.15)) {
    if (rentre && Math.hypot(bx - nid(h.qui)[0], bz - nid(h.qui)[1]) < 0.01) {
      ;[u, graine] = tirer(graine)
      return { ...h, etat: 'nid', t: entre(u, mere ? GUET : SIESTE), rentre: false, flane: false, graine, vitesse: 0 }
    }
    ;[u, graine] = tirer(graine)
    return { ...h, etat: 'flaire', t: entre(u, suit ? FLAIRE : FLAIRE_BUT), but, rentre, flane: false, graine, vitesse: 0 }
  }
  const t = h.t - dt
  // Au bout de sa trotte, il s'arrête flairer ; un petit en retard, lui, trottine encore.
  if (t <= 0 && !rentre && !(suit && d > RATTRAPE)) {
    ;[u, graine] = tirer(graine)
    return { ...h, etat: 'flaire', t: entre(u, FLAIRE), but, rentre, flane: false, graine, vitesse: 0 }
  }
  const ecart = angle(Math.atan2(bz - h.z, bx - h.x) - h.cap)
  const cap = h.cap + Math.sign(ecart) * Math.min(Math.abs(ecart), VIRAGE * dt)
  // Il ralentit pour virer, et part d'un pas plus lent quand il ne va pas droit au but.
  const v = ind.vitesse * (suit && d > RATTRAPE ? 1.4 : 1) * Math.max(0.2, Math.cos(Math.min(Math.abs(ecart), Math.PI / 2)))
  const [x, z] = [h.x + Math.cos(cap) * v * dt, h.z + Math.sin(cap) * v * dt]
  if (!libre(x, z, ind.echelle) || gene(h, x, z, famille)) {
    // Buté (le but était derrière un obstacle, un autre hérisson, ou il a coupé un virage) : il cherche ailleurs ;
    // un petit fait un détour, près de sa mère. Sur le chemin du retour, le détour
    // le rapproche encore du nid : buté contre un de ses petits au pas de la porte,
    // on ne repart pas flâner à huit mètres.
    const s = rentre ? prochainBut({ ...h, rentre }) : choisirBut(h, guide)
    return { ...h, t, but: s.but, rentre, flane: !!guide, graine: s.graine, vitesse: 0, cap: cap + Math.PI / 4 }
  }
  return { ...h, x, z, cap, t, but, rentre, flane, graine, vitesse: dt > 0 ? v : 0 }
}

/** L'envie de sortir de chacun : la même heure pour tous, à quelques minutes près. */
export function envieDe(qui: number, elevation: number, hiberne: boolean): number {
  return activite(elevation + FAMILLE[qui].decalage, hiberne)
}

/**
 * La famille au début d'une session : la mère et le vieux comme un hérisson
 * seul ; les petits derrière leur mère si elle est dehors, sinon au nid.
 * Personne sur personne : un vieux qui tomberait sur eux reste au nid.
 */
export function familleInitiale(elevation: number, hiberne: boolean, graine = 1): Herisson[] {
  const f: Herisson[] = []
  for (let qui = 0; qui < FAMILLE.length; qui++) {
    let h = herissonInitial(envieDe(qui, elevation, hiberne), (graine + qui * 7919) >>> 0, qui)
    const mere = f.find((m) => FAMILLE[m.qui].role === 'mere')
    const place = (x: number, z: number) => libre(x, z, FAMILLE[qui].echelle) && f.every((o) => !dehors(o) || Math.hypot(o.x - x, o.z - z) >= ecartMinimal(h, o))
    if (FAMILLE[qui].role === 'petit') {
      const [nx, nz] = nid(qui)
      h = { ...h, etat: 'nid', x: nx, z: nz, but: [nx, nz], t: GUET[0] + qui }
      if (sortie(mere)) {
        // Derrière elle, ou à défaut autour d'elle.
        const essais = [derriere(mere, qui), ...Array.from({ length: 8 }, (_, k): [number, number] => [mere.x + Math.cos(k * 0.785 + qui) * 1.1, mere.z + Math.sin(k * 0.785 + qui) * 1.1])]
        const p = essais.find(([x, z]) => place(x, z))
        if (p) h = { ...h, etat: 'flaire', x: p[0], z: p[1], but: p, cap: mere.cap, t: FLAIRE[0] + qui }
      }
    } else if (dehors(h) && !place(h.x, h.z)) {
      const [nx, nz] = nid(qui)
      h = { ...h, etat: 'nid', x: nx, z: nz, but: [nx, nz] }
    }
    f.push(h)
  }
  return f
}

/** Un pas de vie pour toute la famille : chacun voit où en sont les autres. */
export function avancerFamille(f: readonly Herisson[], dt: number, visiteur: { x: number; z: number } | null, elevation: number, hiberne: boolean): Herisson[] {
  const r = f.slice()
  for (let i = 0; i < r.length; i++) r[i] = avancerHerisson(r[i], dt, visiteur, envieDe(r[i].qui, elevation, hiberne), r)
  return r
}
