/**
 * Les FEUILLES MORTES de l'automne (FeuillesMortes de ParkLayer.tsx) : de petites
 * cartes lobées couchées sur le relief sous chaque érable et chaque ginkgo, aux
 * couleurs de l'arbre, plus serrées sous le houppier. Un maillage, un appel.
 *
 * Saison figée au chargement (`ambiance()`) : la part tombée (`feuillesAuSol`)
 * est triée sur CPU (three la repliait par shader, `step(w, uFeuillesSol)`), et
 * le lobe est découpé par l'alpha d'une petite carte (three : `discard`) ; aucun
 * shader. Hors de l'automne, rien n'est créé. Couchées, elles ne portent pas d'ombre.
 * ponytail : pas de masquage hors champ (`uneEnVue` de three) : ~20 k triangles,
 * moins cher qu'un test par image ; pas d'`intemperer` (neige) : vague météo.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import { presDeLEau } from '../plan/jardin.ts'
import type { Parc } from '../plan/park.ts'
import { hauteurDuParc } from '../plan/relief.ts'
import { matiere } from './boites.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { ambiance, mulberry32, PARC } from './parc.ts'

const AUTOMNE: Record<string, string[]> = {
  'erable-rouge': ['#8c1a12', '#a3230f', '#6e1410', '#5a2a18'],
  'erable-vert': ['#c8641a', '#d4861c', '#b03a14', '#c9a227', '#7a4a22'],
  // Sous le ginkgo, un tapis d'or, d'un seul ton.
  ginkgo: ['#e0b21c', '#d9a414', '#e8c33a', '#c99414'],
}

/** Une feuille d'érable, cinq lobes, sur [−1, 1]² : dedans ou non. */
export const dansLeLobe = (x: number, y: number): boolean => Math.hypot(x, y) <= 0.4 + 0.6 * Math.abs(Math.cos(2.5 * Math.atan2(y, x))) ** 1.5

/**
 * Le tapis (même tirage que three, mulberry32 0x5eed), réduit aux feuilles
 * tombées : `part` = `feuillesAuSol`. Couleurs RGBA linéaires, faces dans l'ordre de Babylon.
 */
export function feuillesMortes(parc: Parc, part: number): { positions: number[]; uvs: number[]; colors: number[]; normals: number[]; indices: number[] } {
  const alea = mulberry32(0x5eed)
  const [positions, uvs, colors, indices] = [[], [], [], []] as number[][]
  for (const p of parc.plantations) {
    const palette = AUTOMNE[p.espece]
    if (!palette) continue
    const rayon = 3 * p.scale
    for (let k = 0; k < 320 * p.scale; k++) {
      const [a, r] = [alea() * Math.PI * 2, rayon * Math.sqrt(alea()) * (0.35 + 0.65 * alea())]
      const [x, z] = [p.x + Math.cos(a) * r, p.z + Math.sin(a) * r]
      if (presDeLEau(x, z, 0.2)) continue
      const y = hauteurDuParc(x, z) + 0.035 + alea() * 0.006
      const [t, l] = [alea() * Math.PI * 2, 0.06 + alea() * 0.05]
      const [c, s] = [Math.cos(t) * l, Math.sin(t) * l]
      const w = alea()
      const teinte = lin(palette[Math.floor(alea() * palette.length)]).scale(0.75 + alea() * 0.4)
      // Les quatre tirages de hauteur ont lieu même pour une feuille encore sur l'arbre : le tirage reste celui de three.
      const coins = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [x + u * c - v * s, y + (alea() - 0.5) * 0.01, z + u * s + v * c, u, v])
      if (w > part) continue
      const rang = positions.length / 3
      for (const [px, py, pz, u, v] of coins) {
        positions.push(px, py, pz)
        uvs.push((u + 1) / 2, (v + 1) / 2)
        colors.push(teinte.r, teinte.g, teinte.b, 1)
      }
      indices.push(rang, rang + 1, rang + 2, rang, rang + 2, rang + 3)
    }
  }
  return { positions, uvs, colors, normals: positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), indices }
}

export function monterFeuilles(scene: Scene): void {
  const part = ambiance().saison.feuillesAuSol
  if (part <= 0) return
  const m = new Mesh('feuilles-mortes', scene)
  Object.assign(new VertexData(), feuillesMortes(PARC, part)).applyToMesh(m)
  const n = 64
  const masque = new Uint8Array(4 * n * n).fill(255)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) masque[4 * (j * n + i) + 3] = dansLeLobe(((i + 0.5) / n) * 2 - 1, ((j + 0.5) / n) * 2 - 1) ? 255 : 0
  const mat = matiere('feuilles-mortes', scene)
  mat.albedoTexture = RawTexture.CreateRGBATexture(masque, n, n, scene, false, false, Texture.BILINEAR_SAMPLINGMODE)
  mat.useAlphaFromAlbedoTexture = true
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST
  mat.alphaCutOff = 0.5
  mat.backFaceCulling = false
  mat.environmentIntensity = 0
  mat.metallicF0Factor = 0
  brancherLueurs([mat])
  m.material = mat
  m.isPickable = false
  m.receiveShadows = true
}
