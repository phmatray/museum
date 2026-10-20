/**
 * L'air de la nef sous la verrière (RayonsLayer de three) : une brume locale,
 * les rayons du soleil qui tombent des vitres (`plan/rayons.ts`) et ceux, doux,
 * des lanterneaux de l'étage, la poussière qui danse dedans. Trois appels.
 *
 * - LA BRUME : une boîte dont on ne dessine que les faces du fond ; chaque pixel
 *   se voile de la longueur de nef que traverse son regard.
 * - LES RAYONS : un prisme par panneau, tiré le long du soleil jusqu'au sol, en
 *   mélange additif ; un seul pixel par faisceau peint la corde que traverse le regard.
 * - LA POUSSIÈRE : 700 grains, allumés dans un faisceau. Babylon ne sait pas
 *   la taille des points en WebGPU : chaque grain est un carré de 4 sommets
 *   tourné vers l'écran (même taille en pixels que `gl_PointSize`).
 *
 * Sorties linéaires HDR (le rendu des tons est dans le post-traitement). Les
 * uniformes sont posés à chaque image ; les prismes refaits quand le ciel bouge.
 * Sous mouvement réduit, stries et poussière ne bougent plus.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo'
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { directionDuSoleil } from '../domain/soleil.ts'
import { MUSEE } from '../plan/musee.ts'
import { plafonds } from '../plan/plafonds.ts'
import { forceDesRayons, nefDuPlan, vitres, type Vitre } from '../plan/rayons.ts'
import type { Plan } from '../plan/types.ts'
import { auCiel, mouvementReduit, vivant } from './etat.ts'
import { lin } from './lueurs.ts'

type V3 = [number, number, number]
/** Une vitre et la salle qui borne son faisceau ; `doux` : verre dépoli (lanterneau), la lumière tombe droit. */
export interface Faisceau { vitre: Vitre; min: V3; max: V3; doux: number }

const POUSSIERES = 700
const COULEUR = lin('#fff3e0')

/** L'intérieur de la nef jusqu'à la clé de voûte, un rien en retrait des murs, sous le sol. */
const bornes = (plan: Plan) => {
  const nef = nefDuPlan(plan)
  return { nef, min: [nef.x + 0.15, -0.1, nef.z + 0.15] as V3, max: [nef.x + nef.width - 0.15, nef.naissance + nef.rayon, nef.z + nef.depth - 0.15] as V3 }
}

/** Les faisceaux de la verrière (bornés à la nef) puis ceux des lanterneaux du dernier niveau (bornés à leur salle). */
export function faisceaux(plan: Plan): Faisceau[] {
  const { nef, min, max } = bornes(plan)
  const etage = plan.levels.reduce((a, b) => (b.elevation > a.elevation ? b : a))
  return [
    ...vitres(nef).map((vitre) => ({ vitre, min, max, doux: 0 })),
    ...plafonds(plan, etage.id).verre.flatMap((b) => {
      const s = etage.rooms.find((r) => b.x > r.x && b.x < r.x + r.width && b.z > r.z && b.z < r.z + r.depth)
      return s ? [{
        vitre: { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y: b.y },
        min: [s.x + 0.15, etage.elevation, s.z + 0.15] as V3,
        max: [s.x + s.width - 0.15, b.y + 0.05, s.z + s.depth - 0.15] as V3,
        doux: 1,
      }] : []
    }),
  ]
}

/** Les sommets des prismes (36 par faisceau, non indexés) : la vitre tirée le long de `soleil` (ou droit) jusqu'au sol de sa salle. */
export function prismes(fs: readonly Faisceau[], soleil: V3): Float32Array {
  const out = new Float32Array(fs.length * 108)
  let i = 0
  for (const { vitre: v, min, doux } of fs) {
    const d = doux ? [0, 1, 0] : soleil
    const haut: V3[] = [[v.x0, v.y, v.z0], [v.x1, v.y, v.z0], [v.x1, v.y, v.z1], [v.x0, v.y, v.z1]]
    const k = (v.y - min[1]) / d[1]
    const bas = haut.map(([x, y, z]): V3 => [x - d[0] * k, y - d[1] * k, z - d[2] * k])
    const quads = [haut, bas]
    for (let j = 0; j < 4; j++) quads.push([haut[j], haut[(j + 1) % 4], bas[(j + 1) % 4], bas[j]])
    for (const [a, b, c, e] of quads) for (const p of [a, b, c, a, c, e]) out.set(p, (i++) * 3)
  }
  return out
}

