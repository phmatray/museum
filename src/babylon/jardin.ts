/**
 * Le décor fixe du jardin japonais (`assets/jardin/jardin.glb`, `Jardin` de
 * ParkLayer.tsx et jardinMatieres.ts de three), posé tel que Blender l'a
 * modelé dans le repère du plan : le sol creusé prend la pelouse du parc (et
 * les caustiques au fond du ruisseau), pas japonais, lanterne et culées la
 * roche, le pont le bois, l'étang son eau ; le foyer de la lanterne garde sa
 * matière et ne brûle qu'au crépuscule. La nappe de la cascade du GLB est
 * jetée : celle de `nappeDeLaCascade` la remplace, et le ruisseau coule sur
 * `rubanDuRuisseau`.
 *
 * Les primitives du GLB n'ont ni UV ni couleurs : UV en mètres lues sur le plan
 * (sol, eau) ou projetées « en boîte » (granit, bois), berge assombrie par sommet.
 * Les shaders de three en greffes (greffe.ts) : Etang, Cascade, Ruisseau,
 * Caustiques ; leur temps est lu dans `lier`. Les décalages de texture (dérive
 * des vaguelettes de l'étang, filets de la cascade) ne passent pas par `lier` :
 * 'jardin:eau' et 'jardin:cascade' vont dans VIVANTES.
 * ponytail : ni `intemperer` (météo, gel du ruisseau, ronds de pluie) ni
 * `retoucherCartes` du bois ; le jour (lueur, couleur du ciel dans l'eau) est
 * figé au montage, comme le reste de la tranche.
 */
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Material } from '@babylonjs/core/Materials/material'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import { BOMBE_LEVRE, distanceRuisseau, INDICE_LEVRE, JARDIN, nappeDeLaCascade, rubanDuRuisseau, TRACE_RUISSEAU } from '../plan/jardin.ts'
import { remous, type Remous } from '../plan/ruisseau.ts'
import { matiere } from './boites.ts'
import { VIVANTES } from './etat.ts'
import { fusionnerParMatiere, glbPartage } from './glb.ts'
import { dialecte, greffer } from './greffe.ts'
import { brancherLueurs, lin, smoothstep } from './lueurs.ts'
import { matierePBR } from './matieres.ts'
import { PARC, retourner } from './parc.ts'

/** Des vaguelettes (RGBA8, normales OpenGL) : une somme de sinus à fréquences ENTIÈRES, donc une tuile sans raccord. */
export function carteDeVaguelettes(n = 128): Uint8Array {
  const ondes = [[3, 1, 0.9, 0.3], [1, 4, 0.7, 1.7], [5, -3, 0.35, 2.9], [-2, 7, 0.25, 0.8], [8, 5, 0.15, 4.1]]
  const h = (x: number, y: number) => ondes.reduce((s, [kx, ky, a, p]) => s + a * Math.sin((2 * Math.PI * (kx * x + ky * y)) / n + p), 0)
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const [dx, dy] = [(h(x + 1, y) - h(x - 1, y)) / 2, (h(x, y + 1) - h(x, y - 1)) / 2]
      const l = Math.hypot(dx, dy, 1)
      data.set([((-dx / l) * 0.5 + 0.5) * 255, ((-dy / l) * 0.5 + 0.5) * 255, ((1 / l) * 0.5 + 0.5) * 255, 255], (y * n + x) * 4)
    }
  return data
}

/** Des filets d'eau verticaux, plus ou moins opaques : la nappe de la cascade (opacité dans les quatre canaux). */
export function carteDeFilets(n = 64): Uint8Array {
  const data = new Uint8Array(n * n * 4)
  for (let x = 0; x < n; x++) {
    const filet = 0.7 + 0.3 * Math.sin(x * 0.45) * Math.sin(x * 0.19 + 1.3)
    for (let y = 0; y < n; y++) data.fill(Math.max(0, Math.min(1, filet * (0.75 + 0.25 * Math.sin((y / n) * Math.PI * 6 + x)))) * 255, (y * n + x) * 4, (y * n + x) * 4 + 4)
  }
  return data
}

