/**
 * Le parement du bâtiment : les surfaces cuites de `surfacesCuites` (murs,
 * dalles, parement du hall, peintures des galeries, plafonds, corniches, bandes
 * du sol), plus les plinthes et la résille, rangées par REVÊTEMENT : un
 * maillage fusionné par matière (7 appels), uv en mètres, uv2 dans l'atlas,
 * teinte par sommet (la couleur des peintures, blanc ailleurs).
 *
 * Les matières de `Niveau` (scene/PlanBuilding.tsx) : plâtre (murs, linteaux,
 * plafonds, corniches), plâtre teinté et tendu (peintures), pierre de taille
 * épaufrée (balcons, parement, plinthes des salles), terrazzo terni sur les
 * passages (sol du hall), parquet à lames décalées (étage), parquet à bâtons
 * rompus (galeries), granit (plinthes du hall, bandes, résille).
 *
 * Les greffes `onBeforeCompile` de three (peindreRebond, retoucherCartes,
 * batonsRompus, tendre, userInterieur, userSolDuHall) deviennent UN plugin,
 * `Parement`, réglé par defines (GLSL et WGSL écrits une fois, comme lueurs.ts).
 * three modifie `diffuseColor` avant l'éclairage : ici `surfaceAlbedo`, juste
 * après le bloc d'albédo ; la rugosité suit le bloc de réflectivité.
 * Plinthes et résille n'ont pas de clé dans l'atlas : texel (0, 0), facteur 1.
 */
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { Material } from '@babylonjs/core/Materials/material'
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import { surfacesCuites } from '../plan/lumiere.ts'
import LUMIERE from '../plan/lumiere.json' with { type: 'json' }
import type { Box } from '../plan/mesh.ts'
import { plinthes } from '../plan/parement.ts'
import { plafonds } from '../plan/plafonds.ts'
import type { Plan } from '../plan/types.ts'
import { passagesDuHall } from '../plan/usure.ts'
import { gabaritCube, geometrieCuite, type Cuite, type Gabarit } from './boites.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { matierePBR, REGLAGES } from './matieres.ts'
import { creerGranit, creerPierre } from './pierre.ts'

export type Revetement = 'platre' | 'peinture' | 'pierre' | 'terrazzo' | 'parquet' | 'parquet-galeries' | 'granit'

/**
 * Les boîtes du parement par revêtement (tous niveaux). Le parquet des galeries
 * se reconnaît au centre de sa dalle, celui d'une galerie au même plancher.
 */
export function revetements(plan: Plan): Record<Revetement, Cuite[]> {
  const out: Record<Revetement, Cuite[]> = { platre: [], peinture: [], pierre: [], terrazzo: [], parquet: [], 'parquet-galeries': [], granit: [] }
  const galerie = (b: Box) =>
    plan.levels.some((l) => Math.abs(b.y + b.h / 2 - l.elevation) < 1e-6 &&
      l.rooms.some((r) => r.kind === 'gallery' && Math.abs(r.x + r.width / 2 - b.x) < 1e-6 && Math.abs(r.z + r.depth / 2 - b.z) < 1e-6))
  for (const s of surfacesCuites(plan)) {
    const peinte = s.matiere.startsWith('#')
    const r: Revetement = peinte ? 'peinture' : s.matiere === 'parquet' && galerie(s.boite) ? 'parquet-galeries' : (s.matiere as Revetement)
    out[r].push({ b: s.boite, cle: s.cle, couleur: peinte ? s.matiere : '#ffffff' })
  }
  const sansCle = (r: Revetement, boites: Box[]) => boites.forEach((b) => out[r].push({ b, cle: '', couleur: '#ffffff' }))
  for (const l of plan.levels) {
    const p = plinthes(plan, l.id)
    sansCle('granit', p.hall)
    sansCle('pierre', p.salles)
    sansCle('granit', plafonds(plan, l.id).resille)
  }
  return out
}

