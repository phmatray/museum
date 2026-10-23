/**
 * Les reflets (RefletsLayer de three) : ce que le laiton, le métal, le verre et
 * le marbre poli ont à refléter, `scene.environmentTexture`.
 *
 * - Une SONDE par salle (centre, 2 m au-dessus du plancher), une pour la nef
 *   (centre du hall, à 3 m) et une pour le CIEL (le dôme seul ; sans dôme, le
 *   fond de l'heure). Captures linéaires en demi-flottant : ni rendu des tons
 *   ni gamma dedans (la passe d'écran s'en charge).
 * - Rendues UNE PAR IMAGE, en file : au montage, à `rafraichir()` (tout
 *   arrivé) et quand le soleil a tourné d'environ une heure. Pas de passe à
 *   +9 s comme three : `rafraichir()` la remplace, et elle tombait en pleine
 *   marche (seize images de 500 à 1 000 appels) quand tout était arrivé avant. Une sonde
 *   de salle voit le ciel dans les métaux (la sonde du ciel sert d'environnement
 *   le temps de sa capture), toute la scène (lots décompactés, `toutMontrer`,
 *   recompactés après la sixième face : `retrier`) restreinte aux zones que sa
 *   salle voit (`zonesVisibles`), et chaque face ne dessine que ce qui est dans son champ.
 * - L'environnement de la scène est UNE texture fixe (les matières sont figées :
 *   ni la texture ni `environmentIntensity` ne seraient republiées) : un cube
 *   procédural qui recopie la sonde du lieu, mêlée à la voisine sur le seuil
 *   d'une porte (`melangeDeReflets`), l'intensité cuite dedans (0,6 dehors,
 *   0,8 dedans, 25 % la nuit). Refait seulement quand ce mélange change.
 *
 * Le spéculaire seul, comme three : un polynôme sphérique nul tient lieu
 * d'irradiance, le diffus ambiant reste l'hémisphérique et la lumière cuite.
 * En VR, les captures en file attendent la fin de la session (celle en cours
 * s'achève) ; le fondu entre sondes continue (texture procédurale de la scène).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { ProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/proceduralTexture'
import type { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import { Plane } from '@babylonjs/core/Maths/math.plane'
import { SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe'
import type { Scene } from '@babylonjs/core/scene'

import { melangeDeReflets } from '../domain/ombres.ts'
import type { Plan } from '../plan/types.ts'
import { NEF, zonesDuVolume, zonesVisibles } from '../plan/visibilite.ts'
import type { Walker } from '../plan/walk.ts'

import { auCiel, partie, vivant } from './etat.ts'
import { retrier, toutMontrer } from './visibilite.ts'

/** Côté d'une face : les reflets sont flous, 128 suffit. */
const TAILLE = 128
/** Le mip par rugosité, celui des cubes préfiltrés de Babylon (une cible de rendu part à 0 : un miroir). */
const LOD = 0.8
/** L'intensité des reflets, dehors et dedans, et la part qui en reste la nuit. */
const INTENSITE = { ciel: 0.6, dedans: 0.8, nuit: 0.25 }

/** Le centre de chaque salle à 2 m du plancher, la nef à 3 m au-dessus du hall ; les balcons n'en ont pas. */
export function sondes(plan: Plan): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>()
  for (const l of plan.levels)
    for (const r of l.rooms) {
      const [x, z] = [r.x + r.width / 2, r.z + r.depth / 2]
      if (r.kind === 'hall') out.set('nef', [x, 3, z])
      else if (r.kind !== 'balcony') out.set(`${l.id}:${r.id}`, [x, l.elevation + 2, z])
    }
  return out
}

/**
 * Les poids de la sonde et de sa voisine dans l'environnement (intensité
 * cuite) : three dessine `mix(a, b, part) × intensité`, avec une intensité
 * mêlée de même et 25 % la nuit. `aEgalB` : une seule carte (la voisine pas
 * encore prise), la part ne compte plus.
 */
export function intensiteDesReflets(m: { sonde: string; voisine: string; part: number }, aEgalB: boolean, jour: number): [number, number] {
  const i = (k: string) => (k === 'ciel' ? INTENSITE.ciel : INTENSITE.dedans)
  const p = aEgalB ? 0 : m.part
  const total = (i(m.sonde) * (1 - p) + i(m.voisine) * p) * (INTENSITE.nuit + (1 - INTENSITE.nuit) * jour)
  return [(1 - p) * total, p * total]
}

