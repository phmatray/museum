/**
 * Les toiles de l'accrochage, tous niveaux : cadres en thin instances, toiles
 * en UN maillage fusionné sur l'atlas des médias (`media/atlas.json`), soit
 * deux appels de dessin pour 116 toiles. Sans atlas (`public/media` est
 * gitignoré, c'est le cas normal en local), un repli DynamicTexture peint la
 * MÊME grille 16 × 16 de tuiles 256 × 128 : nom du dépôt, propriétaire,
 * langage et étoiles. Les UV ne changent pas d'un cas à l'autre.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Scene } from '@babylonjs/core/scene'

import { DEFAULT_ASPECT } from '../domain/hanging.ts'
import { couleurDeLangage } from '../domain/langages.ts'
import type { Artwork, AtlasIndex } from '../domain/types.ts'
import type { Accrochage } from '../plan/hang.ts'
import { matiere } from './boites.ts'

/** Bordure et profondeur du cadre, comme `builders/artwork.ts`. */
const BORDURE = 0.06
const PROFONDEUR = 0.05
/** La toile flotte 4 mm devant le cadre. */
const DECOLLE = PROFONDEUR + 0.004
/** La grille de l'atlas, en tuiles et en pixels. */
const COLS = 16
const ROWS = 16
const TUILE_L = 256
const TUILE_H = 128

export interface Pose {
  cle: string
  /** Matrice 16 du cadre, ligne majeure. */
  cadre: Float32Array
  /** Les 4 coins de la toile : bas-gauche, bas-droite, haut-droite, haut-gauche (droite du visiteur). */
  coins: [number, number, number][]
}

/**
 * Les placements (positions monde, normale de mur) en cadres et coins de toile,
 * comme `computePoses` de three. La base du cadre est (droite, haut, normale) :
 * directe, donc sans retournement de faces.
 */
export function poserToiles(accrochage: Accrochage): Pose[] {
  return accrochage.rooms.flatMap((salle) =>
    salle.placements.map((p): Pose => {
      const [nx, nz] = p.normal
      const w = p.width
      const h = w / DEFAULT_ASPECT
      // Le visiteur regarde le mur (vers −n) : sa droite est (nz, 0, −nx).
      const [dx, dz] = [nz, -nx]
      const lw = w + 2 * BORDURE
      const lh = h + 2 * BORDURE
      const t = PROFONDEUR / 2
      // Babylon : vecteur ligne, chaque ligne est un axe mis à l'échelle, la translation en bas.
      const cadre = new Float32Array([
        dx * lw, 0, dz * lw, 0,
        0, lh, 0, 0,
        nx * PROFONDEUR, 0, nz * PROFONDEUR, 0,
        p.x + nx * t, p.y, p.z + nz * t, 1,
      ])
      const cx = p.x + nx * DECOLLE
      const cz = p.z + nz * DECOLLE
      const coin = (sd: number, sh: number): [number, number, number] => [cx + (sd * dx * w) / 2, p.y + (sh * h) / 2, cz + (sd * dz * w) / 2]
      return { cle: p.key, cadre, coins: [coin(-1, -1), coin(1, -1), coin(1, 1), coin(-1, 1)] }
    }))
}

/** u0, vBas, u1, vHaut de la tuile `layer` (invertY : ligne 0 en haut). */
export function uvDeTuile(layer: number, cols = COLS, rows = ROWS): [number, number, number, number] {
  const c = layer % cols
  const r = Math.floor(layer / cols)
  return [c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows]
}

