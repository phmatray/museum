/**
 * Le ciel du musée (Ciel.tsx) : une sphère lointaine. Le jour est physique (la table du ciel de
 * l'Atmosphere de Babylon, `monterAtmosphere`, sous le vrai soleil : bleu à midi, doré puis rose
 * au lever et au coucher, crépuscule après) ; la photo de jour (kloofendal) n'y prête que ses
 * nuages, éclairés par ce soleil ; la nuit reste la photo étoilée (rogland). Puis il se couvre,
 * se voile d'air et de brume, s'allume à l'éclair. `?ciel=photo` (ou un moteur sans WebGL2 ni
 * WebGPU) rend l'ancien ciel : la photo de jour fondue dans celle de nuit, l'horizon doré au crépuscule.
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
import { Atmosphere } from '@babylonjs/addons/atmosphere/atmosphere'
// L'addon lit le regard de la caméra par un rayon (getForwardRayToRef) : l'effet de bord de Ray d'abord.
import '@babylonjs/core/Culling/ray'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { UnregisterMaterialPlugin } from '@babylonjs/core/Materials/materialPluginManager'
import type { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'

import { directionDuSoleil, type Ciel } from '../domain/soleil.ts'
import { auCiel, recherche, vivant, VIVANTES } from './etat.ts'
import { dialecte } from './greffe.ts'
import { AIR, METEO } from './intemperies.ts'

const PHOTOS = { jour: 'assets/ciel/kloofendal_48d_partly_cloudy_puresky.jpg', nuit: 'assets/ciel/rogland_clear_night.jpg' }
/** À combien de degrés de l'horizon on va chercher la photo de l'autre ciel (≈ 1 h avant le crépuscule). */
const VEILLE = 12

/**
 * Le fragment de Ciel.tsx, une fois, dans les deux langues (exporté pour les tests). `physique` : le jour
 * vient de la table du ciel de l'Atmosphere de Babylon (`cielLut`, sa paramétrisation de `sampleSkyViewLut`),
 * les nuages de la photo du jour, éclairés par le soleil qui a traversé l'air (`teinte`) et par ce ciel ;
 * la nuit reste la photo étoilée, ajoutée sous le crépuscule physique.
 */
