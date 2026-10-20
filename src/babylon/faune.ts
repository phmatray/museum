/**
 * La faune du jardin (FauneLayer.tsx) : les carpes koï de l'étang et leurs
 * ronds dans l'eau, les oiseaux des érables, les lucioles des nuits d'été, la
 * famille de hérissons. Cinq appels de dessin, des thin instances animées par
 * attributs d'instance : les matières se figent, seuls les tampons bougent.
 *
 * `plan/koi.ts`, `plan/oiseaux.ts` et `domain/herisson.ts` décident où va
 * chaque bête ; ici on ne fait que les montrer. Les greffes (greffe.ts) portent
 * les `onBeforeCompile` de three, en GLSL et en WGSL.
 *
 * Aucune bête ne touche à la carte d'ombre (ni porteuse, ni receveuse, comme three).
 * Matrices : `Euler(ex, ey, ez, 'YXZ')` de three = `RotationYawPitchRoll(ey, ex, ez)`.
 * Ciel, saison et météo sont lus une fois (main.ts, `ambiance()`) : le jour et
 * la nuit des lucioles sont cuits dans le code.
 * Les oiseaux se posent sur les vrais érables (`erablesCales()` de vegetation.ts) :
 * au bord du houppier, ou au bout des rameaux l'hiver (`bordsDuHouppier`, `rameaux`).
 * Une bête masquée (visibilite.ts : `layerMask`) continue de vivre, mais ses
 * tampons ne sont ni réécrits ni renvoyés au GPU.
 * ponytail : pas de froissement (pas de moteur audio dans la tranche), ronds
 * dans l'eau triés par distance avec l'eau (pas de renderOrder).
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { FAMILLE, avancerFamille, familleInitiale, type EtatHerisson, type Herisson } from '../domain/herisson.ts'
import type { Saison } from '../domain/saisons.ts'
import type { Ciel } from '../domain/soleil.ts'
import { SOURCES_LAMPADAIRES } from '../plan/eclairage.ts'
import { CONTOUR_ETANG, JARDIN, TRACE_RUISSEAU } from '../plan/jardin.ts'
import { SURFACE, avancerKoi, distanceEtang, koiInitiaux, type Koi } from '../plan/koi.ts'
import { avancerOiseaux, oiseauxInitiaux, perchoirs, type Oiseau, type Perchoir, type Point3 } from '../plan/oiseaux.ts'
import { generateur } from '../plan/park.ts'
import { hauteurDuParc, solDuParc } from '../plan/relief.ts'
import { matiere } from './boites.ts'
import { glbOuRien } from './glb.ts'
import { dialecte, greffer } from './greffe.ts'
import { brancherLueurs, lin, lueursDuJour, smoothstep } from './lueurs.ts'
import { FOULE, PARC, ambiance, retourner } from './parc.ts'
import { erablesCales, type Geo as GeoCalee } from './vegetation.ts'

export interface Geo { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

/** (b − a) × (c − a), la normale de face de three (cb × ab), non normée. */
function croix(p: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const [ux, uy, uz] = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]]
  const [vx, vy, vz] = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]]
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

/** Les normales plates d'une soupe de triangles. */
function normalesPlates(p: number[]): number[] {
  const n: number[] = []
  for (let t = 0; t < p.length / 9; t++) {
    const [x, y, z] = croix(p, 3 * t, 3 * t + 1, 3 * t + 2)
    const l = Math.hypot(x, y, z) || 1
    n.push(x / l, y / l, z / l, x / l, y / l, z / l, x / l, y / l, z / l)
  }
  return n
}

/** Les index d'une soupe, sens de three retourné (a, b, c) → (a, c, b) : scène main droite. */
const retourne = (n: number) => Uint32Array.from(retourner(Array.from({ length: n }, (_, i) => i)))

// ── Les carpes ────────────────────────────────────────────────────────────

/** Une carpe d'un mètre, le nez vers +x (corpsDeCarpe de three) ; `nageoire` 1 sur les 15 sommets des nageoires. */
export function corpsDeCarpe(): Geo & { nageoire: Float32Array } {
  const profil = [[-0.5, 0.012], [-0.4, 0.03], [-0.25, 0.058], [-0.05, 0.1], [0.12, 0.118], [0.28, 0.108], [0.4, 0.078], [0.47, 0.045], [0.5, 0.012]]
  const n = 10
  const pos: number[] = []
  for (const [x, r] of profil)
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n
      pos.push(x, Math.sin(a) * r * (Math.sin(a) > 0 ? 0.8 : 0.55), Math.cos(a) * r * 1.2)
    }
  const index: number[] = []
  for (let i = 0; i + 1 < profil.length; i++)
    for (let j = 0; j < n; j++) {
      const [a, b, c, d] = [i * n + j, i * n + ((j + 1) % n), (i + 1) * n + j, (i + 1) * n + ((j + 1) % n)]
      index.push(a, c, b, b, c, d)
    }
  // Normales lissées sur le corps indexé, puis dépliage.
  const lisses = new Float64Array(pos.length)
  for (let t = 0; t < index.length; t += 3) {
    const f = croix(pos, index[t], index[t + 1], index[t + 2])
    for (const v of index.slice(t, t + 3)) for (let k = 0; k < 3; k++) lisses[3 * v + k] += f[k]
  }
  const p: number[] = []
  const nn: number[] = []
  for (const v of index) {
    const l = Math.hypot(lisses[3 * v], lisses[3 * v + 1], lisses[3 * v + 2]) || 1
    p.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2])
    nn.push(lisses[3 * v] / l, lisses[3 * v + 1] / l, lisses[3 * v + 2] / l)
  }
  const corps = p.length / 3
  const nageoires = [
    -0.48, 0, 0, -0.72, 0.13, 0, -0.64, 0, 0,
    -0.48, 0, 0, -0.64, 0, 0, -0.72, -0.13, 0,
    0.2, -0.04, 0.09, 0.08, -0.07, 0.24, 0.02, -0.06, 0.1,
    0.2, -0.04, -0.09, 0.02, -0.06, -0.1, 0.08, -0.07, -0.24,
    0.2, 0.09, 0, -0.18, 0.06, 0, 0.1, 0.16, 0,
  ]
  p.push(...nageoires)
  nn.push(...normalesPlates(nageoires))
  const nb = p.length / 3
  return { positions: Float32Array.from(p), normals: Float32Array.from(nn), indices: retourne(nb), nageoire: new Float32Array(nb).fill(1, corps) }
}

