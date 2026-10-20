/**
 * Les vitrines de la salle d'honneur (VitrinesLayer.tsx, `plan/vitrines.ts`) :
 * pour chacun des trois meilleurs projets, le panneau bordeaux, le cadre doré
 * et la borne laquée de `vitrines.glb` en thin instances ; le titre, un filet,
 * le début du README en deux colonnes et le cartel en UN lot de textes ;
 * l'image OpenGraph dans le cadre ; sur la borne, un écran qui s'éclaire et
 * une invite qui palpite.
 *
 * Les pièces sont posées même sans catalogue. Les sommets du GLB sont dans le
 * repère de la pièce (x le long du mur, z vers la salle) : une translation suffit.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color'
import type { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { couleurDeLangage, partsDeLangages } from '../domain/langages.ts'
import { adresseQr, matriceQr, QR_MARGE } from '../domain/qr.ts'
import type { Artwork } from '../domain/types.ts'
import type { Box } from '../plan/mesh.ts'
import { borneRegardee, chapeau, cheminReadme, choisirVitrines, enColonnes, PANNEAU, readmeEnBlocs, TOILE, VITRINES, type Vitrine } from '../plan/vitrines.ts'
import { cubes, matiere } from './boites.ts'
import { catalogue, vivant, VIVANTES } from './etat.ts'
import { glbOuRien } from './glb.ts'
import { instancier, matrices, type Pose } from './lots.ts'
import { brancherLueurs } from './lueurs.ts'
import { police, type Police } from './polices.ts'
import { atlasDeTextes, canevasEnMetres, maillageDeQuads, matiereDeTexte } from './textes.ts'
import { couper } from './toiles.ts'

type V3 = [number, number, number]

const CREME = '#efe3c8'
const ENCRE = '#2a2620'
/** Le dessus incliné de la borne et l'écran qu'on y pose. */
const ECRAN = { y: 1.086, z: 0.005, inclinaison: (25.81 * Math.PI) / 180, largeur: 0.44, hauteur: 0.28 }
/** Le canevas de l'écran et le bandeau de l'invite, en pixels ; un module du QR. */
const W = 640
const H = Math.round((W * ECRAN.hauteur) / ECRAN.largeur)
const BANDEAU = 72
const QR_MODULE = 3
const COLONNES = { u: -1.8, largeur: 0.88, gouttiere: 0.1, haut: 2.66, corps: 0.056, interligne: 1.4, parLigne: 32, lignes: 24 }
/** Densité des textes peints : le panneau se lit de loin, le cartel de près. */
const PX_PANNEAU = 512
const PX_CARTEL = 2048

/** Un point du panneau : `u` depuis son axe, `h` depuis le sol, `dz` devant sa face. */
const surPanneau = (v: Vitrine, u: number, h: number, dz = 0): V3 => [v.x + u, v.y + h, v.z + PANNEAU.recul + PANNEAU.epaisseur + 0.002 + dz]

/** Les pièces du GLB par vitrine, et la base et la normale de chaque écran (pur). */
export function posesDesVitrines(): { pieces: Pose[]; ecrans: { base: V3; normale: V3 }[] } {
  const [c, s] = [Math.cos(ECRAN.inclinaison), Math.sin(ECRAN.inclinaison)]
  return {
    pieces: VITRINES.flatMap((v) => {
      const dos = v.z + PANNEAU.recul
      return [
        { piece: 'Panneau', x: v.x, y: v.y, z: dos, lacet: 0 },
        { piece: 'Cadre', x: v.x + TOILE.u, y: v.y + TOILE.v, z: dos + PANNEAU.epaisseur, lacet: 0 },
        { piece: 'Borne', x: v.borne.x, y: v.y, z: v.borne.z, lacet: 0 },
      ]
    }),
    // L'écran couché sur le dessus incliné, 4 mm au-dessus ; son haut monte vers le mur.
    ecrans: VITRINES.map((v) => ({ base: [v.borne.x, v.y + ECRAN.y + c * 0.004, v.borne.z + ECRAN.z + s * 0.004], normale: [0, c, s] })),
  }
}