/** Recopie texel à texel de deux cubes de même taille, pondérés : face et position → direction (convention GL). */
const MELANGE_GLSL = `precision highp float;
varying vec2 vPosition;
uniform float face;
uniform float ka;
uniform float kb;
uniform samplerCube a;
uniform samplerCube b;
vec3 direction(vec2 p) {
  if (face < 0.5) return vec3(1., -p.y, -p.x);
  if (face < 1.5) return vec3(-1., -p.y, p.x);
  if (face < 2.5) return vec3(p.x, 1., p.y);
  if (face < 3.5) return vec3(p.x, -1., -p.y);
  if (face < 4.5) return vec3(p.x, -p.y, 1.);
  return vec3(-p.x, -p.y, -1.);
}
void main(void) {
  vec3 d = direction(vPosition);
  gl_FragColor = vec4(textureCube(a, d).rgb * ka + textureCube(b, d).rgb * kb, 1.);
}`
const MELANGE_WGSL = `varying vPosition: vec2f;
uniform face: f32;
uniform ka: f32;
uniform kb: f32;
var aSampler: sampler;
var a: texture_cube<f32>;
var bSampler: sampler;
var b: texture_cube<f32>;
fn direction(p: vec2f, f: f32) -> vec3f {
  if (f < 0.5) { return vec3f(1., -p.y, -p.x); }
  if (f < 1.5) { return vec3f(-1., -p.y, p.x); }
  if (f < 2.5) { return vec3f(p.x, 1., p.y); }
  if (f < 3.5) { return vec3f(p.x, -1., -p.y); }
  if (f < 4.5) { return vec3f(p.x, -p.y, 1.); }
  return vec3f(-p.x, -p.y, -1.);
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = direction(fragmentInputs.vPosition, uniforms.face);
  fragmentOutputs.color = vec4f(textureSampleLevel(a, aSampler, d, 0.).rgb * uniforms.ka + textureSampleLevel(b, bSampler, d, 0.).rgb * uniforms.kb, 1.);
}`

/** Le spéculaire seul : l'irradiance tirée du polynôme sphérique, ici nul. */
function sansIrradiance(t: { getInternalTexture(): { _sphericalPolynomial: SphericalPolynomial | null; _sphericalPolynomialComputed: boolean } | null }): void {
  const i = t.getInternalTexture()
  if (!i) return
  i._sphericalPolynomial = new SphericalPolynomial()
  i._sphericalPolynomialComputed = true
}

