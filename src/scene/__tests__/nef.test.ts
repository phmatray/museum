/**
 * La nef (`tools/blender/build-nef.py`) est modélisée dans le repère du plan :
 * un ré-export qui oublierait la conversion d'axes la poserait à côté du hall.
 */
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { chargerGLTF, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

it('nef.glb coiffe le hall, au-dessus des murs de l’étage', async () => {
  const hall = MUSEE.levels[0].rooms.find((r) => r.id === 'hall')!
  const boite = new THREE.Box3().setFromObject((await chargerGLTF('public/assets/architecture/nef.glb')).scene)
  const murs = 2 * MUSEE.storey - MUSEE.slab
  expect(boite.min.x).toBeCloseTo(hall.x - 0.4, 0)
  expect(boite.max.x).toBeCloseTo(hall.x + hall.width + 0.4, 0)
  expect(boite.min.z).toBeGreaterThan(hall.z - 0.5)
  expect(boite.max.z).toBeLessThan(hall.z + hall.depth + 0.5)
  // Seules les lanternes descendent sous les murs, et jamais au niveau des yeux d'un balcon.
  expect(boite.min.y).toBeGreaterThan(MUSEE.storey + 1.8)
  expect(boite.max.y).toBeGreaterThan(murs + MUSEE.levels.length)
})
