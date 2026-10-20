/**
 * Le tableau des départs sous l'horloge de la nef (TableauDeparts.tsx) et le
 * compteur de visites du mur sud du hall (CompteurLayer.tsx).
 *
 * - Tableau : caisson et suspentes fusionnés, écran = un quad non éclairé sur
 *   un canevas 2048 × 640, redessiné seulement pendant que les palettes tournent.
 *   La page −1 (nouvelles versions) suit `etat.annonce`, posée par la cloche.
 * - Compteur : planche, carter et lunette en cubes, plaque gravée, six tambours
 *   (cylindre ouvert fait main, UV du CylinderGeometry de three) en thin instances
 *   dont on réécrit les matrices pendant la rotation.
 *
 * Ni lightmap ni intempéries : hémisphérique, soleil, ombres et lueurs de la nef.
 * Chaque nouvelle page fait cliqueter les palettes (`sonVolets`).
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Matrix } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { FACES, TAILLE, TIRET, chiffres, dureeDuCompteur, faceDuTambour } from '../domain/compteur.ts'
import { COLONNES, dureeVolets, ligneAnnonce, ligneEnPalettes, lignesDeDeparts, palettes, versionsRecentes, voletsA } from '../domain/departs.ts'
import type { Artwork } from '../domain/types.ts'
import { laVisite } from '../io/visite.ts'
import type { Box } from '../plan/mesh.ts'
import type { Accrochage } from '../plan/hang.ts'
import { cubes, matiere } from './boites.ts'
import { catalogue, etat, mouvementReduit, recherche } from './etat.ts'
import { brancherLueurs } from './lueurs.ts'
import { sonVolets } from './son.ts'
import { canevasEnMetres, enSrgb, maillageDeQuads } from './textes.ts'

// ── Le tableau ──

/** Sous l'horloge du pignon nord (`build-nef.py` : cadran à +14,80, z = 12,6). */
const CENTRE = [24, 11.2, 12.95] as const
const LARGEUR = 8.4
const LIGNES = 6
const PAGES = 2
const PAGE_MS = 12000
/** Après le dernier coup de cloche, les nouvelles versions restent affichées vingt secondes. */
const ANNONCE_MS = 20000
const [CW, CH] = [2048, 640]
const CELLULE = { w: 30, h: 70, pas: 80 }
const HAUT_LIGNES = 150
const LARGEUR_LIGNE = COLONNES.depuis + COLONNES.destination + COLONNES.langage + COLONNES.salle + 3
const MARGE = (CW - LARGEUR_LIGNE * CELLULE.w) / 2

/** La page affichée : −1 tant que la cloche annonce, sinon 0 et 1 en alternance. */
export function pageA(maintenant: number, annonceAt: number | null): -1 | 0 | 1 {
  if (annonceAt !== null && maintenant - annonceAt < ANNONCE_MS) return -1
  return (Math.floor(maintenant / PAGE_MS) % PAGES) as 0 | 1
}

/** Les `annonces` premières lignes sont des nouvelles versions : toutes en ambre. */
function dessiner(ctx: CanvasRenderingContext2D, lignes: string[], annonces: number): void {
  ctx.fillStyle = '#101214'
  ctx.fillRect(0, 0, CW, CH)
  ctx.fillStyle = '#f2b705'
  ctx.font = '600 58px Helvetica, Arial, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('MES DERNIERS PROJETS', MARGE, 48)
  ctx.font = '400 28px Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#9aa0a6'
  ctx.textAlign = 'right'
  ctx.fillText('LES DERNIERS DÉPÔTS POUSSÉS', CW - MARGE, 52)
  ctx.textAlign = 'left'
  ctx.fillStyle = '#f2b705'
  let x = MARGE
  for (const [titre, n] of [['PUSH', COLONNES.depuis], ['DESTINATION', COLONNES.destination], ['LANGAGE', COLONNES.langage], ['SALLE', COLONNES.salle]] as const) {
    ctx.fillText(titre, x + 4, 118)
    x += (n + 1) * CELLULE.w
  }
  ctx.font = '700 48px Helvetica, Arial, sans-serif'
  ctx.textAlign = 'center'
  lignes.forEach((ligne, j) => {
    const y = HAUT_LIGNES + j * CELLULE.pas
    ;[...ligne].forEach((c, i) => {
      const cx = MARGE + i * CELLULE.w
      ctx.fillStyle = '#1e2124'
      ctx.fillRect(cx + 1, y, CELLULE.w - 2, CELLULE.h)
      ctx.fillStyle = '#0a0b0c'
      ctx.fillRect(cx + 1, y + CELLULE.h / 2 - 1, CELLULE.w - 2, 2)
      if (c === ' ') return
      ctx.fillStyle = j < annonces || i < COLONNES.depuis ? '#f2b705' : '#f4f1e6'
      ctx.fillText(c, cx + CELLULE.w / 2, y + CELLULE.h / 2 + 2)
    })
  })
}