export async function monterToiles(scene: Scene, accrochage: Accrochage, base: string): Promise<void> {
  const poses = poserToiles(accrochage)
  // Le serveur de dev répond index.html à une URL absente : le JSON échoue et l'on prend le repli.
  const index = await fetch(`${base}media/atlas.json`)
    .then((r) => (r.ok ? (r.json() as Promise<AtlasIndex>) : null))
    .catch(() => null)
  // ponytail : la seule feuille 0 de l'atlas (256 places, 116 toiles) ; une toile sur une autre feuille garde son cadre seul.
  const couche = (p: Pose, i: number) => {
    if (index === null) return i
    const e = index.entries[p.cle]
    return e?.atlas === 0 ? e.layer : undefined
  }

  const cadres = CreateBox('cadres', { size: 1 }, scene)
  // ArtworkLayer : #241f1b, rugosité 0,55 (le métal à 0,05 ne se voit pas sans environnement).
  const bois = matiere('cadres', scene, '#241f1b', 0.55)
  cadres.material = bois
  cadres.receiveShadows = true
  const matrices = new Float32Array(poses.length * 16)
  poses.forEach((p, i) => matrices.set(p.cadre, i * 16))
  cadres.thinInstanceSetBuffer('matrix', matrices, 16, true)

  // Une toile absente de l'index garde son cadre mais pas de toile : la couche 0 montrerait un autre dépôt.
  const peintes = poses.flatMap((p, i) => {
    const layer = couche(p, i)
    return layer === undefined || layer >= COLS * ROWS ? [] : [{ p, layer }]
  })
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const [k, { p, layer }] of peintes.entries()) {
    const [u0, v0, u1, v1] = uvDeTuile(layer)
    for (const c of p.coins) positions.push(...c)
    // La normale du mur, retrouvée sur la matrice du cadre (3e ligne, profondeur).
    for (let j = 0; j < 4; j++) normals.push(p.cadre[8] / PROFONDEUR, 0, p.cadre[10] / PROFONDEUR)
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1)
    const o = k * 4
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3)
  }
  const toiles = new Mesh('toiles', scene)
  Object.assign(new VertexData(), { positions, normals, uvs, indices }).applyToMesh(toiles)
  const peinture = new StandardMaterial('toiles', scene)
  peinture.disableLighting = true
  peinture.diffuseColor = Color3.Black()
  // Filet de sécurité en repère droit : une toile vue de dos se verrait plutôt que de disparaître.
  peinture.backFaceCulling = false
  toiles.material = peinture
  toiles.isPickable = cadres.isPickable = false

  const brancher = (t: BaseTexture) => (peinture.emissiveTexture = t)
  const replier = () => void repli(scene, base, peintes).then(brancher)
  if (index === null) return replier()
  const atlas = new Texture(`${base}media/${index.atlases[0]}`, scene, { invertY: true, onError: replier })
  brancher(atlas)
}

/** L'atlas de repli : chaque tuile peinte à sa place, un aplat du langage et le nom du dépôt. */
async function repli(scene: Scene, base: string, peintes: { p: Pose; layer: number }[]): Promise<DynamicTexture> {
  const catalogue = await fetch(`${base}data/catalogue.json`)
    .then((r) => r.json() as Promise<{ artworks: Artwork[] }>)
    .catch(() => ({ artworks: [] }))
  const fiches = new Map(catalogue.artworks.map((a) => [a.key, a]))
  const dt = new DynamicTexture('repli', { width: COLS * TUILE_L, height: ROWS * TUILE_H }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  g.textBaseline = 'top'
  for (const { p, layer } of peintes) {
    const x = (layer % COLS) * TUILE_L
    const y = Math.floor(layer / COLS) * TUILE_H
    const a = fiches.get(p.cle)
    const [proprietaire, nom] = p.cle.split('/')
    g.fillStyle = assombrir(couleurDeLangage(a?.language ?? ''), 0.45)
    g.fillRect(x, y, TUILE_L, TUILE_H)
    g.fillStyle = '#efe4cc'
    g.font = 'bold 26px sans-serif'
    const lignes = couper(g, a?.title ?? nom, TUILE_L - 24).slice(0, 2)
    lignes.forEach((l, i) => g.fillText(l, x + 12, y + 12 + i * 30, TUILE_L - 24))
    g.font = '17px sans-serif'
    const bas = y + 18 + lignes.length * 30
    g.fillText([proprietaire, a?.language].filter(Boolean).join(' · '), x + 12, bas, TUILE_L - 24)
    if (a) g.fillText(`★ ${a.stars}`, x + 12, bas + 24)
  }
  dt.update()
  return dt
}

/** Coupe un titre en lignes au mot près (un mot trop long reste entier, `fillText` le serre). */
function couper(g: CanvasRenderingContext2D, texte: string, largeur: number): string[] {
  const lignes: string[] = []
  for (const mot of texte.split(/\s+/)) {
    const essai = lignes.length ? `${lignes[lignes.length - 1]} ${mot}` : mot
    if (lignes.length && g.measureText(essai).width <= largeur) lignes[lignes.length - 1] = essai
    else lignes.push(mot)
  }
  return lignes
}

/** `#rrggbb` assombri de `part` (0,45 → 55 % de la couleur). */
function assombrir(hex: string, part: number): string {
  const c = Color3.FromHexString(hex).scale(1 - part)
  return c.toHexString()
}
