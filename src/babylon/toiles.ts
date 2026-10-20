/**
 * Les toiles de l'accrochage, tous niveaux : cadres en thin instances, toiles
 * en UN maillage fusionné sur l'atlas des médias (`media/atlas.json`), soit
 * deux appels de dessin pour 116 toiles. Sans atlas (`public/media` est
 * gitignoré, c'est le cas normal en local), un repli DynamicTexture peint la
 * MÊME grille 16 × 16 de tuiles 256 × 128 : nom du dépôt, propriétaire,
 * langage et étoiles. Les UV ne changent pas d'un cas à l'autre.
 *
 * Le spot peint de three (`peindreLeSpot` d'ArtworkLayer) : chaque toile est une
 * grille 5 × 5 dont les couleurs de sommets portent le halo. De près (< 8 m,
 * 6 au plus), la vignette 1024 × 512 de `media/near/` se pose 2 mm devant la
 * tuile de l'atlas. Le nom de chaque salle est peint au-dessus de son mur nord.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Scene } from '@babylonjs/core/scene'

import { DEFAULT_ASPECT } from '../domain/hanging.ts'
import { couleurDeLangage } from '../domain/langages.ts'
import type { AtlasIndex } from '../domain/types.ts'
import { cimaisesDe } from '../plan/cimaises.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { INT } from '../plan/svg.ts'
import { SALLE_VITRINES } from '../plan/vitrines.ts'
import { matiere } from './boites.ts'
import { catalogue } from './etat.ts'
import { brancherLueurs } from './lueurs.ts'
import { police } from './polices.ts'
import { atlasDeTextes, maillageDeQuads, matiereDeTexte } from './textes.ts'

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
/** Le LOD proche (io/arrayTexture.ts, planToilesGeometry.ts) : 6 vignettes, entrée sous 8 m, sortie au-delà de 11. */
const MAX_PROCHES = 6
const ENTREE = 8
const SORTIE = 11
/** L'axe des toiles est à 1,55 m, l'œil vers 1,6 m ; un étage plus haut, 4,80 m. */
const MEME_NIVEAU = 2.4
/** La grille du halo : N × N quads par toile. */
const N = 4

export interface Pose {
  /** `salle#clé`, comme `computePoses`. */
  id: string
  cle: string
  /** La face du mur au centre de la toile (`at(0)` de three) : la distance du LOD se mesure d'ici. */
  centre: [number, number, number]
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
      return { id: `${salle.id}#${p.key}`, cle: p.key, centre: [p.x, p.y, p.z], cadre, coins: [coin(-1, -1), coin(1, -1), coin(1, 1), coin(-1, 1)] }
    }))
}

/** u0, vBas, u1, vHaut de la tuile `layer` (invertY : ligne 0 en haut). */
export function uvDeTuile(layer: number, cols = COLS, rows = ROWS): [number, number, number, number] {
  const c = layer % cols
  const r = Math.floor(layer / cols)
  return [c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows]
}

/**
 * Le spot de three, `lin × (0,72 + 0,34 e^(−3|uv − (0,5 ; 0,62)|²))`, en couleur
 * de sommet. Le Standard compose en gamma puis élève TOUT à 2,2 : le facteur
 * entre donc à la puissance 1/2,2 pour ressortir tel quel.
 */
export function halo(s: number, t: number): number {
  const [a, b] = [s - 0.5, t - 0.62]
  return (0.72 + 0.34 * Math.exp(-3 * (a * a + b * b))) ** (1 / 2.2)
}

interface Geometrie { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[] }

