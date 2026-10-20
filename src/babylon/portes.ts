/**
 * L'habillage des portes (`plan/portes.ts`, modèle `chambranle.glb`), comme
 * PortesLayer.tsx : embrasures doublées de pierre de taille, chambranles,
 * plinthes et entablements de pierre, et le nom de chaque salle en lettres de
 * bronze sur la frise, côté nef, qui s'allument doucement la nuit.
 *
 * Trois appels de dessin : les embrasures (boîtes fusionnées, UV en mètres),
 * toutes les pièces du modèle posées et fusionnées en UN maillage (126 pièces,
 * ~16 k triangles), les 8 enseignes en quads sur un atlas DynamicTexture.
 */
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { Scene } from '@babylonjs/core/scene'

import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { portes, type NomPiece, type Piece } from '../plan/portes.ts'
import { boitesFusionnees, matiere } from './boites.ts'
import { chargerGlb } from './glb.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { creerPierre } from './pierre.ts'
import { police } from './polices.ts'

const PORTES = portes(MUSEE)
/** La largeur de baie du modèle (`W0` de `build-chambranle.py`). */
const W0 = 2
/** Pixels par mètre des enseignes, et hauteur d'une bande de l'atlas (la frise fait 0,36 m). */
const PPM = 512
const BANDE = 0.36

interface Gabarit { positions: Float32Array; normals: Float32Array; indices: Uint32Array }

/**
 * Élargit une pièce modelée pour W0 : chaque moitié glisse vers son côté, si
 * bien que les onglets et le profil gardent leur forme. La plinthe ne s'élargit jamais.
 */
export function elargir(positions: ArrayLike<number>, largeur: number): Float32Array {
  const e = Float32Array.from(positions)
  const d = (largeur - W0) / 2
  for (let i = 0; i < e.length; i += 3) e[i] += Math.sign(e[i]) * d
  return e
}

/**
 * Les pièces posées en un seul maillage : élargies, tournées de `lacet` autour
 * de y (+x local → (cos, 0, −sin), +z local → (sin, 0, cos), comme
 * `setFromAxisAngle(UP, lacet)` de three), puis posées.
 */
export function poserPieces(modele: Record<NomPiece, Gabarit>, pieces: readonly Piece[]): Gabarit {
  const total = (k: 'positions' | 'indices') => pieces.reduce((n, p) => n + modele[p.nom][k].length, 0)
  const out = { positions: new Float32Array(total('positions')), normals: new Float32Array(total('positions')), indices: new Uint32Array(total('indices')) }
  let [v, i] = [0, 0]
  for (const p of pieces) {
    const g = modele[p.nom]
    const pos = p.nom === 'Plinthe' ? g.positions : elargir(g.positions, p.largeur)
    const [c, s] = [Math.cos(p.lacet), Math.sin(p.lacet)]
    for (let k = 0; k < pos.length; k += 3) {
      const [x, y, z] = [pos[k], pos[k + 1], pos[k + 2]]
      const [nx, ny, nz] = [g.normals[k], g.normals[k + 1], g.normals[k + 2]]
      out.positions.set([p.x + c * x + s * z, p.y + y, p.z - s * x + c * z], v + k)
      out.normals.set([c * nx + s * nz, ny, -s * nx + c * nz], v + k)
    }
    for (let k = 0; k < g.indices.length; k++) out.indices[i + k] = g.indices[k] + v / 3
    v += pos.length
    i += g.indices.length
  }
  return out
}

/** « BLAZOR · 9 PROJETS » : le thème de la salle et le nombre de ses œuvres. */
export function texteDEnseigne(accrochage: Accrochage, salle: string, level: number): string {
  const r = accrochage.rooms.find((x) => x.id === salle && x.level === level)
  const n = r?.placements.length ?? 0
  return `${(r?.name ?? salle).toUpperCase()} · ${n} PROJET${n > 1 ? 'S' : ''}`
}

