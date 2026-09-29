/**
 * Les OISEAUX du jardin : moineaux et mésanges perchés au bord des érables,
 * qui sautillent, changent d'arbre en vol, picorent sur la pelouse — et
 * s'envolent quand le visiteur approche à moins de quatre mètres.
 *
 * Pur : des perchoirs tirés des érables de `parkPlacements`, et un pas de
 * temps qui fait passer chaque oiseau de perché à en vol, d'en vol à posé.
 * Le hasard est un paramètre : `Math.random` à l'écran, une graine au banc.
 */
import { presDeLEau } from './jardin.ts'
import { generateur, type Parc } from './park.ts'
import { hauteurDuParc } from './relief.ts'

export interface Perchoir {
  x: number
  y: number
  z: number
  /** Au sol, sur une allée : l'oiseau y picore. */
  sol: boolean
}

export type Espece = 'moineau' | 'mesange'

export interface Oiseau {
  espece: Espece
  etat: 'perche' | 'vol'
  /** Le perchoir d'où il part (ou où il est), celui où il va. */
  de: number
  vers: number
  /** En vol : l'avancement, 0 → 1, et la durée totale en secondes. */
  u: number
  duree: number
  x: number
  y: number
  z: number
  /** Le lacet : l'oiseau regarde vers (sin cap, cos cap)… comme `Walker.yaw` : 0 regarde −z. */
  cap: number
  /** Avant la prochaine idée (sautiller, picorer, changer d'arbre). */
  minuteur: number
  /** Un saut en cours : de 1 à 0, 0 au repos. */
  saut: number
  /** Le bec au sol : de 1 à 0. */
  picore: number
}

/** Le visiteur à moins de 4 m : tout le monde s'envole. */
export const PORTEE_FUITE = 4
const VITESSE_VOL = 5.5
/** Le bâtiment : aucun oiseau n'y entre, même en vol. */
const EMPRISE = { x0: -1, x1: 49, z0: -1, z1: 41 }
const dansLeMusee = (x: number, z: number) => x > EMPRISE.x0 && x < EMPRISE.x1 && z > EMPRISE.z0 && z < EMPRISE.z1

export type Point3 = [number, number, number]

const PAR_ARBRE = 5

/**
 * Cinq perchoirs dans chaque érable, et des coins de gravier sur l'allée voisine.
 * Avec `branches` (des points du dessus du feuillage de chaque essence, dans
 * son repère — `FauneLayer` les lit sur le modèle), les oiseaux se posent sur
 * le vrai houppier ; sans, à son bord, vers 2 m de rayon et 3,3 m de haut à
 * l'échelle 1 (`erable()` de build-jardin.py).
 */
export function perchoirs(parc: Parc, branches?: Partial<Record<string, Point3[]>>): Perchoir[] {
  const alea = generateur('oiseaux')
  const out: Perchoir[] = []
  for (const a of parc.plantations) {
    if (!a.espece.startsWith('erable')) continue
    const y0 = a.y ?? 0
    const [c, s] = [Math.cos(a.rotation), Math.sin(a.rotation)]
    const bois = branches?.[a.espece] ?? []
    for (let k = 0; k < 3; k++) {
      if (bois.length > 0) {
        // Le même repère que l'instance : lacet `rotation` autour de y (three), puis l'échelle.
        // Un par tiers de la liste : trois perchoirs distincts.
        const [bx, by, bz] = bois[Math.floor(((k + alea()) / 3) * bois.length)]
        out.push({ x: a.x + (bx * c + bz * s) * a.scale, y: y0 + by * a.scale + 0.02, z: a.z + (-bx * s + bz * c) * a.scale, sol: false })
        continue
      }
      const th = a.rotation + (2 * Math.PI * (k + alea() * 0.6)) / PAR_ARBRE
      const r = (1.9 + alea() * 0.7) * a.scale
      out.push({ x: a.x + Math.cos(th) * r, y: y0 + (3.35 - 0.3 * (r / a.scale - 1.9)) * a.scale, z: a.z + Math.sin(th) * r, sol: false })
    }
    // Au sol, sur le gravier de l'allée la plus proche : dans le gazon haut, on ne les verrait pas.
    // La seule plus proche : les allées courbes sont faites de tronçons d'un mètre, un arbre en a des dizaines à 8 m.
    const proches = parc.allees.map((al) => {
      const [dx, dz] = [al.b.x - al.a.x, al.b.z - al.a.z]
      const t = Math.max(0, Math.min(1, ((a.x - al.a.x) * dx + (a.z - al.a.z) * dz) / (dx * dx + dz * dz)))
      const [px, pz] = [al.a.x + dx * t, al.a.z + dz * t]
      return { al, dx, dz, px, pz, d: Math.hypot(px - a.x, pz - a.z) }
    }).sort((p, q) => p.d - q.d).slice(0, 1)
    for (const { al, dx, dz, px, pz, d } of proches) {
      if (d > 8) continue
      const l = Math.hypot(dx, dz)
      for (let k = 0; k < 2; k++) {
        const [u, v] = [(alea() - 0.5) * 4, (alea() - 0.5) * al.largeur * 0.7]
        const [x, z] = [px + (dx / l) * u - (dz / l) * v, pz + (dz / l) * u + (dx / l) * v]
        if (dansLeMusee(x, z) || presDeLEau(x, z, 1)) continue
        out.push({ x, y: hauteurDuParc(x, z) + 0.03, z, sol: true })
      }
    }
  }
  return out.filter((p) => !dansLeMusee(p.x, p.z))
}