export function codeDuCiel(wgsl: boolean, physique = false): { sommets: string; fragments: string } {
  const { V, u, tr, fn } = dialecte(wgsl)
  const tex = (n: string, uv = 'uv') => (wgsl ? `textureSampleLevel(${n}, ${n}Sampler, ${uv}, 0.0).rgb` : `texture2D(${n}, ${uv}).rgb`)
  const uniformes: [string, string][] = [
    ['jour', 'float'], ['crepuscule', 'float'], ['nuages', 'float'], ['brume', 'float'], ['eclair', 'float'],
    ['brumeCouleur', 'vec3'], ['air', 'vec4'], ['airSoleil', 'vec4'], ['airLueur', 'vec3'],
    ...(physique ? ([['horizon', 'float'], ['teinte', 'vec3']] as [string, string][]) : []),
  ]
  const T = (t: string) => (wgsl ? (t === 'float' ? 'f32' : `${t}f`) : t)
  const decl = uniformes.map(([n, t]) => (wgsl ? `uniform ${n}: ${T(t)};` : `uniform ${t} ${n};`)).join('\n')
  const noms = ['jourTex', 'nuitTex', ...(physique ? ['cielLut'] : [])]
  const textures = noms.map((n) => (wgsl ? `var ${n}Sampler: sampler;\nvar ${n}: texture_2d<f32>;` : `uniform sampler2D ${n};`)).join('\n')
  // atmosphere.ts : la couleur de l'air dans la direction d, qui s'allume face au soleil.
  const airCouleur = fn('airCouleur', [['d', 'vec3']], 'vec3', `
  ${V('face', 'float', `max(dot(d, ${u('airSoleil')}.xyz), 0.0)`)}
  return ${u('air')}.rgb + ${u('airLueur')} * ${u('airSoleil')}.w * (0.25 * face * face + pow(face, 12.0));`)
  // sampleSkyViewLut (atmosphereFunctions de l'addon), l'œil au sol : le zénith est +y, `horizon` le cosinus
  // de l'horizon depuis le zénith, l'azimut compté depuis celui du soleil ; table de 128², demi-texel de bord.
  const cielPhysique = tr(fn('cielPhysique', [['d', 'vec3']], 'vec3', `
  ${V('h', 'float', u('horizon'))}
  ${V('azimut', 'float', `dot(normalize(d.xz + vec2(1e-5, 0.0)), normalize(${u('airSoleil')}.xz + vec2(1e-5, 0.0)))`)}
  ${V('haut', 'float', '0.5 * sqrt(max(0.0, (d.y - h) / (1.0 - h))) + 0.5')}
  ${V('bas', 'float', '0.5 * sqrt(max(0.0, (d.y + 1.0) / (h + 1.0)))')}
  ${V('l', 'vec2', 'vec2(0.5 - 0.5 * azimut, mix(haut, bas, step(0.95 * d.y, h))) * (127.0 / 128.0) + 0.5 / 128.0')}
  return ${tex('cielLut', 'l')};`))
  const jour = physique
    ? `
  ${V('photo', 'vec3', tex('jourTex'))}
  ${V('pMax', 'float', 'max(photo.r, max(photo.g, photo.b))')}
  // Le nuage de la photo : ce qui n'est pas bleu (peu saturé), au-dessus de l'horizon.
  ${V('nuage', 'float', `(1.0 - smoothstep(0.1, 0.35, (pMax - min(photo.r, min(photo.g, photo.b))) / max(pMax, 1e-3))) * smoothstep(0.0, 0.06, d.y) * smoothstep(0.1, 0.6, ${u('jour')})`)}
  ${V('physique', 'vec3', 'cielPhysique(d)')}
  // Les étoiles seulement une fois le ciel physique éteint (sinon elles perceraient l'aube).
  ${V('c', 'vec3', `physique + ${tex('nuitTex')} * (1.0 - smoothstep(0.0, 0.5, ${u('jour')}))`)}
  // Éclairé par le soleil qui a traversé l'air, et par ce ciel.
  // Bas sur l'horizon, le soleil rougit mais le nuage, éclairé par-dessous, reste vif : sa teinte, à peine assombrie.
  ${V('soleilNuage', 'vec3', `mix(vec3(dot(${u('teinte')}, vec3(0.3, 0.59, 0.11))), ${u('teinte')}, 0.7) / max(max(${u('teinte')}.r, max(${u('teinte')}.g, ${u('teinte')}.b)), 0.4)`)}
  // Jamais plus sombre que le ciel derrière : le bord bleu du masque ne fait pas de liseré noir.
  c = mix(c, max(dot(photo, vec3(0.3, 0.59, 0.11)) * (soleilNuage + 0.5 * physique), physique), nuage);`
    : `
  ${V('c', 'vec3', `mix(${tex('nuitTex')}, ${tex('jourTex')}, ${u('jour')})`)}
  c *= mix(vec3(1.0), vec3(1.25, 0.72, 0.45), ${u('crepuscule')} * 0.75 * (1.0 - smoothstep(0.0, 0.6, abs(d.y))));`
  const corps = tr(`
  ${V('d', 'vec3', wgsl ? 'normalize(fragmentInputs.vDir)' : 'normalize(vDir)')}
  ${V('uv', 'vec2', `vec2(${wgsl ? 'atan2' : 'atan'}(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5)`)}${jour}
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
${physique ? cielPhysique : ''}
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
${physique ? cielPhysique : ''}
void main(void) {${corps}
  gl_FragColor = vec4(c, 1.0);
}`,
  }
}

for (const wgsl of [false, true])
  for (const physique of [false, true]) {
    const { sommets, fragments } = codeDuCiel(wgsl, physique)
    const store = wgsl ? ShaderStore.ShadersStoreWGSL : ShaderStore.ShadersStore
    const nom = physique ? 'cielPhysique' : 'ciel'
    store[`${nom}VertexShader`] = sommets
    store[`${nom}FragmentShader`] = fragments
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
  // Le ciel physique par défaut ; `?ciel=photo` rend l'ancien (la photo du jour fondue dans celle de la nuit).
  const atmo = new URLSearchParams(recherche()).get('ciel') !== 'photo' ? monterAtmosphere(scene) : null
  const dome = CreateSphere('ciel', { diameter: 2, segments: 24 }, scene)
  dome.scaling.setAll(800)
  dome.alwaysSelectAsActiveMesh = true
  dome.isPickable = false
  dome.metadata = { zone: 'ciel' }
  dome.setEnabled(false)

  const m = new ShaderMaterial('ciel', scene, atmo ? 'cielPhysique' : 'ciel', {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'jour', 'crepuscule', 'nuages', 'brume', 'eclair', 'brumeCouleur', 'air', 'airSoleil', 'airLueur', 'horizon', 'teinte'],
    samplers: ['jourTex', 'nuitTex', 'cielLut'],
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
    if (atmo) {
      m.setTexture('cielLut', atmo.lut)
      m.setFloat('horizon', atmo.horizon())
      m.setColor3('teinte', atmo.teinte())
    }
  })
  // Physique : la sonde du ciel attend aussi la première table.
  return { dome, charge: () => (dome.isEnabled() || enRoute.size === 0) && (!atmo || atmo.prete()) }
}

