/**
 * Les sculptures (SculptureLayer, sculptureAssets) : un socle de pierre claire,
 * la pièce, son cartel, et la flaque de ses projecteurs.
 *
 * `plan/sculptures.ts` décide où : dans une niche (aucune aujourd'hui) ou sur le
 * socle de la vitrine de son projet, une fois le catalogue chargé.
 *
 * - Socles et plaques : un cube unité en thin instances (UV 0..1 par face, comme
 *   la boxGeometry de three : chaque face montre 1/2,6 de la tuile de béton).
 * - Pièces : un GLB par fichier, posé tel quel (le nœud Mesh_0 porte sa propre
 *   transformation : on ne fait que placer `__root__` au sommet du socle).
 * - Projecteurs : three greffe deux lumières directionnelles sur le seul shader
 *   des pièces ; ici deux DirectionalLight réservées aux pièces
 *   (`includedOnlyMeshes`), sans ombre. Les autres matières ne les voient pas :
 *   leur limite de 4 lumières tient. `environmentIntensity` reste à 1 (le
 *   REFLETS 1,8 de three est écrasé par scene.environmentIntensity).
 * - Halos : deux plans additifs non éclairés en thin instances (monterHalos).
 *
 * Les socles sont nommés `sculptures:socles` (métadonnée `couche: 'sculptures'`)
 * pour les ombres de contact. ponytail : pas de `brancherLueurs`, la salle
 * d'honneur est hors des lieux des lueurs (hall, balcons, façade).
 */
import { Constants } from '@babylonjs/core/Engines/constants'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Material } from '@babylonjs/core/Materials/material'
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import { MUSEE } from '../plan/musee.ts'
import { sculpturePlacements, sculpturesDesVitrines, type SculpturePlacement } from '../plan/sculptures.ts'
import { choisirVitrines } from '../plan/vitrines.ts'
import { matiere } from './boites.ts'
import { catalogue } from './etat.ts'
import { chargerGlb } from './glb.ts'
import { lin } from './lueurs.ts'
import { matierePBR } from './matieres.ts'
import { police } from './polices.ts'
import { atlasDeTextes, maillageDeQuads, matiereDeTexte, type Quad } from './textes.ts'
import { couper } from './toiles.ts'

/** La plaque du cartel : ses cotes, et sa distance au haut du socle (m). */
const CARTEL = { largeur: 0.3, hauteur: 0.09, epaisseur: 0.006, haut: 0.12 }
const HALO = { diametre: 2.6, avance: 0.25, sol: 0.03, couleur: '#ffd9a0', opacite: { sol: 0.32, face: 0.12 } }
/** sculptureAssets.ts : directions VERS la lumière (monde), couleur × 3,2. */
const PROJECTEURS = [
  { nom: 'cle', vers: new Vector3(-0.45, 0.8, 0.9), couleur: '#fff0d8' },
  { nom: 'contre', vers: new Vector3(0.35, 0.75, -0.8), couleur: '#ffe6c0' },
]
const FORCE = 3.2
/** Pixels par mètre des cartels (une police de 0,026 m ≈ 53 px). */
const PX = 2048
const ENCRE = '#2a2620'

/** Le texte du cartel : titre, puis le dépôt (sinon auteur, année). */
export function texteDuCartel(p: SculpturePlacement): string {
  return `${p.cartel.title}\n${p.project?.split('/')[1] ?? `${p.cartel.author}, ${p.cartel.year}`}`
}

const largeurPlaque = (p: SculpturePlacement) => Math.min(CARTEL.largeur, p.plinth.width - 0.08)

/**
 * Les poses de chaque pièce, dans le repère du groupe three (x, y, z, lacet) :
 * matrices des socles, plaques, halos au sol et sur la face, quads des textes.
 */
