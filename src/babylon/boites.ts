/**
 * Les boîtes du plan. Les surfaces cuites (murs, dalles, parement, peintures,
 * plafonds, bandes du sol), plinthes et résille sont le parement (parement.ts,
 * qui lit `geometrieCuite` et l'atlas d'ici) ; le reste, sans lumière cuite :
 * mains courantes (acier Metal032, fusionnées), verre des garde-corps et des
 * baies (Fresnel de `creerVitrageGardeCorps`), marches (que remplace le GLB de
 * l'escalier) et lanterneaux (un lot par niveau, jour/nuit différents).
 *
 * `geometrieDeBoites` / `boitesFusionnees` : la même fusion pour toute couche
 * de boîtes texturées (façade, embrasures…), UV en mètres par face comme
 * `appliquerEchelleInstance` de three.
 *
 * Matières PBR (éclairage linéaire, Lambert, comme MeshStandardMaterial) : le
 * Standard de Babylon éclaire en espace gamma, borne à 1 puis élève à 2,2.
 *
 * La lightmap reprend `scene/lumiere.ts` : facteur d'ambiance
 * f = mix(1, (cuit × PLAFOND / REFERENCE)^CONTRASTE, force), qui multiplie
 * l'hémisphérique seule ; le soleil reste en temps réel. Babylon ne sait pas
 * multiplier une lumière par la lightmap : `LIGHTMAP_SHADOWSONLY` (soleil.ts) la
 * REMPLACE par la lightmap. L'atlas porte donc f × l'éclairement de
 * l'hémisphérique, ciel, sol ou mi-chemin selon la face (les boîtes sont droites).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import type { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { coordonneesDeFace, MARGE, type Face } from '../plan/lumiere.ts'
import LUMIERE from '../plan/lumiere.json' with { type: 'json' }
import { meshLevel, type Box } from '../plan/mesh.ts'
import { plafonds } from '../plan/plafonds.ts'
import { sansBaieBatllo } from '../scene/batllo.ts'
import type { Plan } from '../plan/types.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { matierePBR } from './matieres.ts'

/** Une surface cuite : sa boîte, sa clé dans lumiere.json (vide : texel (0, 0)), sa teinte. */
export interface Cuite { b: Box; cle: string; couleur: string }
export interface Lots {
  /** Les mains courantes (garde-corps des balcons et des volées, rampantes comprises). */
  mains: Box[]
  /** Marches, palier et paillasses : retirés quand le GLB de l'escalier arrive. */
  marches: Box[]
  verre: Box[]
  /** Le verre dépoli des lanterneaux, un tableau par niveau (ordre de `plan.levels`). */
  lanterneau: Box[][]
}

/** L'éclairement encodé : 1 dans l'atlas vaut PLAFOND (même constante que `bake-lumiere.py`). */
const PLAFOND = 2
/** Mêmes valeurs que `scene/lumiere.ts`, recopiées : l'importer tirerait three dans la tranche. */
const REFERENCE = 0.45
const CONTRASTE = 0.75
/** Le facteur plafonne à ECHELLE (l'octet de l'atlas couvre [0, ECHELLE × éclairement max]). */
const ECHELLE = 2

/**
 * Le tri par LISTE SOURCE de PlanBuilding : le kind seul ne suffit pas (une
 * paillasse est une dalle qui dépasse le plancher, la résille est une boîte de
 * plafond). Les marches attendent le GLB de l'escalier dans leur propre lot.
 */
export function trierBoites(plan: Plan): Lots {
  const lots: Lots = { mains: [], marches: [], verre: [], lanterneau: [] }
  for (const l of plan.levels) {
    const boites = meshLevel(plan, l.id)
    // La baie du palier est le GLB de Batlló (batllo.ts) : sa vitre en boîte part.
    const verre = new Set(sansBaieBatllo(boites.filter((b) => b.kind === 'glass'), l.id))
    for (const b of boites) {
      if (b.kind === 'step' || b.kind === 'landing' || (b.kind === 'slab' && b.y + b.h / 2 > l.elevation + 1e-6)) lots.marches.push(b)
      else if (b.kind === 'handrail') lots.mains.push(b)
      else if (b.kind === 'railing' || verre.has(b)) lots.verre.push(b)
    }
    // Plinthes et résille sont du parement (parement.ts).
    lots.lanterneau.push(plafonds(plan, l.id).verre)
  }
  return lots
}

