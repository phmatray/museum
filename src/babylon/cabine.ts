/**
 * La cabine de projection (`SALLE_CABINE`, `SOL_CABINE`, `PORTE_CABINE`, `CABINE` : plan/cinema.ts),
 * derrière le mur du fond, de plain-pied avec le promenoir. On la voit de la salle par ses deux
 * lucarnes : le projecteur et son objectif dans l'une, le pupitre du projectionniste dans l'autre.
 *
 * Dedans : le projecteur sur son pied, sa lanterne et sa cheminée ; la tour à plateaux de la
 * pellicule ; la table de rembobinage et ses boîtes de film ; une étagère de bobines ; une
 * ampoule nue. La porte, côté salle, reste fermée tant que le visiteur n'a pas dix tampons
 * (`cabineOuverte`, domain/succes.ts) : une plaque le lui dit.
 */
import type { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import type { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { PointLight } from '@babylonjs/core/Lights/pointLight'
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Scene } from '@babylonjs/core/scene'

import { TAMPONS_CABINE } from '../domain/succes.ts'
import { CABINE, MEUBLES_CABINE, PLAFOND, PORTE_CABINE, SALLE_CABINE, SOL_CABINE } from '../plan/cinema.ts'
import { centre, lumineuse, pbr, plan, SERIF } from './foyer.ts'

/** La face des cloisons (0,15) plus le revêtement. */
const FACE = 0.17
const CHAUD = new Color3(1, 0.82, 0.6)

export interface Cabine {
  /** Ouvre ou ferme la porte (selon le carnet). */
  ouvrir(oui: boolean): void
  /** La porte et sa plaque, vues de la salle : à éclairer par la salle. */
  porte: AbstractMesh[]
}

export function monterCabine(scene: Scene, lumieres: { soleil: DirectionalLight; hemi: HemisphericLight; dore: PBRMaterial }): Cabine {
  const cabine: AbstractMesh[] = []
  const garder = <T extends AbstractMesh>(m: T): T => (cabine.push(m), (m.isPickable = false), m)
  const sol = SOL_CABINE.elevation
  const haut = PLAFOND
  const [x0, x1, z0, z1] = [SALLE_CABINE.x + FACE, SALLE_CABINE.x + SALLE_CABINE.width - FACE, SALLE_CABINE.z + FACE, SALLE_CABINE.z + SALLE_CABINE.depth - FACE]
  const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2]

  // ── Les matières : murs vert d'atelier, plancher de linoléum, métal des machines ──
  const murs = pbr(scene, 'cabine:murs', new Color3(0.12, 0.16, 0.13), 0.8)
  const lino = pbr(scene, 'cabine:lino', new Color3(0.16, 0.1, 0.07), 0.6)
  const plafond = pbr(scene, 'cabine:plafond', new Color3(0.2, 0.19, 0.17), 0.9)
  const machine = pbr(scene, 'cabine:machine', new Color3(0.09, 0.1, 0.11), 0.35, 0.8)
  // L'émail gris-vert des projecteurs d'autrefois.
  const email = pbr(scene, 'cabine:email', new Color3(0.27, 0.33, 0.3), 0.4, 0.3)
  const chrome = pbr(scene, 'cabine:chrome', new Color3(0.7, 0.7, 0.72), 0.2, 1)
  const bois = pbr(scene, 'cabine:bois', new Color3(0.3, 0.18, 0.1), 0.55)
  const boite = pbr(scene, 'cabine:boites', new Color3(0.42, 0.4, 0.36), 0.4, 0.9)
  const verre = pbr(scene, 'cabine:verre', new Color3(0.85, 0.9, 1), 0.05)
  verre.alpha = 0.12

  const pave = (nom: string, sx: number, sy: number, sz: number, x: number, y: number, z: number, m: PBRMaterial | StandardMaterial) => {
    const b = garder(CreateBox(nom, { width: sx, height: sy, depth: sz }, scene))
    b.position.set(x, y, z)
    b.material = m
    return b
  }
  const disque = (nom: string, r: number, ep: number, x: number, y: number, z: number, m: PBRMaterial, axe: 'x' | 'y' | 'z' = 'y') => {
    const d = garder(CreateCylinder(nom, { diameter: 2 * r, height: ep, tessellation: 32 }, scene))
    d.position.set(x, y, z)
    if (axe === 'x') d.rotation.z = Math.PI / 2
    if (axe === 'z') d.rotation.x = Math.PI / 2
    d.material = m
    return d
  }

  // ── Les parois (le mur du fond de la salle est percé : on en double les morceaux autour des lucarnes et de la porte) ──
  const hauteur = haut - sol
  garder(plan('cabine:mur-sud', scene, x1 - x0, hauteur, cx, (sol + haut) / 2, z1, '-z')).material = murs
  garder(plan('cabine:mur-ouest', scene, z1 - z0, hauteur, x0, (sol + haut) / 2, cz, '+x')).material = murs
  garder(plan('cabine:mur-est', scene, z1 - z0, hauteur, x1, (sol + haut) / 2, cz, '-x')).material = murs
  const trous = [
    { a: PORTE_CABINE.x - PORTE_CABINE.width / 2, b: PORTE_CABINE.x + PORTE_CABINE.width / 2, y0: sol, y1: sol + (PORTE_CABINE.hauteur ?? 2) },
    ...CABINE.map((f) => ({ a: f.x - f.largeur / 2, b: f.x + f.largeur / 2, y0: f.y0, y1: f.y1 })),
  ]
  for (const [i, m] of morceaux({ a: x0, b: x1, y0: sol, y1: haut }, trous).entries())
    garder(plan(`cabine:mur-nord${i}`, scene, m.b - m.a, m.y1 - m.y0, (m.a + m.b) / 2, (m.y0 + m.y1) / 2, z0, '+z')).material = murs
  const lit = garder(plan('cabine:sol', scene, x1 - x0, z1 - z0, cx, sol + 0.005, cz, '-z'))
  lit.rotation.x = Math.PI / 2
  lit.material = lino
  const ciel = garder(plan('cabine:plafond', scene, x1 - x0, z1 - z0, cx, haut - 0.01, cz, '-z'))
  ciel.rotation.x = -Math.PI / 2
  ciel.material = plafond
  // Le vitrage des lucarnes.
  for (const [i, f] of CABINE.entries()) pave(`cabine:vitre${i}`, f.largeur, f.y1 - f.y0, 0.01, f.x, (f.y0 + f.y1) / 2, SALLE_CABINE.z, verre)

  // ── Le projecteur, dans l'axe de la lucarne de projection : l'objectif affleure la vitre ──
  const lucarne = CABINE.find((f) => f.projection)!
  const yo = (lucarne.y0 + lucarne.y1) / 2
  const xo = lucarne.x
  disque('cabine:objectif', 0.07, 0.3, xo, yo, z0 + 0.2, chrome, 'z')
  pave('cabine:projecteur', 0.42, 0.46, 0.75, xo, yo - 0.05, z0 + 0.72, email)
  pave('cabine:lanterne', 0.5, 0.62, 0.55, xo, yo - 0.02, z0 + 1.35, email)
  disque('cabine:cheminee', 0.09, haut - (yo + 0.29), xo, (yo + 0.29 + haut) / 2, z0 + 1.35, chrome)
  pave('cabine:pied', 0.36, yo - 0.28 - sol, 0.5, xo, (sol + yo - 0.28) / 2, z0 + 0.95, email)
  pave('cabine:socle', 0.7, 0.06, 0.9, xo, sol + 0.03, z0 + 0.95, machine)
  // La tour à plateaux : trois grands disques de pellicule, dans l'angle (son emprise : MEUBLES_CABINE).
  const tour = MEUBLES_CABINE[1]
  const [tx, tz] = [tour.x + tour.width / 2, tour.z + tour.depth / 2]
  disque('cabine:tour', 0.05, 1.6, tx, sol + 0.8, tz, chrome)
  for (const [k, y] of [0.55, 1.0, 1.45].entries()) {
    disque(`cabine:plateau${k}`, 0.62, 0.02, tx, sol + y, tz, chrome)
    disque(`cabine:pellicule${k}`, 0.45 - k * 0.08, 0.035, tx, sol + y + 0.03, tz, machine)
  }
  // La table de rembobinage, contre le mur du fond, et ses boîtes de film.
  const t = MEUBLES_CABINE[2]
  const [mx, mz] = [t.x + t.width / 2, t.z + t.depth / 2]
  pave('cabine:table', t.width, 0.05, 0.7, mx, sol + 0.9, mz, bois)
  for (const [k, dx] of [-0.8, 0.8].entries()) pave(`cabine:table-pied${k}`, 0.05, 0.9, 0.6, mx + dx, sol + 0.45, mz, bois)
  for (const [k, [dx, dy]] of [[-0.4, 0], [-0.4, 0.04], [0.1, 0], [0.5, 0]].entries()) disque(`cabine:boite${k}`, 0.2, 0.035, mx + dx, sol + 0.945 + dy, mz, boite)
  // L'étagère des bobines, au mur ouest.
  const e = MEUBLES_CABINE[3]
  const ez = e.z + e.depth / 2
  for (const [k, y] of [0.5, 1.1, 1.7].entries()) pave(`cabine:etagere${k}`, 0.35, 0.03, e.depth - 0.2, x0 + 0.18, sol + y, ez, bois)
  for (let k = 0; k < 9; k++) disque(`cabine:bobine${k}`, 0.17, 0.05, x0 + 0.18, sol + 0.5 + Math.floor(k / 3) * 0.6 + 0.19, ez - 0.45 + (k % 3) * 0.45, boite, 'x')
  // Le tabouret du projectionniste, devant sa lucarne.
  const obs = CABINE.find((f) => !f.projection)!
  disque('cabine:tabouret', 0.18, 0.04, obs.x, sol + 0.75, z0 + 0.5, bois)
  disque('cabine:tabouret-pied', 0.03, 0.73, obs.x, sol + 0.37, z0 + 0.5, chrome)
  // L'ampoule nue, et sa lumière, pour la cabine seule.
  const ampoule = garder(CreateSphere('cabine:ampoule', { diameter: 0.09 }, scene))
  ampoule.position.set(cx, haut - 0.45, cz)
  const filament = new StandardMaterial('cabine:ampoule', scene)
  filament.disableLighting = true
  filament.emissiveColor = new Color3(1, 0.85, 0.6)
  ampoule.material = filament
  disque('cabine:fil', 0.006, 0.4, cx, haut - 0.22, cz, machine)
  const lampe = new PointLight('cabine:lampe', new Vector3(cx, haut - 0.5, cz), scene)
  lampe.diffuse = CHAUD
  lampe.specular = CHAUD.scale(0.5)
  lampe.intensity = 3
  lampe.range = 7
  lampe.includedOnlyMeshes = cabine
  // Une veilleuse au-dessus du projecteur, côté lucarne : de la salle, on le devine.
  const pilote = new PointLight('cabine:pilote', new Vector3(xo + 0.25, yo + 0.35, z0 + 0.35), scene)
  pilote.diffuse = CHAUD
  pilote.specular = Color3.Black()
  pilote.intensity = 1.2
  pilote.range = 2.2
  pilote.includedOnlyMeshes = cabine

  // ── La porte, côté salle, et sa plaque ──
  const larg = PORTE_CABINE.width
  const hPorte = PORTE_CABINE.hauteur ?? 2
  const gond = new TransformNode('cabine:gond', scene)
  gond.position.set(PORTE_CABINE.x - larg / 2, sol, SALLE_CABINE.z)
  const porte: AbstractMesh[] = []
  const battant = CreateBox('cabine:porte', { width: larg - 0.02, height: hPorte - 0.02, depth: 0.04 }, scene)
  porte.push(battant)
  battant.parent = gond
  battant.position.set(larg / 2, hPorte / 2, 0)
  battant.material = bois
  const poignee = CreateSphere('cabine:poignee', { diameter: 0.06 }, scene)
  porte.push(poignee)
  poignee.parent = battant
  poignee.position.set(larg / 2 - 0.1, -0.05, -0.04)
  poignee.material = lumieres.dore
  const plaque = plan('cabine:plaque', scene, 0.6, 0.3, PORTE_CABINE.x, sol + 1.55, SALLE_CABINE.z - 0.035, '-z')
  porte.push(plaque)
  plaque.material = lumineuse('cabine:plaque', scene, 0.6, 0.3, (g, L, H) => {
    g.fillStyle = '#1b0e08'
    g.fillRect(0, 0, L, H)
    g.strokeStyle = '#c9a25a'
    g.lineWidth = 10
    g.strokeRect(14, 14, L - 28, H - 28)
    g.fillStyle = '#f1dcaa'
    centre(g, 'CABINE', H * 0.42, L, SERIF, 150)
    g.fillStyle = '#c9a25a'
    centre(g, `Réservé · ${TAMPONS_CABINE} tampons`, H * 0.78, L, SERIF, 64)
  }, 0.5)

  // Ni soleil ni ciel ; ni aucune lumière du musée (une lumière traverse les dalles).
  lumieres.soleil.excludedMeshes.push(...cabine)
  lumieres.hemi.excludedMeshes.push(...cabine)
  const horsLumiere = (l: { name: string; excludedMeshes: AbstractMesh[] }) => { if (!l.name.startsWith('cabine:')) l.excludedMeshes.push(...cabine) }
  scene.lights.forEach(horsLumiere)
  scene.onNewLightAddedObservable.add(horsLumiere)

  for (const m of porte) m.isPickable = false
  return {
    porte,
    ouvrir(oui) {
      // Ouverte vers l'intérieur de la cabine.
      gond.rotation.y = oui ? -Math.PI * 0.55 : 0
      plaque.setEnabled(!oui)
    },
  }
}

/** Les morceaux d'un rectangle de mur (a–b en largeur, y0–y1 en hauteur) autour de trous rectangulaires. */
export function morceaux(r: { a: number; b: number; y0: number; y1: number }, trous: { a: number; b: number; y0: number; y1: number }[]): { a: number; b: number; y0: number; y1: number }[] {
  const xs = [...new Set([r.a, r.b, ...trous.flatMap((t) => [t.a, t.b])])].filter((x) => x >= r.a && x <= r.b).sort((p, q) => p - q)
  const out: { a: number; b: number; y0: number; y1: number }[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    const [a, b] = [xs[i], xs[i + 1]]
    const ici = trous.filter((t) => t.a <= a + 1e-9 && t.b >= b - 1e-9).sort((p, q) => p.y0 - q.y0)
    let y = r.y0
    for (const t of ici) {
      if (t.y0 > y + 1e-9) out.push({ a, b, y0: y, y1: t.y0 })
      y = Math.max(y, t.y1)
    }
    if (r.y1 > y + 1e-9) out.push({ a, b, y0: y, y1: r.y1 })
  }
  return out
}
