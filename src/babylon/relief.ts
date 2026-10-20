/**
 * Le relief du parc (ParkLayer.tsx et gazon.ts de three) : la pelouse posée sur
 * `hauteurDuParc`, sa jupe, la campagne derrière le mur et la mousse de la fosse
 * du belvédère en UN maillage (matière `pelouse`) ; le parvis dallé aux angles
 * arrondis (matière `dallage`) ; et le gazon, deux lots de brins en thin instances
 * repliés autour de la caméra par les plugins `Gazon-0` et `Gazon-1` (le shader de three ligne pour ligne).
 *
 * Sens des faces inversé par rapport à three : chaque triangle (a, b, c) de three est écrit (a, c, b).
 * Les couleurs de sommet sont déjà linéaires (au-delà de 1 pour la brume, exprès).
 * Le gazon ne porte pas d'ombre, il la reçoit ; sa visibilité suit les parcelles
 * d'herbe en vue (sa sphère englobante l'entoure toujours, elle ne dit rien).
 * Saison du gazon (jaune, terne : état vivant) et météo lissée (vent, mouillé,
 * enneigé : METEO) passent par l'UBO (`gazonSaison`), sans recompiler.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { FromHalfFloat, ToHalfFloat } from '@babylonjs/core/Misc/halfFloat'
import type { Scene } from '@babylonjs/core/scene'

import { BORDURE, GALETS, champDesAllees } from '../plan/allees.ts'
import { PAS_DE_LA_RIVE, dansLeBelvedere, terreDeLaFosse } from '../plan/belvedere.ts'
import { dansLeChantier } from '../plan/chantier.ts'
import { JARDIN, TABLIER, distanceEtang, distanceRuisseau } from '../plan/jardin.ts'
import { surUneAllee, type Allee, type Parc } from '../plan/park.ts'
import { ARRONDI_PARVIS, COTE_DALLAGE, distanceParvis, hauteurDuParc, masqueDuRelief } from '../plan/relief.ts'
import type { Rect } from '../plan/types.ts'
import { gabaritCube, geometrieDeBoites, matiere, type Gabarit } from './boites.ts'
import { vivant } from './etat.ts'
import { dialecte, greffer } from './greffe.ts'
import { METEO } from './intemperies.ts'
import { brancherLueurs, smoothstep } from './lueurs.ts'
import { dallage, FOULE, mulberry32, PARC, pelouse } from './parc.ts'

/** Le bord du terrain descend d'autant. */
const EPAISSEUR_SOL = 0.4
/** Les pas de la campagne, du mur vers l'horizon (cumulés, en mètres). */
const AU_DELA = [2, 5, 9, 14, 20, 28, 38, 52, 70, 95, 130, 180, 250, 340, 460]
/** Un texel de la carte du sol, en mètres. */
const TEXEL = 0.5
const BERGE = 1.2
const RIVE = 0.3

/** `avance` : le carré de côté `cote` est centré à tant de mètres DEVANT le visiteur (vue de dessus). */
export interface Lot { nombre: number; cote: number; avance: number; rayon: number; largeur: number; hauteur: [number, number]; niveaux: number }
/**
 * Deux semis : serré près du visiteur, plus lâche et plus large au loin. Même
 * densité que three (110 000 brins sur 20 m, 50 000 sur 64 m), mais le carré
 * est poussé devant le regard : three en semait la moitié dans le dos. Le
 * semis est ancré au monde (un brin = brin.xy + k × côté), déplacer le carré ne
 * fait que changer quelle copie paraît : rien ne saute en tournant la tête.
 * Au loin (au-delà de 6 m), deux rangs par brin au lieu de trois : 3 triangles, pas 5.
 */
export const GAZONS: Lot[] = [
  { nombre: Math.round(110000 * (14 / 20) ** 2), cote: 14, avance: 3, rayon: 10, largeur: 0.03, hauteur: [0.1, 0.24], niveaux: 3 },
  { nombre: Math.round(50000 * (48 / 64) ** 2), cote: 48, avance: 12, rayon: 31, largeur: 0.09, hauteur: [0.12, 0.28], niveaux: 2 },
]

interface Geo { positions: number[]; colors: number[]; uvs: number[]; indices: number[] }
const dansRect = (r: Rect, x: number, z: number, marge = 0) =>
  x >= r.x - marge && x <= r.x + r.width + marge && z >= r.z - marge && z <= r.z + r.depth + marge
