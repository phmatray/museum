/**
 * Les CARPES KOÏ de l'étang : une dizaine de poissons qui errent sans fin,
 * s'évitent, gardent leurs distances avec la berge — et qui, dès que le
 * visiteur s'avance au bord, viennent à lui et montent à la surface, la bouche
 * ouverte, comme à Hasselt quand on s'accoude au garde-fou.
 *
 * Des boids en petit : chaque carpe a un cap et une vitesse, et braque vers la
 * somme de quelques envies (errer, fuir la berge, s'écarter des voisines,
 * rejoindre le visiteur), sans jamais tourner plus vite qu'un poisson.
 * Pur : l'état entre, l'état sort ; `FauneLayer` ne fait que le montrer.
 */
import { CONTOUR_ETANG, JARDIN, distanceEtang as distanceExacte } from './jardin.ts'
import { generateur } from './park.ts'

/**
 * La distance à la berge, précalculée sur une grille de 20 cm et lue en
 * bilinéaire : `distanceEtang` parcourt tout le contour, et le banc la
 * demande des milliers de fois par seconde.
 */
const PAS = 0.2
const [X0, Z0] = [Math.min(...CONTOUR_ETANG.map((p) => p[0])) - 4, Math.min(...CONTOUR_ETANG.map((p) => p[1])) - 4]
const NX = Math.ceil((Math.max(...CONTOUR_ETANG.map((p) => p[0])) + 4 - X0) / PAS) + 1
const NZ = Math.ceil((Math.max(...CONTOUR_ETANG.map((p) => p[1])) + 4 - Z0) / PAS) + 1
let champ: Float32Array | null = null
export function distanceEtang(x: number, z: number): number {
  const [u, v] = [(x - X0) / PAS, (z - Z0) / PAS]
  if (u < 0 || v < 0 || u >= NX - 1 || v >= NZ - 1) return distanceExacte(x, z)
  if (!champ) {
    champ = new Float32Array(NX * NZ)
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) champ[j * NX + i] = distanceExacte(X0 + i * PAS, Z0 + j * PAS)
  }
  const [i, j] = [Math.floor(u), Math.floor(v)]
  const [fu, fv] = [u - i, v - j]
  const k = j * NX + i
  return (champ[k] * (1 - fu) + champ[k + 1] * fu) * (1 - fv) + (champ[k + NX] * (1 - fu) + champ[k + NX + 1] * fu) * fv
}

export type Variete = 'kohaku' | 'ogon' | 'showa'

export interface Koi {
  x: number
  z: number
  /** Le cap : la carpe nage vers (cos cap, sin cap) dans le plan (x, z). */
  cap: number
  vitesse: number
  /** Sous la surface, en mètres (l'échine) : 0 à fleur d'eau. */
  prof: number
  /** Le nez levé quand elle monte gober : en radians. */
  tangage: number
  /** 0 à 1 : son caractère (errance, motif, profondeur préférée). */
  graine: number
  variete: Variete
  /** Longueur, en mètres. */
  taille: number
  /** Son horloge : l'errance en dépend. */
  t: number
}

/** La cote de l'eau, et le fond : la berge bombée de `hauteur()` (build-jardin.py), plafonnée à −0,9 m. */
export const SURFACE = JARDIN.etang.niveau
export const fondEtang = (x: number, z: number): number => Math.max(-0.9, SURFACE + 0.5 * Math.min(0, distanceEtang(x, z)))

/** Elles ne s'approchent pas de la berge à moins de 80 cm. */
export const MARGE_BERGE = 0.8
/** Le visiteur à moins de 3 m du bord : on vient le voir. */
export const PORTEE_VISITEUR = 3
/** Au-delà, une carpe ne l'a pas vu. */
const PORTEE_BANC = 16
const VITESSE_ERRANCE = 0.22
const VITESSE_APPEL = 0.5
/** Radians par seconde : une carpe vire large. */
const VIRAGE = 1.3
const ECART = 0.9

const VARIETES: Variete[] = ['kohaku', 'kohaku', 'ogon', 'showa']

/** Le banc, semé loin des berges. */
export function koiInitiaux(n = 10, graine = 'koi'): Koi[] {
  const alea = generateur(graine)
  const out: Koi[] = []
  while (out.length < n) {
    const [x, z] = [33 + alea() * 26, 56 + alea() * 19]
    if (distanceEtang(x, z) > -2) continue
    out.push({
      x, z, cap: alea() * 2 * Math.PI, vitesse: VITESSE_ERRANCE, prof: 0.3, tangage: 0,
      graine: alea(), variete: VARIETES[out.length % VARIETES.length], taille: 0.42 + alea() * 0.18, t: alea() * 100,
    })
  }
  return out
}

