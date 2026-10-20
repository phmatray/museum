/**
 * « L'atelier en coupe » (AteliersLayer.tsx, `plan/ateliers.ts`) : sous chaque
 * vitrine de la salle d'honneur, l'architecture du même projet en vue éclatée —
 * un socle de bois cerclé de laiton, des plaques de verre (les couches), des
 * blocs (ses projets, à la taille de leur code) et des fils lumineux (ses
 * références), le long desquels une impulsion monte de la dépendance vers qui
 * s'en sert. Données : `data/ateliers.json` et les vitrines du catalogue.
 *
 * Appels : bois, laiton, blocs (couleur d'instance), verre, cartels inclinés,
 * mur d'épure, fils (tubes fusionnés, la comète dans le fragment comme three :
 * plugin `Comete`, un uniform temps, matière dans VIVANTES), textes (un atlas,
 * un maillage). Pas de lightmap (aucun outil de bake ne connaît ces socles).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { Material } from '@babylonjs/core/Materials/material'
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase'
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage'
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import type { Atelier } from '../domain/atelier.ts'
import { ATELIERS, disposerCoupe, MUR_ATELIER, PLAQUE, RECUL_PLAQUES, SOCLE_ATELIER, type Coupe } from '../plan/ateliers.ts'
import type { Box } from '../plan/mesh.ts'
import { choisirVitrines } from '../plan/vitrines.ts'
import { cubes, matiere } from './boites.ts'
import { catalogue, mouvementReduit, VIVANTES } from './etat.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { police, type Police } from './polices.ts'
import { atlasDeTextes, maillageDeQuads, matiereDeTexte, type Quad } from './textes.ts'

type V3 = [number, number, number]

/** La teinte de chaque couche, du socle aux tests : cuivre, or, paille, puis un bleu-vert et un vert sauge. */
const TEINTES: Record<string, string> = {
  socle: '#b8703a', extensions: '#d4a040', assemblages: '#e6cf8c', demonstrations: '#4f9a9c', tests: '#8aa46e',
}
const CREME = '#f4ead2'
const ENCRE = '#2a2620'
const FIL = '#ffc46b'
/** Le filet de laiton sous chaque légende, du montant vers la gauche. */
const FILET = 0.27
/** Pixels par mètre de l'atlas des textes (corps de 1,65 cm ≈ 50 px). */
const PPM = 3000
/** L'interligne `normal` de troika pour PT Sans/Serif. */
const INTERLIGNE = 1.25
const CONTOUR = { l: 0.0018, couleur: 'rgba(28, 20, 12, 0.85)' }

const boite = (p: readonly number[], s: readonly number[]): Box => ({ x: p[0], y: p[1], z: p[2], w: s[0], h: s[1], d: s[2], kind: 'wall' })

/** Le cadre de laiton d'un atelier, en coordonnées locales : quatre montants, la ceinture du haut, et un rebord sous chaque plaque. */
export function laiton(coupe: Coupe): Box[] {
  const [lx, lz] = [PLAQUE.largeur / 2 + 0.018, PLAQUE.profondeur / 2 + 0.018]
  const bas = SOCLE_ATELIER.hauteur
  const h = coupe.hauteur - bas
  const out: Box[] = []
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(boite([sx * lx, bas + h / 2, RECUL_PLAQUES + sz * lz], [0.022, h, 0.022]))
  for (const sz of [-1, 1]) out.push(boite([0, coupe.hauteur, RECUL_PLAQUES + sz * lz], [2 * lx + 0.022, 0.018, 0.018]))
  for (const sx of [-1, 1]) out.push(boite([sx * lx, coupe.hauteur, RECUL_PLAQUES], [0.018, 0.018, 2 * lz]))
  // Les deux lisses qui portent chaque plaque, d'un montant à l'autre.
  for (const pl of coupe.plaques) for (const sx of [-1, 1]) out.push(boite([sx * (lx - 0.004), pl.y - PLAQUE.epaisseur / 2 - 0.006, RECUL_PLAQUES], [0.02, 0.012, 2 * lz]))
  // Le jonc de laiton qui cercle le haut du socle (le bois reste visible dedans), et la plinthe.
  const [sx, sz] = [SOCLE_ATELIER.largeur / 2, SOCLE_ATELIER.profondeur / 2]
  for (const s of [-1, 1]) {
    out.push(boite([0, bas + 0.004, s * (sz - 0.015)], [2 * sx + 0.012, 0.012, 0.042]))
    out.push(boite([s * (sx - 0.015), bas + 0.004, 0], [0.042, 0.012, 2 * sz + 0.012]))
  }
  out.push(boite([0, 0.03, 0], [2 * sx + 0.008, 0.06, 2 * sz + 0.008]))
  // Sous chaque légende, un filet de laiton qui la rattache au coin de sa plaque.
  for (const pl of coupe.plaques) out.push(boite([-lx - FILET / 2, pl.y, RECUL_PLAQUES + lz], [FILET, 0.004, 0.004]))
  return out
}