/** Un triangle de three (a, b, c), écrit dans le sens de Babylon. */
const tri = (out: number[], a: number, b: number, c: number) => out.push(a, c, b)

/** La pelouse : grille d'un mètre, mailles de `parc.sol` et des angles arrondis du parvis, plus la jupe. */
function grille(parc: Parc, g: Geo): void {
  const { terrain, parvis: p } = parc
  const [nx, nz] = [terrain.width, terrain.depth]
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const [x, z] = [terrain.x + i, terrain.z + j]
      g.positions.push(x, hauteurDuParc(x, z), z)
      const v = 1 + masqueDuRelief(x, z) * 0.14 * Math.sin(x * 0.13 + 2 * Math.sin(z * 0.05)) * Math.sin(z * 0.11 - x * 0.04)
      g.colors.push(v, v * (1 + 0.04 * Math.sin(x * 0.07 + z * 0.09)), v, 1)
      g.uvs.push(x, z)
    }
  const v = (i: number, j: number) => j * (nx + 1) + i
  const dans = (x: number, z: number) => parc.sol.some((r) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth)
  const angle = (x: number, z: number) => x > p.x && x < p.x + p.width && z > p.z && z < p.z + p.depth &&
    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].some(([u, w]) => distanceParvis(p, x + u, z + w) > 1e-3)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [x, z] = [terrain.x + i + 0.5, terrain.z + j + 0.5]
      if (!dans(x, z) && !angle(x, z)) continue
      tri(g.indices, v(i, j), v(i, j + 1), v(i + 1, j))
      tri(g.indices, v(i + 1, j), v(i, j + 1), v(i + 1, j + 1))
    }
  const tour = [
    ...Array.from({ length: nx }, (_, i) => v(i, 0)), ...Array.from({ length: nz }, (_, j) => v(nx, j)),
    ...Array.from({ length: nx }, (_, i) => v(nx - i, nz)), ...Array.from({ length: nz }, (_, j) => v(0, nz - j)),
  ]
  const n = g.positions.length / 3
  tour.forEach((k, i) => {
    g.positions.push(g.positions[3 * k], -EPAISSEUR_SOL, g.positions[3 * k + 2])
    g.colors.push(1, 1, 1, 1)
    g.uvs.push(g.positions[3 * k], g.positions[3 * k + 2])
    const [a, b, c, d] = [k, tour[(i + 1) % tour.length], n + i, n + ((i + 1) % tour.length)]
    tri(g.indices, a, c, b)
    tri(g.indices, b, c, d)
  })
}

/** La campagne : grille à pas croissants percée du terrain, aplanie et pâlie vers l'horizon. */
function dehors(terrain: Rect, g: Geo): void {
  const axe = (a0: number, a1: number) => {
    const n = Math.round((a1 - a0) / 8)
    return [...AU_DELA.map((d) => a0 - d).reverse(), ...Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n), ...AU_DELA.map((d) => a1 + d)]
  }
  const [xs, zs] = [axe(terrain.x, terrain.x + terrain.width), axe(terrain.z, terrain.z + terrain.depth)]
  const o = g.positions.length / 3
  for (const z of zs)
    for (const x of xs) {
      const d = Math.hypot(Math.max(terrain.x - x, 0, x - terrain.x - terrain.width), Math.max(terrain.z - z, 0, z - terrain.z - terrain.depth))
      g.positions.push(x, hauteurDuParc(x, z) * (1 - smoothstep(d, 20, 200)), z)
      const b = smoothstep(d, 40, 460)
      g.colors.push(0.95 + (1.5 - 0.95) * b, 0.97 + (1.5 - 0.97) * b, 0.93 + (1.95 - 0.93) * b, 1)
      g.uvs.push(x, z)
    }
  const nx = xs.length
  for (let j = 0; j + 1 < zs.length; j++)
    for (let i = 0; i + 1 < nx; i++) {
      if (dansRect(terrain, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2, -1e-9)) continue
      const v = o + j * nx + i
      tri(g.indices, v, v + nx, v + 1)
      tri(g.indices, v + 1, v + nx, v + nx + 1)
    }
}

