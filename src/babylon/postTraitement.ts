/**
 * Le post-traitement (PostProcessing.tsx) : la scène rendue en HDR linéaire,
 * puis, dans cet ordre (l'ordre de création fait l'ordre de la chaîne) :
 *
 *   AO        SSAO2 sur la profondeur et les normales du prepass (aucun rendu
 *             de scène de plus), rayon 1,8 m — N8AO de three
 *   Miroir    reflets en espace écran (SSRRenderingPipeline) sur le terrazzo du
 *             hall et, plus doux, le parquet des galeries : le prepass n'écrit de
 *             réflectivité que pour eux (PM_MIROIR, parement.ts), le reste tombe sous
 *             le seuil et sort à la première ligne du shader. Une passe pleine image,
 *             sans flou (nets), sur le même prepass ; aucune en qualité basse
 *   Bloom     seuil 1 en linéaire, avant la courbe (les toiles blanches culminent à 0,95 : elles ne luisent pas)
 *   Tons      Khronos PBR Neutral, exposition 1,15 (socle.ts) : l'image processing
 *             quitte les matières pour cette passe (applyByPostProcess), les
 *             mélanges additifs (fils des ateliers, halos) s'ajoutent avant la courbe
 *   Rayons    le soleil à travers les arbres, en écran, sur la profondeur du prepass
 *             (le ciel n'y écrit rien, le verre non plus) — pas de
 *             VolumetricLightScattering, qui redessine toute la scène
 *   Étalonnage la couleur de l'heure (etalonnage.ts), les rayons en SCREEN, puis la
 *             vignette après la courbe, en linéaire, et le sRGB exact en sortie
 *   TAA       l'image finie accumulée sur 8 décalages sous-pixel (TAARenderingPipeline), caméra
 *             immobile, historique borné au voisinage 3 × 3 ; aucun en qualité basse
 *   FXAA      en dernier : l'anticrénelage de la marche (le TAA s'efface quand la caméra bouge) ;
 *             la VR a sa propre chaîne (vrRendu.ts), sans l'un ni l'autre
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
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine'
import { Constants } from '@babylonjs/core/Engines/constants'
// Le prepass rend dans plusieurs cibles à la fois (MRT) : extensions des deux moteurs, absentes du cœur importé.
import '@babylonjs/core/Engines/Extensions/engine.multiRender'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { Effect } from '@babylonjs/core/Materials/effect'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { FxaaPostProcess } from '@babylonjs/core/PostProcesses/fxaaPostProcess'
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline'
import { TAARenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/taaRenderingPipeline'
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline'
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent'
import '@babylonjs/core/Rendering/prePassRendererSceneComponent'
// Le bloc du prepass des PBR et le shader du miroir, chargés ici pour être recousus avant toute compilation (le magasin ne les écrase pas ensuite).
import '@babylonjs/core/Shaders/ShadersInclude/pbrBlockPrePass'
import '@babylonjs/core/ShadersWGSL/ShadersInclude/pbrBlockPrePass'
import '@babylonjs/core/Shaders/screenSpaceReflection2.fragment'
import '@babylonjs/core/ShadersWGSL/screenSpaceReflection2.fragment'
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

/**
 * La réflectivité du prepass (que lit le seul miroir) réservée aux sols qui
 * reflètent : une PBR avec PM_MIROIR y écrit (F0 × k, k), k = 1 (terrazzo du
 * hall) ou MIROIR_DOUX (PM_MIROIR_DOUX, parquet des galeries) ; les autres
 * (0, 0, 0, 1), sous le seuil. Le miroir prend l'alpha pour F90 de son Fresnel
 * (1 dans Babylon) : le parquet reflète alors k fois le terrazzo à tout angle,
 * pas seulement de face. GLSL et WGSL ; l'AO lit profondeur et normales, pas cette cible.
 */