/** UV « de boîte » en mètres : chaque sommet projeté sur le plan qui fait face à sa normale. */
export function uvBoite(p: ArrayLike<number>, n: ArrayLike<number>, echelle = 1): Float32Array {
  const uv = new Float32Array((p.length / 3) * 2)
  for (let i = 0; i < p.length / 3; i++) {
    const [ax, ay, az] = [Math.abs(n[3 * i]), Math.abs(n[3 * i + 1]), Math.abs(n[3 * i + 2])]
    const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]]
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y]
    uv[2 * i] = u / echelle
    uv[2 * i + 1] = v / echelle
  }
  return uv
}

/** UV en mètres lues sur le plan : (x, z) pour le sol, (x, z) / 3 pour l'eau. */
export function uvDuPlan(p: ArrayLike<number>, eau: boolean): Float32Array {
  const k = eau ? 1 / 3 : 1
  const uv = new Float32Array((p.length / 3) * 2)
  for (let i = 0; i < p.length / 3; i++) [uv[2 * i], uv[2 * i + 1]] = [p[3 * i] * k, p[3 * i + 2] * k]
  return uv
}

const [BERGE, TERRE, LIT] = [lin('#4a5a2c'), lin('#3a3325'), lin('#5e5644')]
/** La berge fonce en descendant vers l'eau (mousse, terre mouillée, lit) : RGBA linéaires par sommet. */
export function couleursDeBerge(p: ArrayLike<number>): Float32Array {
  const out = new Float32Array((p.length / 3) * 4)
  for (let i = 0; i < p.length / 3; i++) {
    const y = p[3 * i + 1]
    const t = (a: number, b: number) => Math.min(1, Math.max(0, (-y - a) / (b - a)))
    const c = Color3.Lerp(Color3.Lerp(Color3.Lerp(Color3.White(), BERGE, t(0.03, 0.12)), TERRE, t(0.1, 0.2)), LIT, t(0.22, 0.28))
    out.set([c.r, c.g, c.b, 1], 4 * i)
  }
  return out
}

/** Une géométrie de three (winding inversé pour Babylon, normales recalculées). */
export function geometrie(position: Float32Array, uv: Float32Array, index: number[]): VertexData {
  const indices = retourner(index)
  const normals: number[] = []
  VertexData.ComputeNormals(position, indices, normals)
  return Object.assign(new VertexData(), { positions: position, uvs: uv, indices, normals })
}

const f = (v: number) => v.toFixed(4)
const temps = () => performance.now() / 1000

/** Le pied de la cascade dans l'étang (x, z), la direction de la chute (x, z), et sa demi-largeur. */
const CHUTE = (() => {
  const [[ax, az], [bx, bz, w]] = [TRACE_RUISSEAU[INDICE_LEVRE - 1], TRACE_RUISSEAU[INDICE_LEVRE]]
  const l = Math.hypot(bx - ax, bz - az)
  const [ux, uz] = [(bx - ax) / l, (bz - az) / l]
  const a = BOMBE_LEVRE + 0.14
  return { x: bx + ux * a, z: bz + uz * a, ux, uz, demi: w / 2 + 0.25 }
})()

/** Le bruit de valeur des shaders du jardin (jHash, jBruit). */
function bruit(wgsl: boolean): string {
  const { V, fn, tr } = dialecte(wgsl)
  return tr(`
${fn('jHash', [['p', 'vec2']], 'float', 'return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453);')}
${fn('jBruit', [['p', 'vec2']], 'float', `
  ${V('i', 'vec2', 'floor(p)')}
  ${V('q', 'vec2', 'fract(p)')}
  ${V('w', 'vec2', 'q * q * (3.0 - 2.0 * q)')}
  return mix(mix(jHash(i), jHash(i + vec2(1.0, 0.0)), w.x), mix(jHash(i + vec2(0.0, 1.0)), jHash(i + vec2(1.0, 1.0)), w.x), w.y);`)}`)
}

/** Le fresnel (1 − n·v)^k sur la normale perturbée. */
const fresnel = (k: number) => `pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), ${k.toFixed(1)})`

