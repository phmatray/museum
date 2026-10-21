/**
 * La façade (FacadeLayer de three, géométrie de `plan/facade.ts`) : brique,
 * portique de pierre, piliers cannelés, verre sombre des baies, verre clair des
 * portes, menuiseries de granit (une fusion par calque, UV en mètres), le nom
 * du musée (canevas non éclairé), les deux bannières des vitrines de la salle
 * d'honneur (fond, filets et textes peints sur UN canevas, hampes en thin
 * instances) et les quatre drapeaux (mâts en thin instances, toiles fusionnées
 * à couleur par sommet). Une douzaine d'appels de dessin.
 * Le temps qu'il fait (`intemperer`) : la brique fonce sous la pluie, la neige
 * tient sur les corniches et les appuis. L'enseigne s'allume la nuit (`auCiel`).
 * Elle a vécu (`userFacade`, usure.ts) : coulures sous les saillies, pied
 * éclaboussé, mousse au nord ; la pierre et les piliers épaufrés aux arêtes.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import config from '../../museum.config.json'
import type { Artwork } from '../domain/types.ts'
import { facade, lignesDeBanniere } from '../plan/facade.ts'
import type { Box } from '../plan/mesh.ts'
import type { Plan } from '../plan/types.ts'
import { choisirVitrines } from '../plan/vitrines.ts'
import { boitesFusionnees, cubes, matiere } from './boites.ts'
import { auCielMatiere } from './etat.ts'
import { intemperer } from './intemperies.ts'
import { brancherLueurs } from './lueurs.ts'
import { matierePBR } from './matieres.ts'
import { creerBrique, creerCannelure, creerGranit, creerPierre } from './pierre.ts'
import { police, type Police } from './polices.ts'
import { couper } from './toiles.ts'
import { attributsFacade, userFacade } from './usure.ts'

/** Les quatre carrés du logo Microsoft, dans l'ordre du logo. */
const DRAPEAUX = ['#f25022', '#7fba00', '#00a4ef', '#ffb900']
const MAT = 4
const DRAPEAU: [number, number] = [1.5, 1]
const FONDS_BANNIERE = ['#15304f', '#0c4841']
const CREME = '#f3ead8'
const OR = '#d8b060'
/** Pixels par mètre des canevas de texte. */
const PPM = 256

/** La première phrase de la description, coupée au mot vers 90 signes : trois lignes au plus (FacadeLayer.tsx). */
export function resume(texte: string): string {
  const phrase = texte.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s|\s[—–-]\s/)[0].replace(/[.:;,]$/, '')
  return phrase.length <= 90 ? phrase : `${phrase.slice(0, phrase.lastIndexOf(' ', 88))}…`
}

/**
 * Les toiles des drapeaux, ondulées une fois pour toutes (PlaneGeometry 16 × 4
 * de three : z = sin(x·3,2)·0,08·x, le bord x = 0 tient à la hampe), tournées
 * de π/5 et posées à 4 cm du mât, sous sa pomme. Couleurs linéaires par sommet.
 */
export function geometrieDesDrapeaux(mats: readonly { x: number; y: number; z: number }[]): VertexData {
  const [W, H, SX, SY] = [DRAPEAU[0], DRAPEAU[1], 16, 4]
  const [c, s] = [Math.cos(Math.PI / 5), Math.sin(Math.PI / 5)]
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  mats.forEach((m, k) => {
    const teinte = Color3.FromHexString(DRAPEAUX[k % DRAPEAUX.length]).toLinearSpace()
    const o = k * (SX + 1) * (SY + 1)
    for (let iy = 0; iy <= SY; iy++)
      for (let ix = 0; ix <= SX; ix++) {
        const x = (ix / SX) * W
        const y = H / 2 - (iy / SY) * H
        const z = Math.sin(x * 3.2) * 0.08 * x
        positions.push(m.x + 0.04 + x * c + z * s, m.y + MAT - H / 2 - 0.05 + y, m.z - x * s + z * c)
        colors.push(teinte.r, teinte.g, teinte.b, 1)
      }
    for (let iy = 0; iy < SY; iy++)
      for (let ix = 0; ix < SX; ix++) {
        const [a, b, cc, d] = [ix + (SX + 1) * iy, ix + (SX + 1) * (iy + 1), ix + 1 + (SX + 1) * (iy + 1), ix + 1 + (SX + 1) * iy].map((i) => i + o)
        // Sens des faces inversé par rapport à three : Babylon tient la face avant pour horaire (ComputeNormals aussi).
        indices.push(a, d, b, b, d, cc)
      }
  })
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  return Object.assign(new VertexData(), { positions, normals, colors, indices })
}