export function posesDesSculptures(placements: readonly SculpturePlacement[]): {
  socles: Float32Array
  plaques: Float32Array
  sol: Float32Array
  face: Float32Array
  textes: Omit<Quad, 'uv'>[]
} {
  const n = placements.length
  const out = { socles: new Float32Array(16 * n), plaques: new Float32Array(16 * n), sol: new Float32Array(16 * n), face: new Float32Array(16 * n), textes: [] as Omit<Quad, 'uv'>[] }
  placements.forEach((p, i) => {
    const { width: w, height: h, depth: d } = p.plinth
    const groupe = Matrix.RotationY(p.rotation).multiply(Matrix.Translation(p.x, p.y, p.z))
    // Un cube unité mis à l'échelle (sx, sy, sz), centré en (lx, ly, lz) dans le groupe.
    const boite = (sx: number, sy: number, sz: number, lx: number, ly: number, lz: number) =>
      Matrix.Scaling(sx, sy, sz).multiply(Matrix.Translation(lx, ly, lz)).multiply(groupe)
    boite(w, h, d, 0, h / 2, 0).copyToArray(out.socles, 16 * i)
    const l = largeurPlaque(p)
    boite(l, CARTEL.hauteur, CARTEL.epaisseur, 0, h - CARTEL.haut, d / 2 + CARTEL.epaisseur / 2).copyToArray(out.plaques, 16 * i)
    Matrix.Scaling(HALO.diametre, HALO.diametre, 1)
      .multiply(Matrix.RotationX(-Math.PI / 2))
      .multiply(Matrix.Translation(0, HALO.sol, HALO.avance))
      .multiply(groupe)
      .copyToArray(out.sol, 16 * i)
    boite(w, h, 1, 0, h / 2, d / 2 + 0.002).copyToArray(out.face, 16 * i)
    const [s, c] = [Math.sin(p.rotation), Math.cos(p.rotation)]
    const avant = d / 2 + CARTEL.epaisseur + 0.001
    out.textes.push({ centre: [p.x + avant * s, p.y + h - CARTEL.haut, p.z + avant * c], droite: [c, 0, -s], haut: [0, 1, 0], l, h: CARTEL.hauteur })
  })
  return out
}

/** Un cube unité en thin instances (UV de CreateBox). */
function lot(nom: string, matrices: Float32Array, scene: Scene, mat: Material): Mesh {
  const m = CreateBox(nom, { size: 1 }, scene)
  m.thinInstanceSetBuffer('matrix', matrices, 16, true)
  m.material = mat
  m.receiveShadows = true
  m.isPickable = false
  return m
}

/** Un dégradé 128² peint en valeurs BRUTES (NoColorSpace de three : pas de conversion sRGB). */
function degrade(nom: string, scene: Scene, dessiner: (g: CanvasRenderingContext2D) => CanvasGradient): DynamicTexture {
  const dt = new DynamicTexture(nom, { width: 128, height: 128 }, scene, true)
  const g = dt.getContext() as CanvasRenderingContext2D
  g.fillStyle = dessiner(g)
  g.fillRect(0, 0, 128, 128)
  dt.gammaSpace = false
  dt.update()
  return dt
}

/** MeshBasic additif de three : tex × couleur × opacité ajoutés au fond, sans écriture de profondeur. */
function plansAdditifs(nom: string, matrices: Float32Array, dt: DynamicTexture, opacite: number, scene: Scene): void {
  const plan = CreatePlane(nom, { size: 1 }, scene)
  plan.thinInstanceSetBuffer('matrix', matrices, 16, true)
  const mat = new PBRMaterial(nom, scene)
  mat.unlit = true
  mat.albedoTexture = dt
  mat.albedoColor = lin(HALO.couleur)
  mat.alpha = opacite
  mat.alphaMode = Constants.ALPHA_ADD
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  mat.disableDepthWrite = true
  mat.backFaceCulling = false
  plan.material = mat
  plan.isPickable = false
}

