/**
 * Les ALLÉES du parc (`plan/allees.ts` a tout décidé ; AlleesDuParc.tsx de three) :
 * le gravier et les dalles de l'axe drapés sur le relief, la bordure de pierre,
 * le lit de galets, les dalles irrégulières près de l'eau (fusionnées), puis en
 * thin instances les piquets, leur corde et les touffes d'herbe des courbes.
 * Les sols fusionnés sont découpés en carreaux de 32 m (le frustum les écarte), les lots d'instances en un appel chacun.
 *
 * Les géométries pures rendent l'ordre de three (a, b, c) ; `maille` le retourne
 * pour la main droite de Babylon (a, c, b), comme jardin.ts.
 * Porteurs d'ombre : bordure et piquets (le sol drapé, les galets, les dalles
 * irrégulières à 2 cm, les cordes et les touffes ne portent rien de visible).
 * Le gravier foulé au milieu, verdi aux bords (`pietiner`, usure.ts), puis le
 * temps qu'il fait (`intemperer` : mouillé, neige, flaques).
 * ponytail : les touffes au-delà de 35 m sont cachées (`cacherAuLoin`), la
 * bordure et les dalles fusionnées restent entières.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import { BORDURE, GALETS, amenagerAllees, type Amenagement, type Pose, type Surface } from '../plan/allees.ts'
import { COTE_DALLAGE, hauteurDuParc } from '../plan/relief.ts'
import { matiere } from './boites.ts'
import { cacherAuLoin, matrices } from './lots.ts'
import { intemperer } from './intemperies.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { matierePBR, REGLAGES } from './matieres.ts'
import { dallage, PARC, retourner } from './parc.ts'
import { pietiner } from './usure.ts'

/** Le sol des allées, 3 cm au-dessus de la pelouse : assez pour ne pas scintiller avec elle. */
const RELIEF_ALLEE = 0.03
/** Le profil de la bordure (décalage vers le gazon, hauteur sur le sol), arête du dessus arrondie. */
const PROFIL: [number, number][] = [
  [BORDURE.dedans, -0.05], [BORDURE.dedans, 0.06], [BORDURE.dedans + 0.012, 0.08], [BORDURE.dedans + 0.035, 0.09],
  [BORDURE.dehors - 0.035, 0.09], [BORDURE.dehors - 0.012, 0.08], [BORDURE.dehors, 0.06], [BORDURE.dehors, -0.05],
]
/** La bordure arasée où l'axe dallé traverse le gravier : 1 cm au-dessus des dalles, elle mord sur elles. */
const ARASE: [number, number][] = [
  [-0.03, 0], [-0.03, RELIEF_ALLEE + 0.017], [-0.02, RELIEF_ALLEE + 0.02],
  [0.09, RELIEF_ALLEE + 0.02], [0.1, RELIEF_ALLEE + 0.017], [0.1, -0.03],
]
const PIQUET = { haut: 0.62, corde: 0.46 }

/** Une géométrie pure, dans l'ordre des faces de three. */
export interface Geo { positions: number[]; uvs?: number[]; colors?: number[]; normals?: number[]; indices: number[] }

const frac = (x: number) => x - Math.floor(x)
type Bords = Amenagement['bordures']

/** Une surface des allées posée sur le relief (+ dy) ; UV en mètres, lues sur le plan. */
export function drape(s: Surface, dy: number): Geo {
  const positions: number[] = []
  for (let i = 0; i < s.xz.length; i += 2) positions.push(s.xz[i], hauteurDuParc(s.xz[i], s.xz[i + 1]) + dy, s.xz[i + 1])
  return { positions, uvs: [...s.xz], indices: [...s.index] }
}

/** Une bande le long de chaque bord : `profil` donne, par rang, le décalage vers le gazon et la hauteur. UV en mètres. */
export function bande(bords: Bords, profil: (p: { galets: number }) => [number, number][]): Geo {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const ligne of bords) {
    let u = 0
    const base = positions.length / 3
    let n = 0
    ligne.forEach((p, i) => {
      if (i > 0) u += Math.hypot(p.x - ligne[i - 1].x, p.z - ligne[i - 1].z)
      const rangs = profil(p)
      n = rangs.length
      let v = 0
      rangs.forEach(([d, h], k) => {
        if (k > 0) v += Math.hypot(d - rangs[k - 1][0], h - rangs[k - 1][1])
        positions.push(p.x + p.nx * d, hauteurDuParc(p.x, p.z) + h, p.z + p.nz * d)
        uvs.push(u, v)
      })
    })
    // Le bord court dans un sens ou dans l'autre : les faces tournées vers le ciel.
    const [p, q] = ligne
    const sens = p.nz * (q.x - p.x) - p.nx * (q.z - p.z) > 0
    for (let i = 0; i + 1 < ligne.length; i++)
      for (let k = 0; k + 1 < n; k++) {
        const [a, b] = [base + i * n + k, base + (i + 1) * n + k]
        if (sens) indices.push(a, a + 1, b, b, a + 1, b + 1)
        else indices.push(a, b, a + 1, b, b + 1, a + 1)
      }
  }
  return { positions, uvs, indices }
}