/** Le tirage fixe de la poussière (graine 7, LCG de RayonsLayer) : positions et graines. */
export function poussieres(min: V3, max: V3): { pos: Float32Array; graine: Float32Array } {
  let s = 7
  const alea = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const pos = new Float32Array(POUSSIERES * 3)
  const graine = new Float32Array(POUSSIERES * 4)
  for (let i = 0; i < POUSSIERES; i++) {
    pos.set([min[0] + 0.6 + alea() * (max[0] - min[0] - 1.2), 0.8 + alea() * 15, min[2] + 0.6 + alea() * (max[2] - min[2] - 1.2)], i * 3)
    graine.set([alea(), alea(), alea(), alea()], i * 4)
  }
  return { pos, graine }
}

// ── Les shaders, GLSL puis WGSL ───────────────────────────────────────────

const BRUIT_GLSL = `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`
const BRUIT_WGSL = `
fn hash(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn bruit(x: vec3f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3f(1, 0, 0)), f.x), mix(hash(i + vec3f(0, 1, 0)), hash(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3f(0, 0, 1)), hash(i + vec3f(1, 0, 1)), f.x), mix(hash(i + vec3f(0, 1, 1)), hash(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}`

const FAISCEAU = {
  glslV: `precision highp float;
attribute vec3 position;
attribute vec4 aVitre;
attribute float aY;
attribute vec4 aMin;
attribute vec3 aMax;
uniform mat4 viewProjection;
varying vec3 vMonde;
varying vec4 vVitre;
varying float vY;
varying vec4 vMin;
varying vec3 vMax;
void main(void) {
  vMonde = position; vVitre = aVitre; vY = aY; vMin = aMin; vMax = aMax;
  gl_Position = viewProjection * vec4(position, 1.0);
}`,
  glslF: `precision highp float;
uniform vec3 cameraPosition;
uniform float uForce;
uniform float uJour;
uniform vec3 uSoleil;
uniform vec3 uCouleur;
uniform float uTemps;
varying vec3 vMonde;
varying vec4 vVitre;
varying float vY;
varying vec4 vMin;
varying vec3 vMax;
${BRUIT_GLSL}
vec2 tranche(float o, float dv, float a, float b) {
  float inv = 1.0 / (abs(dv) < 1e-5 ? (dv < 0.0 ? -1e-5 : 1e-5) : dv);
  float t0 = (a - o) * inv;
  float t1 = (b - o) * inv;
  return vec2(min(t0, t1), max(t0, t1));
}
vec2 inter(vec2 a, vec2 b) { return vec2(max(a.x, b.x), min(a.y, b.y)); }
void main(void) {
  vec3 o = cameraPosition;
  vec3 r = vMonde - o;
  float ici = length(r);
  vec3 v = r / ici;
  vec2 k = (1.0 - vMin.w) * uSoleil.xz / uSoleil.y;
  vec2 p0 = o.xz + k * (vY - o.y);
  vec2 pv = v.xz - k * v.y;
  vec2 prisme = inter(inter(tranche(p0.x, pv.x, vVitre.x, vVitre.y), tranche(p0.y, pv.y, vVitre.z, vVitre.w)), tranche(o.y, v.y, vMin.y, vY));
  prisme.x = max(prisme.x, 0.0);
  if (prisme.y <= prisme.x) discard;
  vec2 nef = inter(inter(tranche(o.x, v.x, vMin.x, vMax.x), tranche(o.y, v.y, vMin.y, vMax.y)), tranche(o.z, v.z, vMin.z, vMax.z));
  vec2 corde = inter(prisme, nef);
  float l = corde.y - corde.x;
  if (l <= 0.0) discard;
  bool entree = prisme.x > 0.01 && prisme.x >= nef.x - 0.02;
  float face = entree ? prisme.x : prisme.y;
  if (!entree && prisme.y > nef.y + 0.02) discard;
  if (abs(ici - face) > 0.05 * max(1.0, face * 0.05)) discard;
  vec3 milieu = o + v * (0.5 * (corde.x + corde.y));
  float trajet = smoothstep(vY, vY - 2.0, milieu.y) * mix(0.45, 1.0, smoothstep(vMin.y, vMin.y + 8.0, milieu.y));
  vec3 q = milieu - uSoleil * dot(milieu, uSoleil);
  float stries = 0.15 + 1.5 * smoothstep(0.3, 0.8, bruit(q * 0.9 + vec3(0.0, uTemps * 0.03, uTemps * 0.02))) * (0.7 + 0.3 * bruit(q * 4.0 - uTemps * 0.05));
  float colonnes = smoothstep(0.4, 0.8, bruit(vec3(milieu.xz * 0.7, uTemps * 0.015)));
  stries = mix(stries, (0.1 + 1.6 * colonnes) * smoothstep(vMin.y + 1.2, vY - 0.4, milieu.y), vMin.w);
  float phase = mix(0.7 + 1.1 * pow(max(dot(v, uSoleil), 0.0), 4.0), 1.0, vMin.w);
  float force = mix(uForce, 0.6 * uJour, vMin.w);
  float a = 0.45 * force * (1.0 - exp(-l * 0.15)) * trajet * stries * phase;
  gl_FragColor = vec4(mix(uCouleur, vec3(1.0, 0.93, 0.82), vMin.w), a);
}`,
  wgslV: `attribute position: vec3f;
attribute aVitre: vec4f;
attribute aY: f32;
attribute aMin: vec4f;
attribute aMax: vec3f;
uniform viewProjection: mat4x4f;
varying vMonde: vec3f;
varying vVitre: vec4f;
varying vY: f32;
varying vMin: vec4f;
varying vMax: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vMonde = vertexInputs.position;
  vertexOutputs.vVitre = vertexInputs.aVitre;
  vertexOutputs.vY = vertexInputs.aY;
  vertexOutputs.vMin = vertexInputs.aMin;
  vertexOutputs.vMax = vertexInputs.aMax;
  vertexOutputs.position = uniforms.viewProjection * vec4f(vertexInputs.position, 1.0);
}`,
  wgslF: `uniform cameraPosition: vec3f;
uniform uForce: f32;
uniform uJour: f32;
uniform uSoleil: vec3f;
uniform uCouleur: vec3f;
uniform uTemps: f32;
varying vMonde: vec3f;
varying vVitre: vec4f;
varying vY: f32;
varying vMin: vec4f;
varying vMax: vec3f;
${BRUIT_WGSL}
fn tranche(o: f32, dv: f32, a: f32, b: f32) -> vec2f {
  let inv = 1.0 / select(dv, select(1e-5, -1e-5, dv < 0.0), abs(dv) < 1e-5);
  let t0 = (a - o) * inv;
  let t1 = (b - o) * inv;
  return vec2f(min(t0, t1), max(t0, t1));
}
fn inter(a: vec2f, b: vec2f) -> vec2f { return vec2f(max(a.x, b.x), min(a.y, b.y)); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let vMin = fragmentInputs.vMin;
  let vMax = fragmentInputs.vMax;
  let vVitre = fragmentInputs.vVitre;
  let vY = fragmentInputs.vY;
  let uSoleil = uniforms.uSoleil;
  let uTemps = uniforms.uTemps;
  let o = uniforms.cameraPosition;
  let r = fragmentInputs.vMonde - o;
  let ici = length(r);
  let v = r / ici;
  let k = (1.0 - vMin.w) * uSoleil.xz / uSoleil.y;
  let p0 = o.xz + k * (vY - o.y);
  let pv = v.xz - k * v.y;
  var prisme = inter(inter(tranche(p0.x, pv.x, vVitre.x, vVitre.y), tranche(p0.y, pv.y, vVitre.z, vVitre.w)), tranche(o.y, v.y, vMin.y, vY));
  prisme.x = max(prisme.x, 0.0);
  if (prisme.y <= prisme.x) { discard; }
  let nef = inter(inter(tranche(o.x, v.x, vMin.x, vMax.x), tranche(o.y, v.y, vMin.y, vMax.y)), tranche(o.z, v.z, vMin.z, vMax.z));
  let corde = inter(prisme, nef);
  let l = corde.y - corde.x;
  if (l <= 0.0) { discard; }
  let entree = prisme.x > 0.01 && prisme.x >= nef.x - 0.02;
  let face = select(prisme.y, prisme.x, entree);
  if (!entree && prisme.y > nef.y + 0.02) { discard; }
  if (abs(ici - face) > 0.05 * max(1.0, face * 0.05)) { discard; }
  let milieu = o + v * (0.5 * (corde.x + corde.y));
  let trajet = smoothstep(vY, vY - 2.0, milieu.y) * mix(0.45, 1.0, smoothstep(vMin.y, vMin.y + 8.0, milieu.y));
  let q = milieu - uSoleil * dot(milieu, uSoleil);
  var stries = 0.15 + 1.5 * smoothstep(0.3, 0.8, bruit(q * 0.9 + vec3f(0.0, uTemps * 0.03, uTemps * 0.02))) * (0.7 + 0.3 * bruit(q * 4.0 - uTemps * 0.05));
  let colonnes = smoothstep(0.4, 0.8, bruit(vec3f(milieu.xz * 0.7, uTemps * 0.015)));
  stries = mix(stries, (0.1 + 1.6 * colonnes) * smoothstep(vMin.y + 1.2, vY - 0.4, milieu.y), vMin.w);
  let phase = mix(0.7 + 1.1 * pow(max(dot(v, uSoleil), 0.0), 4.0), 1.0, vMin.w);
  let force = mix(uniforms.uForce, 0.6 * uniforms.uJour, vMin.w);
  let a = 0.45 * force * (1.0 - exp(-l * 0.15)) * trajet * stries * phase;
  fragmentOutputs.color = vec4f(mix(uniforms.uCouleur, vec3f(1.0, 0.93, 0.82), vMin.w), a);
}`,
}

