/**
 * La végétation du parc (ParkLayer `Instances` + parkAssets.ts) : un lot de
 * thin instances par essence, par matière et, pour les érables et le lierre,
 * par côté du musée (nord, sud, ouest, est : chaque lot sa boîte, que le cône
 * de vue écarte d'un bloc).
 *
 * Sources : `src_*` de vegetation.glb, grands-arbres.glb et jardin.glb (fougère,
 * pétales, rochers ; partagé avec jardin.ts, on n'y jette que les `src_*`).
 * Chaque essence est fusionnée par matière dans le repère de son nœud, puis
 * calée pied à y = 0, centrée en x et z (`cale`) ; sa géométrie `loin_*` reçoit
 * la même cale. Matières CLONÉES par essence (Jardin_Feuillage sert à cinq
 * essences, chacune sa greffe), double face, découpe binaire (seuil 0,45 pour
 * les planches photo, 0,15 pour l'atlas de jardin.glb).
 *
 * LOD par sujet (comme three) : au-delà de 36 m un érable ou un grand arbre
 * passe à sa géométrie de loin, il ne revient qu'en deçà de 33 m. Deux maillages
 * par lot, matrices recompactées quand un sujet change de côté.
 *
 * La greffe `Vegetal-*` (intemperies.ts) : chute, rougeur et vent des érables
 * et du ginkgo (`aCarte`), nuance par sujet, azalées hors floraison, herbes
 * dans le vent qui blondissent, mousse des rochers. La saison est cuite dans le
 * code (constante pendant la visite), le vent à 2 m/s ; seul le temps passe par
 * l'UBO (`lier`), donc rien dans VIVANTES. Une variante = un nom = un define :
 * le cache d'effets de Babylon ne distingue deux codes que par leurs defines.
 * Les pétales n'ont pas de shader : hors floraison ils ne sont pas posés.
 *
 * ponytail : pas d'`intemperer` (pluie, neige) : neutre par temps clair, à
 * porter avec la vague météo. La carte d'ombre ne voit ni le vent ni la chute
 * (son propre shader) ni les bascules de LOD (redessinée à la demande).
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import { Constants } from '@babylonjs/core/Engines/constants'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { BoundingInfo } from '@babylonjs/core/Culling/boundingInfo'
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

import type { Saison } from '../domain/saisons.ts'
import type { EspeceParc, PlantPlacement } from '../plan/park.ts'
import type { Rect } from '../plan/types.ts'
import { glbOuRien, glbPartage } from './glb.ts'
import { dialecte, greffer } from './greffe.ts'
import { auLoin, cacherAuLoin, matrices } from './lots.ts'
import { MUR } from './enceinte.ts'
import { brancherLueurs, smoothstep } from './lueurs.ts'
import { ambiance, PARC } from './parc.ts'

const VEGETATION = 'assets/jardin/vegetation.glb'
const GRANDS = 'assets/jardin/grands-arbres.glb'
const JARDIN = 'assets/jardin/jardin.glb'

/** NOEUDS de parkAssets.ts : fichier, nœud proche, nœud de loin éventuel. */
const NOEUDS: Record<EspeceParc, [string, string, string?]> = {
  'erable-rouge': [VEGETATION, 'src_erable_rouge', 'loin_erable_rouge'],
  'erable-vert': [VEGETATION, 'src_erable_vert', 'loin_erable_vert'],
  buis: [VEGETATION, 'src_buis'],
  azalee: [VEGETATION, 'src_azalee'],
  lierre: [VEGETATION, 'src_lierre'],
  roseaux: [VEGETATION, 'src_roseaux'],
  herbes: [VEGETATION, 'src_herbes'],
  fougere: [JARDIN, 'src_fougere'],
  petales: [JARDIN, 'src_petales'],
  'rocher-1': [JARDIN, 'src_rocher_1'],
  'rocher-2': [JARDIN, 'src_rocher_2'],
  'rocher-3': [JARDIN, 'src_rocher_3'],
  'rocher-4': [JARDIN, 'src_rocher_4'],
  'rocher-5': [JARDIN, 'src_rocher_5'],
  cedre: [GRANDS, 'src_cedre', 'loin_cedre'],
  ginkgo: [GRANDS, 'src_ginkgo', 'loin_ginkgo'],
  pin: [GRANDS, 'src_pin', 'loin_pin'],
}