/** La face three (0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z) d'un sommet de cube, lue sur sa normale. */
const faceDe = (x: number, y: number, z: number): Face =>
  Math.abs(x) > 0.5 ? (x > 0 ? 0 : 1) : Math.abs(y) > 0.5 ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5

/**
 * Les UV d'un sommet de cube unité (p ∈ [−0,5 ; 0,5]³) de la face `f`, en mètres
 * depuis le coin de la face : exactement celles de `BoxGeometry` × la taille de
 * la boîte (`appliquerEchelleInstance`) : ±x → (d, h), ±y → (w, d), ±z → (w, h),
 * u horizontal et v vers le haut sur les faces verticales.
 */
export function uvMetres(b: Pick<Box, 'w' | 'h' | 'd'>, f: Face, p: readonly number[]): [number, number] {
  const [x, y, z] = p
  switch (f) {
    case 0: return [(0.5 - z) * b.d, (0.5 + y) * b.h]
    case 1: return [(0.5 + z) * b.d, (0.5 + y) * b.h]
    case 2: return [(0.5 + x) * b.w, (0.5 - z) * b.d]
    case 3: return [(0.5 + x) * b.w, (0.5 + z) * b.d]
    case 4: return [(0.5 + x) * b.w, (0.5 + y) * b.h]
    default: return [(0.5 - x) * b.w, (0.5 + y) * b.h]
  }
}

export interface Gabarit { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> }

/**
 * Le cube unité recopié par boîte, mis à l'échelle, cisaillé s'il a une `pente`
 * (comme `matriceDeBoite`), et posé, UV en mètres.
 * ponytail : les normales d'une boîte rampante ne sont pas recisaillées (pentes
 * d'escalier, l'écart ne se voit pas sur une main courante).
 */
export function geometrieDeBoites(gabarit: Gabarit, boites: readonly Box[]): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const nv = gabarit.positions.length / 3
  const ni = gabarit.indices.length
  const out = {
    positions: new Float32Array(boites.length * nv * 3),
    normals: new Float32Array(boites.length * nv * 3),
    uvs: new Float32Array(boites.length * nv * 2),
    indices: new Uint32Array(boites.length * ni),
  }
  boites.forEach((b, k) => {
    const pente = b.pente ?? 0
    for (let v = 0; v < nv; v++) {
      const i = k * nv + v
      const p = [gabarit.positions[3 * v], gabarit.positions[3 * v + 1], gabarit.positions[3 * v + 2]]
      const [nx, ny, nz] = [gabarit.normals[3 * v], gabarit.normals[3 * v + 1], gabarit.normals[3 * v + 2]]
      const glisse = pente * (b.w > b.d ? p[0] * b.w : p[2] * b.d)
      out.positions.set([b.x + p[0] * b.w, b.y + p[1] * b.h + glisse, b.z + p[2] * b.d], 3 * i)
      out.normals.set([nx, ny, nz], 3 * i)
      out.uvs.set(uvMetres(b, faceDe(nx, ny, nz), p), 2 * i)
    }
    for (let j = 0; j < ni; j++) out.indices[k * ni + j] = gabarit.indices[j] + k * nv
  })
  return out
}

/** Le gabarit : le cube unité de Babylon (24 sommets, une normale par face), lu une fois. */
export function gabaritCube(scene: Scene): Gabarit {
  const cube = CreateBox('gabarit', { size: 1 }, scene)
  const v = VertexData.ExtractFromMesh(cube)
  cube.dispose()
  return { positions: v.positions!, normals: v.normals!, indices: v.indices! }
}