/** La nage (vertex) et la robe (fragment) : `aKoi` = (variété, graine, phase, profondeur). */
function codeCarpe(wgsl: boolean, jour: number) {
  const { V, G, attribut, varying, vin, vout, fin, fn, tr } = dialecte(wgsl)
  const varyings = [varying('vLocal', 'vec3'), varying('vKoi', 'vec4'), varying('vNageoire', 'float')].join('\n')
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: `${attribut('aKoi', 'vec4')}\n${attribut('aNageoire', 'float')}\n${varyings}`,
      CUSTOM_VERTEX_UPDATE_POSITION: tr(`{
${V('p0', 'vec3', vin('position'))}
${V('k', 'vec4', vin('aKoi'))}
${vout('vLocal')} = p0; ${vout('vKoi')} = k; ${vout('vNageoire')} = ${vin('aNageoire')};
${V('queue', 'float', '1.0 - smoothstep(-0.75, 0.35, p0.x)')}
positionUpdated.z = positionUpdated.z + 0.09 * queue * queue * sin(p0.x * 7.0 + k.z) + 0.012 * sin(k.z * 0.5 + p0.x * 3.0);
positionUpdated.y = positionUpdated.y + ${vin('aNageoire')} * step(0.0, p0.x) * abs(p0.z) * 0.25 * sin(k.z * 0.7 + p0.z);
}`),
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varyings}\n${G('carpeRobe', 'vec3')}\n${fn('taches', [['p', 'vec3'], ['g', 'float']], 'float', `
  return sin(p.x * 11.0 + g * 31.0) * 0.6 + sin(p.z * 14.0 - p.x * 6.0 + g * 57.0) * 0.45 + sin(p.x * 29.0 + p.z * 9.0 + g * 11.0) * 0.2;`)}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
${V('vl', 'vec3', fin('vLocal'))}
${V('k', 'vec4', fin('vKoi'))}
${V('blanc', 'vec3', 'vec3(0.93, 0.92, 0.88)')}
${V('rouge', 'vec3', 'vec3(0.82, 0.14, 0.05)')}
${V('noir', 'vec3', 'vec3(0.03, 0.03, 0.035)')}
${V('dore', 'vec3', 'vec3(1.0, 0.56, 0.12)')}
${V('dos', 'float', 'smoothstep(-0.02, 0.03, vl.y)')}
${V('robe', 'vec3', 'blanc')}
if (k.x < 0.5) { robe = mix(blanc, rouge, dos * smoothstep(-0.12, -0.05, taches(vl, k.y)) * step(-0.44, vl.x)); }
else if (k.x < 1.5) { robe = dore * (0.85 + 0.25 * dos); }
else {
  robe = mix(noir, rouge, step(0.25, taches(vl, k.y)) * dos);
  robe = mix(robe, blanc, step(0.55, taches(vl.zyx * 1.3, k.y + 0.3)) * (1.0 - dos * 0.5));
}
robe = mix(robe, blanc * 0.95, (1.0 - dos) * 0.35);
robe = mix(robe, mix(robe, vec3(0.95, 0.8, 0.7), 0.45), ${fin('vNageoire')});
robe = mix(robe, vec3(0.05, 0.12, 0.08), 0.12 + smoothstep(0.03, 0.65, k.w) * 0.55);
surfaceAlbedo = robe;
carpeRobe = robe;
}`),
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `finalEmissive += carpeRobe * ${(0.18 * jour).toFixed(4)};`,
    },
  }
}

/** Les ronds dans l'eau : trois anneaux qui s'élargissent ; `aRide` = (graine, force). */
function codeRides(wgsl: boolean) {
  const { V, attribut, varying, vin, vout, fin, u, tr } = dialecte(wgsl)
  const varyings = `${varying('vRideUv', 'vec2')}\n${varying('vRide', 'vec2')}`
  const anneau = (i: number) => `f = fract(${u('ridesTemps')} * 0.45 + ${fin('vRide')}.x + ${(i / 3).toFixed(6)});
a = a + (1.0 - smoothstep(0.0, 0.045, abs(r - f * 0.95))) * (1.0 - f) * (1.0 - f);`
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: `${attribut('aRide', 'vec2')}\n${varyings}`,
      CUSTOM_VERTEX_UPDATE_POSITION: `${vout('vRideUv')} = positionUpdated.xz * 2.0; ${vout('vRide')} = ${vin('aRide')};`,
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: varyings,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
${V('r', 'float', `length(${fin('vRideUv')})`)}
${V('a', 'float', '0.0')}
${V('f', 'float', '0.0')}
${[0, 1, 2].map(anneau).join('\n')}
if (a * ${fin('vRide')}.y < 0.01) { discard; }
surfaceAlbedo = vec3(0.8, 0.86, 0.86);
alpha = a * ${fin('vRide')}.y * 0.35;
}`),
    },
  }
}

// ── Les oiseaux ───────────────────────────────────────────────────────────

/** SphereGeometry(1, 8, 6) de three, en soupe. */
function sphere(): number[] {
  const g = (ix: number, iy: number) => {
    const [u, v] = [(ix / 8) * 2 * Math.PI, (iy / 6) * Math.PI]
    return [-Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v)]
  }
  const out: number[] = []
  for (let iy = 0; iy < 6; iy++)
    for (let ix = 0; ix < 8; ix++) {
      const [a, b, c, d] = [g(ix + 1, iy), g(ix, iy), g(ix, iy + 1), g(ix + 1, iy + 1)]
      if (iy !== 0) out.push(...a, ...b, ...d)
      if (iy !== 5) out.push(...b, ...c, ...d)
    }
  return out
}