/** Un quad vertical face au sud (+z), centré en (x, y, z), UV 0..1 (haut du canevas en v = 1, invertY). Indices : 0 2 1, 0 3 2. */
function quad(x: number, y: number, z: number, w: number, h: number, u0 = 0, u1 = 1) {
  return {
    positions: [x - w / 2, y - h / 2, z, x + w / 2, y - h / 2, z, x + w / 2, y + h / 2, z, x - w / 2, y + h / 2, z],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uvs: [u0, 0, u1, 0, u1, 1, u0, 1],
  }
}

interface Trait { corps: number; ls?: number; couleur: string; police?: Police; alpha?: number }

/** Une ligne centrée en (x, y) pixels ; l'espacement (em) est aussi ajouté après la dernière lettre par le canevas : recentré. */
function ecrire(g: CanvasRenderingContext2D, texte: string, x: number, y: number, t: Trait, contour = 0): void {
  const px = t.corps * PPM
  const ls = (t.ls ?? 0) * px
  g.font = `${px}px '${t.police ?? 'PT Sans'}'`
  g.letterSpacing = `${ls}px`
  g.fillStyle = g.strokeStyle = t.couleur
  g.globalAlpha = t.alpha ?? 1
  if (contour) {
    g.lineWidth = 2 * contour * PPM
    g.lineJoin = 'round'
    g.strokeText(texte, x + ls / 2, y)
  }
  g.fillText(texte, x + ls / 2, y)
}