function monterTableau(scene: Scene, accrochage: Accrochage | null, base: string): Mesh {
  const hauteur = (LARGEUR * CH) / CW
  const [cx, cy, cz] = CENTRE
  // Le caisson d'acier vert sombre des tableaux de gare, et ses deux suspentes.
  const caisson = CreateBox('departs:caisson', { width: LARGEUR + 0.3, height: hauteur + 0.3, depth: 0.12 }, scene)
  caisson.position.set(cx, cy, cz - 0.07)
  const suspentes = [-3.5, 3.5].map((x) => {
    const s = CreateCylinder('departs:suspente', { diameter: 0.04, height: 6, tessellation: 6 }, scene)
    s.position.set(cx + x, cy + hauteur / 2 + 3, cz - 0.07)
    return s
  })
  const acier = Mesh.MergeMeshes([caisson, ...suspentes], true, true)!
  acier.name = 'departs:acier'
  const mat = matiere('departs:acier', scene, '#1c2620', 0.5)
  mat.metallic = 0.5
  brancherLueurs([mat])
  acier.material = mat
  acier.receiveShadows = true
  acier.isPickable = false

  const dt = enSrgb(new DynamicTexture('departs', { width: CW, height: CH }, scene, true))
  dt.anisotropicFilteringLevel = 8
  const ctx = dt.getContext() as CanvasRenderingContext2D
  // Non éclairé (le `meshBasicMaterial` de three) ; PBR, qui lit le canevas sRGB en linéaire (la Standard le relinéariserait).
  const ecran = new PBRMaterial('departs:ecran', scene)
  ecran.unlit = true
  ecran.albedoTexture = dt
  maillageDeQuads('departs:ecran', [{ centre: CENTRE, droite: [1, 0, 0], haut: [0, 1, 0], l: LARGEUR, h: hauteur, uv: [0, 0, 1, 1] }], scene, ecran)

  const salles = new Map(accrochage?.rooms.flatMap((r) => r.placements.map((p) => [p.key, r.name] as const)) ?? [])
  let oeuvres: Map<string, Artwork> | null = null
  void catalogue(base).then((c) => (oeuvres = c?.parCle ?? null))
  const vide = Array.from({ length: LIGNES }, () => palettes('', LARGEUR_LIGNE))
  const e = { avant: vide, apres: vide, debut: 0, page: -2, fini: false, annonces: 0 }
  scene.onBeforeRenderObservable.add(() => {
    if (oeuvres === null || salles.size === 0) return
    const maintenant = performance.now()
    const page = pageA(Date.now(), etat.annonce?.at ?? null)
    if (page !== e.page) {
      // Une nouvelle page : on part de ce qui est affiché, on vise les lignes suivantes.
      const nouvelles = page === -1 ? versionsRecentes(oeuvres.values(), new Date(), recherche()).slice(0, LIGNES).map((a) => ligneAnnonce(a, LARGEUR_LIGNE)) : []
      const lignes = lignesDeDeparts(oeuvres.values(), salles, new Date(), LIGNES * PAGES).slice(Math.max(0, page) * LIGNES, (Math.max(0, page) + 1) * LIGNES).map(ligneEnPalettes)
      Object.assign(e, { avant: e.apres, apres: [...nouvelles, ...lignes, ...vide].slice(0, LIGNES), annonces: nouvelles.length, debut: maintenant, page, fini: false })
      sonVolets(dureeVolets(LARGEUR_LIGNE))
    }
    if (e.fini) return
    const ms = maintenant - e.debut
    dessiner(ctx, e.apres.map((l, j) => voletsA(e.avant[j], l, ms)), e.annonces)
    dt.update(true)
    e.fini = ms > dureeVolets(LARGEUR_LIGNE)
  })
  return acier
}

