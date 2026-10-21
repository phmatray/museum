/**
 * Le foyer du cinéma (`plan/cinema.ts` : FOYER, COMPTOIR, AFFICHES) : on y attend la
 * séance comme dans une vieille salle de quartier. Lambris de bois sombre et tenture
 * bordeaux aux murs, moquette à motif, plafond chaud piqué de spots, appliques dorées
 * (le modèle Meshy du cinéma), un comptoir de confiserie face à l'arrivée, les
 * affiches au mur nord (la séance, la précédente, le programme), l'enseigne « Salle 1 »
 * au-dessus de la porte et, de l'autre côté, la « Sortie » verte.
 *
 * Sous terre : ni soleil ni ciel ; deux plafonniers chauds n'éclairent que le foyer.
 */
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { affiche, type Seance } from '../domain/cinema.ts'
import { AFFICHES, COMPTOIR, FOYER, LAMBRIS, PLAFOND, SOL } from '../plan/cinema.ts'
import { MUSEE } from '../plan/musee.ts'
import { LINTEAU } from '../plan/portes.ts'

const CHAUD = new Color3(1, 0.8, 0.58)

export const pbr = (scene: Scene, nom: string, couleur: Color3, rugosite: number, metal = 0) => {
  const m = new PBRMaterial(nom, scene)
  m.albedoColor = couleur
  m.roughness = rugosite
  m.metallic = metal
  return m
}
/** La retombée du faux plafond sous la dalle (m). */
const FAUX_PLAFOND = 0.5
/** La face des murs du foyer (cloisons de 0,15) plus le revêtement. */
const FACE = 0.15 + 0.02

/** Un plan tourné vers `face` (+x, −x, +z, −z), centré en (x, y, z). */
export function plan(nom: string, scene: Scene, l: number, h: number, x: number, y: number, z: number, face: '+x' | '-x' | '+z' | '-z'): Mesh {
  const m = CreatePlane(nom, { width: l, height: h }, scene)
  m.position.set(x, y, z)
  m.rotation.y = { '+x': -Math.PI / 2, '-x': Math.PI / 2, '+z': Math.PI, '-z': 0 }[face]
  m.isPickable = false
  return m
}

/** Une plaque lumineuse dessinée (texte, affiche) : non éclairée, lisible (le plan retourné est remis à l'endroit). */
export function lumineuse(nom: string, scene: Scene, l: number, h: number, dessin: (g: CanvasRenderingContext2D, L: number, H: number, t: DynamicTexture) => void, eclat = 1): StandardMaterial {
  const L = 1024
  const H = Math.round((L * h) / l)
  const t = new DynamicTexture(nom, { width: L, height: H }, scene, true)
  t.uScale = -1
  t.uOffset = 1
  dessin(t.getContext() as CanvasRenderingContext2D, L, H, t)
  t.update()
  const m = new StandardMaterial(nom, scene)
  m.disableLighting = true
  m.diffuseColor = Color3.Black()
  m.specularColor = Color3.Black()
  m.emissiveTexture = t
  m.emissiveColor = new Color3(eclat, eclat, eclat)
  return m
}

/** Un texte centré sur une ligne, réduit pour tenir dans `largeur`. */
export function centre(g: CanvasRenderingContext2D, texte: string, y: number, L: number, police: (taille: number) => string, taille: number, largeur = L * 0.86) {
  let t = taille
  do g.font = police(t--)
  while (g.measureText(texte).width > largeur && t > 10)
  g.fillText(texte, (L - g.measureText(texte).width) / 2, y)
}

/** Coupe un titre en lignes d'au plus `n` caractères, sur les espaces. */
function lignes(titre: string, n: number, max = 3): string[] {
  const out: string[] = []
  for (const mot of titre.split(/\s+/)) {
    const der = out.at(-1)
    if (der !== undefined && (der + ' ' + mot).length <= n) out[out.length - 1] = `${der} ${mot}`
    else out.push(mot)
  }
  return out.length > max ? [...out.slice(0, max - 1), `${out.slice(max - 1).join(' ').slice(0, n - 1)}…`] : out
}

export const SERIF = (t: number) => `600 ${t}px Marcellus, Georgia, serif`
const SANS = (t: number) => `400 ${t}px "Source Sans 3", sans-serif`

