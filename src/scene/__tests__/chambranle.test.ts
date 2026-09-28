/**
 * Le chambranle (`tools/blender/build-chambranle.py`) est modelé aux cotes de
 * `plan/portes.ts` : une pièce qui déborderait dans la baie la rétrécirait à l'œil.
 */
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'

import { ARCHITRAVE, LINTEAU, PLINTHE } from '../../plan/portes'
import { chargerGLTF, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

it('chambranle.glb : architrave, plinthe et entablement aux cotes du plan, hors de la baie', async () => {
  const { scene } = await chargerGLTF('public/assets/architecture/chambranle.glb')
  const boite = (nom: string) => new THREE.Box3().setFromObject(scene.getObjectByName(nom)!)
  const W0 = 2

  const c = boite('Chambranle')
  expect(c.min.y).toBeCloseTo(PLINTHE.h, 2)
  expect(c.max.y).toBeCloseTo(LINTEAU + ARCHITRAVE, 2)
  expect(c.max.x).toBeCloseTo(W0 / 2 + ARCHITRAVE, 2)
  expect(c.min.z).toBeCloseTo(0, 2)
  expect(c.max.z).toBeGreaterThan(0.06)
  expect(c.max.z).toBeLessThan(0.1)
  // Aucun sommet dans la baie : sous le linteau, |x| reste au-delà de W0 / 2.
  const p = (scene.getObjectByName('Chambranle') as THREE.Mesh).geometry.attributes.position
  for (let i = 0; i < p.count; i++) if (p.getY(i) < LINTEAU - 1e-3) expect(Math.abs(p.getX(i))).toBeGreaterThan(W0 / 2 - 1e-3)

  const pl = boite('Plinthe')
  expect(pl.max.x - pl.min.x).toBeCloseTo(PLINTHE.l, 2)
  expect(pl.max.y).toBeCloseTo(PLINTHE.h, 2)

  const e = boite('Entablement')
  expect(e.min.y).toBeCloseTo(LINTEAU + ARCHITRAVE, 2)
  expect(e.max.z).toBeLessThan(0.25)
})