const BRUME = {
  glslV: `precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vMonde;
void main(void) {
  vec4 m = world * vec4(position, 1.0);
  vMonde = m.xyz;
  gl_Position = viewProjection * m;
}`,
  glslF: `precision highp float;
uniform vec3 cameraPosition;
uniform float uForce;
uniform float uJour;
uniform vec3 uCouleur;
uniform vec3 uMin;
uniform vec3 uMax;
varying vec3 vMonde;
void main(void) {
  vec3 o = cameraPosition;
  vec3 r = vMonde - o;
  float fin = length(r);
  r /= fin;
  vec3 tmin = min((uMin - o) / r, (uMax - o) / r);
  float entree = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float traverse = max(fin - entree, 0.0);
  float hauteur = mix(0.7, 1.3, clamp(vMonde.y / uMax.y, 0.0, 1.0));
  float voile = (1.0 - exp(-traverse * 0.02 * hauteur)) * mix(0.06, 0.22, uJour) * (0.7 + 0.4 * uForce);
  vec3 teinte = mix(vec3(0.12, 0.11, 0.1), mix(vec3(0.82, 0.84, 0.86), uCouleur, 0.35 * uForce), uJour);
  gl_FragColor = vec4(teinte, voile);
}`,
  wgslV: `attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vMonde: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let m = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vMonde = m.xyz;
  vertexOutputs.position = uniforms.viewProjection * m;
}`,
  wgslF: `uniform cameraPosition: vec3f;
uniform uForce: f32;
uniform uJour: f32;
uniform uCouleur: vec3f;
uniform uMin: vec3f;
uniform uMax: vec3f;
varying vMonde: vec3f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let o = uniforms.cameraPosition;
  var r = fragmentInputs.vMonde - o;
  let fin = length(r);
  r /= fin;
  let tmin = min((uniforms.uMin - o) / r, (uniforms.uMax - o) / r);
  let entree = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  let traverse = max(fin - entree, 0.0);
  let hauteur = mix(0.7, 1.3, clamp(fragmentInputs.vMonde.y / uniforms.uMax.y, 0.0, 1.0));
  let voile = (1.0 - exp(-traverse * 0.02 * hauteur)) * mix(0.06, 0.22, uniforms.uJour) * (0.7 + 0.4 * uniforms.uForce);
  let teinte = mix(vec3f(0.12, 0.11, 0.1), mix(vec3f(0.82, 0.84, 0.86), uniforms.uCouleur, 0.35 * uniforms.uForce), uniforms.uJour);
  fragmentOutputs.color = vec4f(teinte, voile);
}`,
}

