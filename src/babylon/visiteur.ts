/**
 * Le visiteur : où il ouvre les yeux (le départ du plan, ou devant la toile de
 * `?p=<repo>`), puis la marche au clavier et le regard à la souris verrouillée.
 * La caméra est passive : `walk.ts` décide où va le pied, on y pose l'œil.
 */
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { PAS_FIXE, cadencer } from '../domain/locomotion.ts'
import { projetDemande, resoudre } from '../domain/lien.ts'
import { arriveeDevant, cibleDe, type Arrivee } from '../plan/arrivee.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { surfaceAt } from '../plan/rules.ts'
import type { Plan } from '../plan/types.ts'
import { step } from '../plan/walk.ts'

const OEIL = 1.62
const SENSIBILITE = 0.002

/** Le départ du visiteur : devant la toile demandée si elle est accrochée, sinon au départ du plan. */
export function departDuVisiteur(plan: Plan, accrochage: Accrochage | null, recherche: string, hash: string, owners: readonly string[]): Arrivee {
  const demande = projetDemande(recherche, hash)
  if (demande && accrochage) {
    const cles = accrochage.rooms.flatMap((r) => r.placements.map((p) => p.key))
    const cle = resoudre(demande, cles, owners)
    // ponytail : pas de vitrines (`[]`) ; on les ajoutera avec la salle d'honneur.
    const cible = cle ? cibleDe(cle, accrochage, []) : null
    const arrivee = cible ? arriveeDevant(plan, cible) : null
    if (arrivee) return arrivee
  }
  const { level, x, z } = plan.spawn
  const y = plan.levels.find((l) => l.id === level)?.elevation ?? 0
  const surface = surfaceAt(plan, x, z, y)
  if (!surface) throw new Error(`Le départ (${x}, ${z}) n'est sur aucune surface`)
  return { level, surface, x, z, y, yaw: 0, pitch: 0 }
}

/** La caméra du visiteur, menée par le clavier (codes positionnels : ZQSD en AZERTY) et la souris verrouillée. */
export function monterVisiteur(scene: Scene, toile: HTMLCanvasElement, depart: Arrivee): FreeCamera {
  const camera = new FreeCamera('visiteur', new Vector3(depart.x, depart.y + OEIL, depart.z), scene)
  camera.inputs.clear()
  camera.fov = (75 * Math.PI) / 180
  camera.minZ = 0.1
  camera.maxZ = 1000

  const enfoncees = new Set<string>()
  addEventListener('keydown', (e) => enfoncees.add(e.code))
  addEventListener('keyup', (e) => enfoncees.delete(e.code))
  addEventListener('blur', () => enfoncees.clear())
  const touche = (...codes: string[]) => Number(codes.some((c) => enfoncees.has(c)))

  toile.onclick = () => { Promise.resolve(toile.requestPointerLock()).catch(() => {}) }
  let { pitch } = depart
  let w = { level: depart.level, surface: depart.surface, x: depart.x, z: depart.z, y: depart.y, yaw: depart.yaw }
  addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== toile) return
    w.yaw -= e.movementX * SENSIBILITE
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - e.movementY * SENSIBILITE))
  })

  let reste = 0
  scene.onBeforeRenderObservable.add(() => {
    const { pas, reste: r } = cadencer(reste, scene.getEngine().getDeltaTime() / 1000)
    reste = r
    const input = {
      forward: touche('KeyW', 'ArrowUp') - touche('KeyS', 'ArrowDown'),
      strafe: touche('KeyD', 'ArrowRight') - touche('KeyA', 'ArrowLeft'),
      yaw: w.yaw,
      hate: touche('ShiftLeft', 'ShiftRight') > 0,
    }
    // Toujours le même objet MUSEE : `walk.ts` y accroche son cache de murs.
    for (let i = 0; i < pas; i++) w = step(MUSEE, w, input, PAS_FIXE)
    camera.position.set(w.x, w.y + OEIL, w.z)
    // En main droite, yaw 0 regarde −z et un pitch positif lève les yeux, comme three.
    camera.rotation.set(pitch, w.yaw, 0)
  })
  return camera
}
