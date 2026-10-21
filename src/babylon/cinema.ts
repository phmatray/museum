/**
 * Le cinéma du sous-sol (d'après Les Variétés de Waremme) : `plan/cinema.ts`
 * dit où tout se trouve, on l'habille ici.
 *
 * Tissu rouge (PBR à reflet de velours, `sheen`) sur un lambris de bois clair
 * qui suit le gradin, plafond à caissons sombres piqué de spots, scène à façade
 * de bois, rideaux dorés plissés, écran blanc qui porte l'affiche de la séance
 * (`public/data/cinema.json`), fauteuils, appliques et enceintes générés par
 * Meshy (`tools/generer-cinema.ts`, posés en thin instances et ramenés à leur
 * taille réelle par leur boîte englobante), veilleuses des marches, fenêtres de
 * la cabine et son faisceau pendant la séance.
 *
 * Sous terre : ni soleil ni ciel sur ces maillages (exclus des deux lumières),
 * mais six lumières chaudes, une par applique, qui n'éclairent qu'eux. La séance
 * (`seance.ts`) plonge la salle dans le noir en quelques secondes, comme un vrai
 * gradateur : appliques et spots baissent, l'affiche s'efface, les nez de marche
 * s'allument pour qu'on ne trébuche pas, l'objectif du projecteur s'éclaire dans
 * sa lucarne et le faisceau apparaît. L'inverse à la fin.
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import type { Scene } from '@babylonjs/core/scene'

import { affiche, type Seance } from '../domain/cinema.ts'
import {
  APPLIQUES, CABINE, CAISSON, COTE_PROMENOIR, ECRAN, ENCEINTES, LAMBRIS, LUMIERES_MARCHES,
  PLAFOND, RIDEAUX, SALLE, SCENE, SIEGES, SOL, SPOTS, dansLeFaisceau, siegeVise, solLeLongDesMurs,
} from '../plan/cinema.ts'
import { BLOC_GRADINS, GRADINS, MEUBLES_CABINE, PORTE_CABINE, PROMENOIR, SIEGES_LIBRES, SOL_CABINE, SPECTATEURS, TRAVERSE, VOLEES_CINEMA, type Siege } from '../plan/cinema.ts'
import { cabineOuverte, TAMPONS_CABINE } from '../domain/succes.ts'
import { MUSEE } from '../plan/musee.ts'
import { LINTEAU } from '../plan/portes.ts'
import type { Arrivee } from '../plan/arrivee.ts'
import type { Walker } from '../plan/walk.ts'
import { partie, VIVANTES } from './etat.ts'
import { glbOuRien } from './glb.ts'
import { monterSeance, type Coins } from './seance.ts'
import { carnet, signaler } from './succes.ts'
import { BARRIERES } from './visiteur.ts'
import { monterCabine, morceaux } from './cabine.ts'
import { monterFoyer } from './foyer.ts'
import { monterSpectateurs } from './spectateurs.ts'
import { el } from './ui/dom.ts'
import './ui/cinema.css'

/** Les surfaces de la salle : on y est « au cinéma » (et l'on peut lancer la séance). */
export const SURFACES_CINEMA = new Set(['-1:cinema', ...VOLEES_CINEMA.map((f) => `volee:${f.id}`), `palier:${PROMENOIR.id}`, `palier:${TRAVERSE.id}`, `palier:${SOL_CABINE.id}`])

/** L'épaisseur du revêtement posé sur la face des cloisons (évite le même plan que le mur). */
const PEAU = 0.02
const CHAUD = new Color3(1, 0.78, 0.52)
/** Un fauteuil de cinéma, dossier compris (m). */
const HAUTEUR_FAUTEUIL = 1.0
/** Le temps (s) que met la salle à s'éteindre ou à se rallumer. */
const GRADATEUR = 4


const pbr = (scene: Scene, nom: string, couleur: Color3, rugosite: number, metal = 0) => {
  const m = new PBRMaterial(nom, scene)
  m.albedoColor = couleur
  m.roughness = rugosite
  m.metallic = metal
  m.maxSimultaneousLights = 8
  return m
}

/** Des matrices de translation, à la suite (thin instances). */
function translations(points: [number, number, number][]): Float32Array {
  const out = new Float32Array(points.length * 16)
  points.forEach(([x, y, z], i) => Matrix.Translation(x, y, z).copyToArray(out, i * 16))
  return out
}