/** Pelouse, jupe, campagne et fosse du belvédère : un maillage, UV (x, z) en mètres. `gabarit` : `gabaritCube(scene)`. */
export function geometriePelouse(parc: Parc, gabarit: Gabarit): VertexData {
  const g: Geo = { positions: [], colors: [], uvs: [], indices: [] }
  grille(parc, g)
  dehors(parc.terrain, g)
  const fosse = geometrieDeBoites(gabarit, [terreDeLaFosse()])
  const o = g.positions.length / 3
  for (let i = 0; i < fosse.positions.length; i += 3) {
    g.positions.push(fosse.positions[i], fosse.positions[i + 1], fosse.positions[i + 2])
    g.colors.push(0.52, 0.66, 0.4, 1)
    g.uvs.push(fosse.positions[i], fosse.positions[i + 2])
  }
  for (const k of fosse.indices) g.indices.push(k + o)
  const normals: number[] = []
  VertexData.ComputeNormals(g.positions, g.indices, normals)
  return Object.assign(new VertexData(), { ...g, normals })
}

/**
 * Le dallage du parvis : chaque bande de `parc.dalles` extrudée de 0 à COTE_DALLAGE,
 * ses coins qui sont des coins du parvis arrondis (24 segments, l'arc de `distanceParvis`).
 * Bandes convexes : dessus en éventail, côtés à sommets propres (normales franches). Sans dessous.
 */
export function geometrieParvis(parc: Parc): VertexData {
  const { parvis } = parc
  const positions: number[] = []
  const indices: number[] = []
  const h = COTE_DALLAGE
  for (const r of parc.dalles) {
    const [x0, x1, z0, z1] = [r.x, r.x + r.width, r.z, r.z + r.depth]
    const contour: [number, number][] = []
    const coins: [number, number, number, number][] = [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]]
    coins.forEach(([x, z, sx, sz], i) => {
      const e = (x === parvis.x || x === parvis.x + parvis.width) && (z === parvis.z || z === parvis.z + parvis.depth) ? ARRONDI_PARVIS : 0
      const [ax, az] = i % 2 === 0 ? [x, z + sz * e] : [x + sx * e, z]
      const [bx, bz] = i % 2 === 0 ? [x + sx * e, z] : [x, z + sz * e]
      contour.push([ax, az])
      if (e === 0) return
      const [cx, cz] = [x + sx * e, z + sz * e]
      const t0 = Math.atan2(az - cz, ax - cx)
      let dt = Math.atan2(bz - cz, bx - cx) - t0
      if (dt > Math.PI) dt -= 2 * Math.PI
      if (dt < -Math.PI) dt += 2 * Math.PI
      for (let k = 1; k <= 24; k++) contour.push([cx + e * Math.cos(t0 + (dt * k) / 24), cz + e * Math.sin(t0 + (dt * k) / 24)])
    })
    // Le contour tourne en horaire vu du dessus (z vers le bas) : l'éventail est déjà dans le sens de Babylon.
    const o = positions.length / 3
    for (const [x, z] of contour) positions.push(x, h, z)
    for (let k = 1; k + 1 < contour.length; k++) indices.push(o, o + k, o + k + 1)
    contour.forEach(([x, z], k) => {
      const [qx, qz] = contour[(k + 1) % contour.length]
      const s = positions.length / 3
      positions.push(x, 0, z, qx, 0, qz, x, h, z, qx, h, qz)
      indices.push(s, s + 1, s + 2, s + 1, s + 3, s + 2)
    })
  }
  const uvs: number[] = []
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i], positions[i + 2])
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  return Object.assign(new VertexData(), { positions, indices, uvs, normals })
}

/** La distance à l'étang au centre de la maille d'un mètre : elle borne tous ses points (± 0,71 m). */
const EAU = new Map<string, number>()
function etangProche(x: number, z: number): number {
  const [i, j] = [Math.floor(x), Math.floor(z)]
  const cle = `${i}:${j}`
  let d = EAU.get(cle)
  if (d === undefined) EAU.set(cle, (d = distanceEtang(i + 0.5, j + 0.5)))
  return d
}

/** Le sol nu : hors du terrain, parvis, tablier, chantier, belvédère, l'eau et ses berges. */
function solNu(parc: Parc, x: number, z: number): boolean {
  if (!dansRect(parc.terrain, x, z) || distanceParvis(parc.parvis, x, z) < 0.1 || dansRect(TABLIER, x, z, 0.6) || dansLeChantier(x, z, 0.05) || dansLeBelvedere(x, z, 0.05)) return true
  if (!JARDIN.zones.some((r) => dansRect(r, x, z, 2))) return false
  if (distanceRuisseau(x, z) < RIVE) return true
  const d = etangProche(x, z)
  return d < BERGE - 0.71 || (d < BERGE + 0.71 && distanceEtang(x, z) < BERGE)
}