/** Ajoute une toile en grille (N + 1)² entre ses 4 coins, `uv` = u0, vBas, u1, vHaut, décollée de `decal` m. */
function grille(g: Geometrie, p: Pose, [u0, v0, u1, v1]: readonly number[], decal = 0): void {
  const [bg, bd, , hg] = p.coins
  const [nx, nz] = [p.cadre[8] / PROFONDEUR, p.cadre[10] / PROFONDEUR]
  const o = g.positions.length / 3
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const [s, t] = [i / N, j / N]
      for (let a = 0; a < 3; a++) g.positions.push(bg[a] + s * (bd[a] - bg[a]) + t * (hg[a] - bg[a]) + decal * [nx, 0, nz][a])
      g.normals.push(nx, 0, nz)
      g.uvs.push(u0 + s * (u1 - u0), v0 + t * (v1 - v0))
      const f = halo(s, t)
      g.colors.push(f, f, f, 1)
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = o + j * (N + 1) + i
      g.indices.push(k, k + 1, k + N + 2, k, k + N + 2, k + N + 1)
    }
  }
}

function maillage(nom: string, scene: Scene, remplir: (g: Geometrie) => void): Mesh {
  const g: Geometrie = { positions: [], normals: [], uvs: [], colors: [], indices: [] }
  remplir(g)
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), g).applyToMesh(m)
  m.isPickable = false
  return m
}

/** La peinture non éclairée des toiles : la texture en émissif, le halo en couleur de sommet. */
function peinture(nom: string, scene: Scene, t?: BaseTexture): StandardMaterial {
  const mat = new StandardMaterial(nom, scene)
  mat.disableLighting = true
  mat.diffuseColor = Color3.Black()
  mat.specularColor = Color3.Black()
  // Filet de sécurité en repère droit : une toile vue de dos se verrait plutôt que de disparaître.
  mat.backFaceCulling = false
  if (t) mat.emissiveTexture = t
  return mat
}

/**
 * Les toiles qui méritent leur vignette (planToilesGeometry.ts `posesProches`),
 * avec hystérésis : une toile ENTRE sous 8 m, ne SORT qu'au-delà de 11, et ne
 * cède sa place, quand les six sont prises, qu'à une toile plus proche qu'elle
 * de 3 m. Rend les identifiants triés.
 */
export function posesProches(poses: readonly Pick<Pose, 'id' | 'centre'>[], oeil: { x: number; y: number; z: number }, avant: readonly string[]): string[] {
  const distance = new Map<string, number>()
  for (const { id, centre: [x, y, z] } of poses) if (Math.abs(y - oeil.y) < MEME_NIVEAU) distance.set(id, Math.hypot(x - oeil.x, y - oeil.y, z - oeil.z))
  const d = (id: string) => distance.get(id) ?? Infinity
  const gardees = avant.filter((id) => d(id) <= SORTIE)
  const candidats = poses
    .map((p) => p.id)
    .filter((id) => d(id) <= ENTREE && !gardees.includes(id))
    .sort((a, b) => d(a) - d(b) || (a < b ? -1 : 1))
  for (const c of candidats) {
    if (gardees.length < MAX_PROCHES) {
      gardees.push(c)
      continue
    }
    const loin = gardees.reduce((a, b) => (d(b) > d(a) ? b : a))
    if (d(loin) - d(c) <= SORTIE - ENTREE) break
    gardees[gardees.indexOf(loin)] = c
  }
  return gardees.sort()
}