/** L'étang : écume au pied de la cascade, soleil adouci, ciel au rasant, presque opaque. */
export function codeDeLEtang(wgsl: boolean, ciel: Color3): { fragment: Record<string, string> } {
  const { V, tr, u, fin } = dialecte(wgsl)
  const T = u('etangT')
  return {
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: bruit(wgsl),
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`
${V('eD', 'vec2', `${fin('vPositionW')}.xz - vec2(${f(CHUTE.x)}, ${f(CHUTE.z)})`)}
${V('eAvant', 'float', `dot(eD, vec2(${f(CHUTE.ux)}, ${f(CHUTE.uz)}))`)}
${V('eTravers', 'float', `dot(eD, vec2(${f(-CHUTE.uz)}, ${f(CHUTE.ux)}))`)}
${V('eZone', 'float', `(1.0 - smoothstep(0.1, 1.0, length(vec2(eAvant * 1.1, eTravers / ${f(CHUTE.demi)})))) * step(-0.2, eAvant)`)}
${V('eFil', 'float', `1.0 - smoothstep(0.0, 0.045, abs(jBruit(vec2(eAvant * 1.5 - ${T}, eTravers * 16.0)) - 0.5))`)}
${V('eCoeur', 'float', `(1.0 - smoothstep(0.0, 0.22, eAvant)) * smoothstep(0.62, 0.82, jBruit(vec2(eAvant * 26.0 - ${T} * 2.0, eTravers * 26.0)))`)}
${V('eEcume', 'float', 'eZone * max(eFil * 0.6, eCoeur)')}
surfaceAlbedo = mix(surfaceAlbedo, vec3(0.82, 0.87, 0.86), eEcume);`),
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: '#ifdef SPECULARTERM\nfinalSpecularScaled *= 0.55;\n#endif\n',
      CUSTOM_FRAGMENT_BEFORE_FOG: tr(`
${V('eFr', 'float', fresnel(5))}
finalColor = vec4(mix(finalColor.rgb, vec3(${f(ciel.r)}, ${f(ciel.g)}, ${f(ciel.b)}), eFr * 0.6), max(mix(0.9, 1.0, eFr), eEcume));`),
    },
  }
}

/** La cascade : la nappe ondule en tombant, vitreuse et rayée en haut, aérée et blanche en bas, flancs effilochés. */
export function codeDeLaCascade(wgsl: boolean): { vertex: Record<string, string>; fragment: Record<string, string> } {
  const { V, tr, u, fin, vout, varying } = dialecte(wgsl)
  const T = u('cascT')
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: varying('vCasc', 'vec2'),
      CUSTOM_VERTEX_UPDATE_POSITION: `positionUpdated += normalUpdated * (sin(uvUpdated.y * 70.0 - ${T} * 9.0 + uvUpdated.x * 11.0) * 0.006 * smoothstep(0.0, 0.08, uvUpdated.y));`,
      CUSTOM_VERTEX_MAIN_END: `${vout('vCasc')} = uvUpdated;`,
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varying('vCasc', 'vec2')}\n${bruit(wgsl)}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`
${V('cC', 'vec2', fin('vCasc'))}
${V('cRaie', 'float', `jBruit(vec2(cC.x * 55.0, cC.y * 5.0 - ${T} * 2.6)) * 0.65 + jBruit(vec2(cC.x * 90.0, cC.y * 9.0 - ${T} * 3.4)) * 0.35`)}
${V('cBas', 'float', 'smoothstep(0.08, 0.17, cC.y)')}
${V('cBulle', 'float', `smoothstep(0.35, 0.7, jBruit(vec2(cC.x * 45.0, cC.y * 22.0 - ${T} * 7.0)) + 0.3 * cBas) * cBas`)}
${V('cBord', 'float', `min(cC.x, 1.0 - cC.x) + (jBruit(vec2(cC.x * 70.0, cC.y * 3.0 - ${T} * 2.2)) - 0.5) * 0.12`)}
${V('cFlanc', 'float', 'smoothstep(0.02, 0.14, cBord)')}
${V('cClair', 'float', 'max(smoothstep(0.5, 0.8, cRaie), cBulle)')}
surfaceAlbedo *= mix(0.72, 1.0, cClair);
alpha = max(alpha * mix(0.42, 0.95, cClair), cBulle * 0.95) * cFlanc;`),
    },
  }
}