/** Les attributs de l'usure (`avecBoite` de usure.ts) : `boite` = position dans la boîte en mètres, `taille`. */
export function attributsDUsure(gabarit: Gabarit, boites: readonly Box[]): { boite: Float32Array; taille: Float32Array } {
  const nv = gabarit.positions.length / 3
  const boite = new Float32Array(boites.length * nv * 3)
  const taille = new Float32Array(boites.length * nv * 3)
  boites.forEach((b, k) => {
    for (let v = 0; v < nv; v++) {
      const i = 3 * (k * nv + v)
      boite.set([gabarit.positions[3 * v] * b.w, gabarit.positions[3 * v + 1] * b.h, gabarit.positions[3 * v + 2] * b.d], i)
      taille.set([b.w, b.h, b.d], i)
    }
  })
  return { boite, taille }
}

// ── Le plugin ────────────────────────────────────────────────────────────

export interface Reglages {
  /** Rebond du sol sous les faces tournées vers le bas (peindreRebond). */
  rebond?: number
  /** Tenture des galeries (tendre). */
  tenture?: boolean
  /** Terrazzo adouci (retoucherCartes). */
  terrazzo?: boolean
  /** Terrazzo terni sur les passages du hall (userSolDuHall). */
  hall?: boolean
  /** Lames décalées tuile par tuile (retoucherCartes, parquet). */
  decale?: boolean
  /** Parquet à bâtons rompus (batonsRompus). */
  batons?: boolean
  /** Pied encrassé (userInterieur) ; `eclats` : arêtes épaufrées. */
  usure?: boolean
  eclats?: boolean
}

const DEFINES = { PM_TENTURE: false, PM_TERRAZZO: false, PM_HALL: false, PM_DECALE: false, PM_BATONS: false, PM_USURE: false, PM_ECLATS: false }

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(6)))
const REBOND = lin('#e4ddd0')
/** La moyenne linéaire de Terrazzo005 (materials.ts, TERRAZZO). */
const MOYENNE = [0.603, 0.568, 0.54]
/** La lame (largeur, longueur en largeurs) et la tuile de la carte du parquet (galeries.ts). */
const [W, N, TUILE] = [0.09, 6, 3]

type Type = 'f' | 'v2' | 'v3' | 'v4' | 'b'