/** Une affiche de film, portrait : bandeau, vignette de la vidéo, titre. */
function peindreAffiche(g: CanvasRenderingContext2D, L: number, H: number, bandeau: string, titre: string, image?: HTMLImageElement) {
  const fond = g.createLinearGradient(0, 0, 0, H)
  fond.addColorStop(0, '#2a0709')
  fond.addColorStop(1, '#0c0203')
  g.fillStyle = fond
  g.fillRect(0, 0, L, H)
  g.fillStyle = '#d9b26a'
  centre(g, bandeau, H * 0.09, L, SERIF, 64)
  g.fillRect(L * 0.3, H * 0.115, L * 0.4, 3)
  if (image) {
    const w = L * 0.88
    g.drawImage(image, (L - w) / 2, H * 0.17, w, (w * 9) / 16)
  }
  g.fillStyle = '#f3e6cf'
  lignes(titre, 26).forEach((l, i) => centre(g, l, H * 0.62 + i * 78, L, SERIF, 60))
  g.fillStyle = '#b89a6a'
  centre(g, 'ATYPICAL CRAFT', H * 0.93, L, SANS, 40)
}

export function monterFoyer(
  scene: Scene,
  programme: Seance | null,
  lumieres: { soleil: DirectionalLight; hemi: HemisphericLight; dore: PBRMaterial },
): void {
  const foyer: AbstractMesh[] = []
  const garder = <T extends AbstractMesh>(m: T): T => (foyer.push(m), m)
  const [x0, x1, z0, z1] = [FOYER.x + FACE, FOYER.x + FOYER.width - FACE, FOYER.z + FACE, FOYER.z + FOYER.depth - FACE]

  // ── Les matières ──
  const tenture = pbr(scene, 'foyer:tenture', new Color3(0.3, 0.025, 0.04), 0.85)
  tenture.sheen.isEnabled = true
  tenture.sheen.color = new Color3(1, 0.4, 0.4)
  tenture.sheen.intensity = 0.5
  const lambris = pbr(scene, 'foyer:lambris', new Color3(0.2, 0.11, 0.06), 0.5)
  const plafond = pbr(scene, 'foyer:plafond', new Color3(0.32, 0.22, 0.15), 0.9)
  const creme = pbr(scene, 'foyer:marbre', new Color3(0.78, 0.72, 0.62), 0.25)
  const laiton = pbr(scene, 'foyer:laiton', new Color3(0.78, 0.6, 0.3), 0.3, 1)
  const verre = pbr(scene, 'foyer:verre', new Color3(0.9, 0.95, 1), 0.05)
  verre.alpha = 0.18
  // La moquette : losanges or sur bordeaux, répétés tous les 60 cm.
  const motif = new DynamicTexture('foyer:moquette', { width: 256, height: 256 }, scene, true)
  const gm = motif.getContext()
  gm.fillStyle = '#4a0b10'
  gm.fillRect(0, 0, 256, 256)
  gm.strokeStyle = '#a07a3a'
  gm.lineWidth = 6
  gm.beginPath()
  gm.moveTo(128, 8)
  gm.lineTo(248, 128)
  gm.lineTo(128, 248)
  gm.lineTo(8, 128)
  gm.closePath()
  gm.stroke()
  gm.fillStyle = '#7a1a20'
  gm.fillRect(118, 118, 20, 20)
  motif.update()
  motif.wrapU = motif.wrapV = Texture.WRAP_ADDRESSMODE
  motif.uScale = (x1 - x0) / 0.6
  motif.vScale = (z1 - z0) / 0.6
  const moquette = pbr(scene, 'foyer:moquette', Color3.White(), 0.95)
  moquette.albedoTexture = motif

  // ── Murs : lambris au pied, tenture au-dessus ; ni dans la porte de la salle ni dans l'arrivée de l'escalier ──
  const sous = MUSEE.levels.find((l) => l.id === -1)!
  const porte = sous.openings.find((o) => o.kind === 'door' && o.b === 'cinema')!
  const arrivee = sous.openings.find((o) => o.a === 'ss-escalier' && o.b === 'ss-foyer')!
  const pan = (nom: string, a: number, b: number, face: '+x' | '-x' | '+z' | '-z', fixe: number, linteau = false) => {
    const l = b - a
    const c = (a + b) / 2
    const [x, z] = face === '+x' || face === '-x' ? [fixe, c] : [c, fixe]
    if (!linteau) garder(plan(`${nom}:lambris`, scene, l, LAMBRIS.hauteur, x, SOL + LAMBRIS.hauteur / 2, z, face)).material = lambris
    const [bas, haut] = [linteau ? SOL + LINTEAU : SOL + LAMBRIS.hauteur, PLAFOND - FAUX_PLAFOND]
    garder(plan(`${nom}:tenture`, scene, l, haut - bas, x, (haut + bas) / 2, z, face)).material = tenture
  }
  const [p0, p1] = [porte.z - porte.width / 2, porte.z + porte.width / 2]
  pan('foyer:ouest-n', z0, p0, '+x', x0)
  pan('foyer:ouest-s', p1, z1, '+x', x0)
  pan('foyer:ouest-linteau', p0, p1, '+x', x0, true)
  pan('foyer:est', z0, z1, '-x', x1)
  pan('foyer:nord', x0, x1, '+z', z0)
  pan('foyer:sud', arrivee.x + arrivee.width / 2, x1, '-z', z1)
  const sol = garder(plan('foyer:moquette', scene, x1 - x0, z1 - z0, (x0 + x1) / 2, SOL + 0.006, (z0 + z1) / 2, '-z'))
  sol.rotation.x = Math.PI / 2
  sol.material = moquette
  // Un faux plafond 0,5 m sous la dalle : au-dessus passent le dessous de l'escalier du hall et ses paillasses.
  const ciel = garder(plan('foyer:plafond', scene, x1 - x0, z1 - z0, (x0 + x1) / 2, PLAFOND - FAUX_PLAFOND, (z0 + z1) / 2, '-z'))
  ciel.rotation.x = -Math.PI / 2
  ciel.material = plafond
  // Une corniche dorée sous le plafond, tout le tour.
  const corniche = garder(CreateBox('foyer:corniche', { size: 1 }, scene))
  corniche.material = laiton
  corniche.thinInstanceSetBuffer('matrix', new Float32Array([
    [x1 - x0, 0.08, 0.05, (x0 + x1) / 2, z0 + 0.025], [x1 - x0, 0.08, 0.05, (x0 + x1) / 2, z1 - 0.025],
    [0.05, 0.08, z1 - z0, x0 + 0.025, (z0 + z1) / 2], [0.05, 0.08, z1 - z0, x1 - 0.025, (z0 + z1) / 2],
  ].flatMap(([sx, sy, sz, x, z]) => [...Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.Identity(), new Vector3(x, PLAFOND - FAUX_PLAFOND - 0.04, z)).asArray()])), 16)
  // Et la cimaise de laiton au-dessus du lambris.
  const cimaise = garder(CreateBox('foyer:cimaise', { size: 1 }, scene))
  cimaise.material = laiton
  cimaise.thinInstanceSetBuffer('matrix', new Float32Array([
    [x1 - x0, z0 + 0.012, 'x'], [x1 - arrivee.x - arrivee.width / 2, z1 - 0.012, 'xs'], [z1 - z0, x1 - 0.012, 'z'], [p0 - z0, x0 + 0.012, 'zn'], [z1 - p1, x0 + 0.012, 'zs'],
  ].flatMap(([l, fixe, sens]) => {
    const [x, z, sx, sz] = sens === 'x' ? [(x0 + x1) / 2, fixe, l, 0.025] : sens === 'xs' ? [x1 - (l as number) / 2, fixe, l, 0.025]
      : sens === 'z' ? [fixe, (z0 + z1) / 2, 0.025, l] : sens === 'zn' ? [fixe, z0 + (l as number) / 2, 0.025, l] : [fixe, z1 - (l as number) / 2, 0.025, l]
    return [...Matrix.Compose(new Vector3(sx as number, 0.04, sz as number), Quaternion.Identity(), new Vector3(x as number, SOL + LAMBRIS.hauteur, z as number)).asArray()]
  })), 16)

  // ── Le comptoir de confiserie, contre le mur est ──
  const [cx0, cz0, cz1] = [COMPTOIR.x, COMPTOIR.z, COMPTOIR.z + COMPTOIR.depth]
  const boite = (nom: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, m: StandardMaterial | PBRMaterial) => {
    const b = garder(CreateBox(nom, { width: sx, height: sy, depth: sz }, scene))
    b.position.set(x, y, z)
    b.material = m
    b.isPickable = false
    return b
  }
  const zc = (cz0 + cz1) / 2
  boite('foyer:comptoir', 0.7, 1.0, cz1 - cz0, cx0 + 0.35, SOL + 0.5, zc, lambris)
  boite('foyer:comptoir-dessus', 0.8, 0.05, cz1 - cz0 + 0.1, cx0 + 0.35, SOL + 1.025, zc, creme)
  boite('foyer:comptoir-plinthe', 0.72, 0.08, cz1 - cz0 + 0.02, cx0 + 0.35, SOL + 0.04, zc, laiton)
  boite('foyer:vitrine', 0.5, 0.36, 2.2, cx0 + 0.35, SOL + 1.23, zc - 0.7, verre)
  // Les friandises dans la vitrine : trois rangées de boîtes de couleurs.
  const couleurs = ['#c0392b', '#e8b33a', '#2e6db0', '#f0e6d0', '#7a3b8f'].map((c) => {
    const m = pbr(scene, `foyer:bonbons${c}`, Color3.FromHexString(c).toLinearSpace(), 0.5)
    return m
  })
  couleurs.forEach((m, i) => {
    const b = garder(CreateBox(`foyer:bonbons${i}`, { width: 0.12, height: 0.16, depth: 0.08 }, scene))
    b.material = m
    b.isPickable = false
    const poses: number[] = []
    for (let k = 0; k < 4; k++) poses.push(...Matrix.Translation(cx0 + 0.27 + (k % 2) * 0.16, SOL + 1.13, zc - 1.7 + i * 0.4 + k * 0.09).asArray())
    b.thinInstanceSetBuffer('matrix', new Float32Array(poses), 16)
  })
  // La machine à pop-corn, au bout du comptoir.
  const rouge = pbr(scene, 'foyer:popcorn', new Color3(0.55, 0.03, 0.03), 0.35)
  const mais = new StandardMaterial('foyer:mais', scene)
  mais.diffuseColor = new Color3(1, 0.85, 0.45)
  mais.emissiveColor = new Color3(0.55, 0.42, 0.18)
  boite('foyer:popcorn-socle', 0.5, 0.12, 0.5, cx0 + 0.35, SOL + 1.11, zc + 1.45, rouge)
  boite('foyer:popcorn-mais', 0.44, 0.12, 0.44, cx0 + 0.35, SOL + 1.23, zc + 1.45, mais)
  boite('foyer:popcorn-cage', 0.5, 0.55, 0.5, cx0 + 0.35, SOL + 1.45, zc + 1.45, verre)
  // Les montants rouges de la cage vitrée.
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) boite('foyer:popcorn-montant', 0.03, 0.55, 0.03, cx0 + 0.35 + dx * 0.24, SOL + 1.45, zc + 1.45 + dz * 0.24, rouge)
  boite('foyer:popcorn-toit', 0.54, 0.08, 0.54, cx0 + 0.35, SOL + 1.76, zc + 1.45, rouge)
  // L'enseigne « Confiserie », au-dessus.
  garder(plan('foyer:confiserie', scene, 2.6, 0.55, x1 - 0.01, SOL + 2.75, zc, '-x')).material = lumineuse('foyer:confiserie', scene, 2.6, 0.55, (g, L, H) => {
    g.fillStyle = '#140405'
    g.fillRect(0, 0, L, H)
    g.strokeStyle = '#d9b26a'
    g.lineWidth = 6
    g.strokeRect(10, 10, L - 20, H - 20)
    g.fillStyle = '#ffcf8a'
    centre(g, 'CONFISERIE', H * 0.68, L, SERIF, 120)
  }, 0.55)

  // ── Les affiches, au mur nord : la séance, la précédente, le programme ──
  const films: { bandeau: string; titre: string; video?: string }[] = [
    ...(programme ? [{ bandeau: 'À L’AFFICHE', titre: programme.titre, video: programme.video }] : []),
    ...(programme?.precedentes ?? []).slice(0, 1).map((p) => ({ bandeau: 'DÉJÀ PROJETÉ', titre: p.titre, video: p.video })),
  ]
  AFFICHES.forEach((a, i) => {
    const f = films[i]
    const cadre = garder(CreateBox(`foyer:cadre${i}`, { width: a.largeur + 0.1, height: a.hauteur + 0.1, depth: 0.04 }, scene))
    cadre.position.set(a.x, a.y, z0 + 0.02)
    cadre.material = lumieres.dore
    const m = lumineuse(`foyer:affiche${i}`, scene, a.largeur, a.hauteur, (g, L, H, t) => {
      if (!f) {
        // Le programme : les horaires de la salle.
        g.fillStyle = '#0f0304'
        g.fillRect(0, 0, L, H)
        g.fillStyle = '#d9b26a'
        centre(g, 'PROGRAMME', H * 0.12, L, SERIF, 80)
        g.fillRect(L * 0.3, H * 0.15, L * 0.4, 3)
        g.fillStyle = '#f3e6cf'
        ;['Chaque jour', 'la dernière vidéo', 'd’Atypical Craft', '', 'Séances permanentes', 'Entrée libre'].forEach((l, k) => centre(g, l, H * 0.32 + k * 90, L, SERIF, 62))
        g.fillStyle = '#b89a6a'
        centre(g, 'SALLE 1 — LES VARIÉTÉS', H * 0.93, L, SANS, 40)
        return
      }
      peindreAffiche(g, L, H, f.bandeau, f.titre)
      if (!f.video) return
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        peindreAffiche(g, L, H, f.bandeau, f.titre, image)
        t.update()
      }
      image.src = affiche(f.video, 'hqdefault')
    }, 0.5)
    garder(plan(`foyer:affiche${i}`, scene, a.largeur, a.hauteur, a.x, a.y, z0 + 0.045, '+z')).material = m
  })

  // ── « Salle 1 » au-dessus de la porte ; « Sortie » de l'autre côté, dans la salle ──
  const ySalle = SOL + LINTEAU + 0.45
  garder(plan('foyer:salle1', scene, 1.6, 0.4, x0 + 0.01, ySalle, porte.z, '+x')).material = lumineuse('foyer:salle1', scene, 1.6, 0.4, (g, L, H) => {
    g.fillStyle = '#140405'
    g.fillRect(0, 0, L, H)
    g.fillStyle = '#ffcf8a'
    centre(g, 'SALLE 1', H * 0.72, L, SERIF, 150)
  }, 0.55)
  const sortie = plan('foyer:sortie', scene, 0.6, 0.2, FOYER.x - FACE - 0.01, ySalle - 0.1, porte.z, '-x')
  sortie.material = lumineuse('foyer:sortie', scene, 0.6, 0.2, (g, L, H) => {
    g.fillStyle = '#0c7a3a'
    g.fillRect(0, 0, L, H)
    g.fillStyle = '#eafff0'
    centre(g, 'SORTIE', H * 0.74, L, (t) => `700 ${t}px "Source Sans 3", sans-serif`, 200)
  }, 1.2)

  // ── Les spots du plafond, et deux plafonniers chauds pour le foyer seul ──
  const spot = garder(CreateBox('foyer:spots', { width: 0.12, height: 0.01, depth: 0.12 }, scene))
  const halo = new StandardMaterial('foyer:spot', scene)
  halo.disableLighting = true
  halo.emissiveColor = new Color3(1, 0.85, 0.62)
  spot.material = halo
  const spots: number[] = []
  for (const x of [19, 22.5, 26, 29.5]) for (const z of [6, 10]) spots.push(...Matrix.Translation(x, PLAFOND - FAUX_PLAFOND - 0.006, z).asArray())
  spot.thinInstanceSetBuffer('matrix', new Float32Array(spots), 16)
  lumieres.soleil.excludedMeshes.push(...foyer)
  lumieres.hemi.excludedMeshes.push(...foyer)
  for (const x of [20, 27.5]) {
    const l = new PointLight(`foyer:plafonnier${x}`, new Vector3(x, PLAFOND - FAUX_PLAFOND - 0.9, (z0 + z1) / 2), scene)
    l.diffuse = CHAUD
    l.specular = CHAUD.scale(0.4)
    l.intensity = 6
    l.range = 11
    l.includedOnlyMeshes = foyer
  }
  // Ni aucune lumière du musée (une lumière traverse les dalles), ni celles de la salle.
  const horsGrappe = (l: { name: string; excludedMeshes: AbstractMesh[] }) => { if (!l.name.startsWith('foyer:')) l.excludedMeshes.push(...foyer) }
  scene.lights.forEach(horsGrappe)
  scene.onNewLightAddedObservable.add(horsGrappe)
}