/** Le lit de galets : un bourrelet entre bordure et gazon qui s'efface (et s'enfonce) le long des dalles. */
const galets = (bords: Bords) => bande(bords, (p) => {
  const l = GALETS * p.galets
  const [k, bas] = [Math.min(1, p.galets * 5), -0.03]
  const h = (y: number) => bas + (y - bas) * k
  return [[BORDURE.dehors - 0.01, h(0.025)], [BORDURE.dehors + l * 0.45, h(0.035)], [BORDURE.dehors + l, h(0.008)]]
})

const joindre = (...gs: Geo[]): Geo => {
  const out: Geo = { positions: [], uvs: [], indices: [] }
  for (const g of gs) {
    const base = out.positions.length / 3
    out.positions.push(...g.positions)
    out.uvs!.push(...(g.uvs ?? []))
    for (const i of g.indices) out.indices.push(base + i)
  }
  return out
}

/** Les dalles irrégulières près de l'eau, fusionnées : contour, teinte, patine (couleurs RGBA linéaires) et UV propres à chaque pierre. */
export function semisDePierres(liste: readonly Pose[]): Geo {
  const n = 20
  // [rayon relatif, hauteur sur le gravier, patine] du centre vers le bord.
  const anneaux: [number, number, number][] = [
    [0.45, 0.017, 1], [0.8, 0.015, 0.97], [0.92, 0.012, 0.9], [0.975, 0.007, 0.84], [1, -0.001, 0.72], [1.01, -0.03, 0.6],
  ]
  const positions: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const mousse = [0.84, 0.9, 0.76]
  liste.forEach((p, s) => {
    const alea = (k: number) => frac(Math.sin(k * 12.9898 + s * 78.233) * 43758.5453)
    const r = Array.from({ length: n }, (_, i) => {
      const t = (2 * Math.PI * i) / n
      return 0.9 + 0.1 * Math.sin(2 * t + alea(1) * 6.3) + 0.07 * Math.sin(3 * t + alea(2) * 6.3) + 0.05 * alea(10 + i)
    })
    const [clair, chaud] = [0.78 + 0.32 * alea(3), alea(4) - 0.5]
    const teinte = [clair * (1 + 0.07 * chaud), clair, clair * (1 - 0.09 * chaud)]
    const m = teinte.map((c, k) => c * mousse[k])
    const [cos, sin] = [Math.cos(p.rotation), Math.sin(p.rotation)]
    const [tu, ou, ov] = [alea(5) * Math.PI * 2, alea(6) * 50, alea(7) * 50]
    const [cu, su] = [Math.cos(tu), Math.sin(tu)]
    const y0 = hauteurDuParc(p.x, p.z) + RELIEF_ALLEE
    const bosse = (x: number, z: number) => 0.004 * Math.sin(x * 4.1 + alea(8) * 6) * Math.sin(z * 3.7 + alea(9) * 6)
    const base = positions.length / 3
    const sommet = (lx: number, lz: number, h: number, patine: number) => {
      const [x, z] = [p.x + lx * p.sx * cos + lz * p.sz * sin, p.z - lx * p.sx * sin + lz * p.sz * cos]
      positions.push(x, y0 + h + (h > 0 ? bosse(lx, lz) : 0), z)
      uvs.push(x * cu - z * su + ou, x * su + z * cu + ov)
      const f = 0.65 + 0.35 * patine
      colors.push(...teinte.map((c, k) => (c + (m[k] - c) * (1 - patine)) * f), 1)
    }
    sommet(0, 0, 0.018, 1)
    for (const [k, h, patine] of anneaux)
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / n
        sommet(Math.cos(t) * r[i] * k, Math.sin(t) * r[i] * k, h, patine)
      }
    for (let i = 0; i < n; i++) indices.push(base, base + 1 + ((i + 1) % n), base + 1 + i)
    for (let a = 0; a + 1 < anneaux.length; a++)
      for (let i = 0; i < n; i++) {
        const [q, w] = [base + 1 + a * n + i, base + 1 + a * n + ((i + 1) % n)]
        indices.push(q, w, q + n, w, w + n, q + n)
      }
  })
  return { positions, uvs, colors, indices }
}

