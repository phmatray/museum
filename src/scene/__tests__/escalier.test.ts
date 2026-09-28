/**
 * L'escalier de marbre (`tools/blender/build-escalier.py`) est modélisé dans le
 * repère du plan et remplace les marches de `plan/mesh.ts` : il doit tenir dans
 * l'emprise des volées et du palier, poser son palier à la cote du plan, et
 * laisser la niche de Bavette, sous la volée ouest, dégagée.
 */
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { chargerGLTF, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

it('escalier.glb tient dans l’emprise des volées et du palier', async () => {
  const scene = (await chargerGLTF('public/assets/architecture/escalier.glb')).scene
  const tout = [...MUSEE.flights, ...MUSEE.landings]
  const x0 = Math.min(...tout.map((r) => r.x))
  const x1 = Math.max(...tout.map((r) => r.x + r.width))
  const z0 = Math.min(...tout.map((r) => r.z))
  const z1 = Math.max(...tout.map((r) => r.z + r.depth))
  const boite = new THREE.Box3().setFromObject(scene)
  // Au plus un nez de marche (3,5 cm) et une moulure au-delà du plan.
  expect(boite.min.x).toBeGreaterThan(x0 - 0.1)
  expect(boite.max.x).toBeLessThan(x1 + 0.1)
  expect(boite.min.z).toBeGreaterThan(z0 - 0.1)
  expect(boite.max.z).toBeLessThan(z1 + 0.1)
  expect(boite.min.y).toBeGreaterThan(-0.01)
  expect(boite.max.y).toBeLessThan(MUSEE.storey + 0.01)

  // Le palier : son dessus à la cote du plan.
  const palier = MUSEE.landings[0]
  const dessus = new THREE.Box3().setFromObject(scene.getObjectByName('Escalier_Palier')!)
  expect(dessus.max.y).toBeCloseTo(palier.elevation, 2)
})

it('les bulbes du départ restent devant la volée centrale, loin de la niche de Bavette', async () => {
  const scene = (await chargerGLTF('public/assets/architecture/escalier.glb')).scene
  const centrale = MUSEE.flights.find((f) => f.id === 'volee-centrale')!
  const ouest = MUSEE.flights.find((f) => f.id === 'volee-ouest')!
  // Tout ce qui est sous les volées latérales (leur paillasse descend à 36 cm sous le palier).
  const v = new THREE.Vector3()
  let debordMax = 0
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const pos = (o.geometry as THREE.BufferGeometry).getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
      if (v.y > ouest.bottom - 0.4) continue
      const debord = Math.max(centrale.x - v.x, v.x - centrale.x - centrale.width)
      // Le limon et ses moulures sortent de quelques centimètres ; un bulbe, de plus.
      if (debord > 0.12) expect(v.z, `bulbe en (${v.x}, ${v.z})`).toBeGreaterThan(18.9)
      // Jamais dans le passage vers la niche de Bavette, ni dans la niche.
      if (v.x < centrale.x) expect(v.x).toBeGreaterThan(ouest.x + ouest.width + 0.5)
      debordMax = Math.max(debordMax, debord)
    }
  })
  expect(debordMax).toBeGreaterThan(0.5)
  expect(debordMax).toBeLessThanOrEqual(0.8 + 0.04)
})
