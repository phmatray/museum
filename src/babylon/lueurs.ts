/**
 * La lumière attachée aux LIEUX (scene/lueurs.ts), en MaterialPluginBase GLSL
 * et WGSL : pas une vraie lumière, un terme par fragment selon sa position monde.
 *
 * - la lueur des lanternes de la nef, la nuit, entre les murs du hall ;
 * - les 25 spots sous les balcons (cônes vers le bas, jour et nuit) ;
 * - les 9 projecteurs au pied de la façade sud (pinceaux vers le haut, la nuit).
 *
 * three l'ajoute à l'irradiance (× albedo/π), que la lumière cuite multiplie
 * ensuite par son facteur f ; ici au diffus final (`finalDiffuse += lueur × f ×
 * albedo / π`), f relu sur la lightmap (qui porte f × l'hémisphérique de la face,
 * boites.ts) divisée par l'hémisphérique de la face (`reglerLueurs(jour, hemi)`).
 * ponytail : l'ambiance « dehors la nuit » (LUEURS.w, qui multiplie l'hémisphérique) et les
 * lampadaires du parc viendront avec le ciel et le jardin.
 *
 * Usage : `brancherLueurs(materiaux)` par chaque couche (matières PBR éclairées),
 * `reglerLueurs(jour)` par main.ts : un seul état, partagé par tous les plugins.
 */
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Color3 } from '@babylonjs/core/Maths/math.color'

import { PROJECTEURS_FACADE, SOUS_BALCON, SPOTS_BALCON } from '../plan/eclairage.ts'

/** Mêmes constantes que scene/lueurs.ts et EclairageLayer.tsx. */
const RAYON_SPOT = 5.2
const RAYON_FACADE = 14
const FORCE_FACADE = 3
const FORCE = { lampadaires: 5, spots: 10 }
const LANTERNES = '#ffc27a'
/** Une couleur hex en linéaire, comme `THREE.Color` (partagée par les couches). */
export const lin = (hex: string): Color3 => Color3.FromHexString(hex).toLinearSpace()
const CHAUD = lin('#ffb46b')