/** Plus loin, la géométrie de loin ; elle ne repart qu'en deçà de LOIN − 3. */
const LOIN = 36
export const estLoin = (d: number, avant: boolean): boolean => auLoin(d, avant, LOIN)
/**
 * Les petits sujets sans géométrie de loin ne sont plus dessinés au-delà de
 * leur portée (`cacherAuLoin`) : à 30 m, une fougère fait quelques pixels.
 * Écart voulu à three (qui les dessine tous) : le budget de triangles. Y
 * compris le lierre du pied du mur (40 m) et les pétales tombés (30 m).
 */
const PORTEE: Partial<Record<EspeceParc, number>> = { buis: 45, azalee: 45, roseaux: 45, lierre: 40, herbes: 30, fougere: 30, petales: 30 }

/** Le côté du musée d'un sujet (`parParcelle` de ParkLayer) : tiers nord et sud du terrain, puis moitiés ouest et est. */
export function cote(s: { x: number; z: number }, t: Rect): string {
  const [u, v] = [(s.x - t.x) / t.width, (s.z - t.z) / t.depth]
  return v < 1 / 3 ? 'nord' : v > 2 / 3 ? 'sud' : u < 0.5 ? 'ouest' : 'est'
}

/** Les sujets par essence, puis par côté pour les érables et le lierre (un seul groupe sinon). */
export function groupes(sujets: readonly PlantPlacement[], t: Rect): Map<EspeceParc, PlantPlacement[][]> {
  const par = new Map<EspeceParc, Map<string, PlantPlacement[]>>()
  for (const s of sujets) {
    const k = s.espece.startsWith('erable') || s.espece === 'lierre' ? cote(s, t) : ''
    const e = par.get(s.espece) ?? new Map<string, PlantPlacement[]>()
    par.set(s.espece, e.set(k, [...(e.get(k) ?? []), s]))
  }
  return new Map([...par].map(([e, m]) => [e, [...m.values()]]))
}

/** `echelle` de ParkLayer ; `k` multiplie tout (pétales hors saison). Buis et azalées s'étirent d'un aléa tiré de leur place. */
export function echelleDe(s: PlantPlacement, k = 1): [number, number, number] {
  const e = s.scale * k
  if (s.espece !== 'buis' && s.espece !== 'azalee') return [e, e, e]
  const h = (i: number) => Math.abs(Math.sin(s.x * (12.9898 + i) + s.z * (78.233 - i)) * 43758.5453) % 1
  return [e * (0.85 + 0.35 * h(1)), e * (0.75 + 0.5 * h(2)), e * (0.85 + 0.35 * h(3))]
}

/**
 * `cartesDeFeuillage` : chaque composante connexe de l'index est une carte ;
 * par sommet (centre de sa carte, aléa). L'aléa est tiré de la SOMME des
 * positions de la carte, comme three.
 */
export function cartesDeFeuillage(p: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const n = p.length / 3
  const parent = Array.from({ length: n }, (_, i) => i)
  const racine = (i: number): number => (parent[i] === i ? i : (parent[i] = racine(parent[i])))
  for (let k = 0; k < index.length; k += 3) {
    const [a, b, c] = [racine(index[k]), racine(index[k + 1]), racine(index[k + 2])]
    parent[b] = a
    parent[racine(c)] = a
  }
  const somme = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const s = somme.get(racine(i)) ?? [0, 0, 0, 0]
    somme.set(racine(i), [s[0] + p[3 * i], s[1] + p[3 * i + 1], s[2] + p[3 * i + 2], s[3] + 1])
  }
  const carte = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const [x, y, z, k] = somme.get(racine(i))!
    carte.set([x / k, y / k, z / k, Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1], 4 * i)
  }
  return carte
}