const PIED: Partial<Record<string, number>> = { 'erable-rouge': 0.25, 'erable-vert': 0.25, buis: 0.7, azalee: 0.7 }

/** Ce qui dégarnit le gazon hors des allées : des disques (bandes de longueur nulle). */
function pelades(parc: Parc): Allee[] {
  const disque = (x: number, z: number, r: number): Allee => ({ a: { x, z }, b: { x, z }, largeur: 2 * r })
  return [
    ...parc.plantations.map((p) => disque(p.x, p.z, p.espece.startsWith('rocher') ? p.rayon * 0.6 : (PIED[p.espece] ?? 0) * (p.espece.startsWith('erable') ? p.scale : p.rayon))),
    disque(JARDIN.lanterne.x, JARDIN.lanterne.z, 0.5),
    ...JARDIN.pas.map(([x, z]) => disque(x, z, 0.45)),
    ...PAS_DE_LA_RIVE.map((p) => disque(p.x, p.z, p.rayon + 0.08)),
  ].filter((p) => p.largeur > 0)
}

export interface CarteDuSol {
  /** RGBA demi-flottants : rouge = cote du relief, vert = 1 où l'herbe pousse. */
  donnees: Uint16Array
  largeur: number
  hauteur: number
  /** (x, z, largeur, profondeur) couverts. */
  cadre: [number, number, number, number]
}

/** La carte du sol, un texel par 0,5 m ; allées et pelades estampées sur leur boîte englobante. */
export function carteDuSol(parc: Parc): CarteDuSol {
  const { terrain } = parc
  const [nx, nz] = [Math.round(terrain.width / TEXEL), Math.round(terrain.depth / TEXEL)]
  const data = new Uint16Array(nx * nz * 4)
  const [un, zero] = [ToHalfFloat(1), ToHalfFloat(0)]
  const centre = (i: number, j: number) => [terrain.x + (i + 0.5) * TEXEL, terrain.z + (j + 0.5) * TEXEL] as const
  const { reseau } = champDesAllees(parc)
  const bord = BORDURE.dehors + GALETS - 0.1
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [x, z] = centre(i, j)
      const k = (j * nx + i) * 4
      data[k] = ToHalfFloat(hauteurDuParc(x, z))
      data[k + 1] = solNu(parc, x, z) || reseau(x, z) < bord ? zero : un
      data[k + 2] = zero
      data[k + 3] = un
    }
  for (const p of pelades(parc)) {
    const m = p.largeur / 2
    const [i0, i1] = [Math.max(0, Math.floor((Math.min(p.a.x, p.b.x) - m - terrain.x) / TEXEL)), Math.min(nx - 1, Math.ceil((Math.max(p.a.x, p.b.x) + m - terrain.x) / TEXEL))]
    const [j0, j1] = [Math.max(0, Math.floor((Math.min(p.a.z, p.b.z) - m - terrain.z) / TEXEL)), Math.min(nz - 1, Math.ceil((Math.max(p.a.z, p.b.z) + m - terrain.z) / TEXEL))]
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (surUneAllee([p], ...centre(i, j))) data[(j * nx + i) * 4 + 1] = zero
  }
  return { donnees: data, largeur: nx, hauteur: nz, cadre: [terrain.x, terrain.z, terrain.width, terrain.depth] }
}

/** Une boîte (x0, y0, z0, x1, y1, z1). */
export type Parcelle = [number, number, number, number, number, number]

/** Où pousse l'herbe, en boîtes de `cote` m : de la cote la plus basse à la plus haute plus `dessus`, ½ m de marge. */
export function parcellesDeGazon({ donnees, largeur, hauteur, cadre }: CarteDuSol, dessus = 0.28 + 0.2, cote = 4): Parcelle[] {
  const n = Math.round(cote / TEXEL)
  const boites: Parcelle[] = []
  for (let j0 = 0; j0 < hauteur; j0 += n)
    for (let i0 = 0; i0 < largeur; i0 += n) {
      let [bas, haut] = [Infinity, -Infinity]
      for (let j = j0; j < Math.min(j0 + n, hauteur); j++)
        for (let i = i0; i < Math.min(i0 + n, largeur); i++) {
          const k = (j * largeur + i) * 4
          if (donnees[k + 1] === 0) continue
          const h = FromHalfFloat(donnees[k])
          ;[bas, haut] = [Math.min(bas, h), Math.max(haut, h)]
        }
      if (bas > haut) continue
      const [x, z] = [cadre[0] + i0 * TEXEL, cadre[1] + j0 * TEXEL]
      boites.push([x - 0.5, bas - 0.1, z - 0.5, x + cote + 0.5, haut + dessus, z + cote + 0.5])
    }
  return boites
}