/** ConeGeometry(0.008, 0.02, 5) de three, la pointe vers +y : le flanc et le fond. */
function cone(): number[] {
  const [r, h] = [0.008, 0.02]
  const anneau = (x: number, y: number) => [r * Math.sin((x / 5) * 2 * Math.PI), y, r * Math.cos((x / 5) * 2 * Math.PI)]
  const out: number[] = []
  for (let x = 0; x < 5; x++) out.push(...anneau(x, -h / 2), ...anneau(x + 1, -h / 2), 0, h / 2, 0)
  for (let x = 0; x < 5; x++) out.push(...anneau(x + 1, -h / 2), ...anneau(x, -h / 2), 0, -h / 2, 0)
  return out
}

/** Une boîte centrée, faces tournées vers le dehors. */
function boite(w: number, h: number, d: number): number[] {
  const out: number[] = []
  const t = [w / 2, h / 2, d / 2]
  for (let k = 0; k < 3; k++)
    for (const s of [-1, 1]) {
      const [i, j] = [(k + 1) % 3, (k + 2) % 3]
      const coin = (a: number, b: number) => {
        const p = [0, 0, 0]
        ;[p[k], p[i], p[j]] = [s * t[k], a * t[i], b * t[j]]
        return p
      }
      const [p0, p1, p2, p3] = [coin(-1, -1), coin(1, -1), coin(1, 1), coin(-1, 1)]
      const quad = [...p0, ...p1, ...p2, ...p0, ...p2, ...p3]
      if (croix(quad, 0, 1, 2)[k] * s < 0) out.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2)
      else out.push(...quad)
    }
  return out
}

/** Applique (rotation x, échelle, translation) à une soupe, dans l'ordre de three : échelle, rotation, translation. */
function placer(p: number[], [sx, sy, sz]: number[], rx: number, [tx, ty, tz]: number[]): number[] {
  const [c, s] = [Math.cos(rx), Math.sin(rx)]
  const out: number[] = []
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = [p[i] * sx, p[i + 1] * sy, p[i + 2] * sz]
    out.push(x + tx, y * c - z * s + ty, y * s + z * c + tz)
  }
  return out
}

type Partie = 'dos' | 'tete' | 'bec' | 'queue' | 'aile'
/** [moineau dessus, moineau dessous, mésange dessus, mésange dessous]. */
const ROBES: Record<Partie, [string, string, string, string]> = {
  dos: ['#6b4a2c', '#b8ad98', '#6f8a3a', '#f0cf3a'],
  tete: ['#7a7470', '#d8d2c6', '#3b6fc4', '#f4f1ea'],
  bec: ['#2a2622', '#2a2622', '#1e1e22', '#1e1e22'],
  queue: ['#4a3422', '#4a3422', '#3d5f9a', '#3d5f9a'],
  aile: ['#7a5230', '#5a3c22', '#4a72b8', '#3a5a90'],
}

/** Un passereau de 15 cm, le bec vers −z : deux robes par sommet (linéaires), `aile` −1, 0 ou +1, normales plates. */
export function corpsDOiseau(): Geo & { couleur: Float32Array; couleur2: Float32Array; aile: Float32Array } {
  const ala = (cote: number) => {
    const q = [[0.02, 0.066, -0.025], [0.02, 0.066, 0.035], [0.1, 0.07, 0.03], [0.085, 0.07, -0.01]].map(([x, y, z]) => [x * cote, y, z])
    return [...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]]
  }
  const parties: [Partie, number[], number][] = [
    ['dos', placer(sphere(), [0.034, 0.032, 0.056], 0, [0, 0.05, 0.005]), 0],
    ['tete', placer(sphere(), [0.026, 0.026, 0.028], 0, [0, 0.082, -0.045]), 0],
    ['bec', placer(cone(), [1, 1, 1], -Math.PI / 2, [0, 0.078, -0.078]), 0],
    ['queue', placer(boite(0.028, 0.004, 0.06), [1, 1, 1], -0.25, [0, 0.058, 0.075]), 0],
    ['aile', ala(-1), -1],
    ['aile', ala(1), 1],
  ]
  const [p, c1, c2, a]: number[][] = [[], [], [], []]
  for (const [partie, pos, cote] of parties) {
    const [mDessus, mDessous, tDessus, tDessous] = ROBES[partie].map(lin)
    for (let i = 0; i < pos.length; i += 3) {
      const dessous = partie !== 'aile' && pos[i + 1] < (partie === 'tete' ? 0.078 : 0.047)
      const [m, t] = dessous ? [mDessous, tDessous] : [mDessus, tDessus]
      c1.push(m.r, m.g, m.b)
      c2.push(t.r, t.g, t.b)
      a.push(cote)
    }
    p.push(...pos)
  }
  return {
    positions: Float32Array.from(p), normals: Float32Array.from(normalesPlates(p)), indices: retourne(p.length / 3),
    couleur: Float32Array.from(c1), couleur2: Float32Array.from(c2), aile: Float32Array.from(a),
  }
}

/** Les ailes battent à l'épaule ; repliées, elles se couchent. `aVol` = (phase, en vol, mésange, —). */
function codeOiseau(wgsl: boolean) {
  const { V, attribut, varying, vin, vout, fin, tr } = dialecte(wgsl)
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: [attribut('oCouleur', 'vec3'), attribut('oCouleur2', 'vec3'), attribut('oAile', 'float'), attribut('aVol', 'vec4'), varying('vCouleur', 'vec3')].join('\n'),
      CUSTOM_VERTEX_UPDATE_POSITION: tr(`{
${V('vol', 'vec4', vin('aVol'))}
${V('aile', 'float', vin('oAile'))}
${vout('vCouleur')} = mix(${vin('oCouleur')}, ${vin('oCouleur2')}, vol.z);
if (aile != 0.0) {
  ${V('battement', 'float', 'mix(-1.1, 0.9 * sin(vol.x), vol.y)')}
  ${V('d', 'vec2', 'vec2((positionUpdated.x - aile * 0.02) * mix(0.35, 1.0, vol.y), positionUpdated.y - 0.066)')}
  ${V('a', 'float', 'battement * aile')}
  positionUpdated = vec3(vec2(aile * 0.02, 0.066) + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a)), positionUpdated.z);
}
}`),
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: varying('vCouleur', 'vec3'),
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `surfaceAlbedo = ${fin('vCouleur')};`,
    },
  }
}