/** Ce que greffe une essence sur une de ses matières (la logique de `charger` dans parkAssets.ts). */
export interface Variante { carte?: 'rouge' | 'vert' | 'ginkgo'; nuance?: number; azalee?: boolean; herbe?: boolean; mousse?: boolean }

export function varianteDe(espece: EspeceParc, matiere: string): Variante | null {
  if (espece.startsWith('rocher')) return { mousse: true }
  if (matiere.startsWith('Jardin_Herbe')) return { herbe: true }
  if (!matiere.startsWith('Jardin_Feuillage') || matiere.includes('Fond')) return null
  if (espece.startsWith('erable') || espece === 'ginkgo') return { carte: espece === 'erable-rouge' ? 'rouge' : espece === 'ginkgo' ? 'ginkgo' : 'vert', nuance: 0.45 }
  if (espece === 'cedre' || espece === 'pin') return { nuance: 0.35 }
  if (espece === 'azalee') return { azalee: true, nuance: 1 }
  return { nuance: espece === 'lierre' ? 0.5 : 1 }
}

/** Le nom de la greffe : une variante, un define. */
export const nomDe = (v: Variante): string =>
  `Vegetal-${[v.carte, v.azalee && 'azalee', v.herbe && 'herbe', v.mousse && 'mousse', v.nuance !== undefined && `n${Math.round(v.nuance * 100)}`].filter(Boolean).join('-')}`