/** L'éclat du ciel physique (le soleil vaut 1 dans l'addon) : son zénith de midi rejoint celui de la photo. */
const EXPOSITION = 8

/**
 * L'Atmosphere de Babylon (@babylonjs/addons), réduite à ses tables : ni compositeur plein écran (groupes −1),
 * ni perspective aérienne, ni irradiance, ni greffe sur les PBR (désinscrite aussitôt : elle prendrait la
 * couleur de light0 et l'ambiante de toutes les matières). Son astre est une lumière éteinte qui suit le vrai
 * soleil, même couché (le crépuscule) ; la lune et l'éclairage de la scène restent à soleil.ts.
 * La table du ciel (128², exposition comprise) n'est redessinée que quand le soleil bouge (`auCiel`, 30 s) ou que
 * l'exposition change : redessinée à chaque image, elle doublait le temps d'image (5 → 10,8 ms à l'arrivée, WebGL2).
 */
function monterAtmosphere(scene: Scene): { lut: RenderTargetTexture; horizon(): number; teinte(): Color3; prete(): boolean } | null {
  if (!Atmosphere.IsSupported(scene.getEngine())) return null
  const astre = new DirectionalLight('astre', new Vector3(0, -1, 0), scene)
  astre.setEnabled(false)
  const atmo = new Atmosphere('atmosphere', scene, [astre], {
    exposure: EXPOSITION,
    isLinearSpaceLight: true,
    isLinearSpaceComposition: true,
    isAerialPerspectiveLutEnabled: false,
    isDiffuseSkyIrradianceLutEnabled: false,
    skyRenderingGroup: -1,
    aerialPerspectiveRenderingGroup: -1,
    globeAtmosphereRenderingGroup: -1,
  })
  UnregisterMaterialPlugin((atmo as unknown as { _materialPluginName: string })._materialPluginName)
  const t = new Color3()
  const haut = { x: 0, y: 1, z: 0 }
  // Les images où la table doit encore être dessinée (deux : la première peut tomber avant les tables globales).
  let aDessiner = 2
  auCiel((c) => {
    astre.direction.copyFromFloats(...(directionDuSoleil(c).map((v) => -v) as [number, number, number]))
    aDessiner = 2
  })
  scene.onBeforeRenderObservable.add(() => atmo.setEnabled(aDessiner > 0))
  atmo.onAfterRenderLutsForCameraObservable.add(() => {
    if (atmo.isEnabled() && atmo.isReady()) aDessiner--
  })
  // Relu à chaque image (la table de transmittance arrive après le montage).
  const transmis = () => {
    atmo.getTransmittedColorToRef(astre.direction.negate(), atmo.physicalProperties.planetRadius + 0.002, haut, t)
    // L'œil s'accommode : soleil bas, le ciel physique (dix fois plus sombre qu'à midi) est relevé,
    // sinon il serait sombre au-dessus d'un jardin que soleil.ts éclaire encore (jusqu'à ×4).
    const e = EXPOSITION / Math.max(0.25, t.toLuminance())
    if (Math.abs(e - atmo.exposure) > 1e-3 * e) {
      atmo.exposure = e
      aDessiner = 2
    }
    return t
  }
  return {
    lut: atmo.skyViewLutRenderTarget!,
    horizon: () => atmo.cameraAtmosphereVariables.cosCameraHorizonAngleFromZenith,
    // Le soleil vu du sol à travers l'air (blanc à midi, orangé au couchant, éteint sous l'horizon).
    teinte: transmis,
    prete: () => atmo.isReady(),
  }
}