/** Les pièces chargées (une absente n'emporte pas les autres), posées au sommet de leur socle. */
async function poserPieces(scene: Scene, placements: readonly SculpturePlacement[]): Promise<AbstractMesh[]> {
  const pieces = await Promise.all(
    placements.map(async (p) => {
      try {
        const c = await chargerGlb(scene, `assets/sculptures/${p.file}`)
        c.addAllToScene()
        const racine = c.rootNodes[0] as TransformNode
        racine.position.set(p.x, p.y + p.plinth.height, p.z)
        racine.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), p.rotation)
        return c.meshes.filter((m) => m.getTotalVertices() > 0)
      } catch (e) {
        console.warn(`sculpture « ${p.file} » introuvable`, e)
        return []
      }
    }),
  )
  return pieces.flat()
}

export async function monterSculptures(scene: Scene, base: string): Promise<Mesh[]> {
  const c = await catalogue(base)
  const placements = [...sculpturePlacements(MUSEE), ...sculpturesDesVitrines(c ? choisirVitrines(c.artworks, c.owners).map((a) => a.key) : [])]
  if (placements.length === 0) return []
  const poses = posesDesSculptures(placements)

  // Un socle de pierre claire, comme au Louvre : il porte la pièce sans lui disputer le regard.
  const pierre = matierePBR('sculptures:pierre', 'beton', scene, { teinte: '#e2dccf' })
  const socles = lot('sculptures:socles', poses.socles, scene, pierre)
  socles.metadata = { couche: 'sculptures' }
  const plaques = lot('sculptures:plaques', poses.plaques, scene, matiere('sculptures:plaque', scene, '#efe6d2', 0.85))

  const rond = degrade('sculptures:rond', scene, (g) => {
    const d = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    d.addColorStop(0, '#fff')
    d.addColorStop(0.45, '#8a8a8a')
    d.addColorStop(1, '#000')
    return d
  })
  // Blanc en haut du canevas = en haut du plan (DynamicTexture en invertY).
  const haut = degrade('sculptures:haut', scene, (g) => {
    const d = g.createLinearGradient(0, 0, 0, 128)
    d.addColorStop(0, '#fff')
    d.addColorStop(1, '#000')
    return d
  })
  plansAdditifs('sculptures:halo-sol', poses.sol, rond, HALO.opacite.sol, scene)
  plansAdditifs('sculptures:halo-face', poses.face, haut, HALO.opacite.face, scene)

  // Les cartels : un atlas, un maillage, non éclairés (troika).
  const [pieces] = await Promise.all([poserPieces(scene, placements), police('PT Sans')])
  const tailles = poses.textes.map((q) => ({ l: Math.round(q.l * PX), h: Math.round(q.h * PX) }))
  const { dt, uvs } = atlasDeTextes('sculptures:cartels', scene, tailles, (g, i, x, y) => {
    const fs = 0.026 * PX
    g.font = `${fs}px 'PT Sans'`
    g.fillStyle = ENCRE
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const lignes = texteDuCartel(placements[i]).split('\n').flatMap((l) => couper(g, l, (poses.textes[i].l - 0.02) * PX))
    lignes.forEach((l, k) => g.fillText(l, x + tailles[i].l / 2, y + tailles[i].h / 2 + (k - (lignes.length - 1) / 2) * 1.3 * fs))
  })
  maillageDeQuads('sculptures:cartels', poses.textes.map((q, i) => ({ ...q, uv: uvs[i] })), scene, matiereDeTexte('sculptures:cartels', scene, dt))

  if (pieces.length > 0) {
    for (const m of pieces) {
      m.receiveShadows = true
      m.isPickable = false
      if (m.material instanceof PBRMaterial) m.material.maxSimultaneousLights = 6
    }
    for (const { nom, vers, couleur } of PROJECTEURS) {
      const l = new DirectionalLight(`sculptures:${nom}`, vers.normalizeToNew().negate(), scene)
      l.diffuse = l.specular = lin(couleur)
      l.intensity = FORCE
      l.shadowEnabled = false
      l.includedOnlyMeshes = pieces
    }
  }
  return [socles, plaques, ...(pieces.filter((m) => m instanceof Mesh) as Mesh[])]
}
