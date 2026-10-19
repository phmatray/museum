/**
 * Les boîtes du plan. Les surfaces cuites (murs, dalles, parement, peintures,
 * plafonds, bandes du sol) forment UN maillage fusionné, couleur par sommet et
 * uv2 de lightmap calculée ici ; le reste (marches, paillasses, mains courantes,
 * plinthes, résille, verre, lanterneaux) passe en thin instances, sans lumière
 * cuite. Quatre maillages, quatre appels.
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
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { coordonneesDeFace, MARGE, surfacesCuites, type Face } from '../plan/lumiere.ts'
import LUMIERE from '../plan/lumiere.json' with { type: 'json' }
import { meshLevel, type Box } from '../plan/mesh.ts'
import { plinthes } from '../plan/parement.ts'
import { plafonds } from '../plan/plafonds.ts'
import type { Plan } from '../plan/types.ts'

export interface Teinte { b: Box; couleur: string }
export interface Lots {
  cuites: (Teinte & { cle: string })[]
  opaques: Teinte[]
  verre: Box[]
  lanterneau: Box[]
}

/** La teinte de chaque matière cuite ; une peinture de galerie est déjà sa couleur. */
const TEINTES: Record<string, string> = { platre: '#dddad4', pierre: '#cec4af', terrazzo: '#c4bfba', parquet: '#997959', granit: '#696159' }
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
 * plafond). L'escalier n'a pas de GLB ici : ses marches restent des boîtes.
 */
export function trierBoites(plan: Plan): Lots {
  const cuites = surfacesCuites(plan).map((s) => ({ b: s.boite, cle: s.cle, couleur: TEINTES[s.matiere] ?? s.matiere }))
  const lots: Lots = { cuites, opaques: [], verre: [], lanterneau: [] }
  const teinter = (boites: Box[], couleur: string) => boites.forEach((b) => lots.opaques.push({ b, couleur }))
  for (const l of plan.levels) {
    for (const b of meshLevel(plan, l.id)) {
      if (b.kind === 'step' || b.kind === 'landing' || (b.kind === 'slab' && b.y + b.h / 2 > l.elevation + 1e-6)) teinter([b], '#c4bfba')
      else if (b.kind === 'handrail') teinter([b], '#8a8a88')
      else if (b.kind === 'railing' || b.kind === 'glass') lots.verre.push(b)
    }
    const p = plinthes(plan, l.id)
    const { verre, resille } = plafonds(plan, l.id)
    teinter(p.hall, '#696159')
    teinter(resille, '#696159')
    teinter(p.salles, '#cec4af')
    lots.lanterneau.push(...verre)
  }
  return lots
}

/** La face three (0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z) d'un sommet de cube, lue sur sa normale. */
const faceDe = (x: number, y: number, z: number): Face =>
  Math.abs(x) > 0.5 ? (x > 0 ? 0 : 1) : Math.abs(y) > 0.5 ? (y > 0 ? 2 : 3) : z > 0 ? 4 : 5

/**
 * Le maillage fusionné des surfaces cuites : le cube unité recopié par boîte,
 * mis à l'échelle et posé, avec sa teinte par sommet et son uv2 dans l'atlas.
 * Une face sans rectangle (clé absente, face cachée) lit le texel (0, 0) :
 * facteur 1, dans la marge, jamais atteint par le bilinéaire d'un rectangle.
 * ponytail : les boîtes cuites n'ont jamais de `pente`, on l'ignore ici.
 */