/** Un bandeau vertical le long d'un mur latéral (x fixe), du sol (suivi) à `haut(z)`, face vers `nx`. */
function bandeau(nom: string, scene: Scene, x: number, nx: number, z0: number, z1: number, bas: (z: number) => number, haut: (z: number) => number): Mesh {
  const zs = [z0, VOLEES_CINEMA[0].z, VOLEES_CINEMA[0].z + VOLEES_CINEMA[0].depth, z1].filter((z, i, a) => z >= z0 && z <= z1 && a.indexOf(z) === i).sort((a, b) => a - b)
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  zs.forEach((z, i) => {
    positions.push(x, bas(z), z, x, haut(z), z)
    normals.push(nx, 0, 0, nx, 0, 0)
    if (i > 0) {
      const a = (i - 1) * 2
      // Orientées vers la salle (scène main droite : le sens dépend de nx).
      if (nx > 0) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  })
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), { positions, indices, normals }).applyToMesh(m)
  return m
}

/** Un pan de rideau plissé : une grille dont le z ondule (plis réguliers), face au sud (vers la salle). */
function rideau(nom: string, scene: Scene, r: (typeof RIDEAUX)[number], plis: number, profondeur: number): Mesh {
  const nx = Math.max(8, Math.round((r.x1 - r.x0) / 0.12))
  const ny = 2
  const positions: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const u = i / nx
      positions.push(r.x0 + u * (r.x1 - r.x0), r.y0 + (j / ny) * (r.y1 - r.y0), r.z + Math.sin(u * Math.PI * 2 * plis) * profondeur)
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2)
    }
  const normals: number[] = []
  VertexData.ComputeNormals(positions, indices, normals)
  const m = new Mesh(nom, scene)
  Object.assign(new VertexData(), { positions, indices, normals }).applyToMesh(m)
  return m
}

/** Pose un modèle Meshy en thin instances : ramené à `taille` (sur l'axe dit), posé au sol (ou centré), tourné de `lacet`. */
function poser(c: AssetContainer, poses: { x: number; y: number; z: number; lacet: number }[], taille: number, axe: 'x' | 'y', centre: boolean): Mesh[] {
  c.addAllToScene()
  const maillages = c.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0)
  for (const m of maillages) {
    m.setParent(null)
    if (!m.computeWorldMatrix(true).isIdentity()) m.bakeCurrentTransformIntoVertices()
  }
  for (const t of c.transformNodes) t.dispose()
  let min = new Vector3(Infinity, Infinity, Infinity)
  let max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const m of maillages) {
    m.refreshBoundingInfo()
    const b = m.getBoundingInfo().boundingBox
    min = Vector3.Minimize(min, b.minimumWorld)
    max = Vector3.Maximize(max, b.maximumWorld)
  }
  const s = taille / (axe === 'x' ? max.x - min.x : max.y - min.y)
  const origine = new Vector3((min.x + max.x) / 2, centre ? (min.y + max.y) / 2 : min.y, (min.z + max.z) / 2)
  const tampon = new Float32Array(poses.length * 16)
  const mat = new Matrix()
  poses.forEach((p, i) => {
    Matrix.TranslationToRef(-origine.x, -origine.y, -origine.z, mat)
    mat.multiplyToRef(Matrix.Scaling(s, s, s), mat)
    mat.multiplyToRef(Matrix.RotationY(p.lacet), mat)
    mat.multiplyToRef(Matrix.Translation(p.x, p.y, p.z), mat)
    mat.copyToArray(tampon, i * 16)
  })
  for (const m of maillages) {
    m.thinInstanceSetBuffer('matrix', tampon, 16)
    m.isPickable = false
    m.metadata = { ...m.metadata, immobile: true }
    if (m.material && 'maxSimultaneousLights' in m.material) (m.material as PBRMaterial).maxSimultaneousLights = 8
  }
  return maillages
}

/** L'affiche : l'image 16:9 au centre de la toile 2,39:1, des bandes noires de part et d'autre. */
function afficheSur(scene: Scene, programme: Seance | null): DynamicTexture {
  const L = 2048
  const H = Math.round((L * ECRAN.hauteur) / ECRAN.largeur)
  const t = new DynamicTexture('cinema:affiche', { width: L, height: H }, scene, true)
  // Le plan est retourné face à la salle : sans ce miroir, l'affiche se lirait à l'envers (scène main droite).
  t.uScale = -1
  t.uOffset = 1
  const g = t.getContext()
  g.fillStyle = '#050505'
  g.fillRect(0, 0, L, H)
  t.update()
  if (!programme) return t
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    const w = H * (16 / 9)
    g.drawImage(image, (L - w) / 2, 0, w, H)
    t.update()
  }
  // Toutes les vidéos n'ont pas de vignette « maxres » (YouTube renvoie alors une image grise de 120 px).
  let essai = 0
  image.onerror = () => { if (essai++ === 0) image.src = affiche(programme.video, 'hqdefault') }
  image.src = affiche(programme.video)
  return t
}