/** Le code GLSL ou WGSL d'une variante (intemperies.ts), saison cuite en littéraux, vent 2 m/s. */
export function codeVegetal(v: Variante, s: Saison, wgsl: boolean) {
  const { V, vin, vout, fin, u, fn, tr, attribut, varying } = dialecte(wgsl)
  const f = (x: number) => x.toFixed(4)
  const T = u('vegTemps')
  const VENT = '2.0'
  const vary = v.carte !== undefined || v.nuance !== undefined
  const veg = fin('vVeg')
  const c = 'surfaceAlbedo'
  const P = 'positionUpdated'
  const vertex = [
    V('vegI', 'vec2', tr('vec2(0.0)')),
    `#ifdef INSTANCES\nvegI = ${wgsl ? 'vertexInputs.world3.xz' : 'world3.xz'};\n#endif`,
    vary ? `${vout('vVeg')} = ${tr('vec4(0.0)')};` : '',
    v.carte
      ? `{
${V('iArbre', 'float', 'vegHash(floor(vegI * 3.0))')}
${V('iC', 'vec4', vin('aCarte'))}
${V('iTombe', 'float', `smoothstep(iC.w * 0.85, iC.w * 0.85 + 0.15, ${f(s.chute)} * 1.08 + (iArbre - 0.5) * 0.12)`)}
${P} = mix(${P}, iC.xyz, iTombe);
${V('iAmp', 'float', `(0.01 + 0.012 * ${VENT}) * clamp(${P}.y / 4.5, 0.0, 1.0)`)}
${P}.x += sin(${T} * 1.7 + iC.x * 2.3 + iArbre * 20.0) * iAmp;
${P}.z += cos(${T} * 1.3 + iC.z * 2.1 + iArbre * 11.0) * iAmp;
${vout('vVeg')} = ${tr('vec4(iC.w, iArbre, iTombe, 0.0)')};
}`
      : '',
    v.herbe
      ? `{
${V('iTouffe', 'float', 'vegHash(floor(vegI * 3.0))')}
${V('iAmp', 'float', `(0.05 + 0.035 * ${VENT}) * pow(max(${P}.y, 0.0) / 1.2, 1.6)`)}
${V('iPhase', 'float', `${T} * (1.6 + 0.5 * iTouffe) + iTouffe * 30.0 + ${P}.x * 2.0`)}
${P}.x += (sin(iPhase) * 0.8 + sin(iPhase * 2.3 + 1.7) * 0.3) * iAmp;
${P}.z += cos(iPhase * 0.8 + ${P}.z * 3.0) * iAmp * 0.7;
}`
      : '',
    v.nuance !== undefined ? `${vout('vVeg')}.w = vegHash(floor(vegI * 2.0) + 0.37);` : '',
  ]
  const tendre = (k: string) => `${c} = mix(${c}, ${c} * vec3(${k}) + vec3(0.03, 0.05, 0.0), ${f(s.tendre)} * (1.0 - iTourne));`
  const automne = {
    rouge: `${c} = mix(${c}, mix(vec3(0.55, 0.03, 0.02), vec3(0.8, 0.12, 0.02), iTon) * (0.8 + 1.4 * iL), iTourne);`,
    vert: `${V('iAuto', 'vec3', wgsl
      ? 'select(select(vec3(0.78, 0.46, 0.02), vec3(0.55, 0.045, 0.015), iTon < 0.8), vec3(0.75, 0.2, 0.015), iTon < 0.45)'
      : 'iTon < 0.45 ? vec3(0.75, 0.2, 0.015) : (iTon < 0.8 ? vec3(0.55, 0.045, 0.015) : vec3(0.78, 0.46, 0.02))')}
${c} = mix(${c}, iAuto * (0.6 + 0.7 * iL), iTourne);
${tendre('1.2, 1.3, 0.7')}
${V('iFleur', 'float', `step(0.66, ${veg}.y) * step(${veg}.x, 0.22) * ${f(s.floraison)}`)}
${c} = mix(${c}, vec3(0.93, 0.74, 0.8) * (0.5 + 0.9 * iL), iFleur * 0.75);`,
    ginkgo: `iTourne = smoothstep(0.35 + ${veg}.y * 0.1, 0.55 + ${veg}.y * 0.1, ${f(s.feuillage)} * 1.05 + (${veg}.x - 0.5) * 0.08);
${c} = mix(${c}, mix(vec3(0.95, 0.72, 0.08), vec3(0.98, 0.82, 0.2), iTon) * (0.55 + 0.8 * iL), iTourne);
${tendre('1.15, 1.25, 0.75')}`,
  }
  const fragment = [
    v.carte
      ? `{
${V('iL', 'float', `dot(${c}, vec3(0.3, 0.59, 0.11))`)}
${wgsl ? 'var' : 'float'} iTourne${wgsl ? ': f32' : ''} = smoothstep(${veg}.x * 0.7, ${veg}.x * 0.7 + 0.25, ${f(s.feuillage)} * 1.05 + (${veg}.y - 0.5) * 0.3);
${V('iTon', 'float', `fract(${veg}.x * 5.1 + ${veg}.y)`)}
${automne[v.carte]}
${c} = mix(${c}, vec3(0.3, 0.16, 0.06) * (0.5 + iL), smoothstep(0.05, 0.6, ${veg}.z));
}`
      : '',
    v.azalee
      ? `${c} = mix(${c}, vec3(0.14, 0.27, 0.07) * (0.8 + 0.5 * fract(${c}.b * 31.0)), smoothstep(0.06, 0.22, ${c}.r - ${c}.g) * ${f(1 - s.floraison)});`
      : '',
    v.herbe
      ? `{
${V('iL', 'float', `dot(${c}, vec3(0.3, 0.59, 0.11))`)}
${V('iSec', 'float', f(Math.min(1, Math.max(s.feuillage * 0.75, s.chute))))}
${c} = mix(${c}, vec3(0.62, 0.5, 0.3) * (0.55 + 1.6 * iL), iSec * 0.85);
${c} = mix(${c}, ${c} * vec3(1.15, 1.2, 0.8), ${f(s.tendre)} * (1.0 - iSec));
}`
      : '',
    v.mousse
      ? `{
${V('iLum', 'float', `dot(${c}, vec3(0.3, 0.55, 0.15))`)}
${V('iPierre', 'vec3', `mix(${c}, vec3(iLum) * vec3(0.92, 0.95, 0.9), 0.6)`)}
${c} = mix(iPierre, vec3(0.16, 0.24, 0.07) * (0.6 + 1.6 * iLum), smoothstep(0.25, 0.75, ${fin('vNormalW')}.y + (iLum - 0.3) * 0.8));
}`
      : '',
    v.nuance !== undefined
      ? `${c} *= mix(vec3(1.0), mix(vec3(1.1, 1.05, 0.78), vec3(0.86, 0.97, 1.08), ${veg}.w) * (0.84 + 0.3 * fract(${veg}.w * 7.31)), ${f(v.nuance)});`
      : '',
  ]
  const hash = fn('vegHash', [['p', 'vec2']], 'float', tr('\nreturn fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);'))
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: [hash, v.carte ? attribut('aCarte', 'vec4') : '', vary ? varying('vVeg', 'vec4') : ''].join('\n'),
      CUSTOM_VERTEX_UPDATE_POSITION: tr(vertex.filter(Boolean).join('\n')),
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: vary ? varying('vVeg', 'vec4') : '',
      CUSTOM_FRAGMENT_UPDATE_ALPHA: tr(fragment.filter(Boolean).join('\n')),
    },
  }
}