/** Des boîtes fusionnées en UN maillage, UV en mètres (× uScale/vScale = 1/motif de la texture). */
export function boitesFusionnees(nom: string, boites: readonly Box[], scene: Scene, mat: Material): Mesh {
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), geometrieDeBoites(gabaritCube(scene), boites)).applyToMesh(m)
  m.material = mat
  return m
}

/**
 * Le maillage fusionné des surfaces cuites : `geometrieDeBoites`, plus la
 * teinte par sommet et l'uv2 dans l'atlas.
 * Une face sans rectangle (clé absente, face cachée) lit le texel (0, 0) :
 * facteur 1, dans la marge, jamais atteint par le bilinéaire d'un rectangle.
 */
export function geometrieCuite(
  gabarit: Gabarit,
  cuites: readonly Cuite[],
  index: { largeur: number; hauteur: number; boites: Record<string, (number[] | number)[]> },
): ReturnType<typeof geometrieDeBoites> & { colors: Float32Array; uvs2: Float32Array } {
  const nv = gabarit.positions.length / 3
  const out = {
    ...geometrieDeBoites(gabarit, cuites.map((c) => c.b)),
    colors: new Float32Array(cuites.length * nv * 4),
    uvs2: new Float32Array(cuites.length * nv * 2),
  }
  const { largeur: L, hauteur: H } = index
  cuites.forEach(({ cle, couleur }, k) => {
    // PBR : teintes par sommet en linéaire, comme `THREE.Color`.
    const c = lin(couleur)
    const rects = index.boites[cle]
    for (let v = 0; v < nv; v++) {
      const i = k * nv + v
      const p: [number, number, number] = [gabarit.positions[3 * v], gabarit.positions[3 * v + 1], gabarit.positions[3 * v + 2]]
      const [nx, ny, nz] = [gabarit.normals[3 * v], gabarit.normals[3 * v + 1], gabarit.normals[3 * v + 2]]
      out.colors.set([c.r, c.g, c.b, 1], 4 * i)
      const f = faceDe(nx, ny, nz)
      const r = rects?.[f]
      if (!Array.isArray(r)) out.uvs2.set([0.5 / L, 0.5 / H], 2 * i)
      else {
        const [s, t] = coordonneesDeFace(f, p)
        out.uvs2.set([(r[0] + s * (r[2] - r[0])) / L, (r[1] + t * (r[3] - r[1])) / H], 2 * i)
      }
    }
  })
  return out
}

/**
 * La matrice d'une boîte, ligne majeure (vecteur ligne v·M), en out[16i…] :
 * échelle, cisaillement d'un garde-corps rampant (y glisse avec x si w > d,
 * sinon avec z — comme `makeShear` appliqué après l'échelle dans three), position.
 */
export function matriceDeBoite(b: Box, out: Float32Array, i: number): void {
  const p = b.pente ?? 0
  const lx = b.w > b.d
  out.set([b.w, lx ? p * b.w : 0, 0, 0, 0, b.h, 0, 0, 0, lx ? 0 : p * b.d, b.d, 0, b.x, b.y, b.z, 1], 16 * i)
}

/** Un cube unité en thin instances, une par boîte (UV de CreateBox, pas en mètres : pour les aplats). */
export function cubes(nom: string, boites: readonly Box[], scene: Scene, mat: Material): Mesh {
  const m = CreateBox(nom, { size: 1 }, scene)
  const matrices = new Float32Array(16 * boites.length)
  boites.forEach((b, i) => matriceDeBoite(b, matrices, i))
  m.thinInstanceSetBuffer('matrix', matrices, 16)
  m.material = mat
  return m
}

/** Une matière (mate par défaut) : la couleur hex devient linéaire, comme dans three. */
export function matiere(nom: string, scene: Scene, couleur = '#ffffff', rugosite = 1): PBRMaterial {
  const mat = new PBRMaterial(nom, scene)
  mat.albedoColor = lin(couleur)
  mat.metallic = 0
  mat.roughness = rugosite
  mat.brdf.baseDiffuseModel = Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT
  return mat
}