/** Vers le large : l'opposé du gradient de la distance à la berge. */
function versLeLarge(x: number, z: number): [number, number] {
  const h = 0.2
  const gx = distanceEtang(x + h, z) - distanceEtang(x - h, z)
  const gz = distanceEtang(x, z + h) - distanceEtang(x, z - h)
  const l = Math.hypot(gx, gz) || 1
  return [-gx / l, -gz / l]
}

/**
 * Où le banc se rassemble quand le visiteur est au bord : un mètre au large,
 * face à lui. `null` s'il est trop loin de l'eau.
 */
export function pointDAppel(visiteur: { x: number; z: number } | null): [number, number] | null {
  if (!visiteur) return null
  const d = distanceEtang(visiteur.x, visiteur.z)
  if (d > PORTEE_VISITEUR) return null
  const [ix, iz] = versLeLarge(visiteur.x, visiteur.z)
  return [visiteur.x + ix * (Math.max(d, 0) + 1.1), visiteur.z + iz * (Math.max(d, 0) + 1.1)]
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function avancerKoi(banc: readonly Koi[], dt: number, visiteur: { x: number; z: number } | null): Koi[] {
  const appel = pointDAppel(visiteur)
  return banc.map((k) => {
    const t = k.t + dt
    let [dx, dz] = [Math.cos(k.cap), Math.sin(k.cap)]
    // Errer : un cap qui tourne lentement, différent pour chacune — elle traverse l'étang, pas des ronds.
    const errance = k.graine * 2 * Math.PI + 2.5 * Math.sin(t * 0.05 + k.graine * 9) + 0.9 * Math.sin(t * 0.17 + k.graine * 3)
    let [vx, vz] = [Math.cos(errance), Math.sin(errance)]

    // La berge, vue un mètre devant : on vire vers le large avant d'y être.
    const devant = distanceEtang(k.x + dx * 1.2, k.z + dz * 1.2)
    const ici = distanceEtang(k.x, k.z)
    const proche = Math.max(devant, ici) + MARGE_BERGE
    if (proche > 0) {
      const [ix, iz] = versLeLarge(k.x, k.z)
      vx += ix * proche * 4
      vz += iz * proche * 4
    }

    // Les voisines : on s'écarte, sans se toucher.
    for (const o of banc) {
      if (o === k) continue
      const [ox, oz] = [k.x - o.x, k.z - o.z]
      const d = Math.hypot(ox, oz)
      if (d > 1e-6 && d < ECART) {
        vx += (ox / d) * (ECART - d) * 3
        vz += (oz / d) * (ECART - d) * 3
      }
    }

    // Le visiteur au bord : tout le banc vient, et monte gober près de lui.
    let appelee = false
    let pres = false
    if (appel) {
      const [ax, az] = [appel[0] - k.x, appel[1] - k.z]
      const d = Math.hypot(ax, az)
      if (d < PORTEE_BANC) {
        appelee = true
        pres = d < 1.8
        if (d > 0.4) {
          vx += (ax / d) * 2.5
          vz += (az / d) * 2.5
        }
      }
    }

    // Braquer vers l'envie, sans dépasser le virage d'un poisson.
    const voulu = Math.atan2(vz, vx)
    const cap = k.cap + Math.max(-VIRAGE * dt, Math.min(VIRAGE * dt, angle(voulu - k.cap)))
    const cible = appelee ? (pres ? 0.12 : VITESSE_APPEL) : VITESSE_ERRANCE * (0.8 + 0.4 * k.graine)
    const vitesse = k.vitesse + (cible - k.vitesse) * Math.min(1, dt * 1.5)
    ;[dx, dz] = [Math.cos(cap), Math.sin(cap)]
    let [x, z] = [k.x + dx * vitesse * dt, k.z + dz * vitesse * dt]
    // Garde-fou : jamais plus près de la berge que la moitié de la marge.
    if (distanceEtang(x, z) > -MARGE_BERGE / 2 && distanceEtang(x, z) > ici) [x, z] = [k.x, k.z]

    // La profondeur : 0,2 à 0,6 m en errance, à fleur d'eau quand on l'appelle, jamais sous le fond.
    const entreDeuxEaux = 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.09 + k.graine * 17))
    const fond = SURFACE - fondEtang(x, z) - 0.12
    // Près du visiteur, elles montent gober tour à tour, puis redescendent d'un empan.
    const gobe = 0.02 + 0.14 * Math.max(0, Math.sin(t * 0.6 + k.graine * 20))
    const voulue = Math.max(0.02, Math.min(pres ? gobe : entreDeuxEaux, fond))
    const prof = k.prof + (voulue - k.prof) * Math.min(1, dt * (pres ? 1.2 : 0.4))
    const tangage = k.tangage + ((pres && prof < 0.15 ? 0.22 : 0) - k.tangage) * Math.min(1, dt * 2)
    return { ...k, x, z, cap, vitesse, prof, tangage, t }
  })
}