/**
 * Le ruisseau : deux couches de vaguelettes qui défilent vers l'aval, écume en
 * fils aux radiers, au pied des berges et derrière les obstacles (remous FIXES,
 * cuits en constantes), claire en eau mince, sombre au creux des mouilles,
 * reflets presque éteints, ciel au rasant. Tout est calculé avant la normale
 * (`CUSTOM_FRAGMENT_MAIN_BEGIN`), que `rsBosse` rend à la place de la carte.
 */
export function codeDuRuisseau(wgsl: boolean, obstacles: Remous[], ciel: Color3): { vertex: Record<string, string>; fragment: Record<string, string> } {
  const { V, G, T: Ty, tr, u, fin, vin, vout, varying, attribut, rugosite } = dialecte(wgsl)
  const T = u('ruisT')
  const N = obstacles.length
  const v4 = (o: number[]) => `${wgsl ? 'vec4f' : 'vec4'}(${o.map(f).join(', ')})`
  const table = wgsl
    ? `var<private> REMOUS: array<vec4f, ${N}> = array<vec4f, ${N}>(${obstacles.map(v4).join(', ')});`
    : `const vec4 REMOUS[${N}] = vec4[${N}](${obstacles.map(v4).join(', ')});`
  const sel = (si: string, a: string, b: string) => (wgsl ? `select(${b}, ${a}, ${si})` : `(${si} ? ${a} : ${b})`)
  const tex = (uv: string) => (wgsl ? `textureSample(bumpSampler, bumpSamplerSampler, ${uv})` : `texture2D(bumpSampler, ${uv})`)
  const args: [string, string][] = wgsl ? [['t', 'texture_2d<f32>'], ['s', 'sampler'], ['uv', 'vec2f']] : [['t', 'sampler2D'], ['uv', 'vec2']]
  const varyings = `${varying('vEau', 'vec2')}\n${varying('vFil', 'vec2')}`
  const [E, F] = [fin('vEau'), fin('vFil')]
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: `${attribut('aEau', 'vec2')}\n${varyings}`,
      CUSTOM_VERTEX_MAIN_END: `${vout('vEau')} = ${vin('aEau')};\n${vout('vFil')} = uvUpdated;`,
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varyings}
${bruit(wgsl)}
${table}
${G('rRadier', 'float')}
${G('rEcume', 'float')}
${G('rProfond', 'float')}
${G('rsN', 'vec4')}
${wgsl ? `fn rsBosse(${args.map(([n, t]) => `${n}: ${t}`).join(', ')}) -> ${Ty('vec4')} { return rsN; }` : `vec4 rsBosse(${args.map(([n, t]) => `${t} ${n}`).join(', ')}) { return rsN; }`}`,
      CUSTOM_FRAGMENT_MAIN_BEGIN: tr(`