// ── Le compteur ──

/** Au mur sud du hall (face à z 39,85), entre l'angle et les vantaux de l'entrée (x 22,4) ; retourné vers le nord. */
const COMPTEUR = [20, 1.5, 39.84] as const
const RAYON = 0.09
const LARGEUR_TAMBOUR = 0.068
const PAS = 0.082
const Z_TAMBOUR = 0.13
const LAITON = '#c9a04e'
const SEGMENTS = 40

/**
 * La matrice monde du tambour i montrant la face `face` (fractionnaire en
 * rotation), vecteur ligne : l'axe du cylindre couché sur x, la face ramenée
 * devant, le pas, puis le repère du compteur (demi-tour, centre).
 */
export function matriceDuTambour(i: number, face: number): Matrix {
  return Matrix.RotationZ(-Math.PI / 2)
    .multiply(Matrix.RotationX((-(face + 0.5) / FACES) * 2 * Math.PI))
    .multiply(Matrix.Translation((i - (TAILLE - 1) / 2) * PAS, 0, Z_TAMBOUR))
    .multiply(Matrix.RotationY(Math.PI))
    .multiply(Matrix.Translation(...COMPTEUR))
}

/** Une boîte du repère local du compteur (retourné de π : x et z changent de signe). */
const boite = (x: number, y: number, z: number, w: number, h: number, d: number): Box => ({ x: COMPTEUR[0] - x, y: COMPTEUR[1] + y, z: COMPTEUR[2] - z, w, h, d, kind: 'wall' })

/** Le CylinderGeometry ouvert de three (θ depuis +z, u = j/40, haut en v = 1), en winding main droite. */
function cylindreOuvert(scene: Scene): Mesh {
  const [positions, normals, uvs, indices]: number[][] = [[], [], [], []]
  for (let j = 0; j <= SEGMENTS; j++) {
    const t = (j / SEGMENTS) * 2 * Math.PI
    const [s, c] = [Math.sin(t), Math.cos(t)]
    for (const v of [1, 0]) {
      positions.push(RAYON * s, (v - 0.5) * LARGEUR_TAMBOUR, RAYON * c)
      normals.push(s, 0, c)
      uvs.push(j / SEGMENTS, v)
    }
  }
  for (let j = 0; j < SEGMENTS; j++) {
    const [a, b, c, d] = [2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2]
    indices.push(a, d, b, b, d, c)
  }
  const m = new Mesh('compteur:tambours', scene)
  Object.assign(new VertexData(), { positions, normals, uvs, indices }).applyToMesh(m)
  return m
}