/** Le GLSL et le WGSL de la greffe, écrits une fois ; les planchers (pied encrassé) et les passages du hall viennent du plan. */
export function codeDuParement(wgsl: boolean, plan: Plan): { fragment: Record<string, string>; vertex: Record<string, string> } {
  const PLANCHERS = plan.levels.map((l) => l.elevation)
  const PASSAGES = passagesDuHall(plan)
  const T = (t: Type) => (wgsl ? { f: 'f32', v2: 'vec2f', v3: 'vec3f', v4: 'vec4f', b: 'bool' } : { f: 'float', v2: 'vec2', v3: 'vec3', v4: 'vec4', b: 'bool' })[t]
  const V = (n: string, t: Type, e: string) => (wgsl ? `var ${n}: ${T(t)} = ${e};` : `${T(t)} ${n} = ${e};`)
  const G = (n: string, t: Type) => (wgsl ? `var<private> ${n}: ${T(t)};` : `${T(t)} ${n};`)
  const S = (c: string, a: string, b: string) => (wgsl ? `select(${b}, ${a}, ${c})` : `(${c} ? ${a} : ${b})`)
  const fn = (nom: string, args: [string, string][], ret: string, corps: string) =>
    wgsl
      ? `fn ${nom}(${args.map(([n, t]) => `${n}: ${t}`).join(', ')})${ret ? ` -> ${ret}` : ''} {${corps}\n}`
      : `${ret || 'void'} ${nom}(${args.map(([n, t]) => `${t} ${n}`).join(', ')}) {${corps}\n}`
  // L'accolade fermante sur sa ligne : collée à un `#endif`, le préprocesseur de Babylon la mangerait.
  // Les constructeurs et dérivées s'écrivent en GLSL, traduits ici.
  const tr = (s: string) => (wgsl ? s.replace(/\bvec([234])\(/g, 'vec$1f(').replaceAll('dFdx(', 'dpdx(').replaceAll('dFdy(', 'dpdy(') : s)
  const entree = (n: string) => (wgsl ? `fragmentInputs.${n}` : n)
  const P = entree('vPositionW')
  const NW = `normalize(${entree('vNormalW')})`
  const [VB, VT] = [entree('vBoite'), entree('vTailleB')]
  const tex = wgsl ? [['t', 'texture_2d<f32>'], ['s', 'sampler'], ['uv', 'vec2f']] as [string, string][] : [['t', 'sampler2D'], ['uv', 'vec2']] as [string, string][]
  const grad = (uv: string, dx: string, dy: string) => (wgsl ? `textureSampleGrad(t, s, ${uv}, ${dx}, ${dy})` : `textureGrad(t, ${uv}, ${dx}, ${dy})`)
  const passages = PASSAGES.length ? PASSAGES : [[1e4, 1e4, 1e4, 1e4]]
  const v4 = (p: readonly number[]) => `vec4(${p.map(f).join(', ')})`
  const tableau = wgsl
    ? `var<private> PM_PASSAGES: array<vec4f, ${passages.length}> = array<vec4f, ${passages.length}>(${passages.map(v4).join(', ')});`
    : `const vec4 PM_PASSAGES[${passages.length}] = vec4[${passages.length}](${passages.map(v4).join(', ')});`
  const pour = (n: number, corps: string) => (wgsl ? `for (var i: i32 = 0; i < ${n}; i++) {${corps}}` : `for (int i = 0; i < ${n}; i++) {${corps}}`)
  const enLineaire = wgsl ? ['toLinearSpaceVec3', 'toGammaSpaceVec3'] : ['toLinearSpace', 'toGammaSpace']

  const definitions = `
${wgsl ? 'varying vBoite: vec3f;\nvarying vTailleB: vec3f;' : 'varying vec3 vBoite;\nvarying vec3 vTailleB;'}
${fn('pmHash', [['p', T('v2')]], T('f'), 'return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);')}
${fn('pmBruit', [['p', T('v2')]], T('f'), `
  ${V('i', 'v2', 'floor(p)')}
  ${V('fr', 'v2', 'fract(p)')}
  ${V('u', 'v2', 'fr * fr * (3.0 - 2.0 * fr)')}
  return mix(mix(pmHash(i), pmHash(i + vec2(1.0, 0.0)), u.x), mix(pmHash(i + vec2(0.0, 1.0)), pmHash(i + vec2(1.0, 1.0)), u.x), u.y);`)}
${fn('pmMod', [['a', T('f')], ['b', T('f')]], T('f'), 'return a - b * floor(a / b);')}
${tableau}
${G('btUv', 'v2')}
${G('btDx', 'v2')}
${G('btDy', 'v2')}
${G('btAngle', 'f')}
${G('btTon', 'f')}
${G('btJoint', 'f')}
${G('pmRugo', 'f')}
${fn('btCalcul', [['p', T('v3')]], '', `
  ${V('q', 'v2', `vec2(p.x + p.z, p.z - p.x) * ${f(0.70710678 / W)}`)}
  ${V('dqx', 'v2', 'dFdx(q)')}
  ${V('dqy', 'v2', 'dFdy(q)')}
  ${V('hu', 'f', 'q.x - floor(q.y)')}
  ${V('r', 'f', `pmMod(hu, ${f(2 * N)})`)}
  ${V('lame', 'v2', 'vec2(0.0)')}
  ${V('id', 'v2', 'vec2(0.0)')}
  ${V('debout', 'b', `r >= ${f(N)}`)}
  if (!debout) {
    lame = vec2(r, fract(q.y));
    id = vec2(floor(q.y), floor(hu / ${f(2 * N)}));
  } else {
    ${V('vv', 'f', 'q.y - floor(q.x) - 1.0')}
    lame = vec2(pmMod(vv, ${f(2 * N)}), fract(q.x));
    id = vec2(floor(q.x) + 517.0, floor(vv / ${f(2 * N)}));
  }
  ${V('h', 'v3', 'fract(sin(vec3(dot(id, vec2(127.1, 311.7)), dot(id, vec2(269.5, 183.3)), dot(id, vec2(419.2, 371.9)))) * 43758.5453)')}
  ${V('m', 'v2', `lame * ${f(W)}`)}
  btUv = vec2(floor(h.x * 4.0) * 0.25 + 0.035 + m.x / ${f(TUILE)}, floor(h.y * 16.0) / 16.0 + 0.016 + m.y / ${f(TUILE)});
  btDx = ${S('debout', 'dqx.yx', 'dqx')} * ${f(W / TUILE)};
  btDy = ${S('debout', 'dqy.yx', 'dqy')} * ${f(W / TUILE)};
  btAngle = ${S('debout', '2.3561945', '0.7853982')};
  btTon = 0.88 + 0.24 * h.z;
  ${V('px', 'f', `(length(dqx) + length(dqy)) * ${f(W)}`)}
  ${V('bord', 'f', `min(min(m.x, ${f(N * W)} - m.x), min(m.y, ${f(W)} - m.y))`)}
  btJoint = 1.0 - 0.5 * (1.0 - smoothstep(0.0006, 0.0006 + px, bord)) * (1.0 - smoothstep(0.003, 0.012, px));`)}
${fn('pmTex', tex, T('v4'), `
#ifdef PM_BATONS
  return ${grad('btUv', 'btDx', 'btDy')};
#else
#ifdef PM_DECALE
  ${V('c', 'v2', 'floor(uv)')}
  ${V('h', 'v2', 'fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453)')}
  return ${grad('uv + floor(h * vec2(4.0, 16.0)) / vec2(4.0, 16.0)', 'dFdx(uv)', 'dFdy(uv)')};
#else
  return ${wgsl ? 'textureSample(t, s, uv)' : 'texture2D(t, uv)'};
#endif
#endif`)}
${fn('pmAlbedo', tex, T('v4'), `
  ${V('c', 'v4', `pmTex(${wgsl ? 't, s, uv' : 't, uv'})`)}
#ifdef PM_TERRAZZO
#ifdef GAMMAALBEDO
  c = vec4(${enLineaire[1]}(mix(vec3(${MOYENNE.map(f).join(', ')}), ${enLineaire[0]}(c.rgb), 0.5)), c.a);
#else
  c = vec4(mix(vec3(${MOYENNE.map(f).join(', ')}), c.rgb, 0.5), c.a);
#endif
#endif
  return c;`)}
${fn('pmBosse', tex, T('v4'), `
  ${V('c', 'v4', `pmTex(${wgsl ? 't, s, uv' : 't, uv'})`)}
#ifdef PM_BATONS
  ${V('n', 'v2', 'c.xy * 2.0 - 1.0')}
  ${V('co', 'f', 'cos(btAngle)')}
  ${V('si', 'f', 'sin(btAngle)')}
  c = vec4(vec2(co * n.x - si * n.y, si * n.x + co * n.y) * 0.5 + 0.5, c.zw);
#endif
  return c;`)}
`

  const albedo = `
pmRugo = 0.0;
#ifdef PM_BATONS
surfaceAlbedo *= btTon * btJoint;
#endif
#ifdef PM_TENTURE
{
  ${V('tP', 'v2', `vec2(${P}.x + ${P}.z, ${P}.y)`)}
  ${V('tPx', 'f', 'length(fwidth(tP))')}
  ${V('tG', 'v2', 'tP / 0.0025')}
  ${V('tF', 'v2', 'fract(tG) - 0.5')}
  ${V('tDessus', 'f', 'pmMod(floor(tG.x) + floor(tG.y), 2.0)')}
  ${V('tFil', 'f', S('tDessus > 0.5', '1.0 - 4.0 * tF.y * tF.y', '1.0 - 4.0 * tF.x * tF.x'))}
  ${V('tPres', 'f', '1.0 - smoothstep(0.0006, 0.0018, tPx)')}
  ${V('tFlamme', 'f', 'pmBruit(vec2(tP.x * 0.8, tP.y * 140.0)) - 0.5')}
  ${V('tMi', 'f', '1.0 - smoothstep(0.004, 0.02, tPx)')}
  ${V('tLe', 'f', 'pmHash(vec2(floor(tP.x / 1.3), 4.1)) - 0.5')}
  ${V('tNuance', 'f', 'pmBruit(tP * 0.9) * 0.6 + pmBruit(tP * 3.1) * 0.4 - 0.5')}
  surfaceAlbedo *= 1.0 + 0.12 * tPres * (tFil - 0.66) + 0.08 * tMi * tFlamme + 0.06 * tLe + 0.16 * tNuance;
  pmRugo += 0.08 * tPres * (0.66 - tFil);
}
#endif
#ifdef PM_USURE
{
  ${V('uVert', 'f', `1.0 - smoothstep(0.35, 0.65, abs(${NW}.y))`)}
  ${V('uDansBoite', 'f', `${VB}.y + ${VT}.y * 0.5`)}
  ${V('uFond', 'f', `${P}.y - uDansBoite`)}
  ${V('uPose', 'f', '0.0')}
  ${PLANCHERS.map((e) => `uPose = max(uPose, 1.0 - step(0.03, abs(uFond - ${f(e)})));`).join('\n  ')}
  ${V('uT', 'f', `${P}.x + ${P}.z`)}
  ${V('uPied', 'f', '(1.0 - smoothstep(0.004, 0.028 + 0.012 * pmBruit(vec2(uT * 4.0, 2.0)), uDansBoite)) * uPose * uVert')}
  surfaceAlbedo *= 1.0 - 0.2 * uPied;
}
#ifdef PM_ECLATS
{
  ${V('uE', 'v3', `${VT} * 0.5 - abs(${VB})`)}
  ${V('uLo', 'f', 'min(uE.x, min(uE.y, uE.z))')}
  ${V('uHi', 'f', 'max(uE.x, max(uE.y, uE.z))')}
  ${V('uArete', 'f', 'uE.x + uE.y + uE.z - uLo - uHi')}
  ${V('uT', 'f', `dot(${P}, vec3(1.0, 0.83, 1.17))`)}
  ${V('uN', 'f', 'pmBruit(vec2(uT * 9.0, 1.3)) * 0.5 + pmBruit(vec2(uT * 27.0, 7.7)) * 0.3 + pmBruit(vec2(uT * 71.0, 2.9)) * 0.2')}
  ${V('uLarge', 'f', '0.3 * (0.004 + 0.07 * pow(uN, 1.8))')}
  ${V('uEclat', 'f', '1.0 - smoothstep(uLarge * 0.75, uLarge, uArete)')}
  ${V('uLisere', 'f', '(1.0 - uEclat) * (1.0 - smoothstep(uLarge, uLarge + 0.004, uArete)) * step(0.006, uLarge)')}
  surfaceAlbedo *= mix(1.0 + 0.06 * (1.0 - smoothstep(0.0, 0.008, uArete)) + 0.12 * uLisere, 0.68, uEclat);
  pmRugo += 0.1 * uEclat;
}
#endif
#endif
#ifdef PM_HALL
if (${P}.y < 0.1) {
  ${V('uD', 'f', '10000.0')}
  ${pour(passages.length, `
    ${V('sg', 'v4', 'PM_PASSAGES[i]')}
    ${V('ab', 'v2', 'sg.zw - sg.xy')}
    ${V('t', 'f', `clamp(dot(${P}.xz - sg.xy, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0)`)}
    uD = min(uD, length(${P}.xz - sg.xy - t * ab));`)}
  ${V('uB', 'f', `pmBruit(${P}.xz * 1.7) * 0.6 + pmBruit(${P}.xz * 6.0) * 0.4`)}
  ${V('uUse', 'f', '1.0 - smoothstep(0.3, 1.2, uD + (uB - 0.5) * 0.5)')}
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * vec3(0.9, 0.89, 0.87), uUse);
  pmRugo += 0.16 * uUse;
}
#endif
`
  const rebond = wgsl ? 'uniforms.pmRebond' : 'pmRebond'
  const fragment = {
    CUSTOM_FRAGMENT_DEFINITIONS: tr(definitions),
    CUSTOM_FRAGMENT_MAIN_BEGIN: `#ifdef PM_BATONS\nbtCalcul(${P});\n#endif`,
    // Les cartes passent par la lame, la tuile décalée ou le terrazzo adouci.
    '!TEXRD\\(albedoSampler,': 'pmAlbedo(albedoSampler,',
    '!TEXRD\\(reflectivitySampler,': 'pmTex(reflectivitySampler,',
    '!TEXRD\\(bumpSampler,': 'pmBosse(bumpSampler,',
    CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(albedo),
    [wgsl ? '!var roughness: f32=reflectivityOut\\.roughness;' : '!float roughness=reflectivityOut\\.roughness;']:
      '$0\nroughness = clamp(roughness + pmRugo, 0.0, 1.0);\nmicroSurface = 1.0 - roughness;',
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: tr(
      `finalEmissive += surfaceAlbedo.rgb * vec3(${f(REBOND.r)}, ${f(REBOND.g)}, ${f(REBOND.b)}) * (${rebond} * clamp(-${NW}.y, 0.0, 1.0));`,
    ),
  }
  const vertex = {
    CUSTOM_VERTEX_DEFINITIONS: wgsl
      ? '#ifdef PM_USURE\nattribute boite: vec3f;\nattribute taille: vec3f;\n#endif\nvarying vBoite: vec3f;\nvarying vTailleB: vec3f;'
      : '#ifdef PM_USURE\nattribute vec3 boite;\nattribute vec3 taille;\n#endif\nvarying vec3 vBoite;\nvarying vec3 vTailleB;',
    CUSTOM_VERTEX_MAIN_END: wgsl
      ? '#ifdef PM_USURE\nvertexOutputs.vBoite = vertexInputs.boite;\nvertexOutputs.vTailleB = vertexInputs.taille;\n#else\nvertexOutputs.vBoite = vec3f(0.0);\nvertexOutputs.vTailleB = vec3f(0.0);\n#endif'
      : '#ifdef PM_USURE\nvBoite = boite;\nvTailleB = taille;\n#else\nvBoite = vec3(0.0);\nvTailleB = vec3(0.0);\n#endif',
  }
  return { fragment, vertex }
}