/**
 * L'une des `boites` du carré de demi-côté `rayon` autour de (x, z) est-elle dans le
 * cône (`Frustum.GetPlanes`, normales vers l'intérieur) élargi de `marge` mètres ?
 */
export function uneEnVue(boites: readonly Parcelle[], plans: readonly Plane[], x: number, z: number, rayon: number, marge = 1): boolean {
  return boites.some((b) =>
    b[3] > x - rayon && b[0] < x + rayon && b[5] > z - rayon && b[2] < z + rayon &&
    plans.every(({ normal: n, d }) => (n.x > 0 ? b[3] : b[0]) * n.x + (n.y > 0 ? b[4] : b[1]) * n.y + (n.z > 0 ? b[5] : b[2]) * n.z + d + marge >= 0))
}

/** Un brin effilé (2 × niveaux + 1 sommets, 2 × niveaux − 1 triangles, x ∈ [−½, ½] travers, y ∈ [0, 1] hauteur) et `aBrin` par instance. */
export function brins({ nombre, cote, niveaux: NIVEAUX }: Lot, graine: number): { positions: number[]; normals: number[]; indices: number[]; aBrin: Float32Array } {
  const positions: number[] = []
  const indices: number[] = []
  for (let k = 0; k < NIVEAUX; k++) {
    const t = k / NIVEAUX
    const l = 0.5 * (1 - t) ** 0.7
    positions.push(-l, t, 0, l, t, 0)
    if (k > 0) {
      tri(indices, 2 * k - 2, 2 * k - 1, 2 * k)
      tri(indices, 2 * k - 1, 2 * k + 1, 2 * k)
    }
  }
  positions.push(0, 1, 0)
  const pointe = 2 * NIVEAUX
  tri(indices, pointe - 2, pointe - 1, pointe)
  // mulberry32, comme three : le même gazon à chaque chargement.
  const alea = mulberry32(graine)
  const aBrin = new Float32Array(nombre * 4)
  for (let i = 0; i < nombre; i++) aBrin.set([alea() * cote, alea() * cote, alea(), alea()], 4 * i)
  return { positions, normals: positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), indices, aBrin }
}

const f = (v: number) => v.toFixed(4)

/**
 * Le plugin Gazon d'un lot : constantes cuites, caméra, temps et foule par image ;
 * `gazonSaison` = (jaune, terne, mouillé, enneigé), `gazonCam.w` = vent (m/s).
 */