function monterCompteur(scene: Scene): Mesh[] {
  const largeur = TAILLE * PAS
  const faces = canevasEnMetres('compteur:faces', scene, FACES, 1, 128, (ctx) => {
    ctx.fillStyle = '#e0bd6a'
    ctx.fillRect(0, 0, FACES, 1)
    ctx.fillStyle = '#1d150a'
    ctx.font = '700 0.62px Georgia, "Times New Roman", serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let k = 0; k < FACES; k++) {
      ctx.save()
      ctx.translate(k + 0.5, 0.5)
      // Le haut d'un chiffre regarde le haut du tambour, c'est-à-dire les u décroissants.
      ctx.rotate(-Math.PI / 2)
      ctx.scale(1, 1.25)
      ctx.fillText(k === TIRET ? '—' : String(k), 0, 0.02)
      ctx.restore()
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(k, 0, 0.02, 1)
      ctx.fillStyle = '#1d150a'
    }
  })
  const gravure = canevasEnMetres('compteur:plaque', scene, 0.62, 0.12, 800, (ctx) => {
    ctx.fillStyle = LAITON
    ctx.fillRect(0, 0, 0.62, 0.12)
    ctx.strokeStyle = '#6b4f1d'
    ctx.lineWidth = 0.004
    ctx.strokeRect(0.01, 0.01, 0.6, 0.1)
    ctx.fillStyle = '#3d2a0c'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 0.05px Georgia, "Times New Roman", serif'
    ctx.fillText('VISITEURS', 0.31, 0.047)
    ctx.font = 'italic 0.024px Georgia, "Times New Roman", serif'
    ctx.fillText('depuis l’ouverture du musée', 0.31, 0.087)
  })

  const mats = {
    noyer: matiere('compteur:noyer', scene, '#5a3820', 0.5),
    ombre: matiere('compteur:carter', scene, '#15110d', 0.8),
    laiton: matiere('compteur:laiton', scene, '#6e5022', 0.4),
    tambour: matiere('compteur:tambour', scene, '#ffffff', 0.35),
    plaque: matiere('compteur:plaque', scene, '#ffffff', 0.35),
  }
  mats.laiton.metallic = 0.6
  mats.tambour.metallic = mats.plaque.metallic = 0.45
  mats.tambour.albedoTexture = faces
  mats.plaque.albedoTexture = gravure
  brancherLueurs(Object.values(mats))

  // La planche de noyer, le carter sombre d'où sortent les tambours, la lunette (deux lèvres, deux joues).
  const noyer = cubes('compteur:noyer', [boite(0, 0.06, 0.015, largeur + 0.26, 0.42, 0.03)], scene, mats.noyer)
  const carter = cubes('compteur:carter', [boite(0, 0, 0.07, largeur + 0.02, 0.2, 0.08)], scene, mats.ombre)
  const laiton = cubes(
    'compteur:laiton',
    [
      ...[1, -1].map((s) => boite(0, s * 0.068, Z_TAMBOUR + RAYON - 0.015, largeur + 0.05, 0.072, 0.06)),
      ...[1, -1].map((s) => boite((s * (largeur + 0.05)) / 2, 0, Z_TAMBOUR / 2 + 0.03, 0.025, 0.162, 0.2)),
    ],
    scene,
    mats.laiton,
  )
  const plaque = maillageDeQuads('compteur:plaque', [{ centre: [COMPTEUR[0], COMPTEUR[1] + 0.195, COMPTEUR[2] - 0.035], droite: [-1, 0, 0], haut: [0, 1, 0], l: 0.62, h: 0.12, uv: [0, 0, 1, 1] }], scene, mats.plaque)

  const tambours = cylindreOuvert(scene)
  tambours.material = mats.tambour
  tambours.isPickable = false
  tambours.alwaysSelectAsActiveMesh = true
  const buffer = new Float32Array(16 * TAILLE)
  tambours.thinInstanceSetBuffer('matrix', buffer, 16, false)

  // Des tirets, puis le nombre d'avant, puis le vôtre.
  const e = { de: chiffres(null), a: chiffres(null), debut: 0 }
  const suivants: { a: number[]; quand: number }[] = []
  void laVisite().then((n) => {
    if (n === null) return
    const t = performance.now() / 1000
    suivants.push({ a: chiffres(n - 1), quand: t + 0.5 }, { a: chiffres(n), quand: t + 2.5 })
  })
  const calme = mouvementReduit()
  let fini = -1
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000
    if (suivants[0] && t >= suivants[0].quand) {
      // On repart de ce qui est affiché, même si la rotation précédente n'est pas finie.
      Object.assign(e, { de: e.a, a: suivants.shift()!.a, debut: t })
    }
    // La face d'arrivée est posée avant de s'arrêter (pas de tambour figé entre deux chiffres).
    if (fini === e.debut) return
    const ecoule = calme ? Infinity : t - e.debut
    for (let i = 0; i < TAILLE; i++) matriceDuTambour(i, faceDuTambour(e.de[i], e.a[i], ecoule)).copyToArray(buffer, 16 * i)
    tambours.thinInstanceBufferUpdated('matrix')
    if (ecoule >= dureeDuCompteur(e.de, e.a)) fini = e.debut
  })

  const porteurs = [noyer, carter, laiton, plaque]
  for (const m of [...porteurs, tambours]) {
    m.receiveShadows = true
    m.isPickable = false
  }
  return porteurs
}

/** Monte le tableau des départs et le compteur de visites. Rend les porteurs d'ombre. */
export async function monterDeparts(scene: Scene, accrochage: Accrochage | null, base: string): Promise<Mesh[]> {
  return [monterTableau(scene, accrochage, base), ...monterCompteur(scene)]
}