rRadier = ${E}.x;
${V('rBord', 'float', `${E}.y`)}
${V('rNappe', 'float', `jBruit(vec2(${F}.x * 0.7 - ${T} * 0.5, ${F}.y * 1.3 + 5.0))`)}
${V('rOnde', 'float', `0.5 * jBruit(vec2(${F}.x * 0.45 - ${T} * 0.4, ${F}.y * 2.5))`)}
${V('rS1', 'float', `jBruit(vec2(${F}.x * 0.8 - ${T} * 1.7, ${F}.y * 15.0 + rOnde * 4.0))`)}
${V('rS2', 'float', `jBruit(vec2(${F}.x * 1.6 - ${T} * 2.3 + 3.7, ${F}.y * 27.0 + rOnde * 6.0 + 1.9))`)}
${V('rF', 'float', 'max(1.0 - smoothstep(0.0, 0.07, abs(rS1 - 0.5)), 0.75 * (1.0 - smoothstep(0.0, 0.05, abs(rS2 - 0.5))))')}
rF *= smoothstep(0.3, 0.65, jBruit(vec2(${F}.x * 2.6 - ${T} * 2.0, ${F}.y * 7.0 + 2.3)));
rEcume = rF * rRadier * smoothstep(0.4, 0.8, rNappe + 0.15 * rRadier) * 0.4;
rEcume = max(rEcume, rF * smoothstep(0.8, 1.05, rBord) * (0.25 + 0.3 * rRadier));
${V('rChoc', 'float', '0.0')}
${V('rCol', 'float', '0.0')}
${wgsl ? `for (var i: i32 = 0; i < ${N}; i++) {` : `for (int i = 0; i < ${N}; i++) {`}
  ${V('o', 'vec4', 'REMOUS[i]')}
  ${V('d', 'vec2', `${F} - o.xy`)}
  ${V('aval', 'float', 'max(d.x, 0.0)')}
  ${V('e', 'vec2', `vec2(d.x / (o.z * ${sel('d.x > 0.0', '6.0', '1.1')}), d.y / (o.z * (1.0 + 0.25 * aval / o.z)))`)}
  ${V('k', 'float', '(1.0 - smoothstep(0.3, 1.0, length(e))) * o.w')}
  rChoc = max(rChoc, k * (1.0 - 0.5 * smoothstep(0.0, 6.0 * o.z, aval)));
  rCol = max(rCol, (1.0 - smoothstep(0.55, 1.0, length(d / (o.z * 0.75)))) * o.w);
}
rEcume = max(rEcume, rF * smoothstep(0.05, 0.5, rChoc));
rEcume = max(rEcume, rCol * 0.8 * smoothstep(0.5, 0.8, jBruit(vec2(${F}.x * 14.0 - ${T} * 3.0, ${F}.y * 14.0)) + 0.15 * rCol));
rRadier = max(rRadier, rChoc);
rProfond = (1.0 - smoothstep(0.25, 1.0, rBord)) * (1.0 - 0.55 * rRadier);
${V('rN1', 'vec3', `${tex(`vec2(${F}.x * 0.55 - ${T} * 0.32, ${F}.y * 0.8)`)}.xyz * 2.0 - 1.0`)}
${V('rN2', 'vec3', `${tex(`vec2(${F}.x * 1.35 - ${T} * 0.6 + 0.37, ${F}.y * 1.6 + 0.21)`)}.xyz * 2.0 - 1.0`)}
rsN = vec4(normalize(vec3((rN1.xy + rN2.xy) * (0.5 + 0.8 * rRadier), 1.0)) * 0.5 + 0.5, 1.0);
`),
      '!TEXRD\\(bumpSampler,': 'rsBosse(bumpSampler,',
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr('surfaceAlbedo = mix(mix(vec3(0.07, 0.085, 0.06), vec3(0.015, 0.04, 0.03), rProfond), vec3(0.86, 0.9, 0.9), rEcume);'),
      [rugosite]: '$0\nroughness = mix(mix(roughness, 0.26, rRadier), 0.75, rEcume);\nmicroSurface = 1.0 - roughness;',
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `${V('rFr', 'float', fresnel(4))}
#ifdef SPECULARTERM
finalSpecularScaled *= 0.03 * (1.0 - 0.8 * rEcume);
#endif
#ifdef REFLECTION
finalRadianceScaled *= mix(0.05, 0.45, rFr) * (1.0 - 0.8 * rEcume);
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_FOG: tr(`
${V('rFresnel', 'float', fresnel(5))}
finalColor = vec4(mix(finalColor.rgb, vec3(${f(ciel.r)}, ${f(ciel.g)}, ${f(ciel.b)}), rFresnel * 0.35 * (1.0 - rEcume)), max(mix(mix(0.38, 0.85, rProfond), 1.0, rFresnel), rEcume * 0.9));`),
    },
  }
}

