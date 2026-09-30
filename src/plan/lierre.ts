/**
 * Le LIERRE du mur d'enceinte, qui a eu le temps de pousser.
 *
 * Chaque pied (`enceinte.ts`, `plaques`) lance au sol quelques tiges ligneuses
 * qui montent en s'écartant, en éventail ; elles se ramifient, se couvrent de
 * feuilles, d'autant plus serrées qu'on est au cœur de la plaque. Les plus
 * vigoureuses atteignent l'arase, passent sur le chaperon et retombent de
 * l'autre côté en rideau ; quelques rameaux, trop longs, pendent aussi côté
 * parc. Tout est tiré du mur : la travée borne la plaque, l'arase l'arrête ou
 * la fait basculer, le sol la plante.
 *
 * Le rendu (`scene/lierre.tsx`) pose une carte par feuille, dans son repère :
 * `normale` ce qu'elle regarde, `haut` vers son pétiole.
 *
 * Pur : ni three ni React.
 */
import { CHAPERON_MUR, type PlaqueDeLierre } from './enceinte.ts'
import { generateur } from './park.ts'
import { hauteurDuParc } from './relief.ts'

/** Les sortes de cartes : deux feuilles, un rameau feuillu, un bout de tige. */
export const SORTE = { feuille: 0, jeune: 1, rameau: 2, tige: 3 } as const

export interface Feuille {
  /** Le côté du parc (0 nord, 1 sud, 2 ouest, 3 est), un lot d'instances chacun. */
  cote: number
  position: [number, number, number]
  normale: [number, number, number]
  /** Dans le plan de la carte, vers le pétiole (vers le haut de la tige pour une tige). */
  haut: [number, number, number]
  largeur: number
  longueur: number
  sorte: number
  /** 0 : au fond, contre le mur, dans l'ombre des autres ; 1 : au soleil, dessus. */
  jour: number
}

type V3 = [number, number, number]
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const croix = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Un point de tige dans le repère du mur : le long du mur, la hauteur, l'écart à la face côté parc (négatif : devant). */
interface Point {
  u: number
  y: number
  v: number
}
/** Où pend une feuille : contre la face côté parc, sur le chaperon, contre la face du dehors. */
type Face = 'parc' | 'dessus' | 'dehors'

const PAS = 0.05

/** Le lierre de toutes les plaques. */
export function lierreDuMur(plaques: readonly PlaqueDeLierre[]): Feuille[] {
  return plaques.flatMap((p, i) => plaque(p, i))
}

