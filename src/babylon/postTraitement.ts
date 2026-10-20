/**
 * Le post-traitement (PostProcessing.tsx) : la scène rendue en HDR linéaire,
 * puis, dans cet ordre (l'ordre de création fait l'ordre de la chaîne) :
 *
 *   AO        SSAO2 sur la profondeur et les normales du prepass (aucun rendu
 *             de scène de plus), rayon 1,8 m — N8AO de three
 *   Bloom     seuil 1 en linéaire, avant la courbe (les toiles blanches culminent à 0,95 : elles ne luisent pas)
 *   Tons      Khronos PBR Neutral, exposition 1,15 (socle.ts) : l'image processing
 *             quitte les matières pour cette passe (applyByPostProcess), les
 *             mélanges additifs (fils des ateliers, halos) s'ajoutent avant la courbe
 *   Rayons    le soleil à travers les arbres, en écran, sur la profondeur du prepass
 *             (le ciel n'y écrit rien, le verre non plus) — pas de
 *             VolumetricLightScattering, qui redessine toute la scène
 *   Étalonnage la couleur de l'heure (etalonnage.ts), les rayons en SCREEN, puis la
 *             vignette après la courbe, en linéaire, et le sRGB exact en sortie
 *   FXAA      en dernier (pas de SMAA dans le cœur de Babylon, pas de MSAA : l'AO lit la profondeur)
 *
 * À monter juste après la caméra, avant toute matière (les defines d'image
 * processing en dépendent) et avant le gel final. Les valeurs vivantes
 * (étalonnage, soleil des rayons) sont relues à chaque image dans l'état
 * vivant et AIR (intemperies.ts). Aucune propriété structurelle des pipelines ne change
 * après coup (elle les rattacherait après les passes maison).
 * Écarts : pas de teinte froide de l'AO (#0f1319 de N8AO), pas de lissage
 * du seuil du bloom, pas de flou Kawase des rayons.
 */
import type { Camera } from '@babylonjs/core/Cameras/camera'
import { Constants } from '@babylonjs/core/Engines/constants'
// Le prepass rend dans plusieurs cibles à la fois (MRT) : extensions des deux moteurs, absentes du cœur importé.
import '@babylonjs/core/Engines/Extensions/engine.multiRender'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { FxaaPostProcess } from '@babylonjs/core/PostProcesses/fxaaPostProcess'
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent'
import '@babylonjs/core/Rendering/prePassRendererSceneComponent'
import type { Scene } from '@babylonjs/core/scene'

import { etalonnageDuCiel } from '../domain/atmosphere.ts'
import { vivant } from './etat.ts'
import { AIR } from './intemperies.ts'

/** postProcessingSettings.ts : bloom et vignette. */
const BLOOM = { seuil: 1, poids: 0.25 }
const VIGNETTE = { offset: 0.42, darkness: 0.3 }
/** Le soleil des rayons : une sphère de 9 m à 600 m (etalonnage.ts). */
const SOLEIL = { rayon: 9, distance: 600 }

/**
 * Le soleil à l'écran, en uv (y vers le haut, comme vUV), ou null derrière le
 * regard. `vue` : la matrice vue × projection de la caméra.
 */
export function soleilEcran(dir: readonly number[], cam: Vector3, avant: Vector3, vue: Matrix): [number, number] | null {
  if (dir[0] * avant.x + dir[1] * avant.y + dir[2] * avant.z <= 0) return null
  const d = SOLEIL.distance
  Vector3.TransformCoordinatesFromFloatsToRef(cam.x + dir[0] * d, cam.y + dir[1] * d, cam.z + dir[2] * d, vue, ECRAN)
  return [ECRAN.x * 0.5 + 0.5, ECRAN.y * 0.5 + 0.5]
}
const ECRAN = new Vector3()

const SRGB_GLSL = 'vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }'
const SRGB_WGSL = 'fn srgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c < vec3f(0.0031308)); }'