/** Le soleil qui danse au fond du ruisseau, seulement sous le fil de l'eau (pelouse du sol creusé). */
export function codeDesCaustiques(wgsl: boolean): { fragment: Record<string, string> } {
  const { V, tr, u, fin } = dialecte(wgsl)
  const [T, n] = [u('caustT'), JARDIN.ruisseau.niveau]
  return {
    fragment: {
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(`
${V('cP', 'vec3', fin('vPositionW'))}
${V('cFond', 'float', `(1.0 - smoothstep(${f(n - 0.05)}, ${f(n - 0.015)}, cP.y)) * smoothstep(-0.42, -0.36, cP.y)`)}
if (cFond > 0.0) {
  ${V('cQ', 'vec2', 'cP.xz * 2.6')}
  ${V('cA', 'float', `abs(sin(cQ.x + 1.3 * sin(cQ.y * 1.2 + ${T} * 0.9) + ${T} * 0.5))`)}
  ${V('cB', 'float', `abs(sin(cQ.y * 1.1 + 1.4 * sin(cQ.x * 1.5 - ${T} * 0.7) - ${T} * 0.4))`)}
  surfaceAlbedo *= 1.0 + 0.45 * pow(1.0 - min(cA, cB), 9.0) * cFond;
}`),
    },
  }
}

/** Une eau transparente : mélange alpha, sans le surplus d'opacité que Babylon donne aux reflets. */
function eau(m: PBRMaterial): PBRMaterial {
  m.transparencyMode = Material.MATERIAL_ALPHABLEND
  m.useRadianceOverAlpha = m.useSpecularOverAlpha = false
  return m
}

type Role = 'sol' | 'eau' | 'cascade' | 'granit' | 'bois' | 'garde'
const role = (matiere: string): Role =>
  (['Sol', 'Eau', 'Cascade', 'Granit', 'Bois'] as const).find((r) => matiere.startsWith(`Jardin_${r}`))?.toLowerCase() as Role ?? 'garde'