/** Rend les porteurs d'ombre : les cadres et les noms de salle. */
export async function monterToiles(scene: Scene, accrochage: Accrochage, base: string): Promise<Mesh[]> {
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
  brancherLueurs([bois])
  cadres.material = bois
  cadres.receiveShadows = true
  const matrices = new Float32Array(poses.length * 16)
  poses.forEach((p, i) => matrices.set(p.cadre, i * 16))
  cadres.thinInstanceSetBuffer('matrix', matrices, 16, true)
  cadres.isPickable = false

  // Une toile absente de l'index garde son cadre mais pas de toile : la couche 0 montrerait un autre dépôt.
  const peintes = poses.flatMap((p, i) => {
    const layer = couche(p, i)
    return layer === undefined || layer >= COLS * ROWS ? [] : [{ p, layer }]
  })
  const toiles = maillage('toiles', scene, (g) => {
    for (const { p, layer } of peintes) grille(g, p, uvDeTuile(layer))
  })
  const mat = peinture('toiles', scene)
  toiles.material = mat

  const brancher = (t: BaseTexture) => (mat.emissiveTexture = t)
  // Une fois au plus : Babylon peut appeler onError deux fois pour une même image.
  let replie = false
  const replier = () => {
    if (replie) return
    replie = true
    void repli(scene, base, peintes).then((t) => {
      mat.emissiveTexture?.dispose()
      brancher(t)
    })
  }
  if (index === null) replier()
  else {
    // Les chemins de l'index sont relatifs à la base (« media/atlas-0.webp »), comme io/arrayTexture.ts.
    // Comme three : bilinéaire SANS mipmaps (elles feraient baver les tuiles voisines au loin), bords serrés.
    const atlas = new Texture(`${base}${index.atlases[0]}`, scene, { invertY: true, noMipmap: true, samplingMode: Texture.BILINEAR_SAMPLINGMODE, onError: replier })
    atlas.wrapU = atlas.wrapV = Texture.CLAMP_ADDRESSMODE
    brancher(atlas)
  }

  suivreLesProches(scene, poses, base)
  return [cadres, await nomsDesSalles(scene, accrochage)]
}

/**
 * Le LOD proche : réévalué tous les demi-mètres de l'œil. Une vignette arrivée
 * crée sa toile (matière complète, jamais retouchée : rien pour VIVANTES) ; un
 * échec garde la tuile de l'atlas, en silence ; une toile sortie est libérée.
 */
function suivreLesProches(scene: Scene, poses: Pose[], base: string): void {
  const parId = new Map(poses.map((p) => [p.id, p]))
  const proches = new Map<string, { texture: Texture; mesh?: Mesh }>()
  let derniere = { x: Infinity, y: 0, z: 0 }
  scene.onBeforeRenderObservable.add(() => {
    const oeil = scene.activeCamera?.position
    if (!oeil || (oeil.x - derniere.x) ** 2 + (oeil.y - derniere.y) ** 2 + (oeil.z - derniere.z) ** 2 < 0.25) return
    derniere = { x: oeil.x, y: oeil.y, z: oeil.z }
    const vues = posesProches(poses, oeil, [...proches.keys()])
    for (const [id, v] of proches) {
      if (vues.includes(id)) continue
      v.mesh?.material?.dispose()
      v.mesh?.dispose()
      v.texture.dispose()
      proches.delete(id)
    }
    for (const id of vues) {
      if (proches.has(id)) continue
      const p = parId.get(id)!
      const texture: Texture = new Texture(`${base}media/near/${p.cle.replace('/', '__')}.webp`, scene, {
        invertY: true,
        samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
        onLoad: () => {
          const v = proches.get(id)
          if (v?.texture !== texture) return void texture.dispose()
          // 2 mm devant la tuile de l'atlas, qui reste dessous : jamais de trou pendant la bascule.
          v.mesh = maillage(`toile-proche:${id}`, scene, (g) => grille(g, p, [0, 0, 1, 1], 0.002))
          v.mesh.material = peinture(`toile-proche:${id}`, scene, texture)
        },
        onError: () => {},
      })
      texture.anisotropicFilteringLevel = 8
      texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE
      proches.set(id, { texture })
    }
  })
}

