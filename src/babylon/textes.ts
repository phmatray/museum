/**
 * Les textes peints (l'équivalent des `<Text>` troika et de lotDeTextes.ts) :
 * UN atlas (texture brute) rangé en étagères, UN maillage de quads orientés,
 * donc un appel de dessin pour tout un lot (cartels, légendes, noms de salle,
 * textes des vitrines…).
 *
 * Usage :
 *   await police('PT Sans')
 *   const { dt, uvs } = atlasDeTextes('cartels', scene, tailles, (g, i, x, y) => { … dessin en pixels … })
 *   maillageDeQuads('cartels', quads.map((q, i) => ({ ...q, uv: uvs[i] })), scene, matiereDeTexte('cartels', scene, dt))
 *
 * Repère d'un quad : `droite` et `haut` unitaires, la normale vaut droite × haut
 * (mur de normale (nx, nz) : droite = (nz, 0, −nx)). Les indices 0 2 1, 0 3 2
 * tiennent la face avant en scène main droite (facade.ts).
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Material } from '@babylonjs/core/Materials/material'
import type { Scene } from '@babylonjs/core/scene'

import { matiere } from './boites.ts'

type V3 = readonly [number, number, number]
/** u0, vBas, u1, vHaut. */
export type UV = [number, number, number, number]

/**
 * Range des cases (pixels) en étagères de `largeurMax` au plus, les plus hautes
 * d'abord (une étagère ne garde pas la hauteur d'une colonne de texte pour une
 * ligne de cartel) : coin haut-gauche de chaque case, dans l'ordre donné, et la
 * taille du canevas. Une marge de 2 px sépare les cases (les mipmaps ne bavent
 * pas d'un texte sur l'autre).
 */
export function rangerTuiles(tailles: readonly { l: number; h: number }[], largeurMax = 4096): { L: number; H: number; places: { x: number; y: number }[] } {
  const M = 2
  let [x, y, etagere, L] = [0, 0, 0, 0]
  const places: { x: number; y: number }[] = []
  for (const i of tailles.map((_, i) => i).sort((a, b) => tailles[b].h - tailles[a].h)) {
    const { l, h } = tailles[i]
    if (x > 0 && x + l > largeurMax) [x, y, etagere] = [0, y + etagere + M, 0]
    places[i] = { x, y }
    x += Math.ceil(l) + M
    etagere = Math.max(etagere, Math.ceil(h))
    L = Math.max(L, x)
  }
  return { L: Math.max(1, L), H: Math.max(1, y + etagere), places }
}

/** Les UV d'une case (haut du canevas en v = 1 : `atlasDeTextes` retourne les rangées). */
export function uvDeCase(p: { x: number; y: number }, t: { l: number; h: number }, L: number, H: number): UV {
  return [p.x / L, 1 - (p.y + t.h) / H, (p.x + t.l) / L, 1 - p.y / H]
}

export interface Quad {
  centre: V3
  droite: V3
  haut: V3
  /** Largeur et hauteur, en mètres. */
  l: number
  h: number
  uv: UV
}

/** Les quads fusionnés : coins BG, BD, HD, HG, normale droite × haut. */
export function geometrieDeQuads(quads: readonly Quad[]): { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array } {
  const out = {
    positions: new Float32Array(12 * quads.length),
    normals: new Float32Array(12 * quads.length),
    uvs: new Float32Array(8 * quads.length),
    indices: new Uint32Array(6 * quads.length),
  }
  quads.forEach(({ centre: c, droite: d, haut: u, l, h, uv: [u0, v0, u1, v1] }, k) => {
    const n = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
    ;[[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sd, sh], j) => {
      for (let a = 0; a < 3; a++) {
        out.positions[12 * k + 3 * j + a] = c[a] + (sd * d[a] * l) / 2 + (sh * u[a] * h) / 2
        out.normals[12 * k + 3 * j + a] = n[a]
      }
    })
    out.uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], 8 * k)
    const o = 4 * k
    out.indices.set([o, o + 2, o + 1, o, o + 3, o + 2], 6 * k)
  })
  return out
}

export function maillageDeQuads(nom: string, quads: readonly Quad[], scene: Scene, mat: Material): Mesh {
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), geometrieDeQuads(quads)).applyToMesh(m)
  m.material = mat
  m.isPickable = false
  return m
}

/** Le plus grand côté d'un atlas de textes : au-delà, toutes les cases sont réduites d'autant. */
const COTE_MAX = 4096

/**
 * Un atlas de textes : une case par taille (pixels), rangée en étagères,
 * `peindre(g, i, x, y)` dessine la case i depuis son coin haut-gauche (le
 * contexte est remis à neuf entre deux cases). Fond transparent. Si le
 * rangement dépasse `COTE_MAX` de haut, le canevas est réduit (le peintre
 * dessine toujours dans ses pixels, le contexte est mis à l'échelle).
 */