/** Monte le décor du jardin ; rend les porteurs d'ombre (sol, granit, bois, foyer de la lanterne). */
export async function monterJardin(scene: Scene, jour: number): Promise<Mesh[]> {
  const ciel = Color3.Lerp(lin('#0b1224'), lin('#5d746c'), jour)
  const vaguelettes = RawTexture.CreateRGBATexture(carteDeVaguelettes(128), 128, 128, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
  vaguelettes.wrapU = vaguelettes.wrapV = Texture.WRAP_ADDRESSMODE
  vaguelettes.level = 0.14

  // Le sol creusé : la pelouse du parc (Lambert, couleur seule), distincte de `pelouse` pour ses caustiques.
  const sol = matierePBR('jardin:sol', 'herbe', scene, { teinte: '#a0b377', gain: 1, couleurSeule: true })
  sol.environmentIntensity = 0
  sol.metallicF0Factor = 0
  greffer(sol, { nom: 'Caustiques', uniforms: [{ name: 'caustT', size: 1, type: 'float' }], lier: (ubo) => ubo.updateFloat('caustT', temps()), code: codeDesCaustiques })
  const granit = matierePBR('jardin:granit', 'roche', scene, { teinte: '#c4c6c2' })
  const bois = matierePBR('jardin:bois', 'parquet', scene, { teinte: '#6b4a34' })
  // Les lueurs : l'ambiance « dehors » et les lampadaires, la nuit.
  brancherLueurs([sol, granit, bois])

  // Presque noire, verte en profondeur : c'est le reflet qui fait l'eau, pas sa couleur.
  const etang = eau(matiere('jardin:eau', scene, '#16291d', 0.1))
  etang.metallic = 0.1
  etang.environmentIntensity = 0.45
  etang.bumpTexture = vaguelettes
  greffer(etang, { nom: 'Etang', uniforms: [{ name: 'etangT', size: 1, type: 'float' }], lier: (ubo) => ubo.updateFloat('etangT', temps()), code: (w) => codeDeLEtang(w, ciel) })

  const filets = RawTexture.CreateRGBATexture(carteDeFilets(64), 64, 64, scene, false, false, Texture.NEAREST_SAMPLINGMODE)
  filets.wrapU = filets.wrapV = Texture.WRAP_ADDRESSMODE
  const cascade = eau(matiere('jardin:cascade', scene, '#e8f2ee', 0.35))
  cascade.opacityTexture = filets
  cascade.alpha = 0.8
  cascade.emissiveColor = lin('#2c3634')
  cascade.disableDepthWrite = true
  cascade.backFaceCulling = false
  cascade.twoSidedLighting = true
  greffer(cascade, { nom: 'Cascade', uniforms: [{ name: 'cascT', size: 1, type: 'float' }], lier: (ubo) => ubo.updateFloat('cascT', temps()), code: codeDeLaCascade })

  // Les rochers posés dans le courant lèvent leur écume, comme souches et galets.
  const rochers = PARC.plantations.filter((p) => p.espece.startsWith('rocher') && distanceRuisseau(p.x, p.z) < 0).map((p): [number, number, number] => [p.x, p.z, p.rayon * 0.6])
  const obstacles = remous(rochers)
  const ruisseau = eau(matiere('jardin:ruisseau', scene, '#ffffff', 0.2))
  ruisseau.environmentIntensity = 0.45
  ruisseau.bumpTexture = vaguelettes
  greffer(ruisseau, {
    nom: 'Ruisseau',
    attributs: ['aEau'],
    uniforms: [{ name: 'ruisT', size: 1, type: 'float' }],
    lier: (ubo) => ubo.updateFloat('ruisT', temps()),
    code: (w) => codeDuRuisseau(w, obstacles, ciel),
  })

  VIVANTES.add('jardin:eau').add('jardin:cascade')
  scene.onBeforeRenderObservable.add(() => {
    const t = temps()
    vaguelettes.uOffset = t * 0.012
    vaguelettes.vOffset = t * 0.007
    filets.vOffset = t * 0.9
  })

  const r = rubanDuRuisseau()
  const ruban = new Mesh('jardin:ruisseau', scene)
  geometrie(r.position, r.uv, r.index).applyToMesh(ruban)
  ruban.setVerticesData('aEau', r.eau, false, 2)
  ruban.material = ruisseau
  ruban.receiveShadows = true
  const n = nappeDeLaCascade()
  const nappe = new Mesh('jardin:cascade', scene)
  geometrie(n.position, n.uv, n.index).applyToMesh(nappe)
  nappe.material = cascade

  const c = await glbPartage(scene, 'assets/jardin/jardin.glb')
  if (!c) return []
  const par: Partial<Record<Role, PBRMaterial>> = { sol, eau: etang, granit, bois }
  const lueur = c.materials.find((m) => m.name === 'Jardin_Lueur')
  // Le foyer ne brûle qu'au crépuscule et la nuit (éclat 1 du GLB, sans le facteur du belvédère).
  if (lueur instanceof PBRMaterial) lueur.emissiveIntensity = 1 - smoothstep(jour, 0.15, 0.6)
  const decor: Mesh[] = []
  // Une copie : `dispose` retire le maillage de `c.meshes` (le suivant serait sauté).
  for (const m of [...c.meshes]) {
    if (!(m instanceof Mesh) || !m.name.startsWith('Jardin_') || !m.material || m.getTotalVertices() === 0) continue
    const quoi = role(m.material.name)
    // La vieille nappe tirée au cordeau : remplacée par `nappe`.
    if (quoi === 'cascade') {
      m.dispose(false, false)
      continue
    }
    const p = m.getVerticesData(VertexBuffer.PositionKind)!
    if (quoi === 'sol' || quoi === 'eau') m.setVerticesData(VertexBuffer.UVKind, uvDuPlan(p, quoi === 'eau'), false, 2)
    if (quoi === 'sol') m.setVerticesData(VertexBuffer.ColorKind, couleursDeBerge(p), false, 4)
    if (quoi === 'granit' || quoi === 'bois') m.setVerticesData(VertexBuffer.UVKind, uvBoite(p, m.getVerticesData(VertexBuffer.NormalKind)!), false, 2)
    m.material = par[quoi] ?? m.material
    decor.push(m)
  }
  const fusionnes = fusionnerParMatiere(decor)
  for (const m of fusionnes) m.receiveShadows = true
  return fusionnes.filter((m) => m.material !== etang)
}