export const MIROIR_DOUX = 0.3
const k = (x: number) => x.toFixed(2)
export function reserverLeMiroir(): void {
  for (const store of [ShaderStore.IncludesShadersStore, ShaderStore.IncludesShadersStoreWGSL]) {
    store.pbrBlockPrePass = store.pbrBlockPrePass.replace(/#ifdef PREPASS_REFLECTIVITY\n#ifndef UNLIT\n(.*)\n#else/, (_, ecrire: string) => {
      const avec = (x: number) => ecrire.replace('(specularEnvironmentR0,microSurface)', `(specularEnvironmentR0*${k(x)},${k(x)})`)
      return `#ifdef PREPASS_REFLECTIVITY\n#if !defined(UNLIT) && defined(PM_MIROIR)\n#ifdef PM_MIROIR_DOUX\n${avec(MIROIR_DOUX)}\n#else\n${avec(1)}\n#endif\n#else`
    })
  }
  const glsl = ShaderStore.ShadersStore
  glsl.screenSpaceReflection2PixelShader = glsl.screenSpaceReflection2PixelShader.replace('F0,vec3(1.))', 'F0,vec3(reflectivity.a))')
  const wgsl = ShaderStore.ShadersStoreWGSL
  wgsl.screenSpaceReflection2PixelShader = wgsl.screenSpaceReflection2PixelShader.replace('F0, vec3f(1.))', 'F0, vec3f(reflectivity.a))')
}
reserverLeMiroir()

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
// `vr` ('etalonnageVR', vrRendu.ts) : sans rayons, et la vignette de confort de SortieVR (VRLayer.tsx) par œil à la place de celle d'écran.
export function etalonnage(vr: boolean): void {
  const nom = vr ? 'etalonnageVRPixelShader' : 'etalonnagePixelShader'
  const vignette = `smoothstep(0.8, ${VIGNETTE.offset} * 0.799, distance(vUV, vec2(0.5)) * (${VIGNETTE.darkness} + ${VIGNETTE.offset}))`
  const confort = (u: string) => `(1.0 - ${u} * smoothstep(0.52 - 0.22 * ${u}, 0.62, length((vUV - 0.5) * vec2(1.0, 1.15))))`
  ShaderStore.ShadersStore[nom] = `
varying vec2 vUV;
uniform sampler2D textureSampler;
${vr ? 'uniform float confort;' : 'uniform sampler2D rayons;'}
uniform vec3 lift;
uniform vec3 gamma;
uniform vec3 gain;
uniform float saturation;
uniform float contraste;
uniform float nuit;
${SRGB_GLSL}
void main(void) {
  vec3 brut = pow(texture2D(textureSampler, vUV).rgb, vec3(2.2));
  ${vr ? '' : 'vec3 r = texture2D(rayons, vUV).rgb;\n  brut = clamp(1.0 - (1.0 - brut) * (1.0 - r), 0.0, 1.0);'}
  vec3 c = gain * brut + lift * (1.0 - brut);
  c = pow(max(c, 0.0), 1.0 / gamma);
  vec3 s = sqrt(c);
  s = clamp((s - 0.46) * contraste + 0.46, 0.0, 1.0);
  c = s * s;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, saturation), 0.0);
  float source = nuit * smoothstep(0.12, 0.45, max(brut.r, max(brut.g, brut.b)));
  c = mix(c, max(c, brut), source);
  c *= ${vr ? confort('confort') : vignette};
  gl_FragColor = vec4(srgb(c), 1.0);
}`
  ShaderStore.ShadersStoreWGSL[nom] = `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
${vr ? 'uniform confort: f32;' : 'var rayonsSampler: sampler;\nvar rayons: texture_2d<f32>;'}
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
  ${vr ? '' : 'let r = textureSample(rayons, rayonsSampler, input.vUV).rgb;\n  brut = clamp(1.0 - (1.0 - brut) * (1.0 - r), vec3f(0.0), vec3f(1.0));'}
  var c = uniforms.gain * brut + uniforms.lift * (1.0 - brut);
  c = pow(max(c, vec3f(0.0)), 1.0 / uniforms.gamma);
  var s = sqrt(c);
  s = clamp((s - 0.46) * uniforms.contraste + 0.46, vec3f(0.0), vec3f(1.0));
  c = s * s;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3f(l), c, uniforms.saturation), vec3f(0.0));
  let source = uniforms.nuit * smoothstep(0.12, 0.45, max(brut.r, max(brut.g, brut.b)));
  c = mix(c, max(c, brut), source);
  c *= ${(vr ? confort('uniforms.confort') : vignette).replaceAll('vec2(', 'vec2f(').replaceAll('vUV', 'input.vUV')};
  fragmentOutputs.color = vec4f(srgb(c), 1.0);
}`
}
etalonnage(false)

/** Les uniformes de l'étalonnage, lus dans le ciel vivant ; il ne change qu'avec le ciel (toutes les 30 s au plus) : recalculé seulement alors. */
export function appliquerEtalonnage(e: Effect): void {
  const { ciel } = vivant.getState()
  if (ciel !== pour) [pour, t] = [ciel, etalonnageDuCiel(ciel)]
  e.setFloat3('lift', ...t.lift)
  e.setFloat3('gamma', ...t.gamma)
  e.setFloat3('gain', ...t.gain)
  e.setFloat('saturation', t.saturation)
  e.setFloat('contraste', t.contraste)
  e.setFloat('nuit', 1 - ciel.jour)
}
let pour: unknown = null
let t = etalonnageDuCiel(vivant.getState().ciel)