export function atlasDeTextes(
  nom: string,
  scene: Scene,
  tailles: readonly { l: number; h: number }[],
  peindre: (g: CanvasRenderingContext2D, i: number, x: number, y: number) => void,
): { dt: RawTexture; uvs: UV[] } {
  let k = 1
  let r = rangerTuiles(tailles, COTE_MAX)
  while (r.H > COTE_MAX) {
    k *= 0.9
    r = rangerTuiles(tailles.map((t) => ({ l: t.l * k, h: t.h * k })), COTE_MAX)
  }
  const { L, H, places } = r
  const toile = document.createElement('canvas')
  Object.assign(toile, { width: L, height: H })
  const g = toile.getContext('2d')!
  places.forEach((p, i) => {
    g.save()
    g.scale(k, k)
    peindre(g, i, p.x / k, p.y / k)
    g.restore()
  })
  // Le canevas, retourné (rangée 0 en bas, v = 0) et débordé, monté en texture brute mipmappée.
  const px = g.getImageData(0, 0, L, H).data
  const data = new Uint8Array(L * H * 4)
  for (let y = 0; y < H; y++) data.set(px.subarray((H - 1 - y) * L * 4, (H - y) * L * 4), y * L * 4)
  deborder(data, L, H)
  const dt = RawTexture.CreateRGBATexture(data, L, H, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE)
  // Babylon garde la copie pour une perte de contexte : jusqu'à 55 Mo de tas par atlas, lâchés ici.
  // ponytail : après une perte de contexte, les textes restent vides ; repeindre si cela arrive en vrai.
  dt.getInternalTexture()!._bufferView = null
  dt.name = nom
  dt.hasAlpha = true
  dt.anisotropicFilteringLevel = 4
  return { dt, uvs: places.map((p, i) => uvDeCase(p, { l: tailles[i].l * k, h: tailles[i].h * k }, L, H)) }
}

/**
 * Le débord des couleurs (« alpha bleeding ») : un pixel transparent prend la
 * teinte de l'encre voisine (sur sa rangée, sinon sur sa colonne), alpha 0
 * inchangé. Sans lui, les mipmaps moyennent l'encre avec le noir des pixels
 * vides et le texte vu de loin pâlit au carré de sa couverture, là où troika
 * (SDF) reste plein.
 */
export function deborder(d: Uint8Array, L: number, H: number): void {
  const vu = new Uint8Array(L * H)
  for (let i = 0; i < L * H; i++) vu[i] = d[4 * i + 3] > 0 ? 1 : 0
  const ligne = (n: number, at: (k: number) => number) => {
    let dernier = -1
    for (const sens of [1, -1]) {
      for (let k = sens > 0 ? 0 : n - 1; k >= 0 && k < n; k += sens) {
        const i = at(k)
        if (vu[i] === 1) dernier = i
        else if (dernier >= 0 && vu[i] === 0) {
          d.copyWithin(4 * i, 4 * dernier, 4 * dernier + 3)
          vu[i] = 2
        }
      }
      dernier = -1
    }
  }
  for (let y = 0; y < H; y++) ligne(L, (x) => y * L + x)
  for (let i = 0; i < L * H; i++) if (vu[i] === 2) vu[i] = 1
  for (let x = 0; x < L; x++) ligne(H, (y) => y * L + x)
}

/**
 * La matière d'un lot de textes. Par défaut celle de troika : non éclairée,
 * tone mappée, fondue (les mipmaps gardent les traits fins, qu'un seuil
 * effacerait). `rugosite` : éclairée (noms de salle peints sur le mur).
 */
export function matiereDeTexte(nom: string, scene: Scene, dt: Texture, rugosite?: number): PBRMaterial {
  const mat = rugosite === undefined ? new PBRMaterial(nom, scene) : matiere(nom, scene, '#ffffff', rugosite)
  mat.unlit = rugosite === undefined
  mat.albedoTexture = dt
  mat.useAlphaFromAlbedoTexture = true
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  mat.backFaceCulling = false
  return mat
}

/** Un DynamicTexture dessiné en mètres (`ppm` pixels par mètre), mipmappé, anisotropie 8, haut du canevas en haut. */
export function canevasEnMetres(nom: string, scene: Scene, l: number, h: number, ppm: number, dessin: (g: CanvasRenderingContext2D) => void): DynamicTexture {
  const dt = new DynamicTexture(nom, { width: Math.round(l * ppm), height: Math.round(h * ppm) }, scene, true)
  dt.anisotropicFilteringLevel = 8
  const g = dt.getContext() as CanvasRenderingContext2D
  g.scale(ppm, ppm)
  dessin(g)
  dt.update(true)
  return dt
}
