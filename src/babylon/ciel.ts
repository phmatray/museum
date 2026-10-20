/**
 * Le ciel du musée (Ciel.tsx) : une sphère lointaine qui fond la photo de jour
 * (kloofendal, nuageux) dans celle de nuit (rogland, étoilée), dore l'horizon au
 * lever et au coucher, se couvre, se voile d'air et de brume, s'allume à l'éclair.
 *
 * Sortie LINÉAIRE HDR : le rendu des tons et l'étalonnage passent dessus
 * (postTraitement.ts). Chaque photo n'est chargée que quand elle peut servir
 * (soleil à moins de VEILLE degrés de son côté de l'horizon) ; tant que celle
 * qui pèse manque, ou pour toujours si elle est absente (gitignorée,
 * tools/fetch-assets.ts), la sphère est éteinte et l'aplat de soleil.ts fait le
 * fond. Pas de mipmaps : au raccord de l'atan (−π/π), le GPU prendrait le plus
 * petit niveau sur une colonne de pixels (ligne pointillée).
 */
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import type { Ciel } from '../domain/soleil.ts'
import { auCiel, vivant, VIVANTES } from './etat.ts'
import { dialecte } from './greffe.ts'
import { AIR, METEO } from './intemperies.ts'

const PHOTOS = { jour: 'assets/ciel/kloofendal_48d_partly_cloudy_puresky.jpg', nuit: 'assets/ciel/rogland_clear_night.jpg' }
/** À combien de degrés de l'horizon on va chercher la photo de l'autre ciel (≈ 1 h avant le crépuscule). */
const VEILLE = 12

