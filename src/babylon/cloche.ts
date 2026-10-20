/**
 * La cloche de l'horloge de la nef (ClocheLayer.tsx) : une clochette de bronze
 * doré posée sur le cartouche, son marteau, et la potence de fer qui les porte.
 *
 * Elle frappe les heures (autant de coups que l'heure du cadran) et, à l'arrivée
 * du visiteur, un coup par version publiée cette semaine : chaque coup d'annonce
 * publie `etat.annonce` à l'impact, que le tableau des départs affiche.
 *
 * Trois appels : le fer fusionné (porteur d'ombre), la cloche et le marteau,
 * chacun fusionné sur son pivot. Ni lightmap ni UV : hémisphérique, soleil,
 * ombres, sonde et lueurs de la nef.
 * ponytail : la carte d'ombre est redessinée à la demande, l'ombre ne suit pas
 * le battement (les pièces mobiles ne la portent pas). Le son attend l'audio.
 */
import type { Material } from '@babylonjs/core/Materials/material'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateLathe } from '@babylonjs/core/Meshes/Builders/latheBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { versionsRecentes } from '../domain/departs.ts'
import { ENTRE_COUPS, coupDeCloche, coupsDeLHeure } from '../scene/horloge.ts'
import { matiere } from './boites.ts'
import { catalogue, etat, recherche } from './etat.ts'
import { brancherLueurs, lin } from './lueurs.ts'

/** Mêmes cotes que ClocheLayer.tsx : le pied, l'échelle, puis tout dans le repère du pied. */
const PIED = [24, 16.75, 13.45] as const
const ECHELLE = 2.2
const SOMMET = [0, 0.52, 0] as const
const ANSE = 0.06
const POTENCE_Y = SOMMET[1] + 0.12
const CONSOLE_Z = (12.58 - PIED[2]) / ECHELLE
const AXE = [0.62, 0.36, 0] as const
/** Le coup frappe 0,43 s après son départ : l'annonce part à l'impact. */
const IMPACT = 0.43
const PROFIL = [
  [0, 0], [0.12, 0], [0.17, -0.03], [0.19, -0.1], [0.2, -0.2], [0.23, -0.3], [0.29, -0.38], [0.31, -0.42], [0.28, -0.42], [0.25, -0.39], [0.19, -0.32], [0, -0.3],
].map(([r, y]) => new Vector3(r, y, 0))

type Annonce = { key: string; tag: string }

/**
 * Le sonneur, sans moteur : `annoncer` pousse les coups des nouvelles versions,
 * `avancer(t, date)` sonne les heures pleines (pas à la première image), rend les
 * angles du marteau et de la cloche, et l'annonce dont le coup vient de frapper.
 */
export function sonneur() {
  let coups: { t: number; annonce?: Annonce }[] = []
  let heure: number | null = null
  return {
    annoncer(annonces: Annonce[], t: number) {
      annonces.forEach((annonce, i) => coups.push({ t: t + 1.2 + i * ENTRE_COUPS * 1.5, annonce }))
    },
    avancer(t: number, d: Date): { marteau: number; cloche: number; annonce: Annonce | null } {
      if (heure !== null && d.getHours() !== heure && d.getMinutes() === 0) {
        for (let k = 0; k < coupsDeLHeure(d); k++) coups.push({ t: t + k * ENTRE_COUPS })
      }
      heure = d.getHours()
      let dernier = -Infinity
      let annonce: Annonce | null = null
      for (const c of coups) {
        if (c.t <= t) dernier = Math.max(dernier, c.t)
        if (c.annonce && t - c.t >= IMPACT) {
          annonce = c.annonce
          delete c.annonce
        }
      }
      coups = coups.filter((c) => c.t > t - 5)
      return { ...coupDeCloche(t - dernier), annonce }
    },
  }
}

/** Fusionne des pièces (posées dans le repère de `parent`) en un maillage accroché à `parent`. */
function fondre(nom: string, pieces: Mesh[], mat: Material, parent: TransformNode): Mesh {
  const m = Mesh.MergeMeshes(pieces, true, true)!
  m.name = nom
  m.material = mat
  m.parent = parent
  m.receiveShadows = true
  m.isPickable = false
  return m
}