/** Un texte du panneau ou du cartel : coin haut-gauche, police, corps et largeur en mètres. */
interface Texte {
  texte: string
  coin: V3
  police: Police
  corps: number
  interligne: number
  largeur: number
  hauteur: number
  couleur: string
  px: number
  espacement?: number
  sansCoupure?: boolean
}

function textesDe(a: Artwork, v: Vitrine, md: string | null): Texte[] {
  const [col1, col2] = enColonnes(md ? chapeau(readmeEnBlocs(md), 1800) : (a.description ?? ''), COLONNES.parLigne, COLONNES.lignes)
  const langues = partsDeLangages(a.languages).slice(0, 3).map((p) => p.langage).join(' · ')
  const panneau = { police: 'PT Sans' as const, interligne: 1.2, couleur: CREME, px: PX_PANNEAU }
  const cartel = { interligne: 1.2, couleur: ENCRE, px: PX_CARTEL, largeur: 0.44 }
  return [
    { ...panneau, texte: `${a.owner.toUpperCase()}  ·  N° ${v.rang + 1}`, coin: surPanneau(v, -1.8, 3.33), corps: 0.07, largeur: 3.7, hauteur: 0.1, espacement: 0.2, sansCoupure: true },
    { ...panneau, texte: a.name, police: 'PT Serif', coin: surPanneau(v, -1.82, 3.2), corps: 0.3, largeur: 3.7, hauteur: 0.42, sansCoupure: true },
    ...[col1, col2].map((texte, i) => ({
      ...panneau, texte, coin: surPanneau(v, COLONNES.u + i * (COLONNES.largeur + COLONNES.gouttiere), COLONNES.haut),
      corps: COLONNES.corps, interligne: COLONNES.interligne, largeur: COLONNES.largeur, hauteur: 2,
    })),
    { ...cartel, texte: a.name, police: 'PT Serif', coin: surPanneau(v, 0.3, 1.36, 0.007), corps: 0.04, hauteur: 0.06 },
    {
      ...cartel, texte: `${langues || a.language || ''}\n★ ${a.stars.toLocaleString('fr-FR')}  ·  depuis ${new Date(a.createdAt).getFullYear()}`,
      police: 'PT Sans', coin: surPanneau(v, 0.3, 1.3, 0.007), corps: 0.026, interligne: 1.35, hauteur: 0.08,
    },
  ]
}

function peindreEcran(g: CanvasRenderingContext2D, a: Artwork, rang: number): void {
  const d = g.createLinearGradient(0, 0, W, H)
  d.addColorStop(0, '#4a1519')
  d.addColorStop(1, '#1e0a0c')
  g.fillStyle = d
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#e0b060'
  g.font = '600 19px system-ui, sans-serif'
  g.fillText(`N° ${rang + 1}  ·  ${a.owner.toUpperCase()}`, 32, 46)
  // Le QR code du projet, en haut à droite : sur l'écran lumineux, il se scanne de jour comme de nuit.
  const qr = matriceQr(adresseQr(a))
  const cote = (qr.length + 2 * QR_MARGE) * QR_MODULE
  const [qx, qy] = [W - 32 - cote, 14]
  g.fillStyle = '#f4f1ea'
  g.fillRect(qx, qy, cote, cote)
  g.fillStyle = '#161412'
  qr.forEach((ligne, l) => ligne.forEach((sombre, c) => sombre && g.fillRect(qx + (QR_MARGE + c) * QR_MODULE, qy + (QR_MARGE + l) * QR_MODULE, QR_MODULE, QR_MODULE)))
  g.fillStyle = CREME
  g.font = '66px Georgia, serif'
  g.fillText(a.name, 30, 118, qx - 46)
  g.fillRect(32, 138, qx - 48, 2)
  g.fillStyle = '#e6d6b6'
  g.font = '23px system-ui, sans-serif'
  couper(g, a.description ?? '', W - 64, 3).forEach((l, i) => g.fillText(l, 32, 178 + i * 31))
  let x = 32
  for (const { langage, part } of partsDeLangages(a.languages)) {
    g.fillStyle = couleurDeLangage(langage)
    g.fillRect(x, 282, (W - 64) * part, 8)
    x += (W - 64) * part
  }
  g.fillStyle = '#c9b89a'
  g.font = '22px system-ui, sans-serif'
  g.fillText(`★ ${a.stars.toLocaleString('fr-FR')}   ⑂ ${a.forks.toLocaleString('fr-FR')}   ·   README`, 32, 322)
}