/** PlanToiles : le nom de chaque salle sur son mur nord, face au sud, PT Sans 0,32 m crème, peint (éclairé). */
async function nomsDesSalles(scene: Scene, accrochage: Accrochage): Promise<Mesh> {
  const PPM = 200
  const EM = 0.32 * PPM
  const INTERLIGNE = 1.2 * EM
  await police('PT Sans')
  const fonte = `${EM}px 'PT Sans'`
  const mesure = document.createElement('canvas').getContext('2d')!
  mesure.font = fonte
  const noms = accrochage.rooms.flatMap((salle) => {
    const niveau = MUSEE.levels.find((l) => l.id === salle.level)
    const room = niveau?.rooms.find((r) => r.id === salle.id)
    // Le mur nord de la salle d'honneur porte les vitrines : pas de nom par-dessus.
    if (!niveau || !room || room.id === SALLE_VITRINES) return []
    // Plus haut derrière une cimaise qui court devant le mur nord.
    const masque = cimaisesDe(salle.level, room.id).some((c) => c.axe === 'x' && c.z < room.z + room.depth / 2)
    const lignes = couper(mesure, salle.name, (room.width - 2) * PPM)
    const l = Math.ceil(Math.max(...lignes.map((t) => mesure.measureText(t).width))) + 8
    const h = Math.ceil(lignes.length * INTERLIGNE)
    const centre = [room.x + room.width / 2, niveau.elevation + (masque ? 3.95 : 3.1), room.z + INT + 0.01] as const
    return [{ lignes, l, h, centre }]
  })
  const { dt, uvs } = atlasDeTextes('noms-de-salle', scene, noms, (g, i, x, y) => {
    g.font = fonte
    g.fillStyle = '#efe4cc'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    noms[i].lignes.forEach((t, k) => g.fillText(t, x + noms[i].l / 2, y + (k + 0.5) * INTERLIGNE))
  })
  const mat = matiereDeTexte('noms-de-salle', scene, dt, 0.85)
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST
  brancherLueurs([mat])
  // Face au sud (+z), lu depuis la salle : la gauche du texte à l'ouest.
  const quads = noms.map((n, i) => ({ centre: n.centre, droite: [1, 0, 0] as const, haut: [0, 1, 0] as const, l: n.l / PPM, h: n.h / PPM, uv: uvs[i] }))
  const m = maillageDeQuads('noms-de-salle', quads, scene, mat)
  m.receiveShadows = true
  return m
}

/** L'atlas de repli : chaque tuile peinte à sa place, un aplat du langage et le nom du dépôt. */
async function repli(scene: Scene, base: string, peintes: { p: Pose; layer: number }[]): Promise<DynamicTexture> {
  const fiches = (await catalogue(base))?.parCle ?? new Map()
  // Comme l'atlas : sans mipmaps.
  const dt = new DynamicTexture('repli', { width: COLS * TUILE_L, height: ROWS * TUILE_H }, scene, false, Texture.BILINEAR_SAMPLINGMODE)
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

/**
 * Coupe un texte en lignes au mot près (un mot trop long reste entier, `fillText`
 * le serre). Au-delà de `max` lignes, la dernière gardée finit par « … » (sans
 * ponctuation pendante), raccourcie au mot jusqu'à tenir dans `largeur`.
 */
export function couper(g: Pick<CanvasRenderingContext2D, 'measureText'>, texte: string, largeur: number, max = Infinity): string[] {
  const lignes: string[] = []
  for (const mot of texte.split(/\s+/)) {
    const essai = lignes.length ? `${lignes[lignes.length - 1]} ${mot}` : mot
    if (lignes.length && g.measureText(essai).width <= largeur) lignes[lignes.length - 1] = essai
    else lignes.push(mot)
  }
  if (lignes.length <= max) return lignes
  const coupe = lignes.slice(0, max)
  let d = coupe[max - 1]
  while (g.measureText(`${d}…`).width > largeur && d.includes(' ')) d = d.replace(/\s+\S+$/, '')
  coupe[max - 1] = `${d.replace(/[,.;:]$/, '')}…`
  return coupe
}

/** `#rrggbb` assombri de `part` (0,45 → 55 % de la couleur). */
function assombrir(hex: string, part: number): string {
  const c = Color3.FromHexString(hex).scale(1 - part)
  return c.toHexString()
}