export const smoothstep = (x: number, a: number, b: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Les forces selon le jour (0 nuit, 1 jour) : lanternes de la nef (NefLayer),
 * projecteurs de façade = force des lampadaires, spots des balcons (EclairageLayer).
 */
export function lueursDuJour(jour: number): { nef: [number, number, number]; facade: number; spots: number } {
  const n = 1 - smoothstep(jour, 0.15, 0.6)
  const l = lin(LANTERNES).scale(0.5 * (1 - jour))
  return { nef: [l.r, l.g, l.b], facade: FORCE.lampadaires * n, spots: FORCE.spots * (0.6 + 0.4 * n) }
}

const ETAT = { ...lueursDuJour(1), hemi: [1, 1, 1] }
/**
 * Règle toutes les lueurs (uniforms relus à chaque liaison de matière). `hemi` :
 * l'hémisphérique que la lightmap remplace, dont on lit le vert sur une face de
 * côté, de dessus, de dessous (les teintes de `chargerAtlas`).
 */
export function reglerLueurs(jour: number, hemi?: HemisphericLight): void {
  const vert = (w: number) => Color3.Lerp(hemi!.groundColor, hemi!.diffuse, w).g * hemi!.intensity
  Object.assign(ETAT, lueursDuJour(jour), hemi && { hemi: [vert(0.5), vert(1), vert(0)] })
}

const f = (v: number) => v.toFixed(3)
const v3 = (wgsl: boolean, p: readonly number[]) => `${wgsl ? 'vec3f' : 'vec3'}(${p.map(f).join(', ')})`
const tableau = (wgsl: boolean, nom: string, pts: [number, number, number][]) =>
  wgsl
    ? `var<private> ${nom}: array<vec3f, ${pts.length}> = array<vec3f, ${pts.length}>(${pts.map((p) => v3(true, p)).join(', ')});`
    : `const vec3 ${nom}[${pts.length}] = vec3[${pts.length}](${pts.map((p) => v3(false, p)).join(', ')});`

/** Le cœur, écrit une fois : `T` est le type vec3, `F` le type float, `V` la déclaration de variable. */
function corps(wgsl: boolean): string {
  const [T, F] = wgsl ? ['vec3f', 'f32'] : ['vec3', 'float']
  const fn = (nom: string, args: [string, string][], ret: string, body: string) =>
    wgsl
      ? `fn ${nom}(${args.map(([n, t]) => `${n}: ${t}`).join(', ')}) -> ${ret} {${body}}`
      : `${ret} ${nom}(${args.map(([n, t]) => `${t} ${n}`).join(', ')}) {${body}}`
  const V = (n: string, t: string, e: string) => (wgsl ? `var ${n}: ${t} = ${e};` : `${t} ${n} = ${e};`)
  const pour = (n: number, corpsBoucle: string) =>
    wgsl ? `for (var i: i32 = 0; i < ${n}; i++) {${corpsBoucle}}` : `for (int i = 0; i < ${n}; i++) {${corpsBoucle}}`
  const chaud = v3(wgsl, [CHAUD.r, CHAUD.g, CHAUD.b])
  return `
${tableau(wgsl, 'SPOTS_BALCON', SPOTS_BALCON)}
${tableau(wgsl, 'PROJECTEURS_FACADE', PROJECTEURS_FACADE)}
${fn('lueurCone', [['d', T], ['n', T], ['rayon', F], ['axe', F], ['c0', F], ['c1', F], ['rasant', F]], F, `
  ${V('l2', F, 'dot(d, d)')}
  if (l2 >= rayon * rayon) { return 0.0; }
  ${V('l', F, 'sqrt(l2)')}
  ${V('a', F, '1.0 - l / rayon')}
  ${V('lambert', F, 'max(dot(n, d) / l, 0.0)')}
  return a * a * smoothstep(c0, c1, axe * d.y / l) * mix(lambert, min(1.0, 4.0 * lambert), rasant);
`)}
${fn('lueurs', [['p', T], ['n', T], ['nefCouleur', T], ['lampes', wgsl ? 'vec2f' : 'vec2']], T, `
  ${V('r', T, `${T}(0.0)`)}
  ${V('nef', F, 'smoothstep(15.85, 16.15, p.x) * (1.0 - smoothstep(31.85, 32.15, p.x)) * smoothstep(11.85, 12.15, p.z) * (1.0 - smoothstep(39.85, 40.15, p.z))')}
  r += nefCouleur * nef * (0.75 + 0.25 * n.y);
  if (lampes.x > 0.0 && p.z > 39.9 && p.z < 43.0) {
    ${V('dedans', F, 'smoothstep(-0.4, 0.1, p.x) * (1.0 - smoothstep(47.9, 48.4, p.x)) * smoothstep(-0.4, 0.1, p.z) * (1.0 - smoothstep(39.9, 40.4, p.z))')}
    if (dedans < 0.99) {
      ${V('s', F, '0.0')}
      ${pour(PROJECTEURS_FACADE.length, `s += ${f(FORCE_FACADE)} * lueurCone(PROJECTEURS_FACADE[i] - p, n, ${f(RAYON_FACADE)}, -1.0, 0.8, 0.97, 1.0);`)}
      r += ${chaud} * (lampes.x * s * (1.0 - dedans));
    }
  }
  if (lampes.y > 0.0 && p.y < ${f(SOUS_BALCON)} && p.x > 16.0 && p.x < 32.0 && p.z > 16.5 && p.z < 40.0 && (p.x < 21.5 || p.x > 26.5 || p.z > 34.5)) {
    ${V('s', F, '0.0')}
    ${pour(SPOTS_BALCON.length, `s += lueurCone(SPOTS_BALCON[i] - p, n, ${f(RAYON_SPOT)}, 1.0, 0.5, 0.85, 0.0);`)}
    r += ${chaud} * (lampes.y * s);
  }
  return r;
`)}`
}

class Lueurs extends MaterialPluginBase {
  constructor(m: Material) {
    super(m, 'Lueurs', 200, undefined, true, true)
  }

  override getClassName(): string {
    return 'Lueurs'
  }

  override isCompatible(langue: ShaderLanguage): boolean {
    return langue === ShaderLanguage.GLSL || langue === ShaderLanguage.WGSL
  }

  override getUniforms(langue?: ShaderLanguage) {
    return {
      ubo: [
        { name: 'lueursNef', size: 3, type: 'vec3' },
        { name: 'lueursLampes', size: 2, type: 'vec2' },
        { name: 'lueursHemi', size: 3, type: 'vec3' },
      ],
      fragment: langue === ShaderLanguage.WGSL ? '' : 'uniform vec3 lueursNef;\nuniform vec2 lueursLampes;\nuniform vec3 lueursHemi;',
    }
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat3('lueursNef', ...ETAT.nef)
    ubo.updateFloat2('lueursLampes', ETAT.facade, ETAT.spots)
    ubo.updateFloat3('lueursHemi', ...(ETAT.hemi as [number, number, number]))
  }

  override getCustomCode(type: string, langue?: ShaderLanguage): { [point: string]: string } | null {
    return type === 'fragment' ? codeDesLueurs(langue === ShaderLanguage.WGSL) : null
  }
}

/** Le code du fragment, GLSL ou WGSL (exporté pour les tests). */
export function codeDesLueurs(wgsl: boolean): Record<string, string> {
  return {
    CUSTOM_FRAGMENT_DEFINITIONS: corps(wgsl),
    // Le facteur f de la lumière cuite : la lightmap sur l'hémisphérique de la face (côté, dessus, dessous).
    // L'accolade fermante seule sur sa ligne : le préprocesseur de Babylon mange une `}` collée à `#endif`.
    CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: wgsl
      ? `{
var lueur: vec3f = lueurs(fragmentInputs.vPositionW, normalW, uniforms.lueursNef, uniforms.lueursLampes);
#ifdef LIGHTMAP
lueur *= lightmapColor.g / select(select(uniforms.lueursHemi.x, uniforms.lueursHemi.z, normalW.y < -0.5), uniforms.lueursHemi.y, normalW.y > 0.5);
#endif
finalDiffuse += lueur * surfaceAlbedo.rgb / PI;
}`
      : `{
vec3 lueur = lueurs(vPositionW, normalW, lueursNef, lueursLampes);
#ifdef LIGHTMAP
lueur *= lightmapColor.g / (normalW.y > 0.5 ? lueursHemi.y : normalW.y < -0.5 ? lueursHemi.z : lueursHemi.x);
#endif
finalDiffuse += lueur * surfaceAlbedo.rgb / PI;
}`,
  }
}

/** Greffe les lueurs sur des matières PBR éclairées (une fois par matière). */
export function brancherLueurs(materiaux: Iterable<Material>): void {
  for (const m of materiaux) if (!m.pluginManager?.getPlugin('Lueurs')) new Lueurs(m)
}
