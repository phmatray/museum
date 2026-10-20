/**
 * Les cartels des toiles (CartelLayer.tsx, Cartel.tsx) : trois appels de dessin
 * pour tous les cartels, toujours montés (three ne montait que les textes à
 * moins de 6 m pour épargner les appels troika ; ici, un atlas suffit).
 * - les plaques : un cube unité en thin instances, cartel (i) puis plaque du
 *   QR code (n + i), teinte par couleur d'instance (sombre sur une cimaise) ;
 * - les QR codes : l'atlas de domain/qr.ts, non éclairé (un code éclairé le
 *   soir perdrait son contraste) ;
 * - les textes : un atlas peint en PT Sans, une case de 26 × 16 cm par cartel.
 *
 * Repère d'un cartel (lacet r, normale du mur (sin r, cos r)) : droite R = (nz, 0, −nx),
 * haut U, normale N ; le point du placement est à 5 mm du mur.
 */
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Constants } from '@babylonjs/core/Engines/constants'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { adresseQr, atlasQr } from '../domain/qr.ts'
import { CARTEL_HAUTEUR, CARTEL_LARGEUR, CARTEL_QR, CARTEL_TEXTE, cartelPlacements, cartelTexte, type CartelPlacement } from '../plan/cartels.ts'
import type { Accrochage } from '../plan/hang.ts'
import { matiere } from './boites.ts'
import { catalogue } from './etat.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { police } from './polices.ts'
import { atlasDeTextes, maillageDeQuads, matiereDeTexte, type Quad } from './textes.ts'
import { couper } from './toiles.ts'

/** Épaisseur des plaques (cartelStyle.ts PLAQUE.epaisseur). */
const EPAISSEUR = 0.01
/** Plaque claire, ou sombre sur le stratifié d'une cimaise, et leurs encres (cartelStyle.ts). */
const PLAQUE = { claire: '#f4f1ea', sombre: '#34302b' }
const ENCRE = { claire: '#2a2620', sombre: '#efe4cc' }
/** Pixels par mètre de l'atlas des textes (corps de 2,2 cm ≈ 23 px). */
const PPM = 1024
const CORPS = 0.022
const INTERLIGNE = 1.3

type V3 = [number, number, number]
const SANS_UV: Quad['uv'] = [0, 0, 1, 1]

/**
 * Les matrices des plaques (2n, ligne majeure : R × largeur, U × hauteur,
 * N × épaisseur, centre) et les quads des QR codes et des textes, dans l'ordre
 * des placements (UV à remplir par l'appelant).
 */
export function poserCartels(placements: CartelPlacement[]): { plaques: Float32Array; quadsQr: Quad[]; quadsTexte: Quad[] } {
  const n = placements.length
  const plaques = new Float32Array(32 * n)
  const quadsQr: Quad[] = []
  const quadsTexte: Quad[] = []
  placements.forEach((p, i) => {
    const [nx, nz] = [Math.sin(p.rotation), Math.cos(p.rotation)]
    const droite: V3 = [nz, 0, -nx]
    // Le point du repère du cartel (droite, haut, avant) en monde.
    const en = (d: number, h: number, a: number): V3 => [p.x + d * nz + a * nx, p.y + h, p.z - d * nx + a * nz]
    const plaque = (k: number, l: number, h: number, c: V3) =>
      plaques.set([nz * l, 0, -nx * l, 0, 0, h, 0, 0, nx * EPAISSEUR, 0, nz * EPAISSEUR, 0, ...c, 1], 16 * k)
    plaque(i, CARTEL_LARGEUR, CARTEL_HAUTEUR, en(0, 0, EPAISSEUR / 2))
    plaque(n + i, CARTEL_QR.plaque, CARTEL_QR.plaque, en(CARTEL_QR.x, CARTEL_QR.y, EPAISSEUR / 2))
    // Le code un demi-millimètre devant sa plaque, le texte un millimètre devant la sienne.
    quadsQr.push({ centre: en(CARTEL_QR.x, CARTEL_QR.y, EPAISSEUR + 0.0005), droite, haut: [0, 1, 0], l: CARTEL_QR.cote, h: CARTEL_QR.cote, uv: SANS_UV })
    quadsTexte.push({
      centre: en(CARTEL_TEXTE.x + CARTEL_TEXTE.largeur / 2, 0, EPAISSEUR + 0.001),
      droite,
      haut: [0, 1, 0],
      l: CARTEL_TEXTE.largeur,
      h: CARTEL_HAUTEUR,
      uv: SANS_UV,
    })
  })
  return { plaques, quadsQr, quadsTexte }
}