/** Une géométrie calée (positions et index), pour poser des oiseaux sur les érables (faune). */
export interface Geo { positions: Float32Array; indices: Uint32Array }

let erables: (m: Map<'erable-rouge' | 'erable-vert', { feuilles: Geo; ecorce: Geo }>) => void
const promesseErables = new Promise<Map<'erable-rouge' | 'erable-vert', { feuilles: Geo; ecorce: Geo }>>((ok) => (erables = ok))
/** Les érables calés (lots Jardin_Feuillage et Jardin_Ecorce), quand la végétation est montée (vide sans vegetation.glb). */
export const erablesCales = () => promesseErables

/** Les maillages sous `noeud`, transformations prises relativement à lui, fusionnés par matière. */
function fusionParMatiere(noeud: TransformNode): Map<PBRMaterial, VertexData> {
  const inverse = noeud.computeWorldMatrix(true).clone().invert()
  const par = new Map<PBRMaterial, VertexData>()
  for (const m of [noeud, ...noeud.getChildMeshes(false)]) {
    if (!(m instanceof Mesh || m instanceof InstancedMesh) || !(m.material instanceof PBRMaterial)) continue
    const source = m instanceof InstancedMesh ? m.sourceMesh : m
    if (source.getTotalVertices() === 0) continue
    const vd = VertexData.ExtractFromMesh(source, true, true)
    vd.transform(m.computeWorldMatrix(true).multiply(inverse))
    const deja = par.get(m.material)
    par.set(m.material, deja ? deja.merge(vd, true) : vd)
  }
  return par
}

interface Lot { espece: EspeceParc; matiere: PBRMaterial; proche: VertexData; loin?: VertexData; carte?: [Float32Array, Float32Array?] }