/**
 * Le BORD du houppier (FauneLayer de three), dans son repère : sur chacun des
 * `azimuts` rayons partant du tronc, des rayons tombés du ciel tous les 25 cm
 * (de 1 à 6 m) ; le dernier qui touche le feuillage plus haut que 1,2 m est le perchoir.
 * Les triangles rangés par cases de 50 cm : chaque rayon ne lit que la sienne.
 */
export function bordsDuHouppier({ positions: p, indices: ix }: GeoCalee, azimuts = 48): Point3[] {
  const CASE = 0.5
  const cases = new Map<string, number[]>()
  let haut = -Infinity
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]]
    haut = Math.max(haut, p[3 * a + 1], p[3 * b + 1], p[3 * c + 1])
    const [x0, x1] = [Math.min(p[3 * a], p[3 * b], p[3 * c]), Math.max(p[3 * a], p[3 * b], p[3 * c])]
    const [z0, z1] = [Math.min(p[3 * a + 2], p[3 * b + 2], p[3 * c + 2]), Math.max(p[3 * a + 2], p[3 * b + 2], p[3 * c + 2])]
    for (let i = Math.floor(x0 / CASE); i <= Math.floor(x1 / CASE); i++)
      for (let j = Math.floor(z0 / CASE); j <= Math.floor(z1 / CASE); j++) {
        const k = `${i}:${j}`
        const liste = cases.get(k)
        if (liste) liste.push(t)
        else cases.set(k, [t])
      }
  }
  // Le point le plus haut du feuillage à la verticale de (x, z), ou −∞.
  const toit = (x: number, z: number) => {
    let y = -Infinity
    for (const t of cases.get(`${Math.floor(x / CASE)}:${Math.floor(z / CASE)}`) ?? []) {
      const [a, b, c] = [3 * ix[t], 3 * ix[t + 1], 3 * ix[t + 2]]
      const d = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2])
      if (Math.abs(d) < 1e-12) continue
      const l0 = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / d
      const l1 = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / d
      if (l0 < 0 || l1 < 0 || l0 + l1 > 1) continue
      y = Math.max(y, l0 * p[a + 1] + l1 * p[b + 1] + (1 - l0 - l1) * p[c + 1])
    }
    return y
  }
  const out: Point3[] = []
  for (let a = 0; a < azimuts; a++) {
    const [c, s] = [Math.cos((2 * Math.PI * a) / azimuts), Math.sin((2 * Math.PI * a) / azimuts)]
    let bord: Point3 | null = null
    for (let r = 1; r < 6; r += 0.25) {
      const y = toit(c * r, s * r)
      if (y > 1.2 && y <= haut) bord = [c * r, y, s * r]
    }
    if (bord) out.push(bord)
  }
  return out
}

/** Branches nues : le bout des rameaux, haut (plus de 2 m) et loin du tronc (plus de 1,5 m), un point tous les 40 cm. */
export function rameaux({ positions: p }: GeoCalee): Point3[] {
  const out: Point3[] = []
  for (let i = 0; i < p.length / 3; i += 5) {
    const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
    if (y > 2 && Math.hypot(x, z) > 1.5 && !out.some((q) => Math.hypot(q[0] - x, q[1] - y, q[2] - z) < 0.4)) out.push([x, y + 0.03, z])
  }
  return out
}

// ── Les lucioles ──────────────────────────────────────────────────────────

const NB_LUCIOLES = 300
/** Au-delà (m), un hérisson n'est plus dessiné. */
const PORTEE_HERISSON = 30

/** De juin à la mi-septembre : ni au débourrement, ni quand les érables tournent, ni sous la pelouse terne. */
export const saisonDesLucioles = (s: Saison): number => (1 - s.chute) * (1 - s.feuillage) * (1 - s.pelouse.terne) * (1 - s.tendre)

/** Où elles dansent (nuageDeLucioles de three) : berges de l'étang, ruisseau, sous les érables. */
export function nuageDeLucioles(): { centres: Float32Array; graines: Float32Array } {
  const alea = generateur('lucioles')
  const erables = PARC.plantations.filter((p) => p.espece.startsWith('erable') && Math.hypot(p.x - 46, p.z - 50) < 45)
  const pos: number[] = []
  const graines: number[] = []
  while (pos.length < NB_LUCIOLES * 3) {
    const u = alea()
    let x: number
    let z: number
    if (u < 0.5) {
      const [a, b] = [CONTOUR_ETANG[Math.floor(alea() * CONTOUR_ETANG.length)], alea() * 3.5 - 1.2]
      const l = Math.hypot(a[0] - 46, a[1] - 65)
      ;[x, z] = [a[0] + ((a[0] - 46) / l) * b, a[1] + ((a[1] - 65) / l) * b]
    } else if (u < 0.72) {
      const t = TRACE_RUISSEAU[Math.floor(alea() * TRACE_RUISSEAU.length)]
      ;[x, z] = [t[0] + (alea() - 0.5) * 5, t[1] + (alea() - 0.5) * 5]
    } else {
      const e = erables[Math.floor(alea() * erables.length)]
      const [th, r] = [alea() * 2 * Math.PI, Math.sqrt(alea()) * e.rayon]
      ;[x, z] = [e.x + Math.cos(th) * r, e.z + Math.sin(th) * r]
    }
    if (x > -1 && x < 49 && z > -1 && z < 41) continue
    const sol = distanceEtang(x, z) < 0 ? JARDIN.etang.niveau : hauteurDuParc(x, z)
    pos.push(x, sol + 0.25 + alea() * 1.5, z)
    graines.push(alea(), alea(), alea(), alea())
  }
  return { centres: Float32Array.from(pos), graines: Float32Array.from(graines) }
}

/**
 * Les points de three en quads tournés vers l'œil (WebGPU n'a pas de gl_PointSize),
 * à la même taille à l'écran : clamp(H × 0,16 / d × (0,5 + éclat), 2, 30) pixels.
 * `lucioles` = (temps, hauteur de rendu en pixels, 2 tan(fov/2), —).
 */