export function monterReflets(
  scene: Scene,
  plan: Plan,
  visiteur: () => Walker,
  ciel: { dome: AbstractMesh; charge(): boolean } | null,
): { rafraichir(): void; prises(): Promise<void>; nombre: number; restantes(): number } {
  const positions = sondes(plan)
  const toutes = ['ciel', ...positions.keys()]
  const niveaux = new Map(plan.levels.map((l) => [l.id, l]))
  const plans = Array.from({ length: 6 }, () => new Plane(0, 0, 0, 0))

  const probes = new Map<string, ReflectionProbe>()
  for (const cle of toutes) {
    const p = new ReflectionProbe(`reflets-${cle}`, TAILLE, scene, true, true, true)
    p.refreshRate = 0 // RENDER_ONCE : seulement quand la file la place dans `customRenderTargets`
    p.renderList!.length = 0
    const pos = positions.get(cle)
    if (pos) p.position.set(...pos)
    sansIrradiance(p.cubeTexture)
    p.cubeTexture.lodGenerationScale = LOD
    // Chaque face ne dessine que son champ (une renderList explicite n'a pas de frustum culling) ;
    // la matrice de la face est posée juste avant (onBeforeRenderObservable de la sonde).
    p.cubeTexture.getCustomRenderList = (_f, liste, n) => {
      Frustum.GetPlanesToRef(scene.getTransformMatrix(), plans)
      const out: AbstractMesh[] = []
      for (let i = 0; i < n; i++) if (liste![i].alwaysSelectAsActiveMesh || liste![i].isInFrustum(plans)) out.push(liste![i])
      return out
    }
    probes.set(cle, p)
  }
  const cielProbe = probes.get('ciel')!

  // L'environnement unique : la sonde du lieu (et sa voisine), intensité cuite.
  const wgsl = scene.getEngine().isWebGPU
  const env = new ProceduralTexture(
    'reflets',
    TAILLE,
    { fragmentSource: wgsl ? MELANGE_WGSL : MELANGE_GLSL },
    scene,
    { shaderLanguage: wgsl ? ShaderLanguage.WGSL : ShaderLanguage.GLSL },
    true,
    true,
    cielProbe.cubeTexture.textureType,
  )
  env.refreshRate = 0
  env.autoClear = false
  // Les réglages d'un cube de sonde (main droite : REFLECTIONMAP_OPPOSITEZ), sinon le reflet est retourné.
  env.coordinatesMode = Constants.TEXTURE_INVCUBIC_MODE
  env.invertZ = cielProbe.cubeTexture.invertZ
  env.gammaSpace = false
  // La rugosité choisit le mip (0 sur une cible de rendu : tout serait un miroir, les globes nets dans le terrazzo).
  env.lodGenerationScale = LOD
  env.setFloat('ka', 0).setFloat('kb', 0)
  env.setTexture('a', cielProbe.cubeTexture).setTexture('b', cielProbe.cubeTexture)
  sansIrradiance(env)
  scene.environmentTexture = env
  scene.environmentIntensity = 1

  // Une sonde de salle voit le ciel dans les métaux, jamais sa propre carte périmée : le temps de la capture,
  // l'environnement prête sa texture interne à celle du ciel. Pas `scene.environmentTexture = …` : ce
  // setter salit toutes les matières de la scène (gelées comprises), deux fois par capture.
  const interne = env as unknown as { _texture: unknown }
  let garde: unknown = null
  for (const [cle, p] of probes) {
    p.cubeTexture.onBeforeBindObservable.add(() => {
      if (cle === 'ciel') return
      garde = interne._texture
      interne._texture = cielProbe.cubeTexture.getInternalTexture()
      toutMontrer() // le `sansTri` de three : tous les lots retrouvent leurs instances le temps des six faces…
    })
    p.cubeTexture.onAfterUnbindObservable.add(() => {
      rendue = true
      if (cle === 'ciel') return
      interne._texture = garde
      retrier() // … et les reperdent avant que la caméra ne dessine l'image
    })
  }

  let file: string[] = []
  const reprendre = () => (file = [...new Set([...file, ...toutes])])
  let epoque = ''
  auCiel((c) => {
    // Environ une heure de soleil : 8° d'élévation, ou un sixième du jour qui tombe.
    const e = `${Math.round(c.elevation / 8)}:${Math.round(c.jour * 6)}`
    if (e !== epoque) file = [...toutes]
    epoque = e
  })

  /** Ce que la sonde `cle` dessine : le dôme pour le ciel ; pour une salle, ce qui touche une zone qu'elle voit. */
  const aDessiner = (cle: string): AbstractMesh[] => {
    if (cle === 'ciel') return ciel ? [ciel.dome] : []
    const [x, , z] = positions.get(cle)!
    const vues = zonesVisibles(plan, [cle === 'nef' ? NEF : cle.slice(cle.indexOf(':') + 1)], { x, z })
    return scene.meshes.filter((m) => {
      const zone = m.metadata?.zone as string | undefined
      if (zone === 'ciel') return true
      if (zone) return vues.has(zone)
      if (m.getTotalVertices() === 0) return false
      const b = m.getBoundingInfo().boundingBox
      return zonesDuVolume(plan, b.minimumWorld, b.maximumWorld).some((v) => vues.has(v))
    })
  }

  const prises = new Set<string>()
  let enCours: [string, RenderTargetTexture] | null = null
  let rendue = false
  let version = 0
  let dernier: unknown[] = []
  let pose: [string, string, number, number, number] = ['', '', 0, 0, -1]
  // Ceux qui attendent que la file se vide (l'écran de chargement, par main.ts).
  const attentes: (() => void)[] = []
  scene.onBeforeRenderObservable.add(() => {
    // La capture de l'image d'avant : faite (même partielle, la file la reprendra), on la retire.
    if (enCours && rendue) {
      scene.customRenderTargets.splice(scene.customRenderTargets.indexOf(enCours[1]), 1)
      prises.add(enCours[0])
      version++
      enCours = null
    }
    if (file.length === 0 && enCours === null) attentes.splice(0).forEach((f) => f())
    const cle = enCours || partie.getState().enVR ? undefined : file.shift()
    if (cle !== undefined) {
      if (cle === 'ciel' && ciel && !ciel.charge()) file.push(cle) // le ciel n'est pas encore chargé : plus tard
      else {
        const p = probes.get(cle)!
        p.renderList!.splice(0, Infinity, ...aDessiner(cle))
        p.cubeTexture.resetRefreshCounter()
        scene.customRenderTargets.push(p.cubeTexture)
        enCours = [cle, p.cubeTexture]
        rendue = false
      }
    }

    // Près d'une porte, les deux sondes se mêlent selon la place, pas selon l'horloge : rien à refaire
    // tant que le visiteur, le jour et les captures n'ont pas bougé.
    const v = visiteur()
    const jour = vivant.getState().ciel.jour
    if (v.x === dernier[0] && v.z === dernier[1] && v.level === dernier[2] && v.surface === dernier[3] && jour === dernier[4] && version === dernier[5]) return
    dernier = [v.x, v.z, v.level, v.surface, jour, version]
    const m = melangeDeReflets(niveaux.get(v.level), v.x, v.z, v.surface)
    const a = prises.has(m.sonde) ? m.sonde : 'ciel'
    const b = prises.has(m.voisine) ? m.voisine : a
    if (!prises.has(a)) return
    const [ka, kb] = intensiteDesReflets(m, a === b, jour)
    if (a === pose[0] && b === pose[1] && Math.abs(ka - pose[2]) < 5e-4 && Math.abs(kb - pose[3]) < 5e-4 && version === pose[4]) return
    pose = [a, b, ka, kb, version]
    env.setTexture('a', probes.get(a)!.cubeTexture).setTexture('b', probes.get(b)!.cubeTexture)
    env.setFloat('ka', ka).setFloat('kb', kb)
    env.resetRefreshCounter()
  })

  /** `prises()` : résolue à la première image où toutes les sondes demandées sont prises. */
  return {
    rafraichir: reprendre,
    prises: () => new Promise<void>((r) => attentes.push(r)),
    // L'avancée des captures, pour l'écran de chargement : toutes les sondes, et celles encore en file ou en cours.
    nombre: toutes.length,
    restantes: () => file.length + (enCours ? 1 : 0),
  }
}
