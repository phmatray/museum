/**
 * La mosaïque des contributions dans l'allée de la nef (MosaiqueLayer.tsx,
 * logique pure dans `plan/mosaique.ts`) : un panneau de granit à cadre de
 * laiton (canevas de couleur + canevas de métal), deux lots de tesselles en
 * thin instances (marbre des jours calmes, or des jours travaillés, une nuance
 * par tesselle) dont celle du jour respire, et la plaque du total au pied.
 * Quatre appels de dessin. Rien si les contributions manquent.
 */
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { COTE, dateDuJour, indexDuJour, moisDeLaMosaique, panneau, semainesDuLundi, tesselles, texteDePlaque, type Contributions } from '../plan/mosaique.ts'
import { matiere } from './boites.ts'
import { mouvementReduit } from './etat.ts'
import { brancherLueurs, lin } from './lueurs.ts'
import { canevasEnMetres, maillageDeQuads, type Quad } from './textes.ts'

/** Du marbre gris au bronze : niveau 0 à 4. */
const TEINTES = ['#8a847b', '#e8c56c', '#dba43a', '#c2821d', '#9c5f0e']
const LAITON = '#c9a04e'
const GRANIT = '#2f2c29'
const PPM = 200
/** Au-dessus des bandes de granit du dallage (6 mm). */
const Y = 0.008
const EPAISSEUR = 0.006

type RGB = [number, number, number]

const hasard = (i: number): number => {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** `Color.offsetHSL(0, 0, dl)` de three : la luminance HSL décalée, teinte et saturation gardées. */
export function decalerLuminance([r, g, b]: RGB, dl: number): RGB {
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)]
  const l = (max + min) / 2
  const l2 = Math.min(1, Math.max(0, l + dl))
  if (max === min) return [l2, l2, l2]
  const s = l <= 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)
  const haut = l2 <= 0.5 ? l2 * (1 + s) : l2 + s - l2 * s
  const bas = 2 * l2 - haut
  return [r, g, b].map((c) => bas + ((c - min) / (max - min)) * (haut - bas)) as RGB
}

/** Un quad à plat, lu depuis le sud : le haut du canevas au nord (−z), sa gauche à l'ouest. */
const aPlat = (x: number, y: number, z: number, l: number, h: number, uv: Quad['uv'] = [0, 0, 1, 1]): Quad => ({ centre: [x, y, z], droite: [1, 0, 0], haut: [0, 0, -1], l, h, uv })