/** `lotsParMateriau` + `accrocherLoin` : les lots d'une essence, calés, matières clonées et réglées. */
function preparer(espece: EspeceParc, noeud: TransformNode, loin: TransformNode | undefined, seuil: number): Lot[] {
  const fusions = fusionParMatiere(noeud)
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = min.scale(-1)
  for (const vd of fusions.values()) {
    const p = vd.positions!
    for (let i = 0; i < p.length; i += 3) {
      min.minimizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2])
      max.maximizeInPlaceFromFloats(p[i], p[i + 1], p[i + 2])
    }
  }
  const cale = Matrix.Translation(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2)
  const loins = loin ? fusionParMatiere(loin) : new Map<PBRMaterial, VertexData>()
  return [...fusions].map(([original, proche]) => {
    proche.transform(cale)
    const l = [...loins].find(([m]) => m.name === original.name)?.[1]?.transform(cale)
    const m = original.clone(`${original.name}:${espece}`)
    m.brdf.baseDiffuseModel = Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT
    m.backFaceCulling = false
    m.twoSidedLighting = true
    if (m.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHATEST || m.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHABLEND) {
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST
      m.alphaCutOff = seuil
    }
    const v = varianteDe(espece, original.name)
    const carte = v?.carte
      ? ([cartesDeFeuillage(proche.positions!, proche.indices!), l && cartesDeFeuillage(l.positions!, l.indices!)] as [Float32Array, Float32Array?])
      : undefined
    if (v) {
      const s = ambiance().saison
      greffer(m, {
        nom: nomDe(v),
        attributs: v.carte ? ['aCarte'] : [],
        uniforms: v.carte || v.herbe ? [{ name: 'vegTemps', size: 1, type: 'float' }] : [],
        lier: v.carte || v.herbe ? (ubo) => ubo.updateFloat('vegTemps', performance.now() / 1000) : undefined,
        code: (wgsl) => codeVegetal(v, s, wgsl),
      })
    }
    return { espece, matiere: m, proche, loin: l, carte }
  })
}

/**
 * Un maillage de thin instances, sa propre Geometry : le buffer de matrices
 * s'accroche à la Geometry, deux côtés qui la partageraient liraient les mêmes.
 */
function maillage(nom: string, scene: Scene, vd: VertexData, carte: Float32Array | undefined, matiere: PBRMaterial, buf: Float32Array): Mesh {
  const m = new Mesh(nom, scene)
  vd.applyToMesh(m)
  if (carte) m.setVerticesData('aCarte', carte, false, 4)
  m.material = matiere
  m.hasVertexAlpha = false
  m.isPickable = false
  m.receiveShadows = true
  m.thinInstanceSetBuffer('matrix', buf, 16, false)
  return m
}