export class Parement extends MaterialPluginBase {
  readonly reglages: Reglages
  private readonly code: Record<'glsl' | 'wgsl', ReturnType<typeof codeDuParement>>
  constructor(m: Material, reglages: Reglages, plan: Plan) {
    // Inscrit seulement une fois le code prêt : l'inscription lit déjà `getCustomCode`.
    super(m, 'Parement', 300, { ...DEFINES }, false)
    this.reglages = reglages
    this.code = { glsl: codeDuParement(false, plan), wgsl: codeDuParement(true, plan) }
    this._pluginManager._addPlugin(this)
    this._enable(true)
  }

  override getClassName(): string {
    return 'Parement'
  }

  override isCompatible(langue: ShaderLanguage): boolean {
    return langue === ShaderLanguage.GLSL || langue === ShaderLanguage.WGSL
  }

  override prepareDefines(defines: MaterialDefines): void {
    const r = this.reglages
    Object.assign(defines, {
      PM_TENTURE: !!r.tenture, PM_TERRAZZO: !!r.terrazzo, PM_HALL: !!r.hall, PM_DECALE: !!r.decale,
      PM_BATONS: !!r.batons, PM_USURE: !!r.usure, PM_ECLATS: !!r.eclats,
    })
  }

  override getAttributes(attributes: string[]): void {
    if (this.reglages.usure) attributes.push('boite', 'taille')
  }