/**
 * La table octet sRGB de l'atlas → octet de lightmap, par teinte (côté, dessus,
 * dessous) et par canal : f × teinte / niveau, `niveau` (le `level` de la
 * texture) valant ECHELLE × le plus fort canal des teintes. Les teintes sont
 * l'éclairement linéaire de l'hémisphérique sur chaque orientation.
 */
export function tableDeLumiere(force: number, teintes: number[][]): { table: Uint8Array; niveau: number } {
  const niveau = ECHELLE * Math.max(...teintes.flat())
  const table = new Uint8Array(teintes.length * 3 * 256)
  for (let c = 0; c < 256; c++) {
    const s = c / 255
    const lin = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    const f = Math.min(ECHELLE, 1 + (((lin * PLAFOND) / REFERENCE) ** CONTRASTE - 1) * force)
    teintes.forEach((t, k) => t.forEach((v, canal) => (table[(3 * k + canal) * 256 + c] = Math.round((255 * f * v) / niveau))))
  }
  return { table, niveau }
}

/**
 * L'atlas cuit relu en facteur d'ambiance, les lignes retournées (ligne 0 = BAS,
 * comme les Rect de lumiere.json) : pas d'`invertY`, même chemin en WebGL2 et WebGPU.
 */
export async function chargerAtlas(scene: Scene, force: number, hemi: HemisphericLight): Promise<RawTexture> {
  const url = `${import.meta.env.BASE_URL}assets/lumiere/atlas.webp`
  const image = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const { width: L, height: H } = image
  const toile = new OffscreenCanvas(L, H)
  const ctx = toile.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  const src = ctx.getImageData(0, 0, L, H).data
  // L'hémisphérique de Babylon : mix(sol, ciel, n·haut × 0,5 + 0,5) × intensité. Côté, dessus, dessous.
  const teinte = (w: number) => Color3.Lerp(hemi.groundColor, hemi.diffuse, w).scale(hemi.intensity).asArray()
  const { table, niveau } = tableDeLumiere(force, [teinte(0.5), teinte(1), teinte(0)])
  // L'orientation de chaque texel : côté par défaut, dessus (face 2) ou dessous (face 3) sur leurs
  // rectangles élargis de la marge, que le bilinéaire du bord lit aussi.
  const sens = new Uint8Array(L * H)
  for (const rects of Object.values(LUMIERE.boites as Record<string, (number[] | number)[]>)) {
    for (const f of [2, 3] as const) {
      const r = rects[f]
      if (!Array.isArray(r)) continue
      for (let y = r[1] - MARGE; y < r[3] + MARGE; y++) sens.fill(f - 1, y * L + r[0] - MARGE, y * L + r[2] + MARGE)
    }
  }
  const data = new Uint8Array(L * H * 4)
  for (let y = 0; y < H; y++) {
    const de = (H - 1 - y) * L * 4
    for (let x = 0; x < L; x++) {
      const i = y * L + x
      const t = sens[i] * 768
      data[4 * i] = table[t + src[de + 4 * x]]
      data[4 * i + 1] = table[t + 256 + src[de + 4 * x + 1]]
      data[4 * i + 2] = table[t + 512 + src[de + 4 * x + 2]]
      data[4 * i + 3] = 255
    }
  }
  // Le texel (0, 0) : facteur 1 en teinte de côté, celui des faces sans rectangle.
  // ponytail : une face dessus ou dessous sans rectangle (cachée en pratique) prend aussi la teinte de côté.
  teinte(0.5).forEach((v, canal) => (data[canal] = Math.round((255 * v) / niveau)))
  const tex = RawTexture.CreateRGBATexture(data, L, H, scene, false, false, Texture.BILINEAR_SAMPLINGMODE)
  tex.gammaSpace = false
  tex.coordinatesIndex = 1
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE
  tex.level = niveau
  return tex
}

/**
 * Le Fresnel du verre des garde-corps (`creerVitrageGardeCorps` de
 * builders/glazing.ts) : clair de face, l'opacité monte vers 0,7 en incidence
 * rasante, si bien que le panneau d'en face se lit comme une paroi verte.
 * La même ligne en GLSL et en WGSL.
 */