/** La verrière pour la poussière : son étendue en x, sa cote moyenne, la nef en z (constantes, `vec2`/`float` à la GLSL). */
function verriere(plan: Plan, wgsl: boolean): string {
  const nef = nefDuPlan(plan)
  const vs = vitres(nef)
  const f = (n: number) => n.toFixed(3)
  const x0 = f(Math.min(...vs.map((v) => v.x0)))
  const x1 = f(Math.max(...vs.map((v) => v.x1)))
  const y = f(vs.reduce((s, v) => s + v.y, 0) / vs.length)
  return wgsl
    ? `const uVitreX = vec2f(${x0}, ${x1});\nconst uVitreY: f32 = ${y};\nconst uNefZ: f32 = ${f(nef.z)};\nconst uNefD: f32 = ${f(nef.depth)};`
    : `const vec2 uVitreX = vec2(${x0}, ${x1});\nconst float uVitreY = ${y};\nconst float uNefZ = ${f(nef.z)};\nconst float uNefD = ${f(nef.depth)};`
}

const poussiere = (plan: Plan) => ({
  glslV: `precision highp float;
attribute vec3 position;
attribute vec4 aGraine;
attribute vec2 aCoin;
uniform mat4 viewProjection;
uniform float uTemps;
uniform float uForce;
uniform float uTaille;
uniform vec2 uEcran;
uniform vec3 uSoleil;
varying float vEclat;
varying vec2 vCoin;
${verriere(plan, false)}
void main(void) {
  vec3 p = position;
  float t = uTemps * (0.4 + 0.6 * aGraine.w);
  p += vec3(sin(t * 0.13 + aGraine.x * 6.28), sin(t * 0.07 + aGraine.y * 6.28) - 0.25 * fract(t * 0.004 + aGraine.z), cos(t * 0.11 + aGraine.z * 6.28)) * 0.6;
  vec3 v = p + uSoleil * ((uVitreY - p.y) / uSoleil.y);
  float travee = fract((v.z - uNefZ) / 3.5);
  float dedans = step(uVitreX.x, v.x) * step(v.x, uVitreX.y) * step(0.1, travee) * step(travee, 0.9) * step(uNefZ, v.z) * step(v.z, uNefZ + uNefD);
  vEclat = dedans * uForce * (0.5 + 0.5 * sin(t * 1.7 + aGraine.w * 40.0));
  vCoin = aCoin;
  gl_Position = viewProjection * vec4(p, 1.0);
  float taille = vEclat > 0.001 ? clamp(uTaille * (0.6 + 0.8 * aGraine.x) / gl_Position.w, 1.0, 5.0) : 0.0;
  gl_Position.xy += aCoin * taille / uEcran * gl_Position.w;
}`,
  glslF: `precision highp float;
uniform vec3 uCouleur;
varying float vEclat;
varying vec2 vCoin;
void main(void) {
  float r = length(vCoin) * 0.5;
  gl_FragColor = vec4(uCouleur, vEclat * 0.8 * (1.0 - smoothstep(0.2, 0.5, r)));
}`,
  wgslV: `attribute position: vec3f;
attribute aGraine: vec4f;
attribute aCoin: vec2f;
uniform viewProjection: mat4x4f;
uniform uTemps: f32;
uniform uForce: f32;
uniform uTaille: f32;
uniform uEcran: vec2f;
uniform uSoleil: vec3f;
varying vEclat: f32;
varying vCoin: vec2f;
${verriere(plan, true)}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let g = vertexInputs.aGraine;
  let uSoleil = uniforms.uSoleil;
  var p = vertexInputs.position;
  let t = uniforms.uTemps * (0.4 + 0.6 * g.w);
  p += vec3f(sin(t * 0.13 + g.x * 6.28), sin(t * 0.07 + g.y * 6.28) - 0.25 * fract(t * 0.004 + g.z), cos(t * 0.11 + g.z * 6.28)) * 0.6;
  let v = p + uSoleil * ((uVitreY - p.y) / uSoleil.y);
  let travee = fract((v.z - uNefZ) / 3.5);
  let dedans = step(uVitreX.x, v.x) * step(v.x, uVitreX.y) * step(0.1, travee) * step(travee, 0.9) * step(uNefZ, v.z) * step(v.z, uNefZ + uNefD);
  let eclat = dedans * uniforms.uForce * (0.5 + 0.5 * sin(t * 1.7 + g.w * 40.0));
  vertexOutputs.vEclat = eclat;
  vertexOutputs.vCoin = vertexInputs.aCoin;
  var c = uniforms.viewProjection * vec4f(p, 1.0);
  let taille = select(0.0, clamp(uniforms.uTaille * (0.6 + 0.8 * g.x) / c.w, 1.0, 5.0), eclat > 0.001);
  c = vec4f(c.xy + vertexInputs.aCoin * taille / uniforms.uEcran * c.w, c.zw);
  vertexOutputs.position = c;
}`,
  wgslF: `uniform uCouleur: vec3f;
varying vEclat: f32;
varying vCoin: vec2f;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let r = length(fragmentInputs.vCoin) * 0.5;
  fragmentOutputs.color = vec4f(uniforms.uCouleur, fragmentInputs.vEclat * 0.8 * (1.0 - smoothstep(0.2, 0.5, r)));
}`,
})

