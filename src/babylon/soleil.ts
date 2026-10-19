/**
 * Le soleil réel (ou la lune) : DirectionalLight, ambiance hémisphérique, fond
 * du ciel et carte d'ombre dessinée à la demande.
 *
 * Mêmes valeurs que three (Ciel.tsx, lighting.ts), couleurs en linéaire, pour
 * des matières PBR Lambert (boites.ts) : le soleil y vaut albedo/π × éclairement
 * comme dans three ; l'hémisphérique, elle, n'y passe pas par le BRDF
 * (albedo × éclairement), on la divise donc par π. La météo est hors tranche : pas de voile.
 */
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { Light } from '@babylonjs/core/Lights/light'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator'
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent'
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { cadrerOmbre } from '../domain/ombres.ts'
import { directionDuSoleil, type Ciel } from '../domain/soleil.ts'

export interface Reglages {
  /** Sens de PROPAGATION (= −directionDuSoleil), la lune quand le soleil est couché. */
  direction: [number, number, number]
  couleur: string
  intensite: number
  /** L'hémisphérique : ciel, sol, intensité. */
  ciel: string
  sol: string
  ambiant: number
  /** clearColor. */
  fond: string
}

// Ciel.tsx et lighting.ts : SOLEIL, LUNE, OR_BAS, AMBIANCE, AMBIANCE_NUIT.
const SOLEIL = { couleur: '#fff3e0', intensite: 3.4 }
const LUNE = { couleur: '#a9bcff', intensite: 0.35 }
const OR_BAS = '#ffb070'
const AMBIANCE = { ciel: '#dbe6f5', nuit: '#8a7358', sol: '#dcd8d0', jour: 1.9, minuit: 1.1 }
const FOND = { nuit: '#0b1224', jour: '#dbe6f5' }

/**
 * La boîte d'ombre de Ciel.tsx : ±`demi` m vu du soleil, centrée `avance` m
 * devant le visiteur et recalée par pas de `pas` m, la lumière reculée de
 * `recul` le long du rayon. 4096 texels : 2,7 cm par texel.
 */
const OMBRE = { demi: 55, carte: 4096, avance: 25, recul: 150, pas: 3 }

/** Mélange deux couleurs hex en espace linéaire, comme `THREE.Color.lerp`. */
const melange = (a: string, b: string, t: number) =>
  Color3.Lerp(Color3.FromHexString(a).toLinearSpace(), Color3.FromHexString(b).toLinearSpace(), t).toGammaSpace().toHexString()

export function reglagesDuCiel(c: Ciel): Reglages {
  // La nuit, une lune fixe à 35° prend le relais, à l'opposé du soleil.
  const d = c.elevation > 0 ? directionDuSoleil(c) : directionDuSoleil({ elevation: 35, azimut: (c.azimut + 180) % 360 })
  return {
    direction: [-d[0], -d[1], -d[2]],
    couleur: melange(LUNE.couleur, melange(SOLEIL.couleur, OR_BAS, c.crepuscule), c.jour),
    intensite: SOLEIL.intensite * c.jour + LUNE.intensite * (1 - c.jour),
    ciel: melange(AMBIANCE.nuit, AMBIANCE.ciel, c.jour),
    sol: AMBIANCE.sol,
    ambiant: (AMBIANCE.minuit + (AMBIANCE.jour - AMBIANCE.minuit) * c.jour) / Math.PI,
    fond: melange(FOND.nuit, FOND.jour, c.jour),
  }
}

/**
 * Pose le soleil, l'hémisphérique et le fond. Avec `ombres`, la carte n'est
 * dessinée qu'à la demande (RENDER_ONCE) : quand la boîte, qui suit la caméra
 * active, glisse d'un pas, ou quand la direction du soleil change. Les
 * porteurs s'ajoutent par `generateur.addShadowCaster` (main.ts).
 */
export function monterSoleil(scene: Scene, c: Ciel, ombres: boolean): { hemi: HemisphericLight; generateur: ShadowGenerator | null } {
  const r = reglagesDuCiel(c)
  const soleil = new DirectionalLight('soleil', new Vector3(...r.direction), scene)
  soleil.diffuse = Color3.FromHexString(r.couleur).toLinearSpace()
  soleil.specular = Color3.Black()
  soleil.intensity = r.intensite

  const hemi = new HemisphericLight('ciel', new Vector3(0, 1, 0), scene)
  hemi.diffuse = Color3.FromHexString(r.ciel).toLinearSpace()
  hemi.groundColor = Color3.FromHexString(r.sol).toLinearSpace()
  hemi.specular = Color3.Black()
  hemi.intensity = r.ambiant
  // Sur une surface cuite, la lightmap (qui porte f × cette hémisphérique, boites.ts) la remplace ; le soleil reste en temps réel.
  hemi.lightmapMode = Light.LIGHTMAP_SHADOWSONLY

  scene.clearColor = Color4.FromHexString(r.fond + 'ff')
  if (!ombres) return { hemi, generateur: null }

  soleil.autoUpdateExtends = false
  soleil.orthoLeft = soleil.orthoBottom = -OMBRE.demi
  soleil.orthoRight = soleil.orthoTop = OMBRE.demi
  soleil.shadowMinZ = 1
  soleil.shadowMaxZ = 2 * OMBRE.recul
  const generateur = new ShadowGenerator(OMBRE.carte, soleil)
  generateur.usePercentageCloserFiltering = true
  generateur.filteringQuality = ShadowGenerator.QUALITY_MEDIUM
  generateur.bias = 5e-4
  generateur.normalBias = 0.02
  const carte = generateur.getShadowMap()!
  carte.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE

  let cle = ''
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera
    if (!cam) return
    // Le point `avance` m devant le visiteur, à l'horizontale, arrondi au pas.
    const avant = cam.getDirection(Vector3.Forward(scene.useRightHandedSystem))
    const h = Math.hypot(avant.x, avant.z) || 1
    const p = [cam.position.x + (avant.x / h) * OMBRE.avance, cam.position.y, cam.position.z + (avant.z / h) * OMBRE.avance]
      .map((v) => Math.round(v / OMBRE.pas) * OMBRE.pas) as [number, number, number]
    const l = soleil.direction
    const nouvelle = `${p.join()}|${l.x},${l.y},${l.z}`
    if (nouvelle === cle) return
    cle = nouvelle
    // Recalée au texel près vue du soleil, sans quoi chaque pas ferait scintiller le bord des ombres.
    const [x, y, z] = cadrerOmbre(p, [-l.x, -l.y, -l.z], (2 * OMBRE.demi) / OMBRE.carte)
    soleil.position.set(x - l.x * OMBRE.recul, y - l.y * OMBRE.recul, z - l.z * OMBRE.recul)
    carte.resetRefreshCounter()
  })
  return { hemi, generateur }
}
