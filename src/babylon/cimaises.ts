/**
 * Les cimaises modulables (`plan/cimaises.ts`, CimaisesLayer de three) : le
 * stratifié blanc mat des modules, et l'aluminium des jonctions, de la plinthe
 * et des pieds. Hors atlas de lumière cuite : l'éclairage direct, l'hémisphérique
 * et les ombres suffisent.
 * ponytail : un lot d'instances par matière pour tous les niveaux (2 appels au
 * lieu de 2 par niveau) ; à scinder par niveau si le tri par zone l'exige.
 */
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'

import { boitesDesCimaises } from '../plan/cimaises.ts'
import type { Plan } from '../plan/types.ts'
import { cubes, matiere } from './boites.ts'
import { brancherLueurs } from './lueurs.ts'

export function monterCimaises(scene: Scene, plan: Plan): Mesh[] {
  const niveaux = plan.levels.map((l) => boitesDesCimaises(plan, l.id))
  const stratifie = matiere('cimaise:stratifie', scene, '#efece6', 0.82)
  const alu = matiere('cimaise:alu', scene, '#a7acb1', 0.45)
  alu.metallic = 0.55
  brancherLueurs([stratifie, alu])
  const ms = [
    cubes('cimaises:panneaux', niveaux.flatMap((n) => n.panneaux), scene, stratifie),
    cubes('cimaises:alu', niveaux.flatMap((n) => n.alu), scene, alu),
  ]
  for (const m of ms) m.receiveShadows = true
  return ms
}
