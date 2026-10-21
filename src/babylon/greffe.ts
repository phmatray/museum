/**
 * Les greffes de shader (les `onBeforeCompile` de three) en MaterialPluginBase,
 * GLSL et WGSL, sans réécrire la classe à chaque fois :
 *
 *   greffer(mat, { nom: 'Gazon', attributs: ['aBrin'], uniforms: [{ name: 'gazonCam', size: 2, type: 'vec2' }],
 *                  lier: (ubo) => ubo.updateFloat2('gazonCam', x, z), code: (wgsl) => ({ vertex: {…}, fragment: {…} }) })
 *
 * - `nom` : nom de classe ET define (`GAZON`), propre à la greffe : sans lui, le
 *   define glisse au plugin suivant (voir ChenBatllo, mobilier.ts).
 * - `uniforms` : membres de l'UBO ; leurs déclarations GLSL (repli sans UBO) sont écrites ici.
 * - `lier` : appelé à chaque liaison, même matière figée (`_mustRebind`) : un temps
 *   lu dans `lier` anime sans passer par VIVANTES (comme Comete d'ateliers.ts).
 * - `code(wgsl)` : points d'injection PBR (CUSTOM_VERTEX_DEFINITIONS,
 *   CUSTOM_VERTEX_UPDATE_POSITION, CUSTOM_VERTEX_UPDATE_NORMAL, CUSTOM_VERTEX_MAIN_END,
 *   CUSTOM_FRAGMENT_DEFINITIONS, CUSTOM_FRAGMENT_UPDATE_ALPHA, regex `!…`), calculé une fois par langue.
 *
 * `dialecte(wgsl)` : les petits mots qui diffèrent (types, variables, entrées,
 * sorties, uniforms), pour écrire chaque corps une seule fois.
 * Pièges : l'accolade fermante seule sur sa ligne après un `#endif` ; pas de
 * `mod()` en WGSL (écrire `x - y * floor(x / y)`) ; `tr()` traduit vecN( et dFdx ;
 * dans `lier`, jamais `ubo.updateUniform` : sous WebGPU la matière n'a pas d'UBO
 * propre, seuls `updateFloat*`/`updateMatrix` sont renvoyés vers l'effet.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'

type Code = { vertex?: Record<string, string>; fragment?: Record<string, string> }
export interface Uniform { name: string; size: number; type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'mat4'; arraySize?: number }
export interface Greffe {
  nom: string
  /** 200 par défaut (celle des Lueurs) ; plus haut passe après. */
  priorite?: number
  attributs?: string[]
  samplers?: string[]
  uniforms?: Uniform[]
  lier?: (ubo: UniformBuffer) => void
  code: (wgsl: boolean) => Code
}

class Greffon extends MaterialPluginBase {
  readonly g: Greffe
  readonly codes = new Map<boolean, Code>()
  constructor(m: Material, g: Greffe) {
    // Inscrit après coup (modèle de ChenBatllo) : l'inscription lit getClassName, donc `g`.
    super(m, g.nom, g.priorite ?? 200, { [g.nom.toUpperCase().replace(/\W/g, '_')]: true }, false)
    this.g = g
    this._pluginManager._addPlugin(this)
    this._enable(true)
  }

  override getClassName(): string {
    return this.g.nom
  }

  override isCompatible(langue: ShaderLanguage): boolean {
    return langue === ShaderLanguage.GLSL || langue === ShaderLanguage.WGSL
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(...(this.g.attributs ?? []))
  }

  override getSamplers(samplers: string[]): void {
    samplers.push(...(this.g.samplers ?? []))
  }

  override getUniforms(langue?: ShaderLanguage) {
    const u = this.g.uniforms ?? []
    const glsl = langue === ShaderLanguage.WGSL ? '' : u.map((x) => `uniform ${x.type} ${x.name}${x.arraySize ? `[${x.arraySize}]` : ''};`).join('\n')
    return { ubo: u, vertex: glsl, fragment: glsl }
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    this.g.lier?.(ubo)
  }

  override getCustomCode(type: string, langue?: ShaderLanguage): { [point: string]: string } | null {
    const wgsl = langue === ShaderLanguage.WGSL
    const c = this.codes.get(wgsl) ?? this.g.code(wgsl)
    this.codes.set(wgsl, c)
    return (type === 'vertex' ? c.vertex : type === 'fragment' ? c.fragment : null) ?? null
  }
}

/** Greffe un plugin sur une matière (avant sa première compilation, sinon `markAsDirty`). Une fois par nom. */
export function greffer(m: Material, g: Greffe): MaterialPluginBase {
  return m.pluginManager?.getPlugin(g.nom) ?? new Greffon(m, g)
}

type Type = 'float' | 'vec2' | 'vec3' | 'vec4'
/** Les mots d'une langue. Types notés à la GLSL (`float`, `vec3`), traduits en WGSL. */
export function dialecte(wgsl: boolean) {
  const T = (t: Type) => (wgsl ? (t === 'float' ? 'f32' : `${t}f`) : t)
  return {
    T,
    /** Déclaration de variable locale. */
    V: (n: string, t: Type, e: string) => (wgsl ? `var ${n}: ${T(t)} = ${e};` : `${t} ${n} = ${e};`),
    /** Globale partagée entre points d'injection d'un même étage. */
    G: (n: string, t: Type) => (wgsl ? `var<private> ${n}: ${T(t)};` : `${t} ${n};`),
    attribut: (n: string, t: Type) => (wgsl ? `attribute ${n}: ${T(t)};` : `attribute ${t} ${n};`),
    varying: (n: string, t: Type) => (wgsl ? `varying ${n}: ${T(t)};` : `varying ${t} ${n};`),
    /** Un attribut lu dans le vertex. */
    vin: (n: string) => (wgsl ? `vertexInputs.${n}` : n),
    /** Un varying écrit dans le vertex. */
    vout: (n: string) => (wgsl ? `vertexOutputs.${n}` : n),
    /** Un varying lu dans le fragment (vPositionW, vNormalW…). */
    fin: (n: string) => (wgsl ? `fragmentInputs.${n}` : n),
    u: (n: string) => (wgsl ? `uniforms.${n}` : n),
    fn: (nom: string, args: [string, Type][], ret: Type | '', corps: string) =>
      wgsl
        ? `fn ${nom}(${args.map(([n, t]) => `${n}: ${T(t)}`).join(', ')})${ret ? ` -> ${T(ret)}` : ''} {${corps}\n}`
        : `${ret || 'void'} ${nom}(${args.map(([n, t]) => `${t} ${n}`).join(', ')}) {${corps}\n}`,
    /** Constructeurs et dérivées écrits en GLSL, traduits. */
    tr: (s: string) => (wgsl ? s.replace(/\bvec([234])\(/g, 'vec$1f(').replaceAll('dFdx(', 'dpdx(').replaceAll('dFdy(', 'dpdy(') : s),
    /** La regex de la rugosité PBR, à remplacer par `$0\nroughness = …;\nmicroSurface = 1.0 - roughness;`. */
    rugosite: wgsl ? '!var roughness: f32=reflectivityOut\\.roughness;' : '!float roughness=reflectivityOut\\.roughness;',
  }
}