/** Une touffe d'herbe du Japon : 44 brins en fontaine, verts au cœur, dorés au bout ; normales vers le haut. */
export function touffe(): Geo {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  const [pied, milieu, pointe] = ['#2f3d17', '#7d8f32', '#c9ad52'].map((h) => lin(h).asArray())
  const mix = (a: number[], b: number[], t: number) => a.map((x, k) => x + (b[k] - x) * t)
  const NIV = 5
  for (let b = 0; b < 44; b++) {
    const h = frac(Math.sin(b * 78.233) * 43758.5453)
    const t0 = b * 2.39996 // l'angle d'or : pas de rangée
    const [dx, dz] = [Math.cos(t0), Math.sin(t0)]
    const [ox, oz] = [dx * 0.05 * h, dz * 0.05 * h]
    const [haut, portee] = [0.32 + 0.22 * h, 0.22 + 0.25 * frac(h * 7.1)]
    const base = positions.length / 3
    for (let k = 0; k <= NIV; k++) {
      const t = k / NIV
      const [x, z, y] = [ox + dx * portee * t ** 1.4, oz + dz * portee * t ** 1.4, haut * (1.7 * t - 0.95 * t * t)]
      const w = 0.022 * (1 - t) + 0.003
      positions.push(x - dz * w, y, z + dx * w, x + dz * w, y, z - dx * w)
      const c = mix(mix(pied, milieu, Math.min(1, t * 1.8)), pointe, Math.max(0, t - 0.5) * 2 * (0.6 + 0.4 * h))
      colors.push(...c, 1, ...c, 1)
      if (k > 0) {
        const q = base + 2 * k
        indices.push(q - 2, q - 1, q, q, q - 1, q + 1)
      }
    }
  }
  return { positions, colors, normals: positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), indices }
}

/** Le côté des carreaux (m) : chaque sol fusionné en carreaux, que le frustum de Babylon écarte hors du champ. */
const CARREAU = 64

/** Une géométrie coupée en carreaux de `cote` m (au centre de chaque triangle), sommets réindexés. */
export function decouper(g: Geo, cote: number): Geo[] {
  const par = new Map<string, { g: Geo; vus: Map<number, number> }>()
  for (let t = 0; t < g.indices.length; t += 3) {
    const tri = g.indices.slice(t, t + 3)
    const [x, z] = [0, 2].map((k) => tri.reduce((a, i) => a + g.positions[3 * i + k], 0) / 3)
    const cle = `${Math.floor(x / cote)}:${Math.floor(z / cote)}`
    let c = par.get(cle)
    if (!c) par.set(cle, (c = { g: { positions: [], uvs: g.uvs && [], colors: g.colors && [], normals: g.normals && [], indices: [] }, vus: new Map() }))
    for (const i of tri) {
      let j = c.vus.get(i)
      if (j === undefined) {
        c.vus.set(i, (j = c.vus.size))
        c.g.positions.push(...g.positions.slice(3 * i, 3 * i + 3))
        c.g.uvs?.push(...g.uvs!.slice(2 * i, 2 * i + 2))
        c.g.colors?.push(...g.colors!.slice(4 * i, 4 * i + 4))
        c.g.normals?.push(...g.normals!.slice(3 * i, 3 * i + 3))
      }
      c.g.indices.push(j)
    }
  }
  return [...par.values()].map((c) => c.g)
}

/** Les normales de Babylon posées sur la géométrie, si elle n'en a pas. */
function lisse(g: Geo): Geo {
  if (g.normals) return g
  const normals: number[] = []
  VertexData.ComputeNormals(g.positions, retourner(g.indices), normals)
  return { ...g, normals }
}

/** Un maillage d'une géométrie pure : faces retournées pour Babylon, normales calculées si absentes. */
function maille(nom: string, g: Geo, scene: Scene, mat: Material): Mesh {
  const indices = retourner(g.indices)
  const normals = lisse(g).normals!
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), { positions: g.positions, indices, normals, uvs: g.uvs, colors: g.colors }).applyToMesh(m)
  m.material = mat
  m.isPickable = false
  m.receiveShadows = true
  return m
}

function lot(m: Mesh, buf: Float32Array): Mesh {
  m.thinInstanceSetBuffer('matrix', buf, 16)
  m.isPickable = false
  m.receiveShadows = true
  return m
}