export function codeDuGazon(lot: Lot, cadre: CarteDuSol['cadre'], wgsl: boolean) {
  const d = dialecte(wgsl)
  const { V, T, u, vin, vout, fin, tr } = d
  const v2 = (a: number, b: number) => `${T('vec2')}(${f(a)}, ${f(b)})`
  const v3 = (a: number, b: number, c: number) => `${T('vec3')}(${f(a)}, ${f(b)}, ${f(c)})`
  const C = f(lot.cote)
  const mod = wgsl ? `(brin.xy - coin) - ${C} * floor((brin.xy - coin) / ${C})` : `mod(brin.xy - coin, ${C})`
  const echantillon = wgsl ? 'textureSampleLevel(gazonSol, gazonSolSampler, st, 0.0)' : 'textureLod(gazonSol, st, 0.0)'
  const foule = [0, 1, 2, 3].map((i) => `{ ${V('q', 'vec4', `${u('gazonFoule')}[${i}]`)}
h *= 1.0 - 0.75 * step(0.001, q.z) * (1.0 - smoothstep(q.z * 0.5, q.z, distance(p, q.xy))); }`).join('\n')
  const varyings = `${d.varying('vT', 'float')}\n${d.varying('vTeinte', 'float')}`
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: `${d.attribut('aBrin', 'vec4')}\n${varyings}\n${wgsl ? 'var gazonSolSampler: sampler;\nvar gazonSol: texture_2d<f32>;' : 'uniform sampler2D gazonSol;'}`,
      CUSTOM_VERTEX_UPDATE_POSITION: tr(`{
${V('brin', 'vec4', vin('aBrin'))}
${V('coin', 'vec2', `${u('gazonCam')}.xy + ${u('gazonCentre')}.xy - 0.5 * ${C}`)}
${V('p', 'vec2', `coin + ${mod}`)}
${V('st', 'vec2', `(p - ${v2(cadre[0], cadre[1])}) / ${v2(cadre[2], cadre[3])}`)}
${V('sol', 'vec4', echantillon)}
${V('dedans', 'float', 'step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0)')}
${V('garde', 'float', 'smoothstep(brin.z * 0.7 + 0.15, brin.z * 0.7 + 0.3, sol.g) * dedans')}
${V('fondu', 'float', `1.0 - smoothstep(${f(lot.rayon * 0.6)}, ${f(lot.rayon)}, distance(p, ${u('gazonCam')}.xy))`)}
${V('h', 'float', `mix(${f(lot.hauteur[0])}, ${f(lot.hauteur[1])}, brin.w * brin.w) * garde * fondu * (1.0 - 0.85 * ${u('gazonSaison')}.w)`)}
${foule}
${V('t', 'float', 'positionUpdated.y')}
${V('a', 'float', 'brin.z * 43.0')}
${V('travers', 'vec2', 'vec2(cos(a), sin(a))')}
${V('face', 'vec2', 'vec2(-travers.y, travers.x)')}
${V('temps', 'float', `${u('gazonCam')}.z`)}
${V('vent', 'float', 'sin(temps * 1.3 + p.x * 0.31 + p.y * 0.17) * 0.6 + sin(temps * 2.9 + p.x * 1.1 - p.y * 0.7) * 0.25')}
${V('penche', 'vec2', `face * (fract(brin.w * 17.0) - 0.5) * 0.9 + vec2(0.8, 0.45) * vent * 0.45 * clamp(0.6 + 0.2 * ${u('gazonCam')}.w, 0.5, 3.0)`)}
${V('courbe', 'float', 't * t')}
${V('herbe', 'vec3', 'vec3(p.x, sol.r - 0.03 + t * h * (1.0 - 0.25 * courbe * dot(penche, penche)), p.y)')}
${V('dxz', 'vec2', `travers * positionUpdated.x * ${f(lot.largeur)} * min(1.0, h * 6.0) + penche * courbe * h`)}
positionUpdated = herbe + vec3(dxz.x, 0.0, dxz.y);
normalUpdated = normalize(vec3(face.x, 2.5, face.y));
${vout('vT')} = t;
${vout('vTeinte')} = fract(brin.z * 7.0 + brin.w * 3.0);
}`),
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: varyings,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `{
${V('pointe', 'vec3', `mix(${v3(0.12, 0.26, 0.05)}, ${v3(0.23, 0.33, 0.07)}, ${fin('vTeinte')})`)}
pointe = mix(pointe, ${v3(0.08, 0.2, 0.06)}, step(0.8, ${fin('vTeinte')}));
surfaceAlbedo = mix(${v3(0.045, 0.09, 0.022)}, pointe, smoothstep(0.0, 0.9, ${fin('vT')}));
${V('lum', 'float', `dot(surfaceAlbedo, ${v3(0.3, 0.59, 0.11)})`)}
${V('gs', 'vec4', u('gazonSaison'))}
surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * ${v3(1.45, 1.15, 0.45)}, gs.x * 0.6 * ${fin('vT')});
surfaceAlbedo = mix(surfaceAlbedo, ${T('vec3')}(lum) * ${v3(1.2, 1.05, 0.6)}, gs.y * 0.65) * (1.0 - 0.15 * gs.y) * (1.0 - 0.3 * gs.z);
surfaceAlbedo = mix(surfaceAlbedo, ${v3(0.85, 0.88, 0.93)}, gs.w * (0.45 + 0.5 * smoothstep(0.2, 1.0, ${fin('vT')})));
}`,
    },
  }
}

