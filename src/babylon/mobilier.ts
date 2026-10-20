/**
 * Le mobilier (`plan/mobilier.ts`, MobilierLayer.tsx de three) : banquettes,
 * bancs, banque d'accueil (`mobilier.glb`) ; cordon, chaise, extincteurs, abri à
 * vélos, caisses de Versailles, panneau et fontaine (`accessoires.glb`) ; les
 * lampadaires du parc (`lampadaire.glb`). Les kentias et figuiers lyres sont à
 * props.ts, seul propriétaire de `plantes.glb`.
 *
 * Un lot de thin instances par primitive (`instancier` de lots.ts), posé comme
 * la cuisson : les ombres cuites des bancs tombent sous les bancs. Un fichier
 * qui manque n'emporte pas les autres.
 *
 * Le globe des lampadaires s'allume avec eux, une fois au montage (jour figé,
 * comme eclairage.ts) : matière gelable, rien dans VIVANTES. Le chêne des bancs
 * Batlló prend le fil d'une lame du parquet (plugin `ChenBatllo`).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { glbOuRien } from './glb.ts'
import { instancier, matrices, posesDuMobilier } from './lots.ts'
import { lueursDuJour } from './lueurs.ts'
import { chargerCartes } from './matieres.ts'

/** La force du globe : 1,5 × LAMPES.x de three (la force des lampadaires × la nuit). */
export const forceDuGlobe = (jour: number): number => 1.5 * lueursDuJour(jour).facade

/**
 * Le fil du chêne Batlló (`sculpterChene` de three), GLSL ou WGSL : une lame de
 * WoodFloor007 (0,75 × 0,19 m, repliée en miroir) projetée sur trois plans en
 * espace OBJET (avant la matrice d'instance), albédo × g^1,4, rugosité qui suit le fil.
 */
export function codeDuChene(wgsl: boolean): { vertex: Record<string, string>; fragment: Record<string, string> } {
  const [V2, V3, F] = wgsl ? ['vec2f', 'vec3f', 'f32'] : ['vec2', 'vec3', 'float']
  const V = (n: string, t: string, e: string) => (wgsl ? `var ${n}: ${t} = ${e};` : `${t} ${n} = ${e};`)
  const entree = (n: string) => (wgsl ? `fragmentInputs.${n}` : n)
  const echantillon = wgsl
    ? 'toLinearSpaceVec3(textureSampleGrad(chenGrain, chenGrainSampler, uv, dpdx(q) * d, dpdy(q) * d).rgb)'
    : 'toLinearSpace(textureGrad(chenGrain, uv, dFdx(q) * d, dFdy(q) * d).rgb)'
  const varyings = wgsl ? 'varying vBoisPos: vec3f;\nvarying vBoisNrm: vec3f;' : 'varying vec3 vBoisPos;\nvarying vec3 vBoisNrm;'
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: varyings,
      CUSTOM_VERTEX_MAIN_END: wgsl
        ? 'vertexOutputs.vBoisPos = positionUpdated;\nvertexOutputs.vBoisNrm = normalUpdated;'
        : 'vBoisPos = positionUpdated;\nvBoisNrm = normalUpdated;',
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: `${varyings}
${wgsl ? 'var chenGrainSampler: sampler;\nvar chenGrain: texture_2d<f32>;\nvar<private> boisG: f32;' : 'uniform sampler2D chenGrain;\nfloat boisG;'}
${wgsl ? `fn fil(q: ${V2}) -> ${F} {` : `${F} fil(${V2} q) {`}
  ${V('s', V2, `q / ${V2}(0.75, 0.19)`)}
  ${V('f', V2, 'abs(fract(s * 0.5) * 2.0 - 1.0)')}
  ${V('uv', V2, `${V2}(0.012 + 0.225 * f.x, (1.1 + 0.8 * f.y) / 16.0)`)}
  ${V('d', V2, `${V2}(0.3, ${(0.05 / 0.19).toFixed(6)})`)}
  ${V('t', V3, echantillon)}
  return dot(t, ${V3}(0.2126, 0.7152, 0.0722)) / 0.152;
}`,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `{
  ${V('n', V3, `pow(abs(normalize(${entree('vBoisNrm')})), ${V3}(4.0))`)}
  n /= n.x + n.y + n.z;
  ${V('p', V3, entree('vBoisPos'))}
  boisG = fil(p.xz) * n.y + fil(p.yx) * n.z + fil(p.yz) * n.x;
  surfaceAlbedo *= pow(boisG, 1.4);
}`,
      [wgsl ? '!var roughness: f32=reflectivityOut\\.roughness;' : '!float roughness=reflectivityOut\\.roughness;']:
        '$0\nroughness *= mix(1.15, 0.85, clamp(boisG - 0.5, 0.0, 1.0));\nmicroSurface = 1.0 - roughness;',
    },
  }
}

class ChenBatllo extends MaterialPluginBase {
  readonly grain: Texture
  constructor(m: Material, grain: Texture) {
    // Inscrit une fois la carte posée (modèle de Parement). Le define est indispensable : sans lui, le
    // define principal du plugin saute au plugin suivant (Lueurs) et l'effet d'une autre matière est repris tel quel.
    super(m, 'ChenBatllo', 210, { CHEN_BATLLO: true }, false)
    this.grain = grain
    this._pluginManager._addPlugin(this)
    this._enable(true)
  }

  override getClassName(): string {
    return 'ChenBatllo'
  }

  override isCompatible(langue: ShaderLanguage): boolean {
    return langue === ShaderLanguage.GLSL || langue === ShaderLanguage.WGSL
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('chenGrain')
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.setTexture('chenGrain', this.grain)
  }

  override getCustomCode(type: string, langue?: ShaderLanguage): { [point: string]: string } | null {
    const c = codeDuChene(langue === ShaderLanguage.WGSL)
    return type === 'fragment' ? c.fragment : type === 'vertex' ? c.vertex : null
  }
}

/** Monte le mobilier ; rend les porteurs d'ombre (tout sauf le verre de l'abri). */
export async function monterMobilier(scene: Scene, jour: number): Promise<Mesh[]> {
  const buffers = matrices(posesDuMobilier().filter((p) => p.piece !== 'Kentia' && p.piece !== 'Lyrata'))
  // Sans les cartes du parquet, le banc Batlló garde son aplat miel.
  const [mobilier, accessoires, lampadaire, parquet] = await Promise.all([
    glbOuRien(scene, 'assets/architecture/mobilier.glb'),
    glbOuRien(scene, 'assets/architecture/accessoires.glb'),
    glbOuRien(scene, 'assets/architecture/lampadaire.glb'),
    chargerCartes(scene, 'parquet').catch(() => null),
  ])
  const chene = mobilier?.materials.find((m) => m.name === 'Mobilier_ChenBatllo')
  if (chene instanceof PBRMaterial && parquet) {
    // Déjà linéaire (setRGB de three).
    chene.albedoColor = new Color3(0.3, 0.165, 0.068)
    chene.roughness = 0.52
    new ChenBatllo(chene, parquet.couleur)
  }
  const globe = lampadaire?.materials.find((m) => m.name === 'Lampadaire_Globe')
  if (globe instanceof PBRMaterial) globe.emissiveIntensity = forceDuGlobe(jour)
  return [mobilier, accessoires, lampadaire].flatMap((c) => (c ? instancier(c, buffers) : []))
}