/** Monte la cloche ; rend le fer (les pièces mobiles ne portent pas d'ombre). */
export async function monterCloche(scene: Scene, base: string): Promise<Mesh[]> {
  const bronze = matiere('cloche:bronze', scene, '#d2a54a', 0.3)
  bronze.metallic = 0.6
  bronze.emissiveColor = lin('#5a3c10')
  bronze.emissiveIntensity = 0.6
  bronze.backFaceCulling = false
  bronze.twoSidedLighting = true
  const fer = matiere('cloche:fer', scene, '#2a2622', 0.45)
  fer.metallic = 0.7
  brancherLueurs([bronze, fer])

  const racine = new TransformNode('cloche', scene)
  racine.position.set(...PIED)
  racine.scaling.setAll(ECHELLE)
  const boite = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = CreateBox('cloche:boite', { width: w, height: h, depth: d }, scene)
    b.position.set(x, y, z)
    return b
  }
  const axe = CreateCylinder('cloche:axe', { diameter: 0.032, height: 0.2, tessellation: 8 }, scene)
  axe.position.set(...SOMMET)
  axe.rotation.x = Math.PI / 2
  const ferForge = fondre('cloche:fer', [
    // La potence scellée dans la console, les deux joues de la chape, l'axe ; la traverse et la patte du marteau.
    boite(0.06, 0.06, 0.1 - CONSOLE_Z + 0.05, 0, POTENCE_Y, (CONSOLE_Z + 0.05) / 2),
    ...[-0.08, 0.08].map((z) => boite(0.07, POTENCE_Y - SOMMET[1] + 0.04, 0.02, 0, (POTENCE_Y + SOMMET[1] - 0.04) / 2, z)),
    axe,
    boite(AXE[0] + 0.05, 0.05, 0.05, (AXE[0] + 0.05) / 2, POTENCE_Y, 0),
    boite(0.05, POTENCE_Y - AXE[1] + 0.05, 0.05, AXE[0] + 0.02, (AXE[1] + POTENCE_Y) / 2, 0),
  ], fer, racine)

  // La cloche tourne autour de l'axe : l'anse (dans le plan xy), le cerveau et le battant dessous.
  const pivotCloche = new TransformNode('cloche:pivot-cloche', scene)
  pivotCloche.parent = racine
  pivotCloche.position.set(...SOMMET)
  const anse = CreateTorus('cloche:anse', { diameter: 0.07, thickness: 0.028, tessellation: 20 }, scene)
  anse.rotation.x = Math.PI / 2
  const corps = CreateLathe('cloche:corps', { shape: PROFIL, tessellation: 40 }, scene)
  corps.position.y = -ANSE
  const battant = CreateSphere('cloche:battant', { diameter: 0.09, segments: 6 }, scene)
  battant.position.y = -ANSE - 0.36
  fondre('cloche:cloche', [anse, corps, battant], bronze, pivotCloche)

  // Le marteau : un bras vers la cloche, en bas à gauche, et sa tête en travers.
  const pivotMarteau = new TransformNode('cloche:pivot-marteau', scene)
  pivotMarteau.parent = racine
  pivotMarteau.position.set(...AXE)
  const bras = CreateBox('cloche:bras', { width: 0.035, height: 0.37, depth: 0.035 }, scene)
  bras.position.set(-0.13, -0.13, 0)
  bras.rotation.z = -Math.PI / 4
  const tete = CreateCylinder('cloche:tete', { diameter: 0.11, height: 0.14, tessellation: 16 }, scene)
  tete.position.set(-0.27, -0.27, 0)
  tete.rotation.z = Math.PI / 4
  fondre('cloche:marteau', [bras, tete], bronze, pivotMarteau)

  const s = sonneur()
  const debut = performance.now()
  const temps = () => (performance.now() - debut) / 1000
  // Pas d'écran d'accueil : la visite commence au chargement, l'annonce dès le catalogue arrivé.
  void catalogue(base).then((c) => {
    if (c) s.annoncer(versionsRecentes(c.artworks, new Date(), recherche()).map((a) => ({ key: a.key, tag: a.release!.tag })), temps())
  })
  scene.onBeforeRenderObservable.add(() => {
    const { marteau, cloche, annonce } = s.avancer(temps(), new Date())
    if (annonce) etat.annonce = { ...annonce, at: Date.now() }
    pivotMarteau.rotation.z = -marteau
    pivotCloche.rotation.z = cloche
  })
  return [ferForge]
}