  override getUniforms(langue?: ShaderLanguage) {
    return {
      ubo: [{ name: 'pmRebond', size: 1, type: 'float' }],
      fragment: langue === ShaderLanguage.WGSL ? '' : 'uniform float pmRebond;',
    }
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat('pmRebond', this.reglages.rebond ?? 0)
  }

  override getCustomCode(type: string, langue?: ShaderLanguage): { [point: string]: string } | null {
    const c = langue === ShaderLanguage.WGSL ? this.code.wgsl : this.code.glsl
    return type === 'fragment' ? c.fragment : type === 'vertex' ? c.vertex : null
  }
}

/** Les sept matières du parement, plugin greffé (une matière par revêtement). */
export function matieresDuParement(scene: Scene, plan: Plan): Record<Revetement, PBRMaterial> {
  const avec = (m: PBRMaterial, r: Reglages) => {
    new Parement(m, r, plan)
    return m
  }
  return {
    platre: avec(matierePBR('parement-platre', 'platre', scene, { repli: '#dddad4' }), { rebond: REGLAGES.platre.rebond }),
    // Teinte par sommet : la couleur de la galerie (blanc × gain avec les cartes, aplat de la couleur sans).
    peinture: avec(matierePBR('parement-peinture', 'platre', scene), { rebond: REGLAGES.platre.rebond, tenture: true }),
    pierre: avec(creerPierre(scene, 'parement-pierre'), { usure: true, eclats: true }),
    terrazzo: avec(matierePBR('parement-terrazzo', 'marbre', scene, { repli: '#c4bfba' }), { rebond: REGLAGES.marbre.rebond, terrazzo: true, hall: true }),
    parquet: avec(matierePBR('parement-parquet', 'parquet', scene, { repli: '#997959' }), { rebond: REGLAGES.parquet.rebond, decale: true }),
    'parquet-galeries': avec(matierePBR('parement-parquet-galeries', 'parquet', scene, { repli: '#997959' }), { rebond: REGLAGES.parquet.rebond, batons: true }),
    granit: avec(creerGranit(scene, 'parement-granit'), { usure: true }),
  }
}