/** Le point de paramètre t d'une Bézier cubique. */
const bezier = ([a, b, c, d]: readonly V3[], t: number): V3 => {
  const [k0, k1, k2, k3] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3]
  return [0, 1, 2].map((i) => k0 * a[i] + k1 * b[i] + k2 * c[i] + k3 * d[i]) as V3
}
const norme = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const vect = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const SEGMENTS = 40
const COTES = 5
const RAYON_FIL = 0.0035

/**
 * Les fils en tubes (TubeGeometry(40, 0,0035, 5, ouvert) de three), fusionnés :
 * `decalage` = phase du fil − abscisse du sommet le long du fil (0 à la dépendance).
 * Faces avant vers l'extérieur (sens horaire vu du dehors, scène main droite).
 */
export function geometrieDesFils(fils: readonly { points: readonly V3[]; phase: number }[]): { positions: Float32Array; normals: Float32Array; indices: Uint32Array; decalage: Float32Array } {
  const nv = (SEGMENTS + 1) * COTES
  const out = {
    positions: new Float32Array(fils.length * nv * 3),
    normals: new Float32Array(fils.length * nv * 3),
    indices: new Uint32Array(fils.length * SEGMENTS * COTES * 6),
    decalage: new Float32Array(fils.length * nv),
  }
  let ii = 0
  fils.forEach(({ points, phase }, f) => {
    for (let k = 0; k <= SEGMENTS; k++) {
      const u = k / SEGMENTS
      const c = bezier(points, u)
      const ecart = 1e-3
      const [p, q] = [bezier(points, Math.max(0, u - ecart)), bezier(points, Math.min(1, u + ecart))]
      const tg = norme([q[0] - p[0], q[1] - p[1], q[2] - p[2]])
      const n = norme(vect(tg, Math.abs(tg[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
      const b = vect(tg, n)
      for (let j = 0; j < COTES; j++) {
        const a = (2 * Math.PI * j) / COTES
        const r: V3 = [0, 1, 2].map((i) => Math.cos(a) * n[i] + Math.sin(a) * b[i]) as V3
        const v = f * nv + k * COTES + j
        out.positions.set([c[0] + RAYON_FIL * r[0], c[1] + RAYON_FIL * r[1], c[2] + RAYON_FIL * r[2]], 3 * v)
        out.normals.set(r, 3 * v)
        out.decalage[v] = phase - u
      }
    }
    for (let k = 0; k < SEGMENTS; k++)
      for (let j = 0; j < COTES; j++) {
        const s = (kk: number, jj: number) => f * nv + kk * COTES + (jj % COTES)
        const [a, b, c, d] = [s(k, j), s(k + 1, j), s(k, j + 1), s(k + 1, j + 1)]
        out.indices.set([a, b, c, b, d, c], ii)
        ii += 6
      }
  })
  return out
}

/**
 * La comète des fils (le fragment de three), GLSL ou WGSL : la tête à t, la
 * traîne derrière, un passage toutes les quatre secondes ; `comete` = (temps,
 * calme), l'albédo (la couleur du fil) × 0,35 + 0,3 calme + 2,4 impulsion.
 */
export function codeDeLaComete(wgsl: boolean): { vertex: Record<string, string>; fragment: Record<string, string> } {
  const [F, u, entree] = wgsl ? ['f32', 'uniforms.comete', 'fragmentInputs.vFilDecalage'] : ['float', 'comete', 'vFilDecalage']
  const varying = wgsl ? 'varying vFilDecalage: f32;' : 'varying float vFilDecalage;'
  return {
    vertex: {
      CUSTOM_VERTEX_DEFINITIONS: wgsl ? `attribute filDecalage: f32;\n${varying}` : `attribute float filDecalage;\n${varying}`,
      CUSTOM_VERTEX_MAIN_END: wgsl ? 'vertexOutputs.vFilDecalage = vertexInputs.filDecalage;' : 'vFilDecalage = filDecalage;',
    },
    fragment: {
      CUSTOM_FRAGMENT_DEFINITIONS: varying,
      CUSTOM_FRAGMENT_UPDATE_ALPHA: `{
  ${wgsl ? 'var d: f32' : `${F} d`} = fract(${u}.x * 0.25 + ${entree});
  surfaceAlbedo *= 0.35 + 0.3 * ${u}.y + 2.4 * pow(1.0 - d, 10.0) * (1.0 - ${u}.y);
}`,
    },
  }
}

class Comete extends MaterialPluginBase {
  readonly calme: boolean
  constructor(m: Material, calme: boolean) {
    super(m, 'Comete', 200, { COMETE: true }, true, true)
    this.calme = calme
  }

  override getClassName(): string {
    return 'Comete'
  }

  override isCompatible(langue: ShaderLanguage): boolean {
    return langue === ShaderLanguage.GLSL || langue === ShaderLanguage.WGSL
  }

  override getAttributes(attributes: string[]): void {
    attributes.push('filDecalage')
  }

  override getUniforms(langue?: ShaderLanguage) {
    return { ubo: [{ name: 'comete', size: 2, type: 'vec2' }], fragment: langue === ShaderLanguage.WGSL ? '' : 'uniform vec2 comete;' }
  }

  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat2('comete', this.calme ? 0 : performance.now() / 1000, this.calme ? 1 : 0)
  }

  override getCustomCode(type: string, langue?: ShaderLanguage): { [point: string]: string } | null {
    const c = codeDeLaComete(langue === ShaderLanguage.WGSL)
    return type === 'fragment' ? c.fragment : type === 'vertex' ? c.vertex : null
  }
}

interface Expose {
  x: number
  z: number
  atelier: Atelier
  coupe: Coupe
}

/** Un texte troika : `point` est son ancre, `alignX` vaut à la fois anchorX et textAlign. */
interface Ecrit {
  texte: string
  police: Police
  corps: number
  interligne?: number
  /** letterSpacing, en em. */
  ls?: number
  couleur: string
  /** maxWidth, en mètres. */
  largeur?: number
  contour?: boolean
  /** Coupe aussi après les points (les noms de projet, que `coupable` rendait sécables dans three). */
  points?: boolean
  alignX: 'left' | 'center' | 'right'
  ancreY: 'haut' | 'bas'
  point: V3
  droite: V3
  haut: V3
}

/** Les lignes d'un texte coupé à `max` px (aux blancs, et après les points si demandé). */
function lignesDe(g: OffscreenCanvasRenderingContext2D, e: Ecrit, max?: number): string[] {
  const out: string[] = []
  for (const para of e.texte.split('\n')) {
    let ligne = ''
    for (const mot of para.split(' '))
      (e.points ? mot.split(/(?<=\.)/) : [mot]).forEach((bout, k) => {
        const essai = ligne + (k === 0 && ligne ? ' ' : '') + bout
        if (!ligne || max === undefined || g.measureText(essai).width <= max) ligne = essai
        else {
          out.push(ligne)
          ligne = bout
        }
      })
    out.push(ligne)
  }
  return out
}

const fonte = (g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, e: Ecrit) => {
  g.font = `${e.corps * PPM}px '${e.police}'`
  g.letterSpacing = `${(e.ls ?? 0) * e.corps * PPM}px`
}

/** Tous les textes en un atlas et un maillage (le lot de textes de three). */
function monterTextes(scene: Scene, ecrits: readonly Ecrit[]): void {
  if (ecrits.length === 0) return
  const mesure = new OffscreenCanvas(1, 1).getContext('2d')!
  const mis = ecrits.map((e) => {
    fonte(mesure, e)
    const lignes = lignesDe(mesure, e, e.largeur && e.largeur * PPM)
    const pas = e.corps * (e.interligne ?? INTERLIGNE) * PPM
    const marge = Math.ceil(e.contour ? 2 * CONTOUR.l * PPM : 2)
    const [bl, bh] = [Math.ceil(Math.max(...lignes.map((l) => mesure.measureText(l).width))), Math.ceil(lignes.length * pas)]
    return { e, lignes, pas, marge, bl, bh, l: bl + 2 * marge, h: bh + 2 * marge }
  })
  const { dt, uvs } = atlasDeTextes('ateliers:textes', scene, mis, (g, i, x, y) => {
    const { e, lignes, pas, marge, bl } = mis[i]
    fonte(g, e)
    g.textAlign = e.alignX
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = 2 * CONTOUR.l * PPM
    g.strokeStyle = CONTOUR.couleur
    g.fillStyle = e.couleur
    const x0 = x + marge + (e.alignX === 'left' ? 0 : e.alignX === 'center' ? bl / 2 : bl)
    lignes.forEach((l, j) => {
      const yl = y + marge + (j + 0.5) * pas
      if (e.contour) g.strokeText(l, x0, yl)
      g.fillText(l, x0, yl)
    })
  })
  const quads: Quad[] = mis.map(({ e, bl, bh, l, h }, i) => {
    // Le centre du bloc de texte, depuis son ancre.
    const dx = ((e.alignX === 'left' ? 1 : e.alignX === 'center' ? 0 : -1) * bl) / 2 / PPM
    const dy = ((e.ancreY === 'bas' ? 1 : -1) * bh) / 2 / PPM
    const centre = [0, 1, 2].map((k) => e.point[k] + e.droite[k] * dx + e.haut[k] * dy) as V3
    return { centre, droite: e.droite, haut: e.haut, l: l / PPM, h: h / PPM, uv: uvs[i] }
  })
  maillageDeQuads('ateliers:textes', quads, scene, matiereDeTexte('ateliers:textes', scene, dt))
}

/** Le cartel : une plaque crème couchée sur le rebord du socle, devant le verre, relevée de 25° vers le visiteur. */
const AVANT = RECUL_PLAQUES + PLAQUE.profondeur / 2 + 0.022
const CARTEL = { y: SOCLE_ATELIER.hauteur + 0.03, z: (AVANT + SOCLE_ATELIER.profondeur / 2) / 2, inclinaison: -(Math.PI / 2 - 0.44) }

/** Les textes d'un atelier : légendes des plaques, noms des blocs, cartel. */
function ecritsDe({ x, z, atelier, coupe }: Expose): Ecrit[] {
  const face = { droite: [1, 0, 0] as V3, haut: [0, 1, 0] as V3 }
  const legende = { police: 'PT Sans' as const, couleur: CREME, contour: true, ...face }
  const gauche = x - PLAQUE.largeur / 2 - 0.06
  const [c, s] = [Math.cos(CARTEL.inclinaison), Math.sin(CARTEL.inclinaison)]
  // Un point du cartel, dans le plan incliné de sa plaque, 4 mm au-dessus (rotation x de three).
  const surCartel = (u: number, v: number): V3 => [x + u, CARTEL.y + v * c - 0.004 * s, z + CARTEL.z + v * s + 0.004 * c]
  const cartel = { couleur: ENCRE, alignX: 'left' as const, ancreY: 'haut' as const, droite: [1, 0, 0] as V3, haut: [0, c, s] as V3 }
  return [
    ...coupe.plaques.flatMap((pl): Ecrit[] => [
      { ...legende, texte: pl.nom.toUpperCase(), corps: 0.028, ls: 0.08, alignX: 'right', ancreY: 'bas', point: [gauche, pl.y, z + AVANT] },
      { ...legende, texte: pl.role, corps: 0.017, alignX: 'right', ancreY: 'haut', point: [gauche, pl.y - 0.006, z + AVANT] },
    ]),
    ...coupe.blocs.map((b): Ecrit => ({
      ...legende, texte: `${b.nom}\n${b.legende}`, points: true, corps: 0.024, interligne: 1.15, largeur: b.largeurEtiquette,
      alignX: 'center', ancreY: 'bas', point: [x + b.etiquette[0], b.etiquette[1], z + b.etiquette[2]],
    })),
    { ...cartel, police: 'PT Serif', corps: 0.03, point: surCartel(-0.43, 0.052), texte: `L’atelier en coupe — l’architecture de ${atelier.key.split('/')[1]}` },
    {
      ...cartel, police: 'PT Sans', corps: 0.0165, interligne: 1.3, largeur: 0.86, point: surCartel(-0.43, 0.012),
      texte: `Chaque plaque est une couche, chaque bloc un projet du dépôt à la taille de son code, chaque fil une dépendance entre eux : la lumière monte de la dépendance vers qui s’en sert. Relevé dans le dépôt ${atelier.key}, commit ${atelier.commit.slice(0, 7)}.`,
    },
  ]
}

/** Le carreau d'épure, 50 cm de côté : un trait tous les 10 cm, un peu plus appuyé au bord du carreau. */
function monterMur(scene: Scene): Mesh {
  const m = MUR_ATELIER
  const n = 256
  const dt = new DynamicTexture('ateliers:epure', { width: n, height: n }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  g.fillStyle = '#2d3843'
  g.fillRect(0, 0, n, n)
  for (let i = 0; i < 5; i++) {
    const t = (i * n) / 5
    g.fillStyle = i === 0 ? 'rgba(214, 226, 232, 0.2)' : 'rgba(214, 226, 232, 0.08)'
    const e = i === 0 ? 2 : 1
    g.fillRect(t, 0, e, n)
    g.fillRect(0, t, n, e)
  }
  dt.update(true)
  dt.wrapU = dt.wrapV = Texture.WRAP_ADDRESSMODE
  dt.uScale = (m.x1 - m.x0) / 0.5
  dt.vScale = (m.haut - m.bas) / 0.5
  dt.anisotropicFilteringLevel = 8
  const mat = matiere('ateliers:mur', scene, '#ffffff', 0.92)
  mat.albedoTexture = dt
  // 4 mm devant la peinture du mur nord : pas de z-fighting.
  const quad: Quad = { centre: [(m.x0 + m.x1) / 2, (m.bas + m.haut) / 2, m.z], droite: [1, 0, 0], haut: [0, 1, 0], l: m.x1 - m.x0, h: m.haut - m.bas, uv: [0, 0, 1, 1] }
  return maillageDeQuads('ateliers:mur', [quad], scene, mat)
}

/** Les fils : un maillage, la comète dans le shader (plugin `Comete`). */
function monterFils(scene: Scene, exposes: readonly Expose[]): void {
  const fils = exposes.flatMap((e) =>
    e.coupe.fils.map((f, i) => ({ points: f.points.map(([x, y, z]): V3 => [e.x + x, y, e.z + z]), phase: (i * 0.618) % 1 })),
  )
  if (fils.length === 0) return
  const g = geometrieDesFils(fils)
  const m = new Mesh('ateliers:fils', scene)
  Object.assign(new VertexData(), { positions: g.positions, normals: g.normals, indices: g.indices }).applyToMesh(m)
  m.setVerticesData('filDecalage', g.decalage, false, 1)
  const mat = new PBRMaterial('ateliers:fils', scene)
  mat.unlit = true
  mat.albedoColor = lin(FIL)
  mat.alphaMode = Constants.ALPHA_ADD
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  mat.disableDepthWrite = true
  new Comete(mat, mouvementReduit())
  // L'uniform temps se relie à chaque image : une matière gelée ne le ferait plus.
  VIVANTES.add(mat.name)
  m.material = mat
  m.isPickable = false
}

/** Rend les porteurs d'ombre : bois, laiton, blocs, cartels, mur (ni le verre ni les fils). */
export async function monterAteliers(scene: Scene, base: string, jour: number): Promise<Mesh[]> {
  const [ateliers, cat] = await Promise.all([
    fetch(`${base}data/ateliers.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ateliers: Atelier[] }>) : { ateliers: [] }))
      .then((j) => j.ateliers)
      .catch((): Atelier[] => []),
    catalogue(base),
    police('PT Sans'),
    police('PT Serif'),
  ])
  const vitrines = cat ? choisirVitrines(cat.artworks, cat.owners) : []
  const exposes: Expose[] = ATELIERS.flatMap((place) => {
    const atelier = ateliers.find((a) => a.key === vitrines[place.rang]?.key)
    return atelier ? [{ x: place.x, z: place.z, atelier, coupe: disposerCoupe(atelier) }] : []
  })
  const monde = (e: Expose, b: Box): Box => ({ ...b, x: e.x + b.x, z: e.z + b.z })
  const S = SOCLE_ATELIER
  const m = MUR_ATELIER
  const porteurs: Mesh[] = []

  const bois = matiere('ateliers:bois', scene, '#5a3820', 0.5)
  porteurs.push(cubes('ateliers:bois', ATELIERS.map((a) => boite([a.x, S.hauteur / 2, a.z], [S.largeur, S.hauteur, S.profondeur])), scene, bois))

  const cuivre = matiere('ateliers:laiton', scene, '#8c6a2c', 0.32)
  cuivre.metallic = 0.65
  // La lisse de laiton qui borde le haut du mur d'atelier, toujours là.
  const lisse = boite([(m.x0 + m.x1) / 2, m.haut + 0.02, m.z + 0.012], [m.x1 - m.x0, 0.04, 0.024])
  porteurs.push(cubes('ateliers:laiton', [...exposes.flatMap((e) => laiton(e.coupe).map((b) => monde(e, b))), lisse], scene, cuivre))

  const lumineux: Material[] = [bois, cuivre]
  const blocs = exposes.flatMap((e) => e.coupe.blocs.map((b) => ({ b: monde(e, boite([b.x, b.y, b.z], [b.cote, b.hauteur, b.cote])), c: TEINTES[e.atelier.couches[b.couche].id] ?? CREME })))
  if (blocs.length > 0) {
    // La nuit, les blocs luisent un peu plus : la coupe reste lisible quand la galerie s'éteint. L'émissif n'est pas teinté.
    const mat = matiere('ateliers:blocs', scene, '#ffffff', 0.45)
    mat.metallic = 0.1
    mat.emissiveColor = lin('#3a2a14')
    mat.emissiveIntensity = 0.6 + 1.4 * (1 - jour)
    const lot = cubes('ateliers:blocs', blocs.map((x) => x.b), scene, mat)
    const couleurs = new Float32Array(4 * blocs.length)
    blocs.forEach(({ c }, i) => {
      const t = lin(c)
      couleurs.set([t.r, t.g, t.b, 1], 4 * i)
    })
    lot.thinInstanceSetBuffer('color', couleurs, 4)
    porteurs.push(lot)
    lumineux.push(mat)
  }

  const plaques = exposes.flatMap((e) => e.coupe.plaques.map((pl) => monde(e, boite([0, pl.y, RECUL_PLAQUES], [PLAQUE.largeur, PLAQUE.epaisseur, PLAQUE.profondeur]))))
  if (plaques.length > 0) {
    // Comme Nef_Verre : ne masque rien, pas de reflet par-dessus l'opacité, pas d'ombre.
    const verre = matiere('verre-atelier', scene, '#dff0ea', 0.05)
    verre.alpha = 0.16
    verre.disableDepthWrite = true
    verre.useRadianceOverAlpha = verre.useSpecularOverAlpha = false
    cubes('verre-atelier', plaques, scene, verre).isPickable = false
  }

  if (exposes.length > 0) {
    const plaque = CreateBox('ateliers:cartels', { width: 0.92, height: 0.13, depth: 0.006 }, scene)
    const matrices = new Float32Array(16 * exposes.length)
    exposes.forEach((e, i) => Matrix.RotationX(CARTEL.inclinaison).multiply(Matrix.Translation(e.x, CARTEL.y, e.z + CARTEL.z)).copyToArray(matrices, 16 * i))
    plaque.thinInstanceSetBuffer('matrix', matrices, 16)
    plaque.material = matiere('ateliers:cartel', scene, '#efe6d2', 0.85)
    lumineux.push(plaque.material)
    porteurs.push(plaque)
  }

  const mur = monterMur(scene)
  lumineux.push(mur.material!)
  porteurs.push(mur)
  brancherLueurs(lumineux)
  for (const p of porteurs) {
    p.receiveShadows = true
    p.isPickable = false
  }

  monterFils(scene, exposes)
  monterTextes(scene, exposes.flatMap(ecritsDe))
  return porteurs
}