function codeLucioles(wgsl: boolean, nuit: number) {
  const { V, attribut, varying, vin, vout, fin, u, tr } = dialecte(wgsl)
  const varyings = `${varying('vEclat', 'float')}\n${varying('vPoint', 'vec2')}`
  const [vue, oeil] = wgsl ? ['scene.view', 'scene.vEyePosition.xyz'] : ['view', 'vEyePosition.xyz']
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: `${attribut('aGraine', 'vec4')}\n${varyings}`,
      CUSTOM_VERTEX_UPDATE_POSITION: tr(`{
${V('gr', 'vec4', vin('aGraine'))}
${V('g', 'vec4', 'gr * 6.2831')}
${V('e', 'vec4', u('lucioles'))}
${V('t', 'float', 'e.x')}
${V('p', 'vec3', `vec3(sin(t * 0.31 + g.x) * 0.9 + sin(t * 0.83 + g.y) * 0.35, sin(t * 0.47 + g.z) * 0.35 + sin(t * 1.1 + g.w) * 0.12, sin(t * 0.37 + g.y) * 0.9 + sin(t * 0.71 + g.z) * 0.35)`)}
${V('f', 'float', 'fract(t / (2.0 + gr.w * 3.0) + gr.x)')}
${V('eclat', 'float', `${nuit.toFixed(4)} * (smoothstep(0.0, 0.12, f) * (1.0 - smoothstep(0.25, 0.6, f)) + 0.1)`)}
${vout('vEclat')} = eclat;
${vout('vPoint')} = positionUpdated.xy * 2.0;
${V('d', 'float', `max(distance(${vin('world3')}.xyz + p, ${oeil}), 0.1)`)}
${V('s', 'float', 'clamp(e.y * 0.16 / d * (0.5 + eclat), 2.0, 30.0) * e.z * d / e.y')}
${V('droite', 'vec3', `vec3(${vue}[0][0], ${vue}[1][0], ${vue}[2][0])`)}
${V('haut', 'vec3', `vec3(${vue}[0][1], ${vue}[1][1], ${vue}[2][1])`)}
positionUpdated = p + (droite * positionUpdated.x + haut * positionUpdated.y) * s;
}`),
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: varyings,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
${V('r2', 'float', `dot(${fin('vPoint')}, ${fin('vPoint')})`)}
${V('a', 'float', `(exp(-r2 * 14.0) + 0.35 * exp(-r2 * 3.0)) * ${fin('vEclat')}`)}
if (a < 0.003) { discard; }
surfaceAlbedo = vec3(1.6, 1.25, 0.45) * a;
alpha = a;
}`),
    },
  }
}

// ── Les hérissons ─────────────────────────────────────────────────────────

/** Les constantes du modèle (matiereHerisson de three) : boîte en x, hauteur, axe et dessous de la boule. */
export function constantesDuHerisson(p: ArrayLike<number>): { x0: number; x1: number; h: number; xc: number; neutre: number; dessous: number } {
  let [x0, x1, h] = [Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) [x0, x1, h] = [Math.min(x0, p[i]), Math.max(x1, p[i]), Math.max(h, p[i + 1])]
  const xc = (x0 + x1) / 2
  const neutre = (x1 - x0) / (1.7 * Math.PI)
  let dessous = 0
  for (let i = 0; i < p.length; i += 3) dessous = Math.min(dessous, Math.cos((p[i] - xc) / neutre) * (0.012 + 0.6 * Math.max(0, p[i + 1])))
  return { x0, x1, h, xc, neutre, dessous }
}

/** Sous les globes : ce qu'il reçoit des lampadaires à moins de 7 m. */
export function flaqueDesLampadaires(x: number, z: number): number {
  let f = 0
  for (const [lx, , lz] of SOURCES_LAMPADAIRES) {
    const a = 1 - Math.hypot(lx - x, lz - z) / 7
    if (a > 0) f += a * a
  }
  return Math.min(1, f)
}

/** Boule, tête, pattes (vertex) ; pelage, yeux et truffe (fragment). `aGeste` = (boule, tête, pas, éclat), `aTeinte`. */
function codeHerisson(wgsl: boolean, k: ReturnType<typeof constantesDuHerisson>) {
  const { V, G, attribut, varying, vin, vout, fin, fn, tr, rugosite } = dialecte(wgsl)
  const f = (v: number) => v.toFixed(5)
  const varyings = [varying('vRepos', 'vec3'), varying('vEclatH', 'float'), varying('vTeinte', 'float')].join('\n')
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: `${attribut('aGeste', 'vec4')}\n${attribut('aTeinte', 'float')}\n${varyings}\n${fn('tourne', [['v', 'vec2'], ['a', 'float']], 'vec2', tr(`
  return vec2(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a));`))}`,
      CUSTOM_VERTEX_UPDATE_POSITION: tr(`{
${V('ge', 'vec4', vin('aGeste'))}
${V('pH', 'vec3', 'positionUpdated')}
${V('nH', 'vec3', 'normalUpdated')}
${vout('vRepos')} = pH; ${vout('vEclatH')} = ge.w; ${vout('vTeinte')} = ${vin('aTeinte')};
${V('jambe', 'float', '1.0 - smoothstep(0.004, 0.022, pH.y)')}
pH.x = pH.x + 0.009 * ge.z * jambe * sign(0.00001 - pH.z) * sign(pH.x - ${f(k.xc - 0.01)});
${V('cou', 'vec2', `vec2(${f(k.x1 - 0.055)}, ${f(0.42 * k.h)})`)}
${V('a', 'float', '0.314 * ge.y * smoothstep(cou.x - 0.012, cou.x + 0.018, pH.x)')}
pH = vec3(cou + tourne(pH.xy - cou, a), pH.z);
nH = vec3(tourne(nH.xy, a), nH.z);
${V('t', 'float', `(pH.x - ${f(k.xc)}) / ${f(k.neutre)}`)}
${V('r', 'float', '0.012 + max(pH.y, 0.0) * 0.6')}
${V('roule', 'vec3', `vec3(sin(t) * r, cos(t) * r - (${f(k.dessous)}), pH.z * 1.05)`)}
${V('nRoule', 'vec3', 'vec3(nH.x * cos(t) + nH.y * sin(t), -nH.x * sin(t) + nH.y * cos(t), nH.z)')}
positionUpdated = mix(pH, roule, ge.x);
normalUpdated = normalize(mix(nH, nRoule, ge.x));
}`),
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varyings}\n${G('yeuxH', 'float')}\n${G('nezH', 'float')}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`{
${V('c', 'vec3', 'surfaceAlbedo')}
${V('rp', 'vec3', fin('vRepos'))}
${V('lumH', 'float', 'dot(c, vec3(0.3, 0.59, 0.11))')}
${V('oeil', 'vec3', `vec3(rp.x - ${f(k.x1 - 0.0225)}, rp.y - 0.027, abs(rp.z) - 0.0145)`)}
${V('truffe', 'vec3', `rp - vec3(${f(k.x1 - 0.0035)}, 0.011, 0.0)`)}
${V('sombre', 'float', '1.0 - smoothstep(0.04, 0.1, lumH)')}
yeuxH = (1.0 - smoothstep(0.003, 0.0065, length(oeil))) * sombre;
nezH = (1.0 - smoothstep(0.004, 0.008, length(truffe))) * sombre;
c = c * vec3(1.06, 1.0, 0.88) * (1.0 + 1.7 * smoothstep(0.07, 0.3, lumH));
${V('te', 'float', fin('vTeinte'))}
surfaceAlbedo = mix(c, vec3(lumH * 2.0) * vec3(1.0, 0.96, 0.9), 0.3 * te * (1.0 - yeuxH - nezH)) * (1.0 + 0.06 * te);
}`),
      [rugosite]: '$0\nroughness = mix(roughness, 0.15, yeuxH);\nmicroSurface = 1.0 - roughness;',
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: tr(`{
${V('face', 'float', 'max(dot(normalW, viewDirectionW), 0.0)')}
finalEmissive += vec3(1.0, 0.93, 0.8) * (${fin('vEclatH')} * (yeuxH * face * face * face + 0.4 * nezH * pow(face, 16.0)));
}`),
    },
  }
}

// ── Le montage ────────────────────────────────────────────────────────────

const M = new Matrix()
const Q = new Quaternion()
const P = new Vector3()
const S = new Vector3()
/** Une matrice d'instance : Euler YXZ de three (ex, ey, ez), échelle uniforme. */
function poser(buf: Float32Array, i: number, x: number, y: number, z: number, ex: number, ey: number, ez: number, s: number): void {
  Quaternion.RotationYawPitchRollToRef(ey, ex, ez, Q)
  Matrix.ComposeToRef(S.setAll(s), Q, P.set(x, y, z), M)
  M.copyToArray(buf, 16 * i)
}

/** Un maillage de faune : thin instances, jamais coupé au bord de l'écran, hors de la carte d'ombre. */
function maillage(nom: string, scene: Scene, g: Geo, mat: Material, attributs: Record<string, [Float32Array, number]>, n: number): [Mesh, Float32Array] {
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), g).applyToMesh(m)
  for (const [k, [d, s]] of Object.entries(attributs)) m.setVerticesData(k, d, false, s)
  // Le tampon passé est gardé tel quel : on l'écrit, puis `thinInstanceBufferUpdated`.
  const mats = new Float32Array(16 * n)
  m.thinInstanceSetBuffer('matrix', mats, 16, false)
  m.material = mat
  m.isPickable = false
  m.alwaysSelectAsActiveMesh = true
  // Pour visibilite.ts : la boîte ne suit pas les bêtes, elles sont au parc.
  m.metadata = { zone: 'parc' }
  return [m, mats]
}

/** Une matière sans lumière (PBR unlit), fondue ou additive, sans écriture de profondeur. */
function voile(nom: string, scene: Scene, additif: boolean): PBRMaterial {
  const m = new PBRMaterial(nom, scene)
  m.unlit = true
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  m.alphaMode = additif ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE
  m.disableDepthWrite = true
  m.backFaceCulling = false
  return m
}

/** Un quad unité (le plan de three) : couché (face +y) ou debout (face +z). */
function quad(couche: boolean): Geo {
  const p = couche ? [-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5] : [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]
  return { positions: Float32Array.from(p), normals: Float32Array.from(Array.from({ length: 4 }, () => (couche ? [0, 1, 0] : [0, 0, 1])).flat()), indices: Uint32Array.of(0, 2, 1, 0, 3, 2) }
}

const VARIETE = { kohaku: 0, ogon: 1, showa: 2 } as const

/**
 * Monte la faune et l'anime à chaque image. `ciel` : celui de main.ts (le jour
 * règle oiseaux, lucioles, éclat des yeux) ; `camera` : le visiteur (les yeux).
 * Rend quand le hérisson est posé (ou absent).
 */
export async function monterFaune(scene: Scene, ciel: Ciel, camera: Camera): Promise<void> {
  const { saison, meteo } = ambiance()
  const jour = ciel.jour
  const dev = { gel: false, envol: false, placer: new Map<number, Partial<Herisson>>() }
  const vivants: ((dt: number) => void)[] = []
  let temps = 0
  const dehors = () => (camera.position.y < 3 ? { x: camera.position.x, z: camera.position.z } : null)
  // Masqué par visibilite.ts (le visiteur dans le musée, la porte hors du champ).
  const masque = (m: Mesh) => (m.layerMask & camera.layerMask) === 0

  // Les carpes et leurs ronds.
  let banc: Koi[] = koiInitiaux()
  const n = banc.length
  const carpe = corpsDeCarpe()
  const mCarpe = matiere('faune:carpe', scene, '#ffffff', 0.45)
  mCarpe.metallic = 0.05
  mCarpe.backFaceCulling = false
  mCarpe.twoSidedLighting = true
  brancherLueurs([mCarpe])
  greffer(mCarpe, { nom: 'Carpe', attributs: ['aKoi', 'aNageoire'], code: (w) => codeCarpe(w, jour) })
  const [corps, matsC] = maillage('faune:carpes', scene, carpe, mCarpe, { aNageoire: [carpe.nageoire, 1] }, n)
  const koi = new Float32Array(4 * n)
  corps.thinInstanceSetBuffer('aKoi', koi, 4, false)
  const mRides = voile('faune:rides', scene, false)
  greffer(mRides, { nom: 'Rides', attributs: ['aRide'], uniforms: [{ name: 'ridesTemps', size: 1, type: 'float' }], lier: (ubo) => ubo.updateFloat('ridesTemps', temps), code: codeRides })
  const [rides, matsR] = maillage('faune:rides', scene, quad(true), mRides, {}, n)
  const ride = new Float32Array(2 * n)
  rides.thinInstanceSetBuffer('aRide', ride, 2, false)
  const phases = new Float32Array(n)
  vivants.push((dt) => {
    const loin = Math.hypot(camera.position.x - 46, camera.position.z - 65) > 60
    if (!dev.gel && (!loin || Math.random() < 0.1)) banc = avancerKoi(banc, loin ? 0.1 : dt, dehors())
    banc.forEach((k, i) => (phases[i] += dt * (4 + k.vitesse * 22)))
    if (masque(corps)) return
    banc.forEach((k, i) => {
      koi[4 * i] = VARIETE[k.variete]
      koi[4 * i + 1] = k.graine
      koi[4 * i + 2] = phases[i]
      koi[4 * i + 3] = k.prof
      poser(matsC, i, k.x, SURFACE - k.prof - 0.1 * k.taille, k.z, 0, -k.cap, k.tangage, k.taille)
      // Le rond, au bout du nez, quand la bouche crève la surface.
      const nez = k.taille * 0.45
      ride[2 * i] = k.graine
      ride[2 * i + 1] = Math.min(1, Math.max(0, (0.05 - k.prof) / 0.025))
      poser(matsR, i, k.x + Math.cos(k.cap) * nez, SURFACE + 0.01, k.z + Math.sin(k.cap) * nez, 0, 0, 0, 0.55)
    })
    corps.thinInstanceBufferUpdated('matrix')
    corps.thinInstanceBufferUpdated('aKoi')
    rides.thinInstanceBufferUpdated('matrix')
    rides.thinInstanceBufferUpdated('aRide')
  })

  // Les oiseaux : la nuit, ils dorment au creux des arbres. Le jour, ils attendent les érables (vegetation.ts).
  let PERCHOIRS: Perchoir[] = []
  let volee: Oiseau[] = []
  if (jour > 0.15) void erablesCales().then((erables) => {
    // Houppier plein : au bord des feuilles. Branches nues (l'hiver) : sur le bois.
    const nu = saison.chute > 0.5
    PERCHOIRS = perchoirs(PARC, Object.fromEntries([...erables].map(([e, g]) => [e, nu ? rameaux(g.ecorce) : bordsDuHouppier(g.feuilles)])))
    volee = oiseauxInitiaux(PERCHOIRS, 16)
    const no = volee.length
    const o = corpsDOiseau()
    const mOiseau = matiere('faune:oiseau', scene, '#ffffff', 0.85)
    mOiseau.backFaceCulling = false
    mOiseau.twoSidedLighting = true
    brancherLueurs([mOiseau])
    greffer(mOiseau, { nom: 'Oiseau', attributs: ['oCouleur', 'oCouleur2', 'oAile', 'aVol'], code: codeOiseau })
    const [lot, mats] = maillage('faune:oiseaux', scene, o, mOiseau, { oCouleur: [o.couleur, 3], oCouleur2: [o.couleur2, 3], oAile: [o.aile, 1] }, no)
    const vol = new Float32Array(4 * no)
    lot.thinInstanceSetBuffer('aVol', vol, 4, false)
    const ph = new Float32Array(no).map((_, i) => i * 2.3)
    const intemperie = Math.max(meteo.pluie, meteo.neige)
    vivants.push((dt) => {
      if (dev.envol) {
        dev.envol = false
        volee = volee.map((b) => avancerOiseaux([b], PERCHOIRS, 0, { x: b.x, z: b.z }, Math.random)[0])
      }
      if (!dev.gel) volee = avancerOiseaux(volee, PERCHOIRS, dt, dehors(), Math.random, intemperie)
      volee.forEach((b, i) => (ph[i] += dt * (b.etat === 'vol' ? 55 : 0)))
      if (masque(lot)) return
      volee.forEach((b, i) => {
        const enVol = b.etat === 'vol'
        vol[4 * i] = ph[i]
        vol[4 * i + 1] = enVol ? 1 : 0
        vol[4 * i + 2] = b.espece === 'mesange' ? 1 : 0
        const bond = 0.06 * Math.sin(Math.PI * b.saut)
        const bec = 0.7 * Math.sin(Math.PI * b.picore)
        poser(mats, i, b.x, b.y + bond, b.z, enVol ? 0.15 : -bec, b.cap, 0, 1.15)
      })
      lot.thinInstanceBufferUpdated('matrix')
      lot.thinInstanceBufferUpdated('aVol')
    })
  })

  // Les lucioles : au crépuscule, les nuits chaudes et sèches seulement.
  const nuit = (1 - smoothstep(jour, 0.05, 0.3)) * saisonDesLucioles(saison) * (1 - meteo.pluie) * (1 - meteo.neige)
  if (nuit > 0.001) {
    const { centres, graines } = nuageDeLucioles()
    const mLuc = voile('faune:lucioles', scene, true)
    const moteur = scene.getEngine()
    greffer(mLuc, {
      nom: 'Lucioles',
      attributs: ['aGraine'],
      uniforms: [{ name: 'lucioles', size: 4, type: 'vec4' }],
      lier: (ubo) => ubo.updateFloat4('lucioles', temps, moteur.getRenderHeight(), 2 * Math.tan(camera.fov / 2), 0),
      code: (w) => codeLucioles(w, nuit),
    })
    const [l, mats] = maillage('faune:lucioles', scene, quad(false), mLuc, {}, NB_LUCIOLES)
    for (let i = 0; i < NB_LUCIOLES; i++) poser(mats, i, centres[3 * i], centres[3 * i + 1], centres[3 * i + 2], 0, 0, 0, 1)
    l.thinInstanceBufferUpdated('matrix')
    l.thinInstanceSetBuffer('aGraine', graines, 4, true)
  }

  // Une seule boucle pour toutes les bêtes.
  scene.onBeforeRenderObservable.add(() => {
    const dt = dev.gel ? 0 : Math.min(scene.getEngine().getDeltaTime() / 1000, 0.1)
    temps += dt
    for (const v of vivants) v(dt)
  })

  // Les hérissons, quand le modèle arrive.
  let famille: Herisson[] = []
  if (import.meta.env.DEV)
    (window as unknown as { __FAUNE__?: unknown }).__FAUNE__ = {
      figer: (g: boolean) => { dev.gel = g },
      envoler: () => { dev.envol = true },
      oiseaux: () => volee,
      perchoirs: () => PERCHOIRS,
      carpes: () => banc,
      herissons: () => famille,
      herisson: (i = 1) => famille[i],
      placerHerisson: (x: number, z: number, cap = 0, etat: EtatHerisson = 'flaire', t = 3600, i = 1) => {
        dev.placer.set(i, { x, z, cap, etat, t, rentre: false, flane: true, boule: etat === 'boule' ? 1 : 0, vitesse: etat === 'marche' ? FAMILLE[i].vitesse : 0, but: [x + Math.cos(cap) * 50, z + Math.sin(cap) * 50] })
      },
    }
  const c = await glbOuRien(scene, 'assets/faune/herisson.glb')
  if (!c) return
  c.addAllToScene()
  const h = c.meshes.find((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0)
  for (const m of c.meshes) if (m !== h) m.dispose(true, false)
  if (!h?.material) return
  h.setParent(null)
  if (!h.computeWorldMatrix(true).isIdentity()) h.bakeCurrentTransformIntoVertices()
  const k = constantesDuHerisson(h.getVerticesData(VertexBuffer.PositionKind)!)
  greffer(h.material, { nom: 'Herisson', attributs: ['aGeste', 'aTeinte'], code: (w) => codeHerisson(w, k) })
  brancherLueurs([h.material])
  const nh = FAMILLE.length
  const mats = new Float32Array(16 * nh)
  h.thinInstanceSetBuffer('matrix', mats, 16, false)
  const geste = new Float32Array(4 * nh)
  h.thinInstanceSetBuffer('aGeste', geste, 4, false)
  const teinte = Float32Array.from(FAMILLE.map((i) => i.teinte))
  h.thinInstanceSetBuffer('aTeinte', teinte, 1, false)
  h.isPickable = false
  h.alwaysSelectAsActiveMesh = true
  h.metadata = { zone: 'parc' }

  const hiberne = saison.pelouse.terne > 0.5
  // Une graine par session : ils ne sont pas deux fois au même endroit.
  famille = familleInitiale(ciel.elevation, hiberne, Math.floor(Math.random() * 2 ** 31))
  const horloges = FAMILLE.map((_, i) => ({ pas: i * 1.3, flair: i * 2.7 }))
  const lampes = lueursDuJour(jour).facade
  vivants.push((dt) => {
    if (dev.placer.size) {
      famille = famille.map((x, i) => ({ ...x, ...dev.placer.get(i) }))
      dev.placer.clear()
    }
    const cam = camera.position
    const visiteur = cam.y - hauteurDuParc(cam.x, cam.z) < 3 ? { x: cam.x, z: cam.z } : null
    if (!dev.gel) famille = avancerFamille(famille, dt, visiteur, ciel.elevation, hiberne)
    const cache = masque(h)
    // Les hérissons dessinés, tassés en tête des buffers : ni ceux du nid ni ceux à plus de
    // PORTEE_HERISSON (un hérisson de 25 cm y fait quelques pixels, et 14 000 triangles).
    let n = 0
    famille.forEach((b, i) => {
      const { echelle, demiLongueur } = FAMILLE[b.qui]
      const dehorsDuNid = b.etat !== 'nid'
      // L'herbe se couche sous lui (gazon de relief.ts) ; au nid, plus rien.
      ;[FOULE[i][0], FOULE[i][1], FOULE[i][2]] = [b.x, b.z, dehorsDuNid ? 0.3 * echelle : 0]
      const hc = horloges[i]
      if (!dehorsDuNid) return
      hc.pas += dt * b.vitesse * ((2 * Math.PI) / (0.028 * echelle))
      hc.flair += dt
      if (cache || Math.hypot(b.x - cam.x, b.z - cam.z) > PORTEE_HERISSON) return
      teinte[n] = FAMILLE[i].teinte
      const marche = Math.min(1, b.vitesse / 0.08)
      const deroule = 1 - smoothstep(b.boule, 0, 1)
      const flaire = b.etat === 'flaire' ? 1 : 0.3 * marche
      const salve = 0.5 + 0.5 * Math.sin(hc.flair * 1.3)
      const tete = flaire * (0.35 * Math.sin(hc.flair * 17) * salve - 0.3 + 0.4 * Math.sin(hc.flair * 0.7))
      const eclat = (1 - jour) * 0.15 + 0.6 * lampes * flaqueDesLampadaires(b.x, b.z)
      geste[4 * n] = 1 - deroule
      geste[4 * n + 1] = tete * deroule
      geste[4 * n + 2] = Math.sin(hc.pas) * marche * deroule
      geste[4 * n + 3] = eclat
      // Posé sur la pente, le nez vers son cap.
      const [x, z] = [b.x, b.z]
      const [ax, az] = [Math.cos(b.cap) * demiLongueur, Math.sin(b.cap) * demiLongueur]
      const tangage = Math.atan2(solDuParc(x + ax, z + az) - solDuParc(x - ax, z - az), 2 * demiLongueur)
      const devers = Math.atan2(solDuParc(x - az, z + ax) - solDuParc(x + az, z - ax), 2 * demiLongueur)
      const dandine = 0.07 * Math.sin(hc.pas) * marche * deroule
      const bond = 0.0025 * echelle * Math.abs(Math.sin(hc.pas)) * marche * deroule
      poser(mats, n++, x, solDuParc(x, z) + bond, z, devers + dandine, -b.cap, tangage, echelle)
    })
    // Sans instance, Babylon dessinerait le modèle seul à l'origine ; sans instance ni avant ni après, rien à renvoyer.
    if (n === 0 && h.thinInstanceCount === 0) return
    h.thinInstanceCount = n
    h.isVisible = n > 0
    h.thinInstanceBufferUpdated('matrix')
    h.thinInstanceBufferUpdated('aGeste')
    h.thinInstanceBufferUpdated('aTeinte')
  })
}