/** Les deux lots de brins, visibles seulement quand une parcelle d'herbe proche est en vue (une fois la scène prête). */
function monterGazon(scene: Scene, camera: Camera): void {
  const carte = carteDuSol(PARC)
  const sol = new RawTexture(carte.donnees, carte.largeur, carte.hauteur, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT)
  sol.wrapU = sol.wrapV = Texture.CLAMP_ADDRESSMODE
  const parcelles = parcellesDeGazon(carte)
  const foule = Matrix.Identity()
  // Le regard à plat (relu avant chaque image), pour pousser les carrés devant lui.
  const avant = new Vector3(0, 0, -1)
  scene.onBeforeRenderObservable.add(() => {
    camera.getDirectionToRef(Vector3.Forward(true), avant)
    avant.y = 0
    if (avant.lengthSquared() < 1e-6) avant.set(0, 0, -1)
    avant.normalize()
  })
  const lots = GAZONS.map((lot, i) => {
    const g = brins(lot, 7 + i)
    const m = new Mesh(`gazon-${i}`, scene)
    Object.assign(new VertexData(), { positions: g.positions, normals: g.normals, indices: g.indices }).applyToMesh(m)
    const mat = matiere(`gazon-${i}`, scene)
    mat.backFaceCulling = false
    mat.environmentIntensity = 0
    mat.metallicF0Factor = 0
    greffer(mat, {
      // Un nom par lot : ses constantes sont cuites, le cache d'effets ne distingue que les defines.
      nom: `Gazon-${i}`,
      attributs: ['aBrin'],
      samplers: ['gazonSol'],
      uniforms: [{ name: 'gazonCam', size: 4, type: 'vec4' }, { name: 'gazonCentre', size: 4, type: 'vec4' }, { name: 'gazonSaison', size: 4, type: 'vec4' }, { name: 'gazonFoule', size: 16, type: 'mat4' }],
      lier: (ubo) => {
        const c = camera.globalPosition
        const p = vivant.getState().saison.pelouse
        ubo.updateFloat4('gazonCam', c.x, c.z, performance.now() / 1000, METEO.vent)
        ubo.updateFloat4('gazonSaison', p.jaune, p.terne, METEO.mouille, METEO.enneige)
        ubo.updateFloat4('gazonCentre', avant.x * lot.avance, avant.z * lot.avance, 0, 0)
        FOULE.forEach(([x, z, r], k) => foule.setRowFromFloats(k, x, z, r, 0))
        // `updateMatrix`, pas `updateUniform` : sous WebGPU la matière n'a pas d'UBO propre (setter de l'effet).
        ubo.updateMatrix('gazonFoule', foule)
        ubo.setTexture('gazonSol', sol)
      },
      code: (wgsl) => codeDuGazon(lot, carte.cadre, wgsl),
    })
    brancherLueurs([mat])
    m.material = mat
    m.receiveShadows = true
    m.doNotSyncBoundingInfo = true
    m.alwaysSelectAsActiveMesh = true
    // Pour visibilite.ts : sa boîte ne dit rien, il est au parc.
    m.metadata = { zone: 'parc' }
    // ponytail : une matrice identité par brin (7 Mo pour le lot proche), les thin instances l'exigent ; les brins vivent en coordonnées monde.
    const id = new Float32Array(16 * lot.nombre)
    for (let k = 0; k < lot.nombre; k++) id[16 * k] = id[16 * k + 5] = id[16 * k + 10] = id[16 * k + 15] = 1
    m.thinInstanceSetBuffer('matrix', id, 16)
    m.thinInstanceSetBuffer('aBrin', g.aBrin, 4)
    return { m, lot }
  })
  let pret = false
  scene.executeWhenReady(() => (pret = true))
  const plans = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0))
  scene.onBeforeRenderObservable.add(() => {
    if (!pret) return
    Frustum.GetPlanesToRef(camera.getTransformationMatrix(), plans)
    const { x, z } = camera.globalPosition
    for (const { m, lot } of lots) m.isVisible = uneEnVue(parcelles, plans, x + avant.x * lot.avance, z + avant.z * lot.avance, lot.cote / 2)
  })
}

/** Monte le relief ; rend le porteur d'ombre (pelouse + campagne + fosse), ni le parvis (1 cm) ni le gazon. */
export async function monterRelief(scene: Scene, camera: Camera): Promise<Mesh[]> {
  const sol = new Mesh('relief:pelouse', scene)
  geometriePelouse(PARC, gabaritCube(scene)).applyToMesh(sol)
  sol.material = pelouse(scene)
  const parvis = new Mesh('relief:parvis', scene)
  geometrieParvis(PARC).applyToMesh(parvis)
  parvis.material = dallage(scene)
  for (const m of [sol, parvis]) m.receiveShadows = true
  monterGazon(scene, camera)
  return [sol]
}