/** Monte les cartels de l'accrochage ; rien sans catalogue (comme three). Rend les plaques, porteuses d'ombre (OmbresLayer). */
export async function monterCartels(scene: Scene, accrochage: Accrochage, base: string): Promise<Mesh[]> {
  const [c] = await Promise.all([catalogue(base), police('PT Sans')])
  if (c === null) return []
  const placements = cartelPlacements(accrochage)
  const { plaques, quadsQr, quadsTexte } = poserCartels(placements)

  const boite = CreateBox('cartels:plaques', { size: 1 }, scene)
  boite.thinInstanceSetBuffer('matrix', plaques, 16)
  const [claire, sombre] = [lin(PLAQUE.claire), lin(PLAQUE.sombre)]
  const couleurs = new Float32Array(8 * placements.length)
  placements.forEach((p, i) => {
    const t = p.surPanneau ? sombre : claire
    couleurs.set([t.r, t.g, t.b, 1], 4 * i)
    couleurs.set([t.r, t.g, t.b, 1], 4 * (placements.length + i))
  })
  boite.thinInstanceSetBuffer('color', couleurs, 4)
  const mat = matiere('cartels:plaque', scene, '#ffffff', 0.9)
  brancherLueurs([mat])
  boite.material = mat
  boite.isPickable = false
  boite.receiveShadows = true

  // QR codes et textes : seulement les toiles du catalogue.
  const avecCode = placements.flatMap((p, i) => (c.parCle.has(p.key) ? [i] : []))
  if (avecCode.length === 0) return [boite]
  const cles = [...c.parCle.keys()]
  const qr = atlasQr(avecCode.map((i) => adresseQr(c.parCle.get(placements[i].key)!, cles)))
  // Rangée 0 en bas, sans invertY ; net de près (un module = un texel), gris uni de loin.
  const tex = RawTexture.CreateRGBATexture(qr.pixels, qr.cote, qr.cote, scene, true, false, Constants.TEXTURE_NEAREST_LINEAR_MIPLINEAR)
  tex.anisotropicFilteringLevel = 4
  const matQr = new PBRMaterial('cartels:qr', scene)
  matQr.unlit = true
  matQr.albedoTexture = tex
  maillageDeQuads('cartels:qr', avecCode.map((i, k) => {
    const [u, v] = qr.uv[k]
    const t = qr.tailles[k] / qr.cote
    return { ...quadsQr[i], uv: [u, v, u + t, v + t] }
  }), scene, matQr)

  const [L, H] = [Math.ceil(CARTEL_TEXTE.largeur * PPM), Math.ceil(CARTEL_HAUTEUR * PPM)]
  const { dt, uvs } = atlasDeTextes('cartels:textes', scene, avecCode.map(() => ({ l: L, h: H })), (g, k, x, y) => {
    const p = placements[avecCode[k]]
    g.font = `${CORPS * PPM}px 'PT Sans'`
    g.fillStyle = p.surPanneau ? ENCRE.sombre : ENCRE.claire
    g.textBaseline = 'middle'
    // Retour à la ligne aux espaces comme troika (maxWidth), le bloc centré sur l'axe du cartel.
    const lignes = cartelTexte(c.parCle.get(p.key)!).split('\n').flatMap((l) => couper(g, l, L))
    const pas = CORPS * INTERLIGNE * PPM
    lignes.forEach((l, j) => g.fillText(l, x, y + H / 2 + (j - (lignes.length - 1) / 2) * pas))
  })
  maillageDeQuads('cartels:textes', avecCode.map((i, k) => ({ ...quadsTexte[i], uv: uvs[k] })), scene, matiereDeTexte('cartels:textes', scene, dt))
  return [boite]
}