/** Les deux passes maison, GLSL et WGSL ; `n` échantillons de rayons. */
function shaders(n: number): void {
  ShaderStore.ShadersStore[`rayons${n}PixelShader`] = `
varying vec2 vUV;
uniform sampler2D profondeur;
uniform vec2 soleil;
uniform vec2 rayon;
uniform vec3 couleur;
uniform float force;
float lumiere(vec2 uv) {
  float z = texture2D(profondeur, uv).r;
  float ciel = float(z == 0.0 || abs(z) > 700.0);
  return ciel * (1.0 - smoothstep(0.8, 1.0, length((uv - soleil) / rayon)));
}
void main(void) {
  if (force <= 0.0) { gl_FragColor = vec4(0.0); return; }
  vec2 c = vUV;
  vec2 delta = (soleil - c) * (0.97 / ${n}.0);
  float dec = 1.0;
  float s = 0.0;
  for (int i = 0; i < ${n}; i++) { c += delta; s += lumiere(c) * dec * 0.45; dec *= 0.94; }
  gl_FragColor = vec4(clamp(couleur * force * s * 0.55, 0.0, 1.0), 1.0);
}`
  ShaderStore.ShadersStoreWGSL[`rayons${n}PixelShader`] = `
varying vUV: vec2f;
var profondeurSampler: sampler;
var profondeur: texture_2d<f32>;
uniform soleil: vec2f;
uniform rayon: vec2f;
uniform couleur: vec3f;
uniform force: f32;
fn lumiere(uv: vec2f) -> f32 {
  let z = textureSampleLevel(profondeur, profondeurSampler, uv, 0.0).r;
  let ciel = select(0.0, 1.0, z == 0.0 || abs(z) > 700.0);
  return ciel * (1.0 - smoothstep(0.8, 1.0, length((uv - uniforms.soleil) / uniforms.rayon)));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  if (uniforms.force <= 0.0) { fragmentOutputs.color = vec4f(0.0); return fragmentOutputs; }
  var c = input.vUV;
  let delta = (uniforms.soleil - c) * (0.97 / ${n}.0);
  var dec = 1.0;
  var s = 0.0;
  for (var i = 0; i < ${n}; i++) { c += delta; s += lumiere(c) * dec * 0.45; dec *= 0.94; }
  fragmentOutputs.color = vec4f(clamp(uniforms.couleur * uniforms.force * s * 0.55, vec3f(0.0), vec3f(1.0)), 1.0);
}`
}