function plaque(p: PlaqueDeLierre, i: number): Feuille[] {
  const alea = generateur(`lierre:${i}:${p.u.toFixed(3)}`)
  const out: Feuille[] = []
  const monde = (u: number, v: number): [number, number] => [p.origine[0] + p.long[0] * u + p.dehors[0] * v, p.origine[1] + p.long[1] * u + p.dehors[1] * v]
  const sol = (u: number) => hauteurDuParc(...monde(u, -0.02))
  const [lo, hi] = [p.a + 0.06, p.b - 0.06]
  const borne = (u: number) => Math.min(hi, Math.max(lo, u))
  const dessus = p.arase + CHAPERON_MUR.h
  const vers = { parc: [-p.dehors[0], 0, -p.dehors[1]] as V3, dehors: [p.dehors[0], 0, p.dehors[1]] as V3 }
  const long: V3 = [p.long[0], 0, p.long[1]]

  // Un pied sur deux passe le chaperon ; les autres s'arrêtent en chemin.
  const vigoureux = alea() < 0.55
  const hauteur = p.arase - sol(p.u)
  const cible = vigoureux ? hauteur + 1 : hauteur * (0.5 + 0.4 * alea())
  const demi = Math.min((0.7 + 0.9 * alea()) * p.scale, (hi - lo) / 2 + 0.3)
  const tiges = 4 + Math.floor(alea() * 3)

  /** Une carte ; `sur` dit contre quelle face elle pend, `u, y, v` où. */
  const feuille = (pt: Point, sur: Face, sorte: number, taille: number, jour: number, bascule = 0.35 + 0.4 * alea()) => {
    const [x, z] = monde(pt.u, pt.v)
    const face = sur === 'dessus' ? ([0, 1, 0] as V3) : vers[sur]
    // Tournée vers le jour : relevée vers le ciel, un peu de biais le long du mur.
    const biais = (alea() - 0.5) * 0.9
    // Sur le chaperon, à plat : une crête dressée se découpait sur le ciel.
    const n: V3 = sur === 'dessus'
      ? norm([long[0] * biais * 0.15 + vers.parc[0] * (alea() - 0.5) * 0.2, 1, long[2] * biais * 0.15 + vers.parc[2] * (alea() - 0.5) * 0.2])
      : norm([face[0] + long[0] * biais + 0, Math.tan(bascule), face[2] + long[2] * biais])
    // Le pétiole vers le haut (ou vers la tige, sur le dessus), puis roulée de ±35°.
    const ref: V3 = sur === 'dessus' ? (alea() < 0.5 ? vers.parc : vers.dehors) : [0, 1, 0]
    const d = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2]
    const h0 = norm([ref[0] - d * n[0], ref[1] - d * n[1], ref[2] - d * n[2]])
    const r = (alea() - 0.5) * 1.2
    const c = croix(n, h0)
    const haut = norm([h0[0] * Math.cos(r) + c[0] * Math.sin(r), h0[1] * Math.cos(r) + c[1] * Math.sin(r), h0[2] * Math.cos(r) + c[2] * Math.sin(r)])
    out.push({ cote: p.cote, position: [x, pt.y, z], normale: n, haut, largeur: taille, longueur: taille, sorte, jour })
  }

  /** Un bout de tige, de `a` (plus bas) à `b` : une carte étroite couchée contre la face. */
  const tige = (a: Point, b: Point, sur: Face, epais: number) => {
    const [xa, za] = monde(a.u, a.v)
    const [xb, zb] = monde(b.u, b.v)
    const dir: V3 = [xb - xa, b.y - a.y, zb - za]
    const l = Math.hypot(...dir)
    if (l < 1e-4) return
    const n = sur === 'dessus' ? ([0, 1, 0] as V3) : vers[sur]
    out.push({ cote: p.cote, position: [xb, b.y, zb], normale: n, haut: norm(dir), largeur: epais, longueur: l * 1.25, sorte: SORTE.tige, jour: 0.3 })
  }

  /**
   * Garnit une tige de feuilles, d'autant plus serrées et plus décollées du
   * mur qu'on est au cœur de la plaque (`masse`, 0..1) ; les jeunes pousses,
   * au bout, ont les feuilles plus petites.
   */
  const garnir = (chemin: Point[], sur: Face, masse: (pt: Point) => number, jeune = 0.35) => {
    const n = chemin.length
    chemin.forEach((pt, k) => {
      const t = k / Math.max(1, n - 1)
      const m = masse(pt)
      const nb = Math.round((0.8 + 2.4 * m) * (0.7 + alea() * 0.6))
      for (let f = 0; f < nb; f++) {
        const ecart = (alea() + alea() - 1) * (0.1 + 0.16 * m)
        const q: Point = sur === 'dessus'
          ? { u: pt.u + ecart, y: pt.y + 0.004 + alea() * 0.01, v: pt.v + (alea() - 0.5) * 0.06 }
          : { u: sur === 'parc' ? borne(pt.u + ecart) : pt.u + ecart, y: pt.y + (alea() - 0.5) * 0.05, v: pt.v }
        // Décollée du mur : le fond de la plaque touche la brique, le dessus s'avance.
        const decolle = 0.012 + alea() ** 1.4 * (0.03 + 0.09 * m)
        if (sur === 'parc') q.v = pt.v - decolle
        else if (sur === 'dehors') q.v = pt.v + decolle
        const bout = t > 1 - jeune ? (t - (1 - jeune)) / jeune : 0
        const tire = alea()
        // Sur le chaperon, pas de rameau long : des feuilles couchées.
        const sorte = tire < 0.32 ? SORTE.feuille : tire < 0.52 || sur === 'dessus' ? SORTE.jeune : SORTE.rameau
        const taille = (sorte === SORTE.rameau ? 0.2 + 0.12 * alea() : 0.085 + 0.065 * alea()) * (1 - 0.4 * bout) * (sur === 'dessus' ? 0.8 : 1)
        const jour = Math.min(1, (sur === 'dessus' ? 0.75 : 0.25) + decolle * 6 + 0.25 * alea())
        feuille(q, sur, sorte, taille, jour)
      }
    })
  }

  /** Le cœur de la plaque : bas et au milieu, épais ; les bords et le haut, plus clairs. */
  const masse = (pt: Point) => {
    const h = Math.max(0, pt.y - sol(p.u))
    const cote = Math.abs(pt.u - p.u) / (demi + 0.2)
    return Math.max(0.15, Math.min(1, 1.15 - cote * 0.8 - Math.max(0, h - 0.4) / (cible + 0.5)))
  }

  for (let k = 0; k < tiges; k++) {
    // Le pied, au sol, et où la tige veut aller : en éventail d'une travée à l'autre.
    const u0 = borne(p.u + (alea() - 0.5) * 0.3 * p.scale)
    const s = tiges === 1 ? 0 : k / (tiges - 1) - 0.5
    const u1 = borne(p.u + s * 2 * demi * (0.7 + 0.4 * alea()))
    const monte = Math.min(cible * (vigoureux && alea() < 0.7 ? 1 : 0.6 + 0.35 * alea()), vigoureux ? hauteur + 1 : hauteur - 0.15)
    const phase = alea() * 6.3
    const chemin: Point[] = []
    const y0 = sol(u0) - 0.03
    let passe = false
    for (let y = y0; y - y0 < monte; y += PAS) {
      const t = (y - y0) / Math.max(0.5, monte)
      const u = borne(u0 + (u1 - u0) * Math.sin((Math.min(1, t) * Math.PI) / 2) + 0.05 * Math.sin((y - y0) * 3.1 + phase))
      if (y >= p.arase - 0.02) {
        passe = true
        break
      }
      chemin.push({ u, y, v: -0.006 })
    }
    // La tige : ligneuse au pied (3 cm), fine en haut.
    for (let j = 1; j < chemin.length; j += 2) tige(chemin[j - 1], chemin[Math.min(chemin.length - 1, j + 1)], 'parc', 0.032 - 0.02 * (j / chemin.length))
    // Le pied nu, un peu : les feuilles commencent à 20 cm.
    garnir(chemin.filter((pt) => pt.y - y0 > 0.2 || alea() < 0.25), 'parc', masse)

    // Les rameaux latéraux, qui s'écartent en montant.
    for (let j = 4; j < chemin.length - 2; j++) {
      if (alea() > 0.11) continue
      const base = chemin[j]
      const sens = alea() < 0.5 ? -1 : 1
      const angle = 0.5 + alea() * 0.75
      const L = 0.3 + alea() * 0.8
      const rameau: Point[] = []
      for (let l = 0; l < L; l += PAS) {
        const y = base.y + Math.cos(angle) * l
        if (y > p.arase - 0.04) break
        rameau.push({ u: borne(base.u + sens * Math.sin(angle) * l), y, v: -0.006 })
      }
      for (let r = 1; r < rameau.length; r += 2) tige(rameau[r - 1], rameau[Math.min(rameau.length - 1, r + 1)], 'parc', 0.012)
      garnir(rameau, 'parc', masse, 0.6)
    }

    if (!passe) continue
    // Par-dessus le chaperon…
    const ut = chemin.length ? chemin[chemin.length - 1].u : u1
    const traverse: Point[] = []
    for (let v = -CHAPERON_MUR.debord; v <= p.epaisseur + CHAPERON_MUR.debord; v += PAS) traverse.push({ u: borne(ut + (alea() - 0.5) * 0.04), y: dessus, v })
    for (let j = 1; j < traverse.length; j++) tige(traverse[j - 1], traverse[j], 'dessus', 0.012)
    garnir(traverse, 'dessus', () => 0.8)
    // … et le rideau qui retombe au dehors.
    const chute = 0.4 + alea() * 1.3
    const rideau: Point[] = []
    for (let l = 0; l < chute; l += PAS) rideau.push({ u: ut + 0.06 * Math.sin(l * 4 + phase), y: dessus - 0.03 - l, v: p.epaisseur + CHAPERON_MUR.debord + 0.005 })
    garnir(rideau, 'dehors', (pt) => 0.9 - 0.5 * ((dessus - pt.y) / chute), 0.5)
    // Côté parc aussi, un rameau trop long pend du chaperon, écarté du mur.
    if (alea() < 0.85) {
      const pend = 0.3 + alea() * 0.8
      const retombe: Point[] = []
      for (let l = 0; l < pend; l += PAS) retombe.push({ u: borne(ut + (alea() - 0.5) * 0.3 + 0.08 * Math.sin(l * 5 + phase)), y: dessus - 0.02 - l, v: -CHAPERON_MUR.debord - 0.03 - 0.04 * (l / pend) })
      garnir(retombe, 'parc', () => 0.35, 0.6)
    }
  }
  return out
}
