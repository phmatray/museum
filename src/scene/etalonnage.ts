/**
 * L'étalonnage de l'image, à l'heure qu'il est (`domain/atmosphere.ts`) :
 * lift / gamma / gain, contraste et saturation, sur l'image déjà passée par
 * le rendu des tons. Un effet de `postprocessing` fusionné dans la même passe
 * que le rendu des tons et la vignette : pas une passe de plus, quelques
 * opérations par pixel.
 *
 * Paramétrique plutôt qu'une LUT : quatre moments fondus le long du jour
 * donnent une infinité d'étalonnages sans texture 3D à charger ni à mélanger.
 *
 * Les uniformes sont réglés par `AtmosphereLayer`, une fois par image.
 */
import * as THREE from 'three'
import { Effect, GodRaysEffect, KernelSize } from 'postprocessing'

export const ETALONNAGE = {
  uLift: new THREE.Uniform(new THREE.Vector3(0, 0, 0)),
  uGamma: new THREE.Uniform(new THREE.Vector3(1, 1, 1)),
  uGain: new THREE.Uniform(new THREE.Vector3(1, 1, 1)),
  uSaturation: new THREE.Uniform(1),
  uContraste: new THREE.Uniform(1),
}

const FRAGMENT = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSaturation;
uniform float uContraste;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
  c = uGain * c + uLift * (1.0 - c);
  c = pow(max(c, 0.0), 1.0 / uGamma);
  // Le contraste en courbe perceptive (racine), pivot au gris moyen : il ne brûle rien.
  vec3 s = sqrt(c);
  s = clamp((s - 0.46) * uContraste + 0.46, 0.0, 1.0);
  c = s * s;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  outputColor = vec4(max(mix(vec3(l), c, uSaturation), 0.0), inputColor.a);
}
`

export class EtalonnageEffect extends Effect {
  constructor() {
    super('EtalonnageEffect', FRAGMENT, { uniforms: new Map<string, THREE.Uniform>(Object.entries(ETALONNAGE)) })
  }
}

/**
 * Le soleil que suivent les rayons à travers les arbres : un disque hors de la
 * scène (les rayons le dessinent à part, masqué par la profondeur de la
 * scène — les feuilles, les troncs, les murs l'arrêtent ; le verre non).
 * `AtmosphereLayer` le pose dans la direction du soleil et règle sa couleur
 * (noire : pas de rayons), et sa force dans `userData.force`.
 */
export const SOLEIL_DES_RAYONS = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 8), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, toneMapped: false }))
SOLEIL_DES_RAYONS.frustumCulled = false
SOLEIL_DES_RAYONS.userData.force = 0

/** Ce que les rayons touchent de `GodRaysEffect`, que ses types ne publient pas. */
interface Rayons {
  renderTargetLight: THREE.WebGLRenderTarget
  resolution: { width: number; height: number }
  setSize(w: number, h: number): void
  update(gl: THREE.WebGLRenderer, entree: THREE.WebGLRenderTarget, dt?: number): void
}

/**
 * Les rayons de soleil en espace écran (la diffusion radiale de
 * `postprocessing`), à demi-résolution — au quart sous `?qualite=basse`, avec
 * moitié moins d'échantillons. Deux économies sur l'effet tel que livré :
 * son tampon de lumière suit la résolution réduite (il était plein écran), et
 * rien ne se calcule tant que le soleil ne peut pas rayonner (nuit, ciel
 * couvert, brouillard) — l'effet reste monté, aucun programme ne change.
 */
export function creerRayons(camera: THREE.Camera, basse: boolean): GodRaysEffect {
  const effet = new GodRaysEffect(camera, SOLEIL_DES_RAYONS, {
    resolutionScale: basse ? 0.25 : 0.5,
    samples: basse ? 30 : 60,
    density: 0.97,
    decay: 0.94,
    weight: 0.45,
    exposure: 0.55,
    clampMax: 1,
    blur: true,
    kernelSize: KernelSize.SMALL,
  })
  const r = effet as unknown as Rayons
  const taille = r.setSize.bind(r)
  r.setSize = (w, h) => {
    taille(w, h)
    r.renderTargetLight.setSize(r.resolution.width, r.resolution.height)
  }
  const maj = r.update.bind(r)
  r.update = (gl, entree, dt) => {
    const actif = (SOLEIL_DES_RAYONS.userData.force as number) > 0.005
    effet.blendMode.opacity.value = actif ? 1 : 0
    if (actif) maj(gl, entree, dt)
  }
  return effet
}
