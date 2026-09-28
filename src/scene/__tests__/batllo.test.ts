/**
 * La fenêtre Batlló (`tools/blender/build-batllo.py`) remplace la boîte de verre
 * de la baie de la salle d'honneur : elle doit tenir dans cette baie — un
 * ré-export qui oublierait la conversion d'axes la poserait ailleurs — et
 * seule cette boîte-là doit disparaître du rendu.
 */
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { meshLevel } from '../../plan/mesh'
import { BAIE_BATLLO, sansBaieBatllo } from '../batllo'
import { chargerGLTF, installerDecodeurDraco } from './glbTestHarness'

beforeAll(installerDecodeurDraco)

it('batllo.glb remplit la baie de la salle d’honneur, sur ses deux faces', async () => {
  const boite = new THREE.Box3().setFromObject((await chargerGLTF('public/assets/architecture/batllo.glb')).scene)
  const niveau = MUSEE.levels.find((l) => l.id === BAIE_BATLLO.level)!
  const [g, d] = [BAIE_BATLLO.x - BAIE_BATLLO.width / 2, BAIE_BATLLO.x + BAIE_BATLLO.width / 2]
  // Le chambranle déborde un peu sur le mur, de chaque côté.
  expect(boite.min.x).toBeGreaterThan(g - 0.2)
  expect(boite.min.x).toBeLessThan(g)
  expect(boite.max.x).toBeLessThan(d + 0.2)
  expect(boite.max.x).toBeGreaterThan(d)
  expect(boite.min.y).toBeCloseTo(niveau.elevation, 2)
  expect(boite.max.y).toBeCloseTo(niveau.elevation + MUSEE.storey - MUSEE.slab, 2)
  // Dans l'épaisseur du mur, en saillie des deux côtés, loin du tableau des départs.
  expect(boite.min.z).toBeGreaterThan(BAIE_BATLLO.z - 0.3)
  expect(boite.min.z).toBeLessThan(BAIE_BATLLO.z - 0.15)
  expect(boite.max.z).toBeGreaterThan(BAIE_BATLLO.z + 0.15)
  expect(boite.max.z).toBeLessThan(BAIE_BATLLO.z + 0.5)
})

it('sansBaieBatllo retire la seule boîte de verre de la baie Batlló', () => {
  for (const l of MUSEE.levels) {
    const verre = meshLevel(MUSEE, l.id).filter((b) => b.kind === 'glass')
    expect(sansBaieBatllo(verre, l.id)).toHaveLength(verre.length - (l.id === BAIE_BATLLO.level ? 1 : 0))
  }
})