// ── La couche ─────────────────────────────────────────────────────────────

const COMMUNS = ['viewProjection', 'cameraPosition', 'uForce', 'uJour', 'uSoleil', 'uCouleur', 'uTemps', 'uMin', 'uMax', 'uTaille', 'uEcran']

/** Brume (alphaIndex 3), faisceaux (4), poussière (5) : jamais porteurs d'ombre. */
export function monterRayons(scene: Scene, plan: Plan = MUSEE): Mesh[] {
  const wgsl = scene.getEngine().isWebGPU
  const fs = faisceaux(plan)
  const { min, max } = bornes(plan)
  const matiere = (nom: string, s: { glslV: string; glslF: string; wgslV: string; wgslF: string }, attributs: string[], alpha: number) => {
    const m = new ShaderMaterial(nom, scene, wgsl ? { vertexSource: s.wgslV, fragmentSource: s.wgslF } : { vertexSource: s.glslV, fragmentSource: s.glslF }, {
      attributes: ['position', ...attributs],
      uniforms: nom === 'rayons-brume' ? ['world', ...COMMUNS] : COMMUNS,
      needAlphaBlending: true,
      shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
    })
    m.alphaMode = alpha
    m.disableDepthWrite = true
    m.setColor3('uCouleur', COULEUR)
    m.setVector3('uMin', new Vector3(...min))
    m.setVector3('uMax', new Vector3(...max))
    return m
  }

  // La brume : les faces du fond d'une boîte qui remplit la nef.
  const brume = CreateBox('rayons-brume', { width: max[0] - min[0], height: max[1] - min[1], depth: max[2] - min[2] }, scene)
  brume.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
  const mBrume = matiere('rayons-brume', BRUME, [], Constants.ALPHA_COMBINE)
  mBrume.cullBackFaces = false
  brume.material = mBrume

  // Les faisceaux : seule la position suit le soleil, le reste est fixe.
  const rayons = new Mesh('rayons-faisceaux', scene)
  const n = fs.length * 36
  const par = (taille: number, f: (x: Faisceau) => number[]) => {
    const a = new Float32Array(n * taille)
    fs.forEach((x, i) => { const v = f(x); for (let j = 0; j < 36; j++) a.set(v, (i * 36 + j) * taille) })
    return a
  }
  rayons.setVerticesData('position', new Float32Array(n * 3), true)
  rayons.setVerticesData('aVitre', par(4, ({ vitre: v }) => [v.x0, v.x1, v.z0, v.z1]), false, 4)
  rayons.setVerticesData('aY', par(1, ({ vitre: v }) => [v.y]), false, 1)
  rayons.setVerticesData('aMin', par(4, (x) => [...x.min, x.doux]), false, 4)
  rayons.setVerticesData('aMax', par(3, (x) => x.max), false, 3)
  rayons.setIndices(Array.from({ length: n }, (_, i) => i))
  const mRayons = matiere('rayons-faisceaux', FAISCEAU, ['aVitre', 'aY', 'aMin', 'aMax'], Constants.ALPHA_ADD)
  mRayons.backFaceCulling = false
  rayons.material = mRayons

  // La poussière : 4 sommets par grain, au même point, écartés à l'écran.
  const grains = new Mesh('rayons-poussiere', scene)
  const { pos, graine } = poussieres(min, max)
  const p4 = new Float32Array(POUSSIERES * 12)
  const g4 = new Float32Array(POUSSIERES * 16)
  const coins = new Float32Array(POUSSIERES * 8)
  const idx: number[] = []
  for (let i = 0; i < POUSSIERES; i++) {
    for (let j = 0; j < 4; j++) {
      p4.set(pos.subarray(i * 3, i * 3 + 3), (i * 4 + j) * 3)
      g4.set(graine.subarray(i * 4, i * 4 + 4), (i * 4 + j) * 4)
    }
    coins.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8)
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
  }
  grains.setVerticesData('position', p4)
  grains.setVerticesData('aGraine', g4, false, 4)
  grains.setVerticesData('aCoin', coins, false, 2)
  grains.setIndices(idx)
  // Les grains dérivent de 0,6 m : la boîte est la nef.
  grains.setBoundingInfo(new BoundingInfo(new Vector3(...min), new Vector3(...max)))
  const mGrains = matiere('rayons-poussiere', poussiere(plan), ['aGraine', 'aCoin'], Constants.ALPHA_ADD)
  mGrains.backFaceCulling = false
  grains.material = mGrains

  const meshes = [brume, rayons, grains]
  const mats = [mBrume, mRayons, mGrains]
  meshes.forEach((m, i) => {
    m.alphaIndex = 3 + i
    m.isPickable = false
    m.receiveShadows = false
  })
  brume.metadata = { zone: 'nef' }
  grains.metadata = { zone: 'nef' }

  // Le soleil des prismes, plancher à 12° (comme three) ; les prismes refaits à chaque nouveau ciel.
  const soleil = new Vector3(0, 1, 0)
  auCiel(({ elevation, azimut }) => {
    const d = directionDuSoleil({ elevation: Math.max(elevation, 12), azimut })
    soleil.set(...d)
    rayons.updateVerticesData('position', prismes(fs, d))
    rayons.refreshBoundingInfo()
  })

  const calme = mouvementReduit()
  const debut = performance.now()
  let force = 0
  const ecran = new Vector2()
  const engine = scene.getEngine()
  scene.onBeforeRenderObservable.add(() => {
    const { ciel, meteo } = vivant.getState()
    const cible = forceDesRayons(ciel, meteo)
    // Le passage d'un nuage se fond en quelques secondes.
    force += (cible - force) * Math.min(1, (engine.getDeltaTime() / 1000) * 0.8)
    const temps = calme ? 0 : (performance.now() - debut) / 1000
    const haut = engine.getRenderingCanvas()?.clientHeight || engine.getRenderHeight()
    for (const m of mats) {
      m.setFloat('uForce', force)
      m.setFloat('uJour', ciel.jour)
      m.setVector3('uSoleil', soleil)
      m.setFloat('uTemps', temps)
      m.setFloat('uTaille', haut * 0.02)
      m.setVector2('uEcran', ecran.set(engine.getRenderWidth(), engine.getRenderHeight()))
    }
    // Les lanterneaux restent clairs tant qu'il fait jour.
    const allume = cible >= 0.01 || force >= 0.01 || ciel.jour >= 0.01
    rayons.isVisible = grains.isVisible = allume
  })
  return meshes
}