// L'entrée est la sortie de l'image processing de Babylon (pow 1/2,2, saturée) : défaite par pow 2,2,
// l'étalonnage et la vignette se font en linéaire comme dans three, la sortie en sRGB exact.
ShaderStore.ShadersStore.etalonnagePixelShader = `
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D rayons;
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform float saturation;
uniform float contraste;
uniform float nuit;
${SRGB_GLSL}
void main(void) {
  vec3 brut = pow(texture2D(textureSampler, vUV).rgb, vec3(2.2));
  vec3 r = texture2D(rayons, vUV).rgb;
  brut = clamp(1.0 - (1.0 - brut) * (1.0 - r), 0.0, 1.0);
  vec3 c = gain * brut + lift * (1.0 - brut);
  c = pow(max(c, 0.0), 1.0 / gamma);
  vec3 s = sqrt(c);
  s = clamp((s - 0.46) * contraste + 0.46, 0.0, 1.0);
  c = s * s;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, saturation), 0.0);
  float source = nuit * smoothstep(0.12, 0.45, max(brut.r, max(brut.g, brut.b)));
  c = mix(c, max(c, brut), source);
  float d = distance(vUV, vec2(0.5));
  c *= smoothstep(0.8, ${VIGNETTE.offset} * 0.799, d * (${VIGNETTE.darkness} + ${VIGNETTE.offset}));
  gl_FragColor = vec4(srgb(c), 1.0);
}`
ShaderStore.ShadersStoreWGSL.etalonnagePixelShader = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var rayonsSampler: sampler;
var rayons: texture_2d<f32>;
uniform lift: vec3f;
uniform gamma: vec3f;
uniform gain: vec3f;
uniform saturation: f32;
uniform contraste: f32;
uniform nuit: f32;
${SRGB_WGSL}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var brut = pow(textureSample(textureSampler, textureSamplerSampler, input.vUV).rgb, vec3f(2.2));
  let r = textureSample(rayons, rayonsSampler, input.vUV).rgb;
  brut = clamp(1.0 - (1.0 - brut) * (1.0 - r), vec3f(0.0), vec3f(1.0));
  var c = uniforms.gain * brut + uniforms.lift * (1.0 - brut);
  c = pow(max(c, vec3f(0.0)), 1.0 / uniforms.gamma);
  var s = sqrt(c);
  s = clamp((s - 0.46) * uniforms.contraste + 0.46, vec3f(0.0), vec3f(1.0));
  c = s * s;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3f(l), c, uniforms.saturation), vec3f(0.0));
  let source = uniforms.nuit * smoothstep(0.12, 0.45, max(brut.r, max(brut.g, brut.b)));
  c = mix(c, max(c, brut), source);
  let d = distance(input.vUV, vec2f(0.5));
  c *= smoothstep(0.8, ${VIGNETTE.offset} * 0.799, d * (${VIGNETTE.darkness} + ${VIGNETTE.offset}));
  fragmentOutputs.color = vec4f(srgb(c), 1.0);
}`

export function monterPostTraitement(scene: Scene, camera: Camera, basse: boolean): void {
  const engine = scene.getEngine()
  const langue = engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL

  // 1) L'AO : demi-flottant, sinon l'HDR serait écrasé avant le bloom ; le prepass (pas de GeometryBufferRenderer : un rendu de scène de plus).
  const ao = new SSAO2RenderingPipeline('ao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false, Constants.TEXTURETYPE_HALF_FLOAT)
  ao.radius = 1.8
  // Mesuré contre three (salle d'honneur, 15 h, mur ouest jusqu'aux deux coins) : à 1,3 les profils suivent ceux de N8AO
  // à ±3 niveaux près (1,6 creuse trop un coin, pas assez l'autre) ; le sol au centre ne bouge pas d'un niveau.
  ao.totalStrength = 1.3
  ao.samples = basse ? 8 : 16
  ao.expensiveBlur = true
  ao.bilateralSamples = basse ? 8 : 16
  ao.maxZ = 100
  ao.base = 0

  // 2) Bloom et rendu des tons (scene.imageProcessingConfiguration : Neutral 1,15, sans la vignette de Babylon, qui passe avant la courbe).
  const rendu = new DefaultRenderingPipeline('rendu', true, scene, [camera])
  rendu.bloomEnabled = true
  // Babylon compare luma(couleur × exposition) à seuil^(1/2,2) : ce seuil-ci revient au 1 linéaire de three, avant l'exposition.
  rendu.bloomThreshold = (BLOOM.seuil * scene.imageProcessingConfiguration.exposure) ** 2.2
  rendu.bloomWeight = BLOOM.poids
  rendu.bloomKernel = 64
  rendu.bloomScale = 0.5
  rendu.imageProcessingEnabled = true
  rendu.fxaaEnabled = false

  // 3) Les rayons. Une passe dessine dans la texture d'ENTRÉE de la suivante, à la taille de celle-ci : le ratio des
  // rayons (1) est donc celui de l'image tone mappée qu'ils reçoivent, et leur demi-résolution (le quart en basse
  // qualité) est le ratio de l'étalonnage, qui la lit.
  const n = basse ? 30 : 60
  shaders(n)
  const rayons = new PostProcess('rayons', `rayons${n}`, ['soleil', 'rayon', 'couleur', 'force'], ['profondeur'], 1, camera,
    Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, undefined, false, undefined, langue)
  const vue = new Matrix()
  const avant = new Vector3()
  const devant = Vector3.Forward(scene.useRightHandedSystem)
  rayons.onApply = (e) => {
    const pre = scene.prePassRenderer
    const cible = pre?.getRenderTarget()
    if (cible) e.setTexture('profondeur', cible.textures[pre!.getIndex(Constants.PREPASS_DEPTH_TEXTURE_TYPE)])
    const f = AIR.rayons
    camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), vue)
    camera.getDirectionToRef(devant, avant)
    const ecran = f > 0.005 ? soleilEcran(AIR.soleil, camera.globalPosition, avant, vue) : null
    const c = AIR.air.lueur
    const y = (0.5 * (SOLEIL.rayon / SOLEIL.distance)) / Math.tan(camera.fov / 2)
    e.setFloat2('soleil', ecran?.[0] ?? 0, ecran?.[1] ?? 0)
    e.setFloat2('rayon', y / engine.getAspectRatio(camera), y)
    e.setFloat3('couleur', c[0], c[1], c[2])
    e.setFloat('force', ecran ? f : 0)
  }

  // 4) Étalonnage, rayons en SCREEN, vignette, sRGB. L'image est celle du rendu des tons, pas celle des rayons.
  const etalonnage = new PostProcess('etalonnage', 'etalonnage', ['lift', 'gamma', 'gain', 'saturation', 'contraste', 'nuit'], ['rayons'], basse ? 0.25 : 0.5, camera,
    Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, undefined, false, undefined, langue)
  etalonnage.externalTextureSamplerBinding = true
  // L'étalonnage ne change qu'avec le ciel (toutes les 30 s au plus) : recalculé seulement alors.
  let pour: unknown = null
  let t = etalonnageDuCiel(vivant.getState().ciel)
  etalonnage.onApply = (e) => {
    // Relu à chaque image : le pipeline recrée sa passe à chaque reconstruction.
    e.setTextureFromPostProcessOutput('textureSampler', rendu.imageProcessing)
    e.setTextureFromPostProcessOutput('rayons', rayons)
    const { ciel } = vivant.getState()
    if (ciel !== pour) [pour, t] = [ciel, etalonnageDuCiel(ciel)]
    e.setFloat3('lift', ...t.lift)
    e.setFloat3('gamma', ...t.gamma)
    e.setFloat3('gain', ...t.gain)
    e.setFloat('saturation', t.saturation)
    e.setFloat('contraste', t.contraste)
    e.setFloat('nuit', 1 - ciel.jour)
  }

  // 5) L'anticrénelage, sur l'image finie.
  new FxaaPostProcess('fxaa', 1, camera)
}