export function geometrieCuite(
  gabarit: { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> },
  cuites: Lots['cuites'],
  index: { largeur: number; hauteur: number; boites: Record<string, (number[] | number)[]> },
): { positions: Float32Array; normals: Float32Array; colors: Float32Array; uvs2: Float32Array; indices: Uint32Array } {
  const nv = gabarit.positions.length / 3
  const ni = gabarit.indices.length
  const out = {
    positions: new Float32Array(cuites.length * nv * 3),
    normals: new Float32Array(cuites.length * nv * 3),
    colors: new Float32Array(cuites.length * nv * 4),
    uvs2: new Float32Array(cuites.length * nv * 2),
    indices: new Uint32Array(cuites.length * ni),
  }
  const { largeur: L, hauteur: H } = index
  cuites.forEach(({ b, cle, couleur }, k) => {
    // PBR : teintes par sommet en linéaire, comme `THREE.Color`.
    const c = Color3.FromHexString(couleur).toLinearSpace()
    const rects = index.boites[cle]
    for (let v = 0; v < nv; v++) {
      const i = k * nv + v
      const p: [number, number, number] = [gabarit.positions[3 * v], gabarit.positions[3 * v + 1], gabarit.positions[3 * v + 2]]
      const [nx, ny, nz] = [gabarit.normals[3 * v], gabarit.normals[3 * v + 1], gabarit.normals[3 * v + 2]]
      out.positions.set([b.x + p[0] * b.w, b.y + p[1] * b.h, b.z + p[2] * b.d], 3 * i)
      out.normals.set([nx, ny, nz], 3 * i)
      out.colors.set([c.r, c.g, c.b, 1], 4 * i)
      const f = faceDe(nx, ny, nz)
      const r = rects?.[f]
      if (!Array.isArray(r)) out.uvs2.set([0.5 / L, 0.5 / H], 2 * i)
      else {
        const [s, t] = coordonneesDeFace(f, p)
        out.uvs2.set([(r[0] + s * (r[2] - r[0])) / L, (r[1] + t * (r[3] - r[1])) / H], 2 * i)
      }
    }
    for (let j = 0; j < ni; j++) out.indices[k * ni + j] = gabarit.indices[j] + k * nv
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

/** Un cube unité en thin instances, une par boîte. */
function cubes(nom: string, boites: Box[], scene: Scene, mat: PBRMaterial): Mesh {
  const m = CreateBox(nom, { size: 1 }, scene)
  const matrices = new Float32Array(16 * boites.length)
  boites.forEach((b, i) => matriceDeBoite(b, matrices, i))
  m.thinInstanceSetBuffer('matrix', matrices, 16)
  m.material = mat
  return m
}

/** Une matière mate, sans environnement : la couleur hex devient linéaire, comme dans three. */
export function matiere(nom: string, scene: Scene, couleur = '#ffffff', rugosite = 1): PBRMaterial {
  const mat = new PBRMaterial(nom, scene)
  mat.albedoColor = Color3.FromHexString(couleur).toLinearSpace()
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
async function chargerAtlas(scene: Scene, force: number, hemi: HemisphericLight): Promise<RawTexture> {
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
 * Monte les boîtes ; rend les porteurs d'ombre (cuites et opaques). Synchrone :
 * l'atlas se branche quand il arrive, l'ambiance reste pleine en attendant.
 * `hemi` est l'hémisphérique que la lightmap remplace (ses teintes et son intensité y sont cuites).
 */
export function monterBoites(scene: Scene, plan: Plan, ambiant: { force: number; hemi: HemisphericLight }): Mesh[] {
  const lots = trierBoites(plan)

  const cube = CreateBox('gabarit', { size: 1 }, scene)
  const gabarit = VertexData.ExtractFromMesh(cube)
  cube.dispose()
  const g = geometrieCuite(
    { positions: gabarit.positions!, normals: gabarit.normals!, indices: gabarit.indices! },
    lots.cuites,
    LUMIERE as { largeur: number; hauteur: number; boites: Record<string, (number[] | number)[]> },
  )
  const cuites = new Mesh('cuites', scene)
  Object.assign(new VertexData(), g).applyToMesh(cuites)
  const platre = matiere('cuites', scene)
  cuites.material = platre
  void chargerAtlas(scene, ambiant.force, ambiant.hemi)
    .then((t) => (platre.lightmapTexture = t))
    // Sans atlas, l'ambiance d'avant : le musée reste visitable.
    .catch((erreur: unknown) => console.warn('lumière précalculée indisponible', erreur))

  const opaques = cubes('opaques', lots.opaques.map((t) => t.b), scene, matiere('opaques', scene))
  const couleurs = new Float32Array(4 * lots.opaques.length)
  lots.opaques.forEach(({ couleur }, i) => {
    const c = Color3.FromHexString(couleur).toLinearSpace()
    couleurs.set([c.r, c.g, c.b, 1], 4 * i)
  })
  opaques.thinInstanceSetBuffer('color', couleurs, 4)

  const vitre = matiere('verre', scene, '#cfe3dd')
  vitre.alpha = 0.12
  vitre.disableDepthWrite = true
  cubes('verre', lots.verre, scene, vitre)

  // ponytail : un seul dépoli, celui du jour ; la nuit et le plafond électrique du rez-de-chaussée viendront avec l'heure qui passe.
  const depoli = matiere('lanterneau', scene, '#f4f1ea')
  depoli.emissiveColor = Color3.FromHexString('#fff6e6').toLinearSpace().scale(0.55)
  cubes('lanterneau', lots.lanterneau, scene, depoli)

  cuites.receiveShadows = opaques.receiveShadows = true
  return [cuites, opaques]
}