export async function monterMosaique(scene: Scene, base: string): Promise<Mesh[]> {
  const donnees = await fetch(`${base}data/contributions.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Contributions>) : null))
    .catch(() => null)
  if (!donnees?.weeks?.length) return []
  const t = tesselles(donnees.weeks)
  const p = panneau(semainesDuLundi(donnees.weeks).length)
  const [l, h] = [p.x1 - p.x0, p.z1 - p.z0]
  const tx0 = Math.min(...t.map((j) => j.x)) - COTE / 2
  const tx1 = Math.max(...t.map((j) => j.x)) + COTE / 2
  const tz0 = Math.min(...t.map((j) => j.z)) - COTE / 2
  const tz1 = Math.max(...t.map((j) => j.z)) + COTE / 2
  const mois = moisDeLaMosaique(donnees.weeks)
  const annees = [...new Set([t[0].date.slice(0, 4), t[t.length - 1].date.slice(0, 4)])].join(' — ')
  const trace = (g: CanvasRenderingContext2D, fond: string, metal: string) => {
    g.fillStyle = fond
    g.fillRect(0, 0, l, h)
    g.strokeStyle = metal
    g.fillStyle = metal
    g.lineWidth = 0.035
    g.strokeRect(0.05, 0.05, l - 0.1, h - 0.1)
    g.lineWidth = 0.012
    g.strokeRect(tx0 - p.x0 - 0.05, tz0 - p.z0 - 0.05, tx1 - tx0 + 0.1, tz1 - tz0 + 0.1)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '600 0.17px Georgia, "Times New Roman", serif'
    for (const m of mois) g.fillText(m.lettre, (tx0 - p.x0 - 0.05) / 2 + 0.02, m.z - p.z0)
    g.font = '600 0.12px Georgia, "Times New Roman", serif'
    ;[...'LMMJVSD'].forEach((j, d) => g.fillText(j, tx0 - p.x0 + (d + 0.5) * 0.25, tz1 - p.z0 + 0.2))
    g.font = '600 0.16px Georgia, "Times New Roman", serif'
    g.fillText(annees, l / 2, (tz0 - p.z0) / 2 + 0.03)
  }
  const couleur = canevasEnMetres('mosaique-couleur', scene, l, h, PPM, (g) => {
    trace(g, GRANIT, LAITON)
    // Le grain du granit, sous le laiton : le laiton est redessiné par-dessus.
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = hasard(i) < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,245,230,0.07)'
      g.fillRect(hasard(i + 7) * l, hasard(i + 13) * h, 0.012, 0.012)
    }
    trace(g, 'rgba(0,0,0,0)', LAITON)
  })
  // Une carte de données, pas de couleur : lue telle quelle.
  const metal = canevasEnMetres('mosaique-metal', scene, l, h, PPM, (g) => trace(g, '#000', '#fff'))
  metal.gammaSpace = false

  // Le panneau : métal 0,5 × le canal B de la carte de métal, comme la metalnessMap de three.
  const granit = matiere('mosaique-panneau', scene, '#ffffff', 0.35)
  granit.metallic = 0.5
  granit.albedoTexture = couleur
  granit.metallicTexture = metal
  granit.useMetallnessFromMetallicTextureBlue = true
  granit.useRoughnessFromMetallicTextureAlpha = false
  granit.useRoughnessFromMetallicTextureGreen = false
  const fond = maillageDeQuads('mosaique-panneau', [aPlat((p.x0 + p.x1) / 2, Y - 0.001, (p.z0 + p.z1) / 2, l, h)], scene, granit)

  // Les tesselles : la teinte linéaire (THREE.Color), nuancée dans l'espace de travail linéaire.
  const aujourdhui = t[indexDuJour(t, dateDuJour(new Date()))]
  let jour: { mesh: Mesh; i: number; base: RGB } | null = null
  const lot = (nom: string, mat: PBRMaterial, liste: typeof t) => {
    const m = CreateBox(nom, { width: COTE, height: EPAISSEUR, depth: COTE }, scene)
    const matrices = new Float32Array(16 * liste.length)
    const couleurs = new Float32Array(4 * liste.length)
    liste.forEach((j, i) => {
      matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, j.x, Y + EPAISSEUR / 2, j.z, 1], 16 * i)
      const c = lin(TEINTES[j.level])
      const nuance = decalerLuminance([c.r, c.g, c.b], (hasard(i + j.level * 97) - 0.5) * 0.05)
      couleurs.set([...nuance, 1], 4 * i)
      if (j === aujourdhui) jour = { mesh: m, i, base: nuance }
    })
    m.thinInstanceSetBuffer('matrix', matrices, 16, true)
    m.thinInstanceSetBuffer('color', couleurs, 4, false)
    m.material = mat
    return m
  }
  const or = matiere('mosaique-or', scene, '#ffffff', 0.3)
  or.metallic = 0.35
  const tesselage = [
    lot('mosaique-marbre', matiere('mosaique-marbre', scene, '#ffffff', 0.3), t.filter((j) => j.level === 0)),
    lot('mosaique-or', or, t.filter((j) => j.level > 0)),
  ].filter((m) => m.thinInstanceCount > 0 || void m.dispose(false, true))

  // La tesselle du jour respire (figée à mi-éclat si le visiteur a demandé moins de mouvement).
  const eclat = lin('#fff4d0')
  const souffle = (f: number) => {
    if (jour === null) return
    const { mesh, i, base: [r, g, b] } = jour
    const k = 0.75 * f
    mesh.thinInstanceSetAttributeAt('color', i, [r + (eclat.r - r) * k, g + (eclat.g - g) * k, b + (eclat.b - b) * k, 1])
  }
  if (mouvementReduit()) souffle(0.5)
  else {
    const debut = performance.now()
    scene.onBeforeRenderObservable.add(() => souffle(0.5 + 0.5 * Math.sin(((performance.now() - debut) / 1000) * 2.2)))
  }

  // La plaque du total : 1,90 × 0,34 m, 24 mm d'épaisseur, au pied du panneau.
  const texte = canevasEnMetres('mosaique-plaque', scene, 1.9, 0.34, 600, (g) => {
    g.fillStyle = LAITON
    g.fillRect(0, 0, 1.9, 0.34)
    g.strokeStyle = '#6b4f1d'
    g.lineWidth = 0.008
    g.strokeRect(0.02, 0.02, 1.86, 0.3)
    g.fillStyle = '#3d2a0c'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = '600 0.1px Georgia, "Times New Roman", serif'
    g.fillText(texteDePlaque(donnees.total), 0.95, 0.175)
  })
  const laiton = matiere('mosaique-plaque', scene, '#ffffff', 0.35)
  laiton.metallic = 0.5
  laiton.albedoTexture = texte
  // Le dessus porte le texte ; les quatre chants, un point de laiton uni du canevas.
  const [cx, cz, L, H, E] = [(p.x0 + p.x1) / 2, p.z1 + 0.3, 1.9, 0.34, 0.024]
  const uni: Quad['uv'] = [0.5, 0.97, 0.5, 0.97]
  const chant = (n: [number, number], dx: number, dz: number, largeur: number): Quad => ({ centre: [cx + dx, E / 2, cz + dz], droite: [n[1], 0, -n[0]], haut: [0, 1, 0], l: largeur, h: E, uv: uni })
  const plaque = maillageDeQuads('mosaique-plaque', [
    aPlat(cx, E, cz, L, H),
    chant([0, 1], 0, H / 2, L),
    chant([0, -1], 0, -H / 2, L),
    chant([1, 0], L / 2, 0, H),
    chant([-1, 0], -L / 2, 0, H),
  ], scene, laiton)

  brancherLueurs([granit, laiton, ...tesselage.map((m) => m.material!)])
  for (const m of [fond, plaque, ...tesselage]) m.receiveShadows = true
  for (const m of tesselage) m.isPickable = false
  return [plaque, ...tesselage]
}