async function chambranles(scene: Scene): Promise<Mesh> {
  const c = await chargerGlb(scene, 'assets/architecture/chambranle.glb')
  try {
    const lire = (nom: NomPiece): Gabarit => {
      const m = c.meshes.find((x) => x.name === nom)!
      return {
        positions: Float32Array.from(m.getVerticesData(VertexBuffer.PositionKind)!),
        normals: Float32Array.from(m.getVerticesData(VertexBuffer.NormalKind)!),
        indices: Uint32Array.from(m.getIndices()!),
      }
    }
    const g = poserPieces({ Chambranle: lire('Chambranle'), Entablement: lire('Entablement'), Plinthe: lire('Plinthe') }, PORTES.pieces)
    const m = new Mesh('chambranles', scene)
    Object.assign(new VertexData(), g).applyToMesh(m)
    // Chambranle_Pierre du GLB : albedo déjà linéaire, double face.
    const pierre = matiere('chambranle', scene, '#ffffff', 0.8)
    pierre.albedoColor = new Color3(0.672, 0.584, 0.434)
    pierre.backFaceCulling = false
    m.material = pierre
    return m
  } finally {
    c.dispose()
  }
}

/** Les 8 enseignes : une bande de l'atlas chacune, 8 quads fusionnés, bronze. */
async function enseignes(scene: Scene, accrochage: Accrochage, jour: number): Promise<Mesh> {
  await police('PT Sans')
  const es = PORTES.enseignes
  const L = Math.max(...es.map((e) => e.longueur))
  const [W, H] = [Math.ceil(L * PPM), Math.ceil(BANDE * PPM)]
  const dt = new DynamicTexture('enseignes', { width: W, height: H * es.length }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  g.clearRect(0, 0, W, H * es.length)
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  es.forEach((e, k) => {
    const texte = texteDEnseigne(accrochage, e.salle, e.level)
    // Le texte tient sur la frise : la taille suit sa longueur (~0,72 em par signe, espacement compris).
    const taille = Math.min(0.15, (e.longueur - 0.3) / (texte.length * 0.72)) * PPM
    g.font = `${taille}px 'PT Sans'`
    g.letterSpacing = `${0.12 * taille}px`
    // L'espacement s'ajoute aussi après la dernière lettre : on recentre d'une demi-espace.
    g.fillText(texte, (e.longueur * PPM) / 2 + 0.06 * taille, (k + 0.5) * H)
    const [c, s] = [Math.cos(e.lacet), Math.sin(e.lacet)]
    const [dx, dy] = [e.longueur / 2, BANDE / 2]
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(e.x + c * sx * dx, e.y + sy * dy, e.z - s * sx * dx)
      normals.push(s, 0, c)
    }
    // invertY : le haut du canevas en v = 1.
    const [u1, vh, vb] = [(e.longueur * PPM) / W, 1 - k / es.length, 1 - (k + 1) / es.length]
    uvs.push(0, vb, u1, vb, u1, vh, 0, vh)
    indices.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3)
  })
  dt.update()
  dt.hasAlpha = true
  const m = new Mesh('enseignes', scene)
  Object.assign(new VertexData(), { positions, normals, uvs, indices }).applyToMesh(m)
  const bronze = matiere('bronze', scene, '#7a5a2e', 0.38)
  bronze.metallic = 0.7
  bronze.albedoTexture = dt
  // Fondu et non découpé : de loin, les mipmaps moyennent l'alpha des traits fins, qu'un seuil effacerait.
  bronze.useAlphaFromAlbedoTexture = true
  bronze.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  bronze.backFaceCulling = false
  // La nuit, le bronze s'éclaire d'une lueur chaude, comme l'enseigne de la façade.
  bronze.emissiveColor = lin('#ffc878').scale(0.55 * (1 - jour))
  m.material = bronze
  m.isPickable = false
  return m
}

/** Monte l'habillage des portes ; rend les porteurs d'ombre (embrasures, chambranles s'ils arrivent). */
export async function monterPortes(scene: Scene, accrochage: Accrochage | null, jour: number): Promise<Mesh[]> {
  const embrasures = boitesFusionnees('embrasures', PORTES.embrasures, scene, creerPierre(scene, 'embrasures'))
  const [cadres, noms] = await Promise.all([
    chambranles(scene).catch((e: unknown) => void console.error('chambranles indisponibles', e)),
    accrochage ? enseignes(scene, accrochage, jour).catch((e: unknown) => void console.error('enseignes indisponibles', e)) : undefined,
  ])
  const porteurs = cadres ? [embrasures, cadres] : [embrasures]
  for (const m of porteurs) m.receiveShadows = true
  if (noms) noms.receiveShadows = true
  brancherLueurs([...porteurs, ...(noms ? [noms] : [])].map((m) => m.material!))
  return porteurs
}
