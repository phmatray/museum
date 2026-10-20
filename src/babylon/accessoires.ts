/**
 * Ce que les modèles des accessoires (mobilier.ts) ne portent pas (AccessoiresLayer.tsx) :
 *
 * - le velours du cordon, en chaînette d'un potelet à l'autre ;
 * - les blocs verts « Sortie », éclairés de l'intérieur, jour et nuit ;
 * - le texte du panneau des horaires, peint sur son émail : les vrais lever et
 *   coucher du soleil du jour de la visite (`domain/horaires.ts`).
 *
 * ponytail : l'eau de la fontaine (bassins et voile, matières de l'étang) vient
 * avec le jardin, qui porte ces matières ; la pierre est posée par mobilier.ts.
 */
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'

import config from '../../museum.config.json'
import { lignesDesHoraires } from '../domain/horaires.ts'
import { heureDemandee } from '../domain/soleil.ts'
import { garniture, MOBILIER } from '../plan/mobilier.ts'
import { MUSEE } from '../plan/musee.ts'
import { BLOC_SORTIE, sorties } from '../plan/signaletique.ts'
import { matiere } from './boites.ts'
import { recherche } from './etat.ts'
import { matrices } from './lots.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { canevasEnMetres, maillageDeQuads } from './textes.ts'

/** Le crochet du potelet (`build-accessoires.py` : 0,95 m, boule comprise), et le creux de la chaînette. */
const CROCHET = 0.86
const CREUX = 0.13
/** L'émail du panneau Meshy, entre ses deux poteaux (mesuré sur `accessoires.glb`). */
const EMAIL = { largeur: 1.22, hauteur: 0.66, centre: 0.96, devant: 0.05 }

/**
 * Un tronçon de cordon de a à b, crochets à `y` + CROCHET : une parabole (assez
 * près de la chaînette pour 2 m qui pendent de 13 cm), en 25 points — les 24
 * segments du TubeGeometry de three.
 */
export function pointsDuCordon(a: { x: number; z: number }, b: { x: number; z: number }, y: number): Vector3[] {
  return Array.from({ length: 25 }, (_, k) => {
    const t = k / 24
    return new Vector3(a.x + (b.x - a.x) * t, y + CROCHET - CREUX * 4 * t * (1 - t), a.z + (b.z - a.z) * t)
  })
}

