/**
 * La constellation de la nef (ConstellationLayer.tsx, `plan/constellation.ts`),
 * suspendue entre les balcons, qui s'allume la nuit : les étoiles en thin
 * instances qui scintillent, un halo additif autour de chacune, les filets d'or,
 * les fils qui les pendent à la voûte, et le nom de chaque salle au-dessus de
 * son amas. Le jour (nuit < 0,02), rien.
 *
 * Les halos (les `points` de three) et les noms (les `Billboard`) sont des quads
 * tournés vers la caméra quand la vue change, sur le CPU (un maillage chacun,
 * ~130 quads, caméra active de la scène) : pas de shader. `jour` étant figé au chargement, l'opacité de nuit est
 * cuite dans les matières et le canevas.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder'
import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { constellations, type Constellation } from '../plan/constellation.ts'
import type { Accrochage } from '../plan/hang.ts'
import { catalogue } from './etat.ts'
import { lin } from './lueurs.ts'
import { police } from './polices.ts'
import { atlasDeTextes, geometrieDeQuads, matiereDeTexte, type UV } from './textes.ts'
import { couper } from './toiles.ts'

type V3 = [number, number, number]

const OR = '#e7b24c'
const ETOILE = '#fff3d2'
/** La taille monde d'un halo : `size` 0,9 de PointsMaterial × tan(fov/2), le fov de three valant 75°. */
const HALO = 0.9 * Math.tan((75 * Math.PI) / 360)
/** Les étiquettes : corps 0,26 m, pixels par mètre de leur atlas. */
const CORPS = 0.26
const PPM = 400

/** L'échelle de l'étoile i, de taille s, à l'instant t (secondes) : ±15 %, jamais deux étoiles en phase. */
export function scintillement(s: number, i: number, t: number): number {
  return s * (1 + 0.15 * Math.sin(t * 1.3 + ((i * 2.399) % (2 * Math.PI))))
}

interface Tournant {
  centre: V3
  l: number
  h: number
  uv: UV
  /** Le centre remonte de `leve` m le long du haut de la vue. */
  leve?: number
}

/**
 * Un maillage de quads tournés vers la caméra active : positions recalculées
 * dans un tampon réutilisé, seulement quand la vue a changé (normales jamais :
 * les deux matières sont non éclairées).
 */
function quadsTournants(nom: string, scene: Scene, items: readonly Tournant[], mat: PBRMaterial): void {
  const m = new Mesh(nom, scene)
  const geo = geometrieDeQuads(items.map((q) => ({ ...q, droite: [1, 0, 0] as const, haut: [0, 1, 0] as const })))
  Object.assign(new VertexData(), geo).applyToMesh(m, true)
  m.material = mat
  m.isPickable = false
  m.alwaysSelectAsActiveMesh = true
  const pos = geo.positions
  const inverse = new Matrix()
  let vue = -1
  scene.onBeforeRenderObservable.add(() => {
    const v = scene.activeCamera?.getViewMatrix()
    // Les drapeaux de Matrix viennent d'un compteur global : ils changent aussi d'une caméra à l'autre.
    if (!v || v.updateFlag === vue) return
    vue = v.updateFlag
    const r = v.invertToRef(inverse).m
    items.forEach(({ centre: c, l, h, leve = 0 }, k) => {
      for (let j = 0; j < 4; j++) {
        const [sd, sh] = [j === 0 || j === 3 ? -0.5 : 0.5, j < 2 ? -0.5 : 0.5]
        for (let a = 0; a < 3; a++) pos[12 * k + 3 * j + a] = c[a] + sd * l * r[a] + (sh * h + leve) * r[4 + a]
      }
    })
    m.updateVerticesData(VertexBuffer.PositionKind, pos)
  })
}