/** Les bannières (FacadeLayer.tsx:97-155) : UN canevas, une bande par bannière, fond, filets et textes à leur place. */
function peindreBannieres(scene: Scene, B: ReturnType<typeof facade>['bannieres'], vitrines: Artwork[]): DynamicTexture {
  const [L, H] = [B[0].w * PPM, B[0].h * PPM]
  const dt = new DynamicTexture('bannieres', { width: L * B.length, height: H }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  vitrines.forEach((oeuvre, i) => {
    const b = B[i]
    const cx = i * L + L / 2
    // y local (m, vers le haut, centre de la bannière) → pixel du canevas.
    const py = (y: number) => (b.h / 2 - y) * PPM
    g.globalAlpha = 1
    g.fillStyle = FONDS_BANNIERE[i % FONDS_BANNIERE.length]
    g.fillRect(i * L, 0, L, H)
    g.fillStyle = OR
    for (const y of [b.h / 2 - 0.72, -b.h / 2 + 0.62]) g.fillRect(cx - ((b.w - 0.6) * PPM) / 2, py(y) - 0.015 * PPM, (b.w - 0.6) * PPM, 0.03 * PPM)
    ecrire(g, config.name.toUpperCase(), cx, py(b.h / 2 - 0.42), { corps: 0.2, ls: 0.18, couleur: CREME })
    ecrire(g, 'SALLE D’HONNEUR', cx, py(b.h / 2 - 1.0), { corps: 0.19, ls: 0.14, couleur: OR })
    const lignes = lignesDeBanniere(oeuvre.name)
    // Le corps suit la plus longue ligne (0,52 em par signe), plafonné à 78 cm.
    const corps = Math.min(0.78, (b.w - 0.5) / (Math.max(...lignes.map((l) => l.length)) * 0.52))
    lignes.forEach((l, k) =>
      ecrire(g, l, cx, py(0.75 + ((lignes.length - 1) / 2 - k) * corps * 1.02), { corps, couleur: CREME, police: 'PT Serif' }, corps * 0.02))
    const chiffres = [`${oeuvre.stars} étoiles`, oeuvre.language].filter(Boolean).join('  ·  ')
    ecrire(g, chiffres, cx, py(-1.25), { corps: 0.24, ls: 0.06, couleur: OR })
    g.font = `${0.15 * PPM}px 'PT Sans'`
    g.letterSpacing = '0px'
    const r = couper(g, resume(oeuvre.description), (b.w - 0.6) * PPM)
    r.forEach((l, k) => ecrire(g, l, cx, py(-2.1 + ((r.length - 1) / 2 - k) * 0.15 * 1.3), { corps: 0.15, couleur: CREME, alpha: 0.85 }))
    ecrire(g, oeuvre.owner, cx, py(-b.h / 2 + 0.36), { corps: 0.18, ls: 0.1, couleur: CREME })
  })
  dt.update(true)
  return dt
}

/** Le nom du musée : un canevas blanc teinté par une matière NON éclairée (le MeshBasic de troika). */
function monterEnseigne(scene: Scene, e: { x: number; y: number; z: number }): Mesh {
  const t: Trait = { corps: 0.72, ls: 0.14, couleur: '#ffffff' }
  const texte = config.name.toUpperCase()
  const mesure = new OffscreenCanvas(1, 1).getContext('2d')!
  mesure.font = `${t.corps * PPM}px 'PT Sans'`
  mesure.letterSpacing = `${t.ls! * t.corps * PPM}px`
  const [L, H] = [Math.ceil(mesure.measureText(texte).width + 0.2 * PPM), Math.ceil(1.4 * t.corps * PPM)]
  const dt = new DynamicTexture('enseigne', { width: L, height: H }, scene, true)
  dt.hasAlpha = true
  const g = dt.getContext() as CanvasRenderingContext2D
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  ecrire(g, texte, L / 2, H / 2, t)
  dt.update(true)
  const m = new Mesh('enseigne', scene)
  Object.assign(new VertexData(), { ...quad(e.x, e.y, e.z, L / PPM, H / PPM), indices: [0, 2, 1, 0, 3, 2] }).applyToMesh(m)
  const mat = new PBRMaterial('enseigne', scene)
  mat.unlit = true
  mat.albedoTexture = dt
  mat.useAlphaFromAlbedoTexture = true
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  // La nuit, les lettres s'allument, comme une enseigne rétroéclairée.
  auCielMatiere(mat, (c) => (mat.albedoColor = Color3.FromHexString(1 - c.jour > 0.5 ? '#ffd98a' : '#3a2c1c').toLinearSpace()))
  m.material = mat
  m.isPickable = false
  return m
}

/** Les bannières et leurs hampes ; rien si le catalogue manque. */
async function monterBannieres(scene: Scene, B: ReturnType<typeof facade>['bannieres'], base: string): Promise<Mesh[]> {
  const c = await fetch(`${base}data/catalogue.json`).then((r) => r.json() as Promise<{ artworks: Artwork[]; owners: string[] }>)
  const vitrines = choisirVitrines(c.artworks, c.owners).slice(0, B.length)
  if (vitrines.length === 0) return []
  await Promise.all([police('PT Sans'), police('PT Serif')])
  const toile = matiere('bannieres', scene, '#ffffff', 0.95)
  toile.albedoTexture = peindreBannieres(scene, B, vitrines)
  toile.backFaceCulling = false
  toile.twoSidedLighting = true
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  vitrines.forEach((_, i) => {
    const b = B[i]
    const q = quad(b.x, b.y, b.z, b.w, b.h, i / B.length, (i + 1) / B.length)
    positions.push(...q.positions)
    normals.push(...q.normals)
    uvs.push(...q.uvs)
    indices.push(4 * i, 4 * i + 2, 4 * i + 1, 4 * i, 4 * i + 3, 4 * i + 2)
  })
  const bannieres = new Mesh('bannieres', scene)
  Object.assign(new VertexData(), { positions, normals, uvs, indices }).applyToMesh(bannieres)
  bannieres.material = toile
  // La hampe en haut, la barre de lest en bas.
  const barres = vitrines.flatMap((_, i): Box[] => {
    const b = B[i]
    return [1, -1].map((s) => ({ x: b.x, y: b.y + s * (b.h / 2 + 0.03), z: b.z + 0.02, w: b.w + 0.2, h: 0.05, d: 0.05, kind: 'handrail' }))
  })
  const fer = matiere('hampes', scene, '#2b2a28', 0.4)
  fer.metallic = 0.6
  const hampes = cubes('hampes', barres, scene, fer)
  brancherLueurs([toile, fer])
  return [bannieres, hampes]
}

/**
 * Monte la façade. Les boîtes, l'enseigne et les drapeaux tout de suite ; les
 * bannières après le catalogue et les polices. Rend les porteurs d'ombre (tout
 * l'opaque ; ni le verre clair, ni l'enseigne). Tout reçoit les ombres.
 */
export async function monterFacade(scene: Scene, plan: Plan, base: string): Promise<Mesh[]> {
  const F = facade(plan)
  const vitre = matiere('facade-vitres', scene, '#1f2b31', 0.12)
  vitre.metallic = 0.6
  // Le verre des portes : clair, on voit le hall au travers (creerVitrage).
  const clair = matiere('facade-portes', scene, '#dceaf2', 0.04)
  clair.alpha = 0.16
  clair.backFaceCulling = false
  clair.disableDepthWrite = true
  clair.environmentIntensity = 2.4
  const calques: [string, Box[], PBRMaterial][] = [
    ['facade-brique', F.brique, creerBrique(scene, 'facade-brique')],
    ['facade-pierre', F.pierre, creerPierre(scene, 'facade-pierre')],
    ['facade-piliers', F.piliers, creerCannelure(scene, 'facade-piliers')],
    ['facade-vitres', F.vitres, vitre],
    ['facade-menuiseries', F.menuiseries, creerGranit(scene, 'facade-menuiseries')],
  ]
  const porteurs = calques.map(([nom, boites, mat]) => boitesFusionnees(nom, boites, scene, mat))
  const portes = boitesFusionnees('facade-portes', F.portes, scene, clair)

  const mats = CreateCylinder('mats', { height: MAT, diameterTop: 0.07, diameterBottom: 0.1, tessellation: 8 }, scene)
  mats.thinInstanceSetBuffer('matrix', new Float32Array(F.mats.flatMap((m) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, m.x, m.y + MAT / 2, m.z, 1])), 16, true)
  const acier = matierePBR('mats', 'metal', scene)
  mats.material = acier
  const drapeaux = new Mesh('drapeaux', scene)
  geometrieDesDrapeaux(F.mats).applyToMesh(drapeaux)
  const etoffe = matiere('drapeaux', scene, '#ffffff', 0.85)
  etoffe.backFaceCulling = false
  etoffe.twoSidedLighting = true
  drapeaux.material = etoffe
  porteurs.push(mats, drapeaux)
  for (const m of [...porteurs, portes]) m.receiveShadows = true
  brancherLueurs([...calques.map(([, , m]) => m), acier, etoffe])
  // L'usure avant le temps qu'il fait : la pluie et la neige passent par-dessus.
  userFacade(calques[0][2])
  for (const k of [1, 2]) {
    userFacade(calques[k][2], { pierre: true })
    attributsFacade(porteurs[k], calques[k][1])
  }
  for (const [nom, , m] of calques) if (nom !== 'facade-vitres') intemperer(m)

  // Mesurée et peinte en PT Sans : après la police.
  void police('PT Sans').then(() => monterEnseigne(scene, F.enseigne)).catch((e: unknown) => console.warn('enseigne indisponible', e))
  const bannieres = await monterBannieres(scene, F.bannieres, base).catch((e: unknown) => {
    console.warn('bannières indisponibles', e)
    return []
  })
  for (const m of bannieres) m.receiveShadows = true
  porteurs.push(...bannieres)
  return porteurs
}