/** Les sujets (plantations, berges, pieds de lierre du mur) en lots ; rend les porteurs d'ombre (tous). */
export async function monterVegetation(scene: Scene): Promise<Mesh[]> {
  const [veg, grands, jardin] = await Promise.all([glbOuRien(scene, VEGETATION), glbOuRien(scene, GRANDS), glbPartage(scene, JARDIN)])
  const fichiers = new Map<string, AssetContainer | null>([[VEGETATION, veg], [GRANDS, grands], [JARDIN, jardin]])
  const noeud = (c: AssetContainer | null | undefined, nom: string) => [...(c?.transformNodes ?? []), ...(c?.meshes ?? [])].find((n) => n.name === nom)
  const lots = new Map<EspeceParc, Lot[]>()
  for (const [espece, [fichier, proche, loin]] of Object.entries(NOEUDS) as [EspeceParc, [string, string, string?]][]) {
    const c = fichiers.get(fichier)
    const n = noeud(c, proche)
    if (!c) continue
    if (!n) {
      console.warn(`${fichier} : nœud « ${proche} » introuvable`)
      continue
    }
    lots.set(espece, preparer(espece, n, loin ? noeud(c, loin) : undefined, fichier === JARDIN ? 0.15 : 0.45))
  }
  const geo = (vd: VertexData): Geo => ({ positions: Float32Array.from(vd.positions!), indices: Uint32Array.from(vd.indices!) })
  erables(new Map((['erable-rouge', 'erable-vert'] as const).flatMap((e) => {
    const l = lots.get(e)
    const f = l?.find((x) => x.matiere.name.startsWith('Jardin_Feuillage:'))
    const b = l?.find((x) => x.matiere.name.startsWith('Jardin_Ecorce:'))
    return f && b ? [[e, { feuilles: geo(f.proche), ecorce: geo(b.proche) }] as const] : []
  })))
  // Les sources libérées, géométries comprises (jardin.glb : seulement nos `src_*`) ; matières et textures restent, nos clones les lisent.
  const sources = [veg, grands].flatMap((c) => [...(c?.meshes ?? []), ...(c?.transformNodes ?? [])])
  for (const n of [...(jardin?.meshes ?? []), ...(jardin?.transformNodes ?? [])]) if (n.name.startsWith('src_')) sources.push(n)
  for (const n of sources) if (!n.isDisposed()) n.dispose(false, false)

  // Les pétales tombés n'existent qu'en saison (`saisonnerPetales`, cuit sur les matrices).
  const pousse = smoothstep(ambiance().saison.floraison, 0, 0.4)
  const sujets = [...PARC.plantations, ...PARC.berges, ...MUR.lierre].filter((s) => s.espece !== 'petales' || pousse > 0)
  const porteurs: Mesh[] = []
  const suivis: { sujets: PlantPlacement[]; loin: boolean[]; mats: Float32Array; proche: Mesh; lointain: Mesh; bp: Float32Array; bl: Float32Array }[] = []
  for (const [espece, parties] of groupes(sujets, PARC.terrain)) {
    for (const lot of lots.get(espece) ?? []) {
      parties.forEach((ss, k) => {
        const mats = matrices(ss.map((s) => ({ piece: '', x: s.x, y: s.y ?? 0, z: s.z, lacet: s.rotation, echelle: echelleDe(s, espece === 'petales' ? pousse : 1) }))).get('')!
        const nom = `vegetation:${lot.matiere.name}:${k}`
        const bp = mats.slice()
        const proche = maillage(nom, scene, lot.proche, lot.carte?.[0], lot.matiere, bp)
        porteurs.push(proche)
        if (!lot.loin) {
          // Un petit sujet : caché au loin plutôt que remplacé.
          const portee = PORTEE[espece]
          if (portee) cacherAuLoin(scene, proche, { matrix: [bp, 16] }, portee)
          return
        }
        const bl = mats.slice()
        const lointain = maillage(`${nom}:loin`, scene, lot.loin, lot.carte?.[1], lot.matiere, bl)
        porteurs.push(lointain)
        // Une boîte pour les deux : celle du lot entier, proche ∪ loin.
        const [a, b] = [proche.getBoundingInfo(), lointain.getBoundingInfo()]
        const [mn, mx] = [Vector3.Minimize(a.minimum, b.minimum), Vector3.Maximize(a.maximum, b.maximum)]
        for (const m of [proche, lointain]) {
          m.setBoundingInfo(new BoundingInfo(mn, mx))
          m.doNotSyncBoundingInfo = true
        }
        lointain.thinInstanceCount = 0
        lointain.setEnabled(false)
        suivis.push({ sujets: ss, loin: ss.map(() => false), mats, proche, lointain, bp, bl })
      })
    }
  }
  brancherLueurs(new Set(porteurs.map((m) => m.material!)))

  // Chaque sujet à sa distance ; un lot ne se recompacte que si l'un d'eux change de géométrie.
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera?.globalPosition
    if (!cam) return
    for (const s of suivis) {
      let change = false
      s.sujets.forEach((p, i) => {
        const d = Math.hypot(p.x - cam.x, p.z - cam.z)
        const l = estLoin(d, s.loin[i])
        change ||= l !== s.loin[i]
        s.loin[i] = l
      })
      if (!change) continue
      const n = [0, 0]
      const bufs = [s.bp, s.bl]
      s.loin.forEach((l, i) => {
        const k = l ? 1 : 0
        bufs[k].set(s.mats.subarray(16 * i, 16 * i + 16), 16 * n[k]++)
      })
      ;[s.proche, s.lointain].forEach((m, k) => {
        m.thinInstanceCount = n[k]
        m.thinInstanceBufferUpdated('matrix')
        // Sans instance, Babylon dessinerait le modèle seul à l'origine.
        m.setEnabled(n[k] > 0)
      })
    }
  })
  return porteurs
}