export async function monterCinema(
  scene: Scene,
  camera: FreeCamera & { walker(): Walker; asseoir(a: Arrivee, oeil: number): void },
  racine: HTMLElement,
  base: string,
  lumieres: { soleil: DirectionalLight; hemi: HemisphericLight },
): Promise<void> {
  const programme = await fetch(`${base}data/cinema.json`).then((r) => (r.ok ? (r.json() as Promise<Seance>) : null)).catch(() => null)
  const salle: AbstractMesh[] = []
  const garder = <T extends AbstractMesh>(m: T): T => (salle.push(m), (m.isPickable = false), m)

  // ── Les matières ──
  const tissu = pbr(scene, 'cinema:tissu', new Color3(0.42, 0.02, 0.03), 0.85)
  tissu.sheen.isEnabled = true
  tissu.sheen.color = new Color3(1, 0.35, 0.35)
  tissu.sheen.intensity = 0.6
  const lambris = pbr(scene, 'cinema:lambris', new Color3(0.62, 0.45, 0.28), 0.55)
  // Les bandeaux le long des murs : vus d'un seul côté, mais leur sens dépend du mur ; on ne trie pas.
  tissu.backFaceCulling = lambris.backFaceCulling = false
  const noir = pbr(scene, 'cinema:noir', new Color3(0.015, 0.015, 0.018), 0.9)
  const plafond = pbr(scene, 'cinema:plafond', new Color3(0.05, 0.045, 0.045), 0.8)
  const bois = pbr(scene, 'cinema:bois', new Color3(0.33, 0.2, 0.11), 0.5)
  const dore = pbr(scene, 'cinema:rideau', new Color3(0.62, 0.42, 0.12), 0.6)
  dore.sheen.isEnabled = true
  dore.sheen.color = new Color3(1, 0.85, 0.5)
  dore.sheen.intensity = 0.7
  dore.backFaceCulling = false
  const ecranMat = new StandardMaterial('cinema:ecran', scene)
  ecranMat.diffuseColor = Color3.Black()
  ecranMat.specularColor = Color3.Black()
  ecranMat.disableLighting = true
  ecranMat.emissiveTexture = afficheSur(scene, programme)
  ecranMat.emissiveColor = new Color3(0.5, 0.5, 0.5)
  VIVANTES.add(ecranMat.name)
  const VEILLEUSE = new Color3(1, 0.62, 0.3)
  const veilleuse = new StandardMaterial('cinema:veilleuse', scene)
  veilleuse.disableLighting = true
  veilleuse.emissiveColor = VEILLEUSE.scale(0.5)
  const moquette = pbr(scene, 'cinema:moquette', new Color3(0.16, 0.02, 0.03), 0.95)

  // ── Les murs : tissu rouge au-dessus du lambris, qui suit le gradin ──
  const [xO, xE] = [SALLE.x + 0.15 + PEAU, SALLE.x + SALLE.width - 0.15 - PEAU]
  const [zN, zS] = [SALLE.z + 0.15 + PEAU, SALLE.z + SALLE.depth - 0.15 - PEAU]
  const sol = (z: number) => solLeLongDesMurs(z) - 0.02
  const lam = (z: number) => solLeLongDesMurs(z) + LAMBRIS.hauteur
  // La porte du foyer (dans le mur est) : ni lambris ni tissu dans la baie, du tissu au-dessus du linteau.
  const porte = MUSEE.levels.flatMap((l) => l.openings).find((o) => o.kind === 'door' && (o.a === 'cinema' || o.b === 'cinema'))
  const baie = porte ? [porte.z - porte.width / 2, porte.z + porte.width / 2] as const : null
  for (const [x, nx] of [[xO, 1], [xE, -1]] as const) {
    const pans: [number, number][] = nx < 0 && baie ? [[zN, baie[0]], [baie[1], zS]] : [[zN, zS]]
    pans.forEach(([a, b], i) => {
      garder(bandeau(`cinema:lambris${nx}:${i}`, scene, x, nx, a, b, sol, lam)).material = lambris
      garder(bandeau(`cinema:tissu${nx}:${i}`, scene, x, nx, a, b, lam, () => PLAFOND - 0.02)).material = tissu
    })
    if (nx < 0 && baie) garder(bandeau('cinema:tissu-linteau', scene, x, nx, baie[0], baie[1], () => SOL + LINTEAU, () => PLAFOND - 0.02)).material = tissu
  }
  // Le fond (au sud, sous la cabine) : rouge au-dessus du promenoir ; le mur nord, noir derrière l'écran.
  // Percé de la porte de la cabine et de ses lucarnes.
  const trous = [
    { a: PORTE_CABINE.x - PORTE_CABINE.width / 2, b: PORTE_CABINE.x + PORTE_CABINE.width / 2, y0: COTE_PROMENOIR, y1: COTE_PROMENOIR + (PORTE_CABINE.hauteur ?? 2) },
    ...CABINE.map((f) => ({ a: f.x - f.largeur / 2, b: f.x + f.largeur / 2, y0: f.y0, y1: f.y1 })),
  ]
  for (const [i, m] of morceaux({ a: SALLE.x + 0.15, b: SALLE.x + SALLE.width - 0.15, y0: COTE_PROMENOIR, y1: PLAFOND }, trous).entries()) {
    const fond = garder(CreatePlane(`cinema:fond${i}`, { width: m.b - m.a, height: m.y1 - m.y0 }, scene))
    fond.position.set((m.a + m.b) / 2, (m.y0 + m.y1) / 2, zS)
    fond.material = tissu
  }
  const nord = garder(CreatePlane('cinema:nord', { width: SALLE.width - 0.3, height: PLAFOND - SOL }, scene))
  nord.position.set(SALLE.x + SALLE.width / 2, (PLAFOND + SOL) / 2, zN)
  nord.rotation.y = Math.PI
  nord.material = noir

  // ── Le plafond à caissons, ses poutres et ses spots ──
  const fauxPlafond = garder(CreatePlane('cinema:plafond', { width: SALLE.width - 0.3, height: SALLE.depth - 0.3 }, scene))
  fauxPlafond.position.set(SALLE.x + SALLE.width / 2, PLAFOND - 0.03, SALLE.z + SALLE.depth / 2)
  fauxPlafond.rotation.x = -Math.PI / 2
  fauxPlafond.material = plafond
  const poutre = garder(CreateBox('cinema:poutres', { size: 1 }, scene))
  poutre.material = plafond
  const poutres: number[] = []
  const nX = Math.round(SALLE.width / CAISSON)
  const nZ = Math.round(SALLE.depth / CAISSON)
  for (let i = 1; i < nX; i++) poutres.push(...Matrix.Compose(new Vector3(0.18, 0.28, SALLE.depth - 0.3), Quaternion.Identity(), new Vector3(SALLE.x + (i * SALLE.width) / nX, PLAFOND - 0.17, SALLE.z + SALLE.depth / 2)).toArray())
  for (let j = 1; j < nZ; j++) poutres.push(...Matrix.Compose(new Vector3(SALLE.width - 0.3, 0.28, 0.18), Quaternion.Identity(), new Vector3(SALLE.x + SALLE.width / 2, PLAFOND - 0.17, SALLE.z + (j * SALLE.depth) / nZ)).toArray())
  poutre.thinInstanceSetBuffer('matrix', new Float32Array(poutres), 16)
  const spot = garder(CreateBox('cinema:spots', { width: 0.09, height: 0.01, depth: 0.09 }, scene))
  const halo = new StandardMaterial('cinema:spot', scene)
  halo.disableLighting = true
  halo.emissiveColor = new Color3(0.75, 0.6, 0.42)
  spot.material = halo
  spot.thinInstanceSetBuffer('matrix', translations(SPOTS.map((s) => [s.x, PLAFOND - 0.05, s.z])), 16)

  // ── Les rangs des gradins : le plancher de chaque rang, du sol à son dessus (la traverse a sa dalle) ──
  const rangs = garder(CreateBox('cinema:rangs', { size: 1 }, scene))
  rangs.material = moquette
  rangs.thinInstanceSetBuffer('matrix', new Float32Array(GRADINS.flatMap((g, k) => {
    const haut = g.dessus - (k === GRADINS.length - 1 ? 0.03 : 0)
    return [...Matrix.Compose(new Vector3(BLOC_GRADINS.width, haut - SOL, g.z1 - g.z0), Quaternion.Identity(), new Vector3(BLOC_GRADINS.x + BLOC_GRADINS.width / 2, (haut + SOL) / 2, (g.z0 + g.z1) / 2)).asArray()]
  })), 16)

  // ── La scène et sa façade de bois ──
  const estrade = garder(CreateBox('cinema:scene', { width: SCENE.width - 0.3, height: SCENE.hauteur, depth: SCENE.depth }, scene))
  estrade.position.set(SCENE.x + SCENE.width / 2, SOL + SCENE.hauteur / 2, SCENE.z + SCENE.depth / 2)
  estrade.material = bois

  // ── L'écran, ses rideaux ──
  const ecran = garder(CreatePlane('cinema:ecran', { width: ECRAN.largeur, height: ECRAN.hauteur }, scene))
  ecran.position.set(ECRAN.x, ECRAN.bas + ECRAN.hauteur / 2, ECRAN.z)
  // Le plan regarde −z : retourné, il fait face à la salle (au sud).
  ecran.rotation.y = Math.PI
  ecran.material = ecranMat
  RIDEAUX.forEach((r, i) => { garder(rideau(`cinema:rideau${i}`, scene, r, i === 2 ? 22 : 6, i === 2 ? 0.05 : 0.09)).material = dore })

  // ── Veilleuses des marches, fenêtres de la cabine ──
  const lumiere = garder(CreateBox('cinema:veilleuses', { width: 0.12, height: 0.035, depth: 0.03 }, scene))
  lumiere.material = veilleuse
  lumiere.thinInstanceSetBuffer('matrix', translations(LUMIERES_MARCHES.map((p) => [p.x, p.y, p.z - 0.02])), 16)
  // Les nez de marche des allées : un filet lumineux sur toute la largeur, presque éteint salle allumée.
  const nez = garder(CreateBox('cinema:nez', { width: 1, height: 0.012, depth: 0.025 }, scene))
  const filet = new StandardMaterial('cinema:nez', scene)
  filet.disableLighting = true
  filet.emissiveColor = VEILLEUSE.scale(0.15)
  nez.material = filet
  nez.thinInstanceSetBuffer('matrix', new Float32Array(VOLEES_CINEMA.flatMap((f) => Array.from({ length: f.risers }, (_, k) => {
    const [g, h] = [f.depth / f.risers, (f.top - f.bottom) / f.risers]
    return [...Matrix.Compose(new Vector3(f.width - 0.2, 1, 1), Quaternion.Identity(), new Vector3(f.x + f.width / 2, f.bottom + (k + 1) * h + 0.004, f.z + k * g + 0.02)).asArray()]
  }).flat())), 16)
  // L'objectif allumé : un disque additif devant la lucarne, qui ne paraît que pendant la séance.
  const lucarne = CABINE.find((f) => f.projection)!
  const eclat = new DynamicTexture('cinema:objectif', { width: 128, height: 128 }, scene, true)
  const ge = eclat.getContext()
  const rg = ge.createRadialGradient(64, 64, 4, 64, 64, 64)
  rg.addColorStop(0, 'rgba(255,255,255,1)')
  rg.addColorStop(0.25, 'rgba(235,240,255,0.8)')
  rg.addColorStop(1, 'rgba(200,215,255,0)')
  ge.fillStyle = rg
  ge.fillRect(0, 0, 128, 128)
  eclat.update()
  const lumiereObjectif = new StandardMaterial('cinema:objectif', scene)
  lumiereObjectif.disableLighting = true
  lumiereObjectif.emissiveTexture = eclat
  lumiereObjectif.opacityTexture = eclat
  lumiereObjectif.alphaMode = Constants.ALPHA_ADD
  lumiereObjectif.disableDepthWrite = true
  const objectif = garder(CreatePlane('cinema:objectif', { size: 0.7 }, scene))
  objectif.position.set(lucarne.x, (lucarne.y0 + lucarne.y1) / 2, lucarne.z - PEAU - 0.03)
  objectif.material = lumiereObjectif
  objectif.visibility = 0

  // ── Les objets Meshy : fauteuils, appliques, enceintes ──
  const [fauteuils, appliques, enceintes] = await Promise.all(['fauteuil', 'applique', 'enceinte'].map((n) => glbOuRien(scene, `assets/cinema/${n}.glb`)))
  if (fauteuils) {
    // Un fauteuil par place (`SIEGES`), ramené à 1,00 m de haut (dossier compris), face à l'écran.
    salle.push(...poser(fauteuils, SIEGES.map((s) => ({ x: s.x, y: s.y, z: s.z, lacet: s.lacet })), HAUTEUR_FAUTEUIL, 'y', false))
  }
  const auMur = (p: (typeof APPLIQUES)[number], recul: number) => ({ x: p.x + p.nx * recul, y: p.y, z: p.z, lacet: Math.atan2(p.nx, p.nz) })
  if (appliques) salle.push(...poser(appliques, APPLIQUES.map((p) => auMur(p, 0.16)), 0.95, 'y', true))
  if (enceintes) salle.push(...poser(enceintes, ENCEINTES.map((p) => auMur(p, 0.17)), 0.55, 'y', true))
  // Les spectateurs, dans les fauteuils qui leur sont réservés.
  salle.push(...await monterSpectateurs(scene, SPECTATEURS).catch((e: unknown) => (console.warn('spectateurs', e), [])))

  // ── Lumière : sous terre, ni soleil ni ciel ; six lumières chaudes, une par applique, pour la salle seule ──
  lumieres.soleil.excludedMeshes.push(...salle)
  lumieres.hemi.excludedMeshes.push(...salle)
  // Ni aucune lumière du musée (les flaques des galeries, juste au-dessus, la lampe d'honneur, la toile regardée :
  // une lumière traverse les dalles), déjà là ou à venir. Les huit places de lumière de la salle sont à elle.
  const horsGrappe = (l: { name: string; excludedMeshes: AbstractMesh[] }) => { if (!l.name.startsWith('cinema:')) l.excludedMeshes.push(...salle) }
  scene.lights.forEach(horsGrappe)
  scene.onNewLightAddedObservable.add(horsGrappe)
  const lampes = APPLIQUES.map((p, i) => {
    const l = new PointLight(`cinema:applique${i}`, new Vector3(p.x + p.nx * 0.9, p.y + 0.35, p.z), scene)
    l.diffuse = CHAUD
    l.specular = CHAUD.scale(0.5)
    l.intensity = 4
    l.range = 8
    l.includedOnlyMeshes = salle
    return l
  })

  // ── Le faisceau du projecteur : de la cabine à la toile, visible pendant la séance ──
  const source = new Vector3(lucarne.x, (lucarne.y0 + lucarne.y1) / 2, lucarne.z - 0.05)
  const coins: Coins = [
    new Vector3(ECRAN.x - ECRAN.largeur / 2, ECRAN.bas + ECRAN.hauteur, ECRAN.z),
    new Vector3(ECRAN.x + ECRAN.largeur / 2, ECRAN.bas + ECRAN.hauteur, ECRAN.z),
    new Vector3(ECRAN.x + ECRAN.largeur / 2, ECRAN.bas, ECRAN.z),
    new Vector3(ECRAN.x - ECRAN.largeur / 2, ECRAN.bas, ECRAN.z),
  ]
  const faisceau = garder(new Mesh('cinema:faisceau', scene))
  // Quatre faces de l'objectif aux bords de la toile, chacune avec ses sommets : u à travers la face, v le long.
  // Le dégradé est dans la texture d'opacité : vif à l'objectif, presque rien à la toile, flou sur les bords.
  const bords = [[coins[0], coins[1]], [coins[1], coins[2]], [coins[2], coins[3]], [coins[3], coins[0]]]
  Object.assign(new VertexData(), {
    positions: bords.flatMap(([a, b]) => [source, a, b].flatMap((v) => [v.x, v.y, v.z])),
    uvs: bords.flatMap(() => [0.5, 0, 0, 1, 1, 1]),
    indices: bords.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2]),
  }).applyToMesh(faisceau)
  const voile = new DynamicTexture('cinema:faisceau', { width: 64, height: 64 }, scene, false)
  const gv = voile.getContext() as CanvasRenderingContext2D
  const img = gv.createImageData(64, 64)
  for (let j = 0; j < 64; j++)
    for (let i = 0; i < 64; i++) {
      const [u, v] = [(i + 0.5) / 64, (j + 0.5) / 64]
      img.data.set([235, 242, 255, Math.round(255 * Math.pow(Math.sin(Math.PI * u), 1.5) * (0.06 * (1 - v) + 0.01 * v))], (j * 64 + i) * 4)
    }
  gv.putImageData(img, 0, 0)
  voile.update()
  voile.hasAlpha = true
  const lumineux = new StandardMaterial('cinema:faisceau', scene)
  lumineux.disableLighting = true
  lumineux.emissiveColor = new Color3(0.92, 0.95, 1)
  lumineux.opacityTexture = voile
  lumineux.backFaceCulling = false
  lumineux.disableDepthWrite = true
  lumineux.alphaMode = Constants.ALPHA_ADD
  faisceau.material = lumineux
  faisceau.isVisible = false

  // La lueur que la toile renvoie sur les premiers rangs, pendant la séance.
  const reflet = new PointLight('cinema:reflet', new Vector3(ECRAN.x, ECRAN.bas + ECRAN.hauteur / 2, ECRAN.z + 1.2), scene)
  reflet.diffuse = new Color3(0.85, 0.88, 1)
  reflet.specular = Color3.Black()
  // Allumé par l'intensité, jamais éteint : une lumière qu'on retire recompilerait les matières en pleine séance.
  reflet.intensity = 0
  reflet.range = 16
  reflet.includedOnlyMeshes = salle

  // ── Le gradateur : `sombre` va de 0 (salle allumée) à 1 (séance) en GRADATEUR secondes ──
  const SPOT = halo.emissiveColor.clone()
  for (const m of [halo, veilleuse, filet, lumiereObjectif]) VIVANTES.add(m.name)
  // L'ambiance de la sonde de la salle (spéculaire) éclaire le velours quelles que soient les lampes : elle baisse avec elles.
  const ambiances = [...new Set(salle.map((m) => m.material).filter((m): m is PBRMaterial => m instanceof PBRMaterial))]
    .map((m) => (VIVANTES.add(m.name), [m, m.environmentIntensity] as const))
  let sombre = 0
  let cible = 0
  const doux = (t: number) => t * t * (3 - 2 * t)
  const regler = () => {
    const n = doux(sombre)
    const jour = 1 - n
    for (const l of lampes) l.intensity = 4 * (0.08 + 0.92 * jour)
    SPOT.scaleToRef(0.05 + 0.95 * jour, halo.emissiveColor)
    ecranMat.emissiveColor.set(0.5 * jour, 0.5 * jour, 0.5 * jour)
    VEILLEUSE.scaleToRef(0.5 + 0.9 * n, veilleuse.emissiveColor)
    VEILLEUSE.scaleToRef(0.15 + 0.75 * n, filet.emissiveColor)
    reflet.intensity = 2 * n
    for (const [m, e] of ambiances) m.environmentIntensity = e * (0.12 + 0.88 * jour)
    objectif.visibility = n
  }
  regler()
  scene.onBeforeRenderObservable.add(() => {
    if (sombre !== cible) {
      const pas = scene.getEngine().getDeltaTime() / 1000 / GRADATEUR
      sombre = cible > sombre ? Math.min(cible, sombre + pas) : Math.max(cible, sombre - pas)
      regler()
    }
    // On ne voit pas un faisceau de l'intérieur : il s'efface peu à peu quand on y entre (`dansLeFaisceau`).
    faisceau.isVisible = sombre > 0
    faisceau.visibility = doux(sombre) * (1 - 0.9 * dansLeFaisceau(camera.position))
  })

  // ── La séance : le lecteur sur la toile, la salle qui s'éteint ──
  const seance = monterSeance(scene, coins, programme, {
    debut() {
      cible = 1
      signaler('cinema')
    },
    fin() {
      cible = 0
    },
  })

  // Ce qu'on peut faire dans la salle, annoncé en bas de l'écran : la séance (Entrée), s'asseoir (E) ou se lever.
  const doigt = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const bSeance = el('button', { type: 'button' })
  const bSiege = el('button', { type: 'button', hidden: true })
  const bCabine = el('button', { type: 'button', hidden: true, disabled: true })
  const invitation = el('div', { class: 'cinema-invitation', hidden: true }, bSeance, bSiege, bCabine)
  racine.append(invitation)
  const dansLaSalle = () => SURFACES_CINEMA.has(camera.walker().surface)
  const regard = new Vector3()
  let vise: Siege | null = null
  /** Dans une allée ou sur la traverse, sans viser : le fauteuil le plus proche du rang qu'on longe. */
  const voisin = (): Siege | null => {
    const w = camera.walker()
    const surTraverse = w.surface === `palier:${TRAVERSE.id}`
    if (!surTraverse && !VOLEES_CINEMA.some((f) => w.surface === `volee:${f.id}`)) return null
    const rang = surTraverse ? GRADINS.length - 2 : GRADINS.findIndex((g) => w.z >= g.z0 && w.z < g.z1)
    let meilleur: Siege | null = null
    for (const s of SIEGES_LIBRES) if (s.rang === rang && (!meilleur || Math.abs(s.x - w.x) < Math.abs(meilleur.x - w.x))) meilleur = s
    return meilleur
  }
  const asseoir = (s: Siege) => {
    // Face à la toile (cap 0 : vers le nord), les yeux d'une personne assise.
    const oeil = s.y + 1.15
    camera.asseoir({ level: -1, surface: '-1:cinema', x: s.x, z: s.z, y: s.y, yaw: 0, pitch: Math.atan2(ECRAN.bas + ECRAN.hauteur / 2 - oeil, s.z - ECRAN.z) }, oeil)
  }
  const touche = (k: string) => (doigt ? '' : `${k} : `)
  const mettreAJour = () => {
    const st = partie.getState()
    const ici = dansLaSalle() || st.assis
    // Sortir de la salle arrête la séance.
    if (st.seance && !ici) seance.finir()
    invitation.hidden = st.paused || !ici
    if (invitation.hidden) return
    bSeance.hidden = !programme
    if (programme) bSeance.textContent = st.seance ? `${touche('Entrée')}arrêter la séance` : `${touche('Entrée')}voir « ${programme.titre} »`
    camera.getDirectionToRef(Vector3.Forward(true), regard)
    vise = st.assis ? null : siegeVise(camera.position, regard, SIEGES_LIBRES) ?? voisin()
    bSiege.hidden = !st.assis && !vise
    bSiege.textContent = st.assis ? (doigt ? 'Avancez pour vous lever' : 'Z ou flèches : se lever') : `${touche('E')}s’asseoir (rang ${(vise?.rang ?? 0) + 1})`
    bSiege.disabled = st.assis
    // Devant la porte de la cabine, fermée : combien de tampons il manque.
    const w = camera.walker()
    const n = Object.keys(carnet.getState().carnet.tampons).length
    bCabine.hidden = ouverte() || w.surface !== `palier:${PROMENOIR.id}` || Math.hypot(w.x - PORTE_CABINE.x, w.z - PORTE_CABINE.z) > 2.2
    bCabine.textContent = `Cabine de projection : ${n} / ${TAMPONS_CABINE} tampons`
  }
  let compte = 0
  scene.onAfterRenderObservable.add(() => { if (++compte % 6 === 0) mettreAJour() })
  partie.subscribe(mettreAJour)
  const basculer = () => (partie.getState().seance ? seance.finir() : seance.lancer())
  bSeance.addEventListener('click', basculer)
  bSiege.addEventListener('click', () => vise && asseoir(vise))
  addEventListener('keydown', (e) => {
    if (e.repeat || partie.getState().paused || !(dansLaSalle() || partie.getState().assis)) return
    if (e.key === 'Enter') basculer()
    else if (e.code === 'KeyE' && vise) asseoir(vise)
  })

  // Au foyer, à côté de la porte : la boîte lumineuse « À l'affiche ».
  if (programme) {
    const L = 1024
    const H = 640
    const vitrine = new DynamicTexture('cinema:vitrine', { width: L, height: H }, scene, true)
    vitrine.uScale = -1
    vitrine.uOffset = 1
    const c = vitrine.getContext()
    const peindre = (image?: HTMLImageElement) => {
      c.fillStyle = '#1a0507'
      c.fillRect(0, 0, L, H)
      c.fillStyle = '#d9b26a'
      c.font = '600 46px Marcellus, Georgia, serif'
      const titre = 'À L’AFFICHE'
      c.fillText(titre, (L - c.measureText(titre).width) / 2, 70)
      if (image) c.drawImage(image, 112, 100, 800, 450)
      c.fillStyle = '#f3e6cf'
      c.font = '400 30px "Source Sans 3", sans-serif'
      const ligne = programme.titre.length > 52 ? `${programme.titre.slice(0, 50)}…` : programme.titre
      c.fillText(ligne, (L - c.measureText(ligne).width) / 2, 600)
      vitrine.update()
    }
    peindre()
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => peindre(image)
    image.src = affiche(programme.video, 'hqdefault')
    const lumineux = new StandardMaterial('cinema:vitrine', scene)
    lumineux.disableLighting = true
    lumineux.diffuseColor = Color3.Black()
    lumineux.specularColor = Color3.Black()
    lumineux.emissiveTexture = vitrine
    const boite = CreatePlane('cinema:vitrine', { width: 1.6, height: 1.0 }, scene)
    // Sur le mur ouest du foyer (sa face x = 16,15), regardant l'est, au sud de la porte.
    boite.position.set(16.21, SOL + 1.65, 9.7)
    boite.rotation.y = -Math.PI / 2
    boite.material = lumineux
    boite.isPickable = false
    const cadre = CreateBox('cinema:vitrine-cadre', { width: 0.04, height: 1.1, depth: 1.7 }, scene)
    cadre.position.set(16.17, SOL + 1.65, 9.7)
    cadre.material = dore
    cadre.isPickable = false
  }

  monterFoyer(scene, programme, { ...lumieres, dore })

  // La cabine de projection : fermée tant que le carnet n'a pas ses dix tampons.
  const cabine = monterCabine(scene, { ...lumieres, dore })
  const ouverte = () => cabineOuverte(carnet.getState().carnet)
  cabine.ouvrir(ouverte())
  carnet.subscribe(() => cabine.ouvrir(ouverte()))
  const dansLaCabine = `palier:${SOL_CABINE.id}`
  // La porte de la cabine, vue de la salle : éclairée par ses lumières.
  salle.push(...cabine.porte)
  // Fermée avant ses tampons ; ouverte, on y contourne les meubles (à 30 cm près : le rayon du visiteur).
  const R = 0.3
  BARRIERES.push((w) => w.surface === dansLaCabine && (!ouverte() || MEUBLES_CABINE.some((m) => w.x > m.x - R && w.x < m.x + m.width + R && w.z > m.z - R && w.z < m.z + m.depth + R)))
  let dedans = false
  scene.onAfterRenderObservable.add(() => {
    const ici = camera.walker().surface === dansLaCabine
    if (ici && !dedans) signaler('cabine')
    dedans = ici
  })

  // L'enseigne du hall, au-dessus de la descente (sous la volée ouest, face au sud).
  const enseigne = new DynamicTexture('cinema:enseigne', { width: 512, height: 128 }, scene, true)
  const g = enseigne.getContext()
  g.fillStyle = '#120405'
  g.fillRect(0, 0, 512, 128)
  g.fillStyle = '#ffcf8a'
  g.font = '600 64px Marcellus, Georgia, serif'
  const mot = 'CINÉMA ↓'
  g.fillText(mot, (512 - g.measureText(mot).width) / 2, 88)
  enseigne.update()
  enseigne.uScale = -1
  enseigne.uOffset = 1
  const plaque = new StandardMaterial('cinema:enseigne', scene)
  plaque.disableLighting = true
  plaque.emissiveTexture = enseigne
  plaque.diffuseColor = Color3.Black()
  plaque.specularColor = Color3.Black()
  const panneau = CreatePlane('cinema:enseigne', { width: 1.8, height: 0.45 }, scene)
  panneau.position.set(17.5, 2.75, 20.06)
  panneau.rotation.y = Math.PI
  panneau.material = plaque
  panneau.isPickable = false
}