/**
 * Monte le parement : 7 maillages fusionnés (les porteurs d'ombre), la lightmap
 * posée à l'arrivée de l'atlas, les lueurs branchées.
 */
export function monterParement(scene: Scene, plan: Plan, atlas: Promise<RawTexture>): Mesh[] {
  const mats = matieresDuParement(scene, plan)
  const gabarit = gabaritCube(scene)
  const lots = revetements(plan)
  const index = LUMIERE as { largeur: number; hauteur: number; boites: Record<string, (number[] | number)[]> }
  const maillages = (Object.keys(lots) as Revetement[]).filter((k) => lots[k].length).map((k) => {
    const m = new Mesh(`parement-${k}`, scene)
    Object.assign(new VertexData(), geometrieCuite(gabarit, lots[k], index)).applyToMesh(m)
    if (mats[k].pluginManager?.getPlugin<Parement>('Parement')?.reglages.usure) {
      const u = attributsDUsure(gabarit, lots[k].map((c) => c.b))
      m.setVerticesData('boite', u.boite, false, 3)
      m.setVerticesData('taille', u.taille, false, 3)
    }
    m.material = mats[k]
    m.receiveShadows = true
    return m
  })
  // L'échec de l'atlas est déjà signalé par monterBoites.
  void atlas.then((t) => Object.values(mats).forEach((m) => (m.lightmapTexture = t))).catch(() => {})
  brancherLueurs(Object.values(mats))
  return maillages
}