export function monterAllees(scene: Scene): Mesh[] {
  const a = amenagerAllees(PARC)
  const gravier = matierePBR('allees:gravier', 'gravier', scene)
  // Des galets de rivière, sombres : le gravier en plus gros et en ardoise.
  const cailloux = matierePBR('allees:galets', 'gravier', scene, { teinte: '#5b5d5e', motif: REGLAGES.gravier.motif * 2.2 })
  const pierre = matierePBR('allees:bordure', 'beton', scene, { teinte: '#d6d1c6' })
  const dalle = matierePBR('allees:dalles', 'roche', scene)
  const bois = matiere('allees:piquet', scene, '#3b2b1f', 0.85)
  const corde = matiere('allees:corde', scene, '#a48a5c', 1)
  // Lambert à couleurs de sommet, double face ; normales vers le haut : le revers s'éclaire comme le sol.
  const herbe = matiere('allees:touffe', scene)
  herbe.backFaceCulling = false
  herbe.specularIntensity = 0
  brancherLueurs([gravier, cailloux, pierre, dalle, bois, corde, herbe])
  // Mouillé sous la pluie, blanc sous la neige ; le gravier prend aussi ses flaques (intemperies.ts).
  for (const m of [cailloux, pierre, dalle, bois, herbe]) intemperer(m)
  pietiner(gravier)
  intemperer(gravier, { flaques: true })

  // Les normales calculées avant la découpe : pas d'arête marquée au bord des carreaux.
  const carreaux = (nom: string, g: Geo, mat: Material) => decouper(lisse(g), CARREAU).map((x, i) => maille(`${nom}-${i}`, x, scene, mat))
  carreaux('allees:gravier', drape(a.gravier, RELIEF_ALLEE), gravier)
  // À la cote du parvis, 1 cm au-dessus du gravier qui file dessous.
  carreaux('allees:dalles', drape(a.dalles, COTE_DALLAGE), dallage(scene))
  carreaux('allees:galets', galets(a.bordures), cailloux)
  const porteurs = carreaux('allees:bordure', joindre(bande(a.bordures, () => PROFIL), bande(a.listels, () => ARASE)), pierre)
  carreaux('allees:pierres', semisDePierres(a.pierres), dalle)

  // Les piquets, fichés de 20 cm, et les travées de corde (axe x d'un piquet à l'autre, creux vertical).
  const piquet = CreateCylinder('allees:piquets', { diameterTop: 0.07, diameterBottom: 0.09, height: PIQUET.haut + 0.2, tessellation: 8 }, scene)
  piquet.bakeTransformIntoVertices(Matrix.Translation(0, (PIQUET.haut - 0.2) / 2, 0))
  piquet.material = bois
  porteurs.push(lot(piquet, matrices(a.poteaux.map((p) => ({ piece: 'p', x: p.x, y: hauteurDuParc(p.x, p.z), z: p.z, lacet: 0 }))).get('p') ?? new Float32Array()))
  const chemin = Array.from({ length: 9 }, (_, i) => new Vector3(i / 8, -0.07 * 4 * (i / 8) * (1 - i / 8), 0))
  const travee = CreateTube('allees:cordes', { path: chemin, radius: 0.012, tessellation: 5 }, scene)
  travee.material = corde
  const bufCordes = new Float32Array(16 * a.cordes.length)
  a.cordes.forEach(([i, j], k) => {
    const [p, q] = [a.poteaux[i], a.poteaux[j]]
    const [y0, y1] = [hauteurDuParc(p.x, p.z) + PIQUET.corde, hauteurDuParc(q.x, q.z) + PIQUET.corde]
    const x = new Vector3(q.x - p.x, y1 - y0, q.z - p.z)
    const z = new Vector3(-x.z, 0, x.x).normalize()
    Matrix.FromValues(x.x, x.y, x.z, 0, 0, 1, 0, 0, z.x, z.y, z.z, 0, p.x, y0, p.z, 1).copyToArray(bufCordes, 16 * k)
  })
  lot(travee, bufCordes)

  // Un seul lot de touffes : l'herbe du Japon telle quelle, l'ophiopogon teinté d'un vert noir (couleur d'instance).
  const poses = [...a.touffes, ...a.couvreSol]
  const touffes = maille('allees:touffes', touffe(), scene, herbe)
  const bufTouffes = matrices(poses.map((p) => ({ piece: 't', x: p.x, y: hauteurDuParc(p.x, p.z) - 0.02, z: p.z, lacet: p.rotation, echelle: [p.sx, p.sy, p.sz] }))).get('t') ?? new Float32Array()
  lot(touffes, bufTouffes)
  const teintes = new Float32Array(4 * poses.length).fill(1)
  a.couvreSol.forEach((_, i) => {
    const k = 0.8 + 0.3 * frac(i * 0.618)
    teintes.set([0.3 * k, 0.42 * k, 0.3 * k, 1], 4 * (a.touffes.length + i))
  })
  touffes.thinInstanceSetBuffer('color', teintes, 4)
  // Une touffe de 40 cm au-delà de 35 m : quelques pixels (lots.ts).
  cacherAuLoin(scene, touffes, { matrix: [bufTouffes, 16], color: [teintes, 4] }, 35)
  return porteurs
}