/** L'image OpenGraph, ou null (absente : le serveur de dev répond index.html, le décodage échoue). */
function chargerImage(url: string, scene: Scene): Promise<Texture | null> {
  return new Promise((ok) => {
    const t: Texture = new Texture(url, scene, { invertY: true, onLoad: () => ok(t), onError: () => (t.dispose(), ok(null)) })
  })
}

/**
 * La StandardMaterial travaille en gamma (sortie remise en linéaire avant
 * l'image processing) : l'éclat linéaire de three (1,25 × couleur) y devient 1,25^(1/2,2).
 */
const enGamma = (s: number) => s ** (1 / 2.2)

export async function monterVitrines(scene: Scene, base: string, visiteur: () => { x: number; y: number; z: number; yaw: number }): Promise<Mesh[]> {
  const { pieces, ecrans } = posesDesVitrines()
  const [glb, cat] = await Promise.all([
    glbOuRien(scene, 'assets/architecture/vitrines.glb'),
    catalogue(base),
  ])
  const porteurs = glb ? instancier(glb, matrices(pieces)) : []
  const oeuvres = cat ? choisirVitrines(cat.artworks, cat.owners).slice(0, VITRINES.length) : []
  if (oeuvres.length === 0) return porteurs
  const vs = oeuvres.map((_, i) => VITRINES[i])

  // Le filet du titre et la plaque du cartel.
  const boite = (c: V3, w: number, h: number, d: number): Box => ({ x: c[0], y: c[1], z: c[2], w, h, d, kind: 'wall' })
  const filet = matiere('vitrines-filet', scene, CREME, 0.7)
  const plaque = matiere('vitrines-plaque', scene, '#efe6d2', 0.85)
  const eclairees: Material[] = [filet, plaque]
  porteurs.push(
    cubes('vitrines-filets', vs.map((v) => boite(surPanneau(v, 0.05, 2.86), 3.7, 0.006, 0.002)), scene, filet),
    cubes('vitrines-plaques', vs.map((v) => boite(surPanneau(v, 0.52, 1.28, 0.003), 0.5, 0.2, 0.006)), scene, plaque),
  )

  const [mds, images] = await Promise.all([
    Promise.all(oeuvres.map((a) => fetch(`${base}${cheminReadme(a.key)}`).then((r) => (r.ok ? r.text() : null)).catch(() => null))),
    Promise.all(oeuvres.map((a) => chargerImage(`${base}media/near/${a.key.replace('/', '__')}.webp`, scene))),
    police('PT Sans'),
    police('PT Serif'),
  ])

  // Les toiles, derrière la vue du cadre : l'image, sinon un aplat bordeaux sombre.
  vs.forEach((v, i) => {
    const t = images[i]
    const mat = t ? matiere(`vitrine-toile-${i}`, scene, '#ffffff', 0.55) : matiere(`vitrine-toile-${i}`, scene, '#3a1416', 0.9)
    if (t) {
      t.anisotropicFilteringLevel = 4
      mat.albedoTexture = t
    }
    eclairees.push(mat)
    const toile = maillageDeQuads(`vitrine-toile-${i}`, [{ centre: [v.toile.x, v.toile.y, v.toile.z], droite: [1, 0, 0], haut: [0, 1, 0], l: TOILE.largeur, h: TOILE.hauteur, uv: [0, 0, 1, 1] }], scene, mat)
    toile.receiveShadows = true
    porteurs.push(toile)
  })
  brancherLueurs(eclairees)
  for (const m of porteurs) m.receiveShadows = true

  // Les textes des trois panneaux et de leurs cartels : un atlas, un maillage, un appel.
  const textes = vs.flatMap((v, i) => textesDe(oeuvres[i], v, mds[i]))
  const tailles = textes.map((t) => ({ l: Math.ceil((t.largeur + 0.1) * t.px), h: Math.ceil(t.hauteur * t.px) }))
  const { dt, uvs } = atlasDeTextes('vitrines-textes', scene, tailles, (g, i, x, y) => {
    const t = textes[i]
    const px = t.corps * t.px
    g.font = `${px}px '${t.police}'`
    g.fillStyle = t.couleur
    g.textBaseline = 'top'
    if (t.espacement) g.letterSpacing = `${t.espacement * px}px`
    g.beginPath()
    g.rect(x, y, tailles[i].l, tailles[i].h)
    g.clip()
    const rangees = t.sansCoupure ? [t.texte] : t.texte.split('\n').flatMap((p) => (p ? couper(g, p, t.largeur * t.px) : ['']))
    // anchorY top de troika : le haut de la première ligne (l'œil centré dans l'interligne).
    rangees.forEach((r, j) => g.fillText(r, x, y + (j * t.interligne + (t.interligne - 1) / 2) * px))
  })
  const quads = textes.map((t, i) => ({
    centre: [t.coin[0] + (t.largeur + 0.1) / 2, t.coin[1] - t.hauteur / 2, t.coin[2]] as V3,
    droite: [1, 0, 0] as V3, haut: [0, 1, 0] as V3, l: t.largeur + 0.1, h: t.hauteur, uv: uvs[i],
  }))
  maillageDeQuads('vitrines-textes', quads, scene, matiereDeTexte('vitrines-textes', scene, dt))

  // Les écrans des bornes et leur invite, non éclairés.
  const haut = (ECRAN.hauteur * BANDEAU) / H
  const [c, s] = [Math.cos(ECRAN.inclinaison), Math.sin(ECRAN.inclinaison)]
  const vers: V3 = [0, s, -c]
  const lumineux = vs.map((v, i) => {
    const { base: b, normale: n } = ecrans[i]
    const ecran = new StandardMaterial(`vitrine-ecran-${i}`, scene)
    ecran.disableLighting = true
    ecran.diffuseColor = Color3.Black()
    // La couleur émissive s'AJOUTE à la carte : l'éclat passe par le niveau de la carte.
    const fond = (ecran.emissiveTexture = canevasEnMetres(`vitrine-ecran-${i}`, scene, W, H, 1, (g) => peindreEcran(g, oeuvres[i], v.rang)))
    const invite = new StandardMaterial(`vitrine-invite-${i}`, scene)
    invite.disableLighting = true
    invite.diffuseColor = Color3.Black()
    invite.emissiveTexture = invite.opacityTexture = canevasEnMetres(`vitrine-invite-${i}`, scene, W, BANDEAU, 1, (g) => {
      g.fillStyle = '#ffd98a'
      g.font = '600 24px system-ui, sans-serif'
      g.textAlign = 'center'
      g.fillText('APPROCHEZ-VOUS  ·  APPUYEZ SUR E', W / 2, BANDEAU * 0.64)
    })
    invite.opacityTexture.hasAlpha = true
    invite.disableDepthWrite = true
    VIVANTES.add(ecran.name).add(invite.name)
    const dy = -(ECRAN.hauteur - haut) / 2
    maillageDeQuads(ecran.name, [{ centre: b, droite: [1, 0, 0], haut: vers, l: ECRAN.largeur, h: ECRAN.hauteur, uv: [0, 0, 1, 1] }], scene, ecran)
    const centre = b.map((x, k) => x + vers[k] * dy + n[k] * 0.001) as V3
    maillageDeQuads(invite.name, [{ centre, droite: [1, 0, 0], haut: vers, l: ECRAN.largeur, h: haut, uv: [0, 0, 1, 1] }], scene, invite)
    return { fond, invite }
  })

  // La borne regardée : l'éclat de l'écran suit la nuit, l'invite palpite tant qu'on ne consulte pas.
  scene.onBeforeRenderObservable.add(() => {
    const nuit = 1 - vivant.getState().ciel.jour
    const rang = borneRegardee(visiteur())
    const borne = (rang !== null && oeuvres[rang]?.key) || null
    const t = performance.now() / 1000
    oeuvres.forEach((a, i) => {
      const active = a.key === borne
      lumineux[i].fond.level = enGamma((active ? 1.25 : 1) + 0.35 * nuit)
      lumineux[i].invite.alpha = active ? 0 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.2))
    })
  })
  return porteurs
}