/** Le rayonnement : un dégradé radial blanc sur alpha, 64 px. */
function texteHalo(scene: Scene): DynamicTexture {
  const dt = new DynamicTexture('constellation:halo', { width: 64, height: 64 }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  d.addColorStop(0, 'rgba(255,255,255,1)')
  d.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  d.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = d
  g.fillRect(0, 0, 64, 64)
  dt.hasAlpha = true
  dt.update(true)
  return dt
}

/**
 * Le nom de chaque salle, en lettres d'or cernées d'un halo sombre flou (contour
 * 10 % du corps, flou 70 %), ancré par le milieu du bas, toujours tourné vers qui le regarde.
 */
function monterEtiquettes(scene: Scene, ciel: readonly Constellation[], nuit: number): void {
  const mesure = new OffscreenCanvas(1, 1).getContext('2d')!
  const px = CORPS * PPM
  const fonte = (g: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    g.font = `${px}px 'PT Sans'`
    g.letterSpacing = `${0.06 * px}px`
  }
  fonte(mesure)
  const marge = Math.ceil(0.9 * px)
  const pas = 1.1 * px
  const mis = ciel.map((c) => {
    const lignes = couper(mesure, c.nom.toUpperCase(), 3.2 * PPM)
    const bl = Math.ceil(Math.max(...lignes.map((l) => mesure.measureText(l).width)))
    return { lignes, bl, l: bl + 2 * marge, h: Math.ceil(lignes.length * pas) + 2 * marge }
  })
  const { dt, uvs } = atlasDeTextes('constellation:noms', scene, mis, (g, i, x, y) => {
    const { lignes, l } = mis[i]
    fonte(g)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = 2 * 0.1 * px
    g.strokeStyle = `rgba(18, 10, 3, ${0.9 * nuit})`
    g.filter = `blur(${0.35 * px}px)`
    lignes.forEach((t, j) => g.strokeText(t, x + l / 2, y + marge + (j + 0.5) * pas))
    g.filter = 'none'
    g.globalAlpha = nuit
    g.fillStyle = '#ffe3a3'
    lignes.forEach((t, j) => g.fillText(t, x + l / 2, y + marge + (j + 0.5) * pas))
  })
  // Le bas du texte (sans sa marge) sur l'ancre : le centre monte de la moitié de la case, moins la marge.
  const items = ciel.map((c, i): Tournant => {
    const h = mis[i].h / PPM
    return { centre: [c.etiquette.x, c.etiquette.y, c.etiquette.z], l: mis[i].l / PPM, h, uv: uvs[i], leve: h / 2 - marge / PPM }
  })
  quadsTournants('constellation:noms', scene, items, matiereDeTexte('constellation:noms', scene, dt))
}

/** Des segments en un LinesMesh : couleur et opacité de LineBasicMaterial (ponytail : le LinesMesh sort la couleur hex telle quelle, sans l'exposition 1,15 ni la courbe que three applique à toute l'image). `useVertexAlpha`, sinon `alpha` est ignoré. */
function segments(nom: string, scene: Scene, paires: [V3, V3][], couleur: string, alpha: number): void {
  if (paires.length === 0) return
  const l = CreateLineSystem(nom, { lines: paires.map(([a, b]) => [new Vector3(...a), new Vector3(...b)]), useVertexAlpha: true }, scene)
  l.color = Color3.FromHexString(couleur)
  l.alpha = alpha
  l.isPickable = false
}

/** Rien le jour, ni sans accrochage. Aucune ombre. */
export async function monterConstellation(scene: Scene, accrochage: Accrochage | null, base: string, jour: number): Promise<void> {
  const nuit = 1 - jour
  if (accrochage === null || nuit < 0.02) return
  const [cat] = await Promise.all([catalogue(base), police('PT Sans')])
  const ciel = constellations(accrochage, new Map((cat?.artworks ?? []).map((a) => [a.key, a.stars])))
  const etoiles = ciel.flatMap((c) => c.etoiles)
  if (etoiles.length === 0) return

  // Les étoiles : un icosaèdre subdivisé une fois (80 faces), échelle par instance à chaque image.
  const ico = CreateIcoSphere('constellation:etoiles', { radius: 1, subdivisions: 2 }, scene)
  const matrices = new Float32Array(16 * etoiles.length)
  etoiles.forEach((e, i) => matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, e.x, e.y, e.z, 1], 16 * i))
  // Seule la diagonale bouge.
  const poser = (t: number) =>
    etoiles.forEach((e, i) => (matrices[16 * i] = matrices[16 * i + 5] = matrices[16 * i + 10] = scintillement(e.taille, i, t)))
  poser(0)
  ico.thinInstanceSetBuffer('matrix', matrices, 16, false)
  ico.alwaysSelectAsActiveMesh = true
  ico.isPickable = false
  const blanc = new PBRMaterial('constellation:etoiles', scene)
  blanc.unlit = true
  blanc.albedoColor = lin(ETOILE)
  ico.material = blanc
  scene.onBeforeRenderObservable.add(() => {
    poser(performance.now() / 1000)
    ico.thinInstanceBufferUpdated('matrix')
  })

  // Les halos : additifs, sans écriture de profondeur.
  const halo = new PBRMaterial('constellation:halos', scene)
  halo.unlit = true
  halo.albedoTexture = texteHalo(scene)
  halo.albedoColor = lin('#ffd98a')
  halo.useAlphaFromAlbedoTexture = true
  halo.alpha = nuit
  halo.alphaMode = Constants.ALPHA_ADD
  halo.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  halo.disableDepthWrite = true
  halo.backFaceCulling = false
  quadsTournants('constellation:halos', scene, etoiles.map((e) => ({ centre: [e.x, e.y, e.z] as V3, l: HALO, h: HALO, uv: [0, 0, 1, 1] as UV })), halo)

  const point = (e: { x: number; y: number; z: number }): V3 => [e.x, e.y, e.z]
  segments('constellation:filets', scene, ciel.flatMap((c) => c.filets.map(([a, b]): [V3, V3] => [point(c.etoiles[a]), point(c.etoiles[b])])), OR, 0.7 * nuit)
  segments('constellation:fils', scene, etoiles.map((e): [V3, V3] => [point(e), [e.x, e.accroche, e.z]]), '#c9b48a', 0.18 * nuit)

  monterEtiquettes(scene, ciel, nuit)
}