class Fresnel extends MaterialPluginBase {
  constructor(m: Material) {
    super(m, 'Fresnel', 200, undefined, true, true)
  }

  override getClassName(): string {
    return 'Fresnel'
  }

  override isCompatible(langue: ShaderLanguage): boolean {
    return langue === ShaderLanguage.GLSL || langue === ShaderLanguage.WGSL
  }

  override getCustomCode(type: string): { [point: string]: string } | null {
    return type === 'fragment'
      ? { CUSTOM_FRAGMENT_UPDATE_ALPHA: 'alpha = mix(alpha, 0.7, pow(1.0 - clamp(abs(dot(normalW, viewDirectionW)), 0.0, 1.0), 3.0));' }
      : null
  }
}

/** Le verre des garde-corps et des baies : poli, reflet × 1,4, sans écriture de profondeur, Fresnel sur l'opacité. */
export function verreDeGardeCorps(scene: Scene): PBRMaterial {
  const vitre = matiere('verre', scene, '#cfe3dd', 0.05)
  vitre.alpha = 0.12
  vitre.environmentIntensity = 1.4
  vitre.disableDepthWrite = true
  // three multiplie aussi le reflet par l'opacité (pas de radiance par-dessus l'alpha).
  vitre.useRadianceOverAlpha = vitre.useSpecularOverAlpha = false
  new Fresnel(vitre)
  return vitre
}

export interface Boites {
  /** Les porteurs d'ombre (mains courantes, marches) ; le parement rend les siens. */
  porteurs: Mesh[]
  /** L'atlas de lumière, partagé avec les GLB cuits (escalier, salle d'honneur : `eclairerModele` de glb.ts). */
  atlas: Promise<RawTexture>
  /** Les marches en boîtes, à retirer (`dispose`) quand le GLB de l'escalier est posé. */
  marches: Mesh
  /** Le dépoli des lanterneaux, un maillage par niveau (ordre de `plan.levels`), matière posée par eclairage.ts. */
  lanterneaux: Mesh[]
}

/**
 * Monte les boîtes. Synchrone : l'atlas se branche quand il arrive, l'ambiance
 * reste pleine en attendant (ou pour toujours s'il manque : la promesse rejetée
 * est déjà signalée ici, les autres couches n'ont qu'à l'attendre dans un catch).
 * `hemi` est l'hémisphérique que la lightmap remplace (ses teintes et son intensité y sont cuites).
 */
export function monterBoites(scene: Scene, plan: Plan, ambiant: { force: number; hemi: HemisphericLight }): Boites {
  const lots = trierBoites(plan)

  const atlas = chargerAtlas(scene, ambiant.force, ambiant.hemi)
  // Sans atlas, l'ambiance d'avant : le musée reste visitable.
  void atlas.catch((erreur: unknown) => console.warn('lumière précalculée indisponible', erreur))

  // L'acier des mains courantes (PlanBuilding : `useMatiere('metal')`), UV en mètres.
  const mains = boitesFusionnees('mains-courantes', lots.mains, scene, matierePBR('mains-courantes', 'metal', scene, { repli: '#8a8a88' }))
  cubes('verre', lots.verre, scene, verreDeGardeCorps(scene))

  const marches = cubes('marches', lots.marches, scene, matiere('marches', scene, '#c4bfba'))

  // Le dépoli de base ; eclairage.ts pose ensuite la matière jour/nuit de chaque niveau.
  const depoli = matiere('lanterneau', scene, '#f4f1ea')
  depoli.emissiveColor = lin('#fff6e6').scale(0.55)
  const lanterneaux = lots.lanterneau.map((v, i) => cubes(`lanterneau-${i}`, v, scene, depoli))

  brancherLueurs([mains.material!, marches.material!])
  mains.receiveShadows = marches.receiveShadows = true
  return { porteurs: [mains, marches], atlas, marches, lanterneaux }
}