/** Les oiseaux au départ : un par perchoir tiré au sort, un tiers au sol. */
export function oiseauxInitiaux(ps: Perchoir[], n = 16, alea: () => number = generateur('volee')): Oiseau[] {
  const pris = new Set<number>()
  const out: Oiseau[] = []
  for (let i = 0; i < n && pris.size < ps.length; i++) {
    const sol = i % 3 === 0
    let k = Math.floor(alea() * ps.length)
    for (let essai = 0; essai < 50 && (pris.has(k) || ps[k].sol !== sol); essai++) k = Math.floor(alea() * ps.length)
    pris.add(k)
    out.push({
      espece: alea() < 0.55 ? 'moineau' : 'mesange', etat: 'perche', de: k, vers: k, u: 0, duree: 0,
      x: ps[k].x, y: ps[k].y, z: ps[k].z, cap: alea() * 2 * Math.PI, minuteur: 1 + alea() * 6, saut: 0, picore: 0,
    })
  }
  return out
}

/** Un perchoir libre, pas trop loin, et à plus de `loinDe` du visiteur s'il y en a un. */
function choisir(ps: Perchoir[], o: Oiseau, pris: Set<number>, alea: () => number, loinDe: { x: number; z: number } | null, abrite: boolean): number {
  let meilleur = o.de
  for (let essai = 0; essai < 40; essai++) {
    const k = Math.floor(alea() * ps.length)
    const p = ps[k]
    const d = Math.hypot(p.x - o.x, p.z - o.z)
    if (pris.has(k) || d < 3 || d > 30 || (abrite && p.sol)) continue
    // Jamais par-dessus le musée : on le contourne en changeant de destination.
    if ([0.25, 0.5, 0.75].some((t) => dansLeMusee(o.x + (p.x - o.x) * t, o.z + (p.z - o.z) * t))) continue
    if (loinDe && Math.hypot(p.x - loinDe.x, p.z - loinDe.z) < PORTEE_FUITE * 3) continue
    meilleur = k
    if (!loinDe || alea() < 0.5) break
  }
  return meilleur
}

/** La position en vol : une ligne droite, et un arc qui monte d'autant plus que le trajet est long. */
export function enVol(a: Perchoir, b: Perchoir, u: number): [number, number, number] {
  const s = u * u * (3 - 2 * u)
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  const arc = Math.min(4, 0.8 + d * 0.18) * Math.sin(Math.PI * u)
  return [a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s + arc, a.z + (b.z - a.z) * s]
}

/**
 * `intemperie` (0 à 1, la pluie ou la neige qui tombe) : sous l'averse, les
 * oiseaux s'abritent dans les arbres — plus aucun au sol — et ne volent plus
 * que pour fuir.
 */
export function avancerOiseaux(
  oiseaux: readonly Oiseau[], ps: Perchoir[], dt: number, visiteur: { x: number; z: number } | null, alea: () => number, intemperie = 0,
): Oiseau[] {
  const abrite = intemperie > 0.3
  const pris = new Set(oiseaux.map((o) => o.vers))
  return oiseaux.map((o) => {
    const saut = Math.max(0, o.saut - dt / 0.3)
    const picore = Math.max(0, o.picore - dt / 0.35)
    if (o.etat === 'vol') {
      const u = Math.min(1, o.u + dt / o.duree)
      const [x, y, z] = enVol(ps[o.de], ps[o.vers], u)
      if (u < 1) return { ...o, u, x, y, z, saut, picore }
      return { ...o, etat: 'perche', de: o.vers, u: 0, x, y, z, minuteur: 1.5 + alea() * 5, saut, picore }
    }
    const effraye = visiteur !== null && Math.hypot(o.x - visiteur.x, o.z - visiteur.z) < PORTEE_FUITE
    const minuteur = o.minuteur - dt
    if (!effraye && minuteur > 0) return { ...o, minuteur, saut, picore }
    // Changer d'arbre (ou fuir), sinon sautiller, ou picorer au sol.
    const aLAbri = abrite && ps[o.de].sol
    if (effraye || aLAbri || alea() < 0.2 * (1 - intemperie)) {
      pris.delete(o.vers)
      const vers = choisir(ps, o, pris, alea, effraye ? visiteur : null, abrite)
      if (vers !== o.de) {
        pris.add(vers)
        const b = ps[vers]
        const d = Math.hypot(b.x - o.x, b.y - o.y, b.z - o.z)
        return { ...o, etat: 'vol', vers, u: 0, duree: Math.max(1.2, d / VITESSE_VOL), cap: Math.atan2(-(b.x - o.x), -(b.z - o.z)), minuteur: 0, saut: 0, picore: 0 }
      }
      pris.add(o.vers)
    }
    const cap = o.cap + (alea() - 0.5) * 2.2
    if (ps[o.de].sol && alea() < 0.6) return { ...o, cap, minuteur: 0.4 + alea() * 1.5, picore: 1, saut }
    return { ...o, cap, minuteur: 0.6 + alea() * 3, saut: 1, picore }
  })
}