/** Le fragment de Ciel.tsx, une fois, dans les deux langues (exporté pour les tests). */
export function codeDuCiel(wgsl: boolean): { sommets: string; fragments: string } {
  const { V, u, tr, fn } = dialecte(wgsl)
  const tex = (n: string) => (wgsl ? `textureSampleLevel(${n}, ${n}Sampler, uv, 0.0).rgb` : `texture2D(${n}, uv).rgb`)
  const uniformes: [string, string][] = [
    ['jour', 'float'], ['crepuscule', 'float'], ['nuages', 'float'], ['brume', 'float'], ['eclair', 'float'],
    ['brumeCouleur', 'vec3'], ['air', 'vec4'], ['airSoleil', 'vec4'], ['airLueur', 'vec3'],
  ]
  const T = (t: string) => (wgsl ? (t === 'float' ? 'f32' : `${t}f`) : t)
  const decl = uniformes.map(([n, t]) => (wgsl ? `uniform ${n}: ${T(t)};` : `uniform ${t} ${n};`)).join('\n')
  const textures = wgsl
    ? 'var jourTexSampler: sampler;\nvar jourTex: texture_2d<f32>;\nvar nuitTexSampler: sampler;\nvar nuitTex: texture_2d<f32>;'
    : 'uniform sampler2D jourTex;\nuniform sampler2D nuitTex;'
  // atmosphere.ts : la couleur de l'air dans la direction d, qui s'allume face au soleil.
  const airCouleur = fn('airCouleur', [['d', 'vec3']], 'vec3', `
  ${V('face', 'float', `max(dot(d, ${u('airSoleil')}.xyz), 0.0)`)}
  return ${u('air')}.rgb + ${u('airLueur')} * ${u('airSoleil')}.w * (0.25 * face * face + pow(face, 12.0));`)
  const corps = tr(`
  ${V('d', 'vec3', wgsl ? 'normalize(fragmentInputs.vDir)' : 'normalize(vDir)')}
  ${V('uv', 'vec2', `vec2(${wgsl ? 'atan2' : 'atan'}(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5)`)}
  ${V('c', 'vec3', `mix(${tex('nuitTex')}, ${tex('jourTex')}, ${u('jour')})`)}
  c *= mix(vec3(1.0), vec3(1.25, 0.72, 0.45), ${u('crepuscule')} * 0.75 * (1.0 - smoothstep(0.0, 0.6, abs(d.y))));
  ${V('l', 'float', 'dot(c, vec3(0.3, 0.59, 0.11))')}
  ${V('couvert', 'vec3', `${u('brumeCouleur')} * (0.8 + 0.2 * smoothstep(0.3, 1.0, l / max(0.1, ${u('jour')})) + 0.08 * d.y)`)}
  c = mix(c, couvert, ${u('nuages')} * 0.95);
  ${V('airHorizon', 'float', `(1.0 - smoothstep(-0.05, 0.3, d.y)) * clamp(${u('air')}.w * 140.0, 0.0, 0.8)`)}
  c = mix(c, airCouleur(d), airHorizon);
  c += ${u('airLueur')} * ${u('airSoleil')}.w * 0.35 * pow(max(dot(d, ${u('airSoleil')}.xyz), 0.0), 24.0) * ${u('jour')};
  c = mix(c, ${u('brumeCouleur')}, ${u('brume')} * (1.0 - 0.55 * smoothstep(0.0, 0.7, d.y)));
  c += ${u('eclair')} * vec3(0.75, 0.8, 1.0);`)
  if (wgsl)
    return {
      sommets: `attribute position: vec3f;
uniform worldViewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vDir = normalize(vertexInputs.position);
  vertexOutputs.position = uniforms.worldViewProjection * vec4f(vertexInputs.position, 1.0);
}`,
      fragments: `varying vDir: vec3f;
${decl}
${textures}
${tr(airCouleur)}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {${corps}
  fragmentOutputs.color = vec4f(c, 1.0);
}`,
    }
  return {
    sommets: `precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main(void) {
  vDir = normalize(position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`,
    fragments: `precision highp float;
varying vec3 vDir;
${decl}
${textures}
${airCouleur}
void main(void) {${corps}
  gl_FragColor = vec4(c, 1.0);
}`,
  }
}

for (const wgsl of [false, true]) {
  const { sommets, fragments } = codeDuCiel(wgsl)
  const store = wgsl ? ShaderStore.ShadersStoreWGSL : ShaderStore.ShadersStore
  store.cielVertexShader = sommets
  store.cielFragmentShader = fragments
}

/** La photo qui pèse est-elle là ? (le jour pèse `jour`, la nuit `1 − jour`) */
export const photoUtile = (jour: number, a: { jour: boolean; nuit: boolean }): boolean => (jour <= 0 || a.jour) && (jour >= 1 || a.nuit)

/**
 * Monte la sphère (rayon 800, centrée à l'origine comme celle de three : pas
 * d'infiniteDistance, le ciel garde sa parallaxe ; en deçà du plan lointain 1000), éteinte jusqu'à
 * la photo utile ; uniformes posés à chaque image depuis `vivant`, METEO et AIR.
 * `charge()` : la photo utile est là, ou plus rien n'est en route (photo absente : fond uni) — pour la sonde
 * de reflets du dehors, qui sinon attendrait sans fin (et l'écran de chargement avec elle).
 */
export function monterCiel(scene: Scene): { dome: Mesh; charge(): boolean } {
  const dome = CreateSphere('ciel', { diameter: 2, segments: 24 }, scene)
  dome.scaling.setAll(800)
  dome.alwaysSelectAsActiveMesh = true
  dome.isPickable = false
  dome.metadata = { zone: 'ciel' }
  dome.setEnabled(false)

  const m = new ShaderMaterial('ciel', scene, 'ciel', {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'jour', 'crepuscule', 'nuages', 'brume', 'eclair', 'brumeCouleur', 'air', 'airSoleil', 'airLueur'],
    samplers: ['jourTex', 'nuitTex'],
    shaderLanguage: scene.getEngine().isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
  })
  // Vue de l'intérieur ; ni profondeur ni prepass : derrière tout, et « ciel » pour les rayons.
  m.backFaceCulling = false
  m.disableDepthWrite = true
  dome.material = m
  VIVANTES.add('ciel')

  const photos: { jour?: Texture; nuit?: Texture } = {}
  const voulues = new Set<keyof typeof photos>()
  // Les photos en route (un Set : Babylon peut signaler deux fois l'échec d'une même photo).
  const enRoute = new Set<keyof typeof photos>()
  const allumer = (c: Ciel) => {
    const la = photos.jour ?? photos.nuit
    if (!la) return
    // L'absente ne pèse rien : la présente tient sa place dans l'échantillonneur.
    m.setTexture('jourTex', photos.jour ?? la)
    m.setTexture('nuitTex', photos.nuit ?? la)
    dome.setEnabled(photoUtile(c.jour, { jour: !!photos.jour, nuit: !!photos.nuit }))
  }
  const charger = (k: keyof typeof photos) => {
    if (voulues.has(k)) return
    voulues.add(k)
    enRoute.add(k)
    const t: Texture = new Texture(`${import.meta.env.BASE_URL}${PHOTOS[k]}`, scene, {
      noMipmap: true,
      samplingMode: Texture.BILINEAR_SAMPLINGMODE,
      useSRGBBuffer: true,
      onLoad: () => {
        enRoute.delete(k)
        photos[k] = t
        allumer(vivant.getState().ciel)
      },
      onError: (erreur) => {
        enRoute.delete(k)
        console.warn('ciel indisponible, fond uni', erreur)
        t.dispose()
      },
    })
    t.wrapV = Texture.CLAMP_ADDRESSMODE
  }
  auCiel((c) => {
    if (c.elevation > -VEILLE) charger('jour')
    if (c.elevation < VEILLE) charger('nuit')
    allumer(c)
  })

  const air = new Vector4()
  const soleil = new Vector4()
  const lueur = new Vector3()
  scene.onBeforeRenderObservable.add(() => {
    if (!dome.isEnabled()) return
    const { jour, crepuscule } = vivant.getState().ciel
    const a = AIR.air
    m.setFloat('jour', jour)
    m.setFloat('crepuscule', crepuscule)
    m.setFloat('nuages', METEO.nuages)
    m.setFloat('brume', METEO.brume)
    m.setFloat('eclair', METEO.eclair)
    m.setColor3('brumeCouleur', METEO.brumeCouleur)
    m.setVector4('air', air.set(a.couleur[0], a.couleur[1], a.couleur[2], a.densite))
    m.setVector4('airSoleil', soleil.set(AIR.soleil[0], AIR.soleil[1], AIR.soleil[2], a.diffusion))
    m.setVector3('airLueur', lueur.set(a.lueur[0], a.lueur[1], a.lueur[2]))
  })
  return { dome, charge: () => dome.isEnabled() || enRoute.size === 0 }
}