// ponytail: `basse` (moins d'AO et de rayons) est lu au montage : la qualité choisie dans les réglages ne le change qu'au rechargement (la densité de pixels, elle, suit tout de suite, qualite.ts).
/** Le bloom et le rendu des tons, à l'écran comme dans chaque œil (vrRendu.ts). */
export function bloomEtTons(nom: string, scene: Scene, cameras: Camera[]): DefaultRenderingPipeline {
  const rendu = new DefaultRenderingPipeline(nom, true, scene, cameras)
  rendu.bloomEnabled = true
  // Babylon compare luma(couleur × exposition) à seuil^(1/2,2) : ce seuil-ci revient au 1 linéaire de three, avant l'exposition.
  rendu.bloomThreshold = (BLOOM.seuil * scene.imageProcessingConfiguration.exposure) ** 2.2
  rendu.bloomWeight = BLOOM.poids
  rendu.bloomKernel = 64
  rendu.bloomScale = 0.5
  rendu.imageProcessingEnabled = true
  rendu.fxaaEnabled = false
  return rendu
}

/** La langue des passes maison : WGSL sur WebGPU, GLSL sur WebGL2. */
export const langueDe = (engine: AbstractEngine): ShaderLanguage => (engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL)

export function monterPostTraitement(scene: Scene, camera: Camera, basse: boolean): void {
  const engine = scene.getEngine()
  const langue = langueDe(engine)

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

  // 2) Le miroir, sur l'HDR linéaire, avant le bloom. Terrazzo et parquet sont diélectriques (F0 0,04) : mélange de
  // Fresnel, net aux angles rasants ; seuil non nul (à 0, Babylon coupe le test et marche sur tout l'écran).
  // Sans flou, la passe rend l'image entière : pas de sous-échantillonnage, le coût se règle en pas et en portée.
  if (!basse) {
    const miroir = new SSRRenderingPipeline('miroir', scene, [camera], false, Constants.TEXTURETYPE_HALF_FLOAT)
    miroir.inputTextureColorIsInGammaSpace = false
    miroir.generateOutputInGammaSpace = false
    miroir.blurDispersionStrength = 0
    miroir.roughnessFactor = 0
    miroir.useFresnel = true
    miroir.reflectivityThreshold = 0.01
    // ponytail: pas de 3 px, 200 au plus (600 px de rayon), 40 m — à régler sur mesurer-rendu si la nef manque de fond.
    miroir.step = 3
    miroir.maxSteps = 200
    miroir.maxDistance = 40
    miroir.enableSmoothReflections = true
    // La profondeur du prepass est en demi-flottant sous WebGPU : sauter deux pas évite l'auto-intersection.
    miroir.selfCollisionNumSkip = 2
  }

  // 3) Bloom et rendu des tons (scene.imageProcessingConfiguration : Neutral 1,15, sans la vignette de Babylon, qui passe avant la courbe).
  const rendu = bloomEtTons('rendu', scene, [camera])

  // 4) Les rayons. Une passe dessine dans la texture d'ENTRÉE de la suivante, à la taille de celle-ci : le ratio des
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

  // 5) Étalonnage, rayons en SCREEN, vignette, sRGB. L'image est celle du rendu des tons, pas celle des rayons.
  const passeEtalonnage = new PostProcess('etalonnage', 'etalonnage', ['lift', 'gamma', 'gain', 'saturation', 'contraste', 'nuit'], ['rayons'], basse ? 0.25 : 0.5, camera,
    Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_UNSIGNED_BYTE, undefined, undefined, false, undefined, langue)
  passeEtalonnage.externalTextureSamplerBinding = true
  passeEtalonnage.onApply = (e) => {
    // Relu à chaque image : le pipeline recrée sa passe à chaque reconstruction.
    e.setTextureFromPostProcessOutput('textureSampler', rendu.imageProcessing)
    e.setTextureFromPostProcessOutput('rayons', rayons)
    appliquerEtalonnage(e)
  }

  // 6) L'anticrénelage, sur l'image finie (créé en dernier : la chaîne suit l'ordre de création). Le TAA de Babylon
  // décale la projection d'un sous-pixel par image et accumule 8 images, historique borné au voisinage 3 × 3 ; caméra
  // en marche, il s'efface (pas de traînée) et le FXAA qui le suit reprend la main. Pas de reprojection par la vitesse
  // du prepass : mesuré, l'historique s'y déchire (toiles noircies, pots en pavés), une partie des matières (greffes,
  // thin instances animées) n'y écrivant pas de vitesse juste. Les visiteurs et Bavette bougent caméra immobile :
  // le bornage limite leur traînée à un pixel. En qualité basse, ou sans texelFetch (WebGL 1), FXAA seul.
  if (!basse && engine.getCaps().texelFetch) {
    const taa = new TAARenderingPipeline('taa', scene, [camera])
    taa.samples = 8
    taa.clampHistory = true
  }
  new FxaaPostProcess('fxaa', 1, camera)
}