/** Le pictogramme ISO 7010 (E001) et sa flèche : pas de texte, il se lit dans toutes les langues. */
function peindreSortie(ctx: CanvasRenderingContext2D, l: number, h: number): void {
  ctx.fillStyle = '#f2f4f1'
  ctx.fillRect(0, 0, l, h)
  const m = 0.012
  const [x0, y0, w, hh] = [m, m, l - 2 * m, h - 2 * m]
  ctx.fillStyle = '#0a8f3c'
  ctx.fillRect(x0, y0, w, hh)
  ctx.fillStyle = '#ffffff'
  // La porte : un cadre blanc, l'embrasure verte, le seuil.
  const [px, py, pw, ph] = [x0 + 0.018, y0 + 0.014, 0.055, hh - 0.028]
  ctx.fillRect(px, py, pw, ph)
  ctx.fillStyle = '#0a8f3c'
  ctx.fillRect(px + 0.008, py + 0.008, pw - 0.02, ph - 0.008)
  ctx.fillStyle = '#ffffff'
  // L'homme qui court, en pleins : tête, tronc penché, bras et jambes en mouvement.
  const u = hh / 0.126
  const S = (x: number, y: number): [number, number] => [px + 0.03 + x * u, py + y * u]
  ctx.beginPath()
  ctx.arc(...S(0.052, 0.018), 0.0095 * u, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#ffffff'
  const trait = (w: number, ...pts: [number, number][]) => {
    ctx.lineWidth = w * u
    ctx.beginPath()
    ctx.moveTo(...S(...pts[0]))
    for (const q of pts.slice(1)) ctx.lineTo(...S(...q))
    ctx.stroke()
  }
  trait(0.016, [0.046, 0.034], [0.034, 0.066]) // tronc
  trait(0.01, [0.046, 0.038], [0.064, 0.05], [0.074, 0.04]) // bras avant
  trait(0.01, [0.044, 0.038], [0.028, 0.046], [0.018, 0.06]) // bras arrière
  trait(0.012, [0.034, 0.066], [0.056, 0.078], [0.058, 0.1]) // jambe avant
  trait(0.012, [0.034, 0.066], [0.02, 0.086], [0.002, 0.092]) // jambe arrière
  // La flèche, vers le bas : la sortie est sous le panneau.
  const cx = x0 + w * 0.72
  const [haut, bas, demi] = [y0 + 0.022, y0 + hh - 0.018, 0.022]
  ctx.fillRect(cx - 0.007, haut, 0.014, bas - haut - 0.018)
  ctx.beginPath()
  ctx.moveTo(cx - demi, bas - 0.026)
  ctx.lineTo(cx + demi, bas - 0.026)
  ctx.lineTo(cx, bas)
  ctx.closePath()
  ctx.fill()
}

function peindreHoraires(ctx: CanvasRenderingContext2D, lignes: string[]): void {
  const { largeur: l, hauteur: h } = EMAIL
  const serif = 'Georgia, "Times New Roman", serif'
  ctx.fillStyle = '#123d2c'
  ctx.fillRect(0, 0, l, h)
  ctx.strokeStyle = '#d9c9a0'
  ctx.lineWidth = 0.006
  ctx.strokeRect(0.03, 0.03, l - 0.06, h - 0.06)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#d9c9a0'
  ctx.font = `600 0.05px ${serif}`
  ctx.fillText(config.name.toUpperCase().split('').join(' '), l / 2, 0.11)
  ctx.fillRect(l / 2 - 0.12, 0.14, 0.24, 0.003)
  ctx.fillStyle = '#f4efe2'
  ctx.font = `400 0.058px ${serif}`
  ctx.fillText(lignes[0], l / 2, 0.235)
  ctx.font = `italic 400 0.046px ${serif}`
  ctx.fillText(lignes[1], l / 2, 0.3)
  ctx.font = `600 0.05px ${serif}`
  ctx.fillText(lignes[2], l / 2, 0.435)
  ctx.fillStyle = '#d9c9a0'
  ctx.font = `400 0.04px ${serif}`
  ctx.fillText(lignes[3], l / 2, 0.555)
}

/** Monte cordon, sorties et horaires. Rend les porteurs d'ombre (velours, émail). */
export function monterAccessoires(scene: Scene): Mesh[] {
  const porteurs: Mesh[] = []

  // ── Le cordon : 6 tubes fusionnés, 1 appel.
  const tubes = MOBILIER.filter((m) => m.piece === 'Cordon').flatMap((m) => {
    const p = garniture(m)
    return p.slice(1).map((b, i) => CreateTube('cordon', { path: pointsDuCordon(p[i], b, m.y), radius: 0.017, tessellation: 8, cap: Mesh.NO_CAP }, scene))
  })
  const cordon = tubes.length ? Mesh.MergeMeshes(tubes, true, true) : null
  if (cordon) {
    cordon.name = 'accessoires:cordon'
    cordon.material = matiere('velours', scene, '#5e0b16', 0.9)
    porteurs.push(cordon)
  }

  // ── Les sorties : boîtier et face peinte en thin instances, 2 appels.
  const { largeur: l, hauteur: h, epaisseur: e } = BLOC_SORTIE
  const poses = matrices(sorties(MUSEE).map((s) => ({ piece: 'sortie', ...s }))).get('sortie')
  if (poses) {
    const boitier = CreateBox('sortie:boitier', { width: l, height: h, depth: e }, scene)
    const corps = new PBRMaterial('sortie:boitier', scene)
    corps.unlit = true
    corps.albedoColor = lin('#dfe3df')
    boitier.material = corps
    // La face +z, un demi-millimètre devant celle du boîtier.
    const face = maillageDeQuads('sortie:face', [{ centre: [0, 0, e / 2 + 0.0005], droite: [1, 0, 0], haut: [0, 1, 0], l, h, uv: [0, 0, 1, 1] }], scene, new PBRMaterial('sortie:face', scene))
    const peinte = face.material as PBRMaterial
    peinte.unlit = true
    peinte.albedoTexture = canevasEnMetres('sortie:face', scene, l, h, 1200, (g) => peindreSortie(g, l, h))
    for (const m of [boitier, face]) {
      m.thinInstanceSetBuffer('matrix', poses, 16)
      m.isPickable = false
    }
  }

  // ── Les horaires : l'émail, devant le panneau GLB, 1 appel.
  const quand = heureDemandee(recherche(), new Date()) ?? new Date()
  const lignes = lignesDesHoraires(quand, config.location.latitude, config.location.longitude)
  const email = matiere('horaires', scene, '#ffffff', 0.35)
  email.metallic = 0.05
  email.albedoTexture = canevasEnMetres('horaires', scene, EMAIL.largeur, EMAIL.hauteur, 900, (g) => peindreHoraires(g, lignes))
  const quads = MOBILIER.filter((m) => m.piece === 'PanneauHoraires').map((m) => {
    const [c, s] = [Math.cos(m.lacet), Math.sin(m.lacet)]
    // Le repère du meuble : x local vers (cos, 0, −sin), z local vers (sin, 0, cos).
    return {
      centre: [m.x + EMAIL.devant * s, m.y + EMAIL.centre, m.z + EMAIL.devant * c] as const,
      droite: [c, 0, -s] as const,
      haut: [0, 1, 0] as const,
      l: EMAIL.largeur,
      h: EMAIL.hauteur,
      uv: [0, 0, 1, 1] as [number, number, number, number],
    }
  })
  if (quads.length) porteurs.push(maillageDeQuads('accessoires:horaires', quads, scene, email))

  for (const m of porteurs) m.receiveShadows = true
  brancherLueurs(porteurs.map((m) => m.material!))
  return porteurs
}
