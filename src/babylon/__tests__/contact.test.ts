import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { emprisesDeContact, emprisesDuMaillage, tache } from '../contact.ts'
import { matrices } from '../lots.ts'

const boite = (minX: number, maxX: number, minY: number, minZ: number, maxZ: number) => ({ minX, maxX, minY, minZ, maxZ })

describe('emprisesDeContact', () => {
  it('fusionne les pièces d’un meuble, écarte les grandes et celles qui flottent', () => {
    const sol = () => 0.5
    const e = emprisesDeContact([
      boite(0, 1, 0, 0, 1), boite(0.8, 2, 0.05, 0, 1), // un banc en deux pièces
      boite(5, 12, 0, 5, 6), // trop grand
      boite(20, 21, 1.5, 20, 21), // en l'air
      boite(60, 61, 0.6, 70, 71), // sur le relief du parc
    ], [0, 4.8], sol)
    expect(e).toEqual([boite(0, 2, 0, 0, 1), boite(60, 61, 0.6, 70, 71)])
  })
})

describe('emprisesDuMaillage', () => {
  it('une boîte monde par thin instance, aucune sans éclairage', () => {
    const scene = new Scene(new NullEngine())
    const m = CreateBox('banc', { size: 1 }, scene)
    m.material = new PBRMaterial('bois', scene)
    m.thinInstanceSetBuffer('matrix', matrices([{ piece: 'p', x: 3, y: 0.5, z: 4, lacet: 0 }, { piece: 'p', x: 10, y: 0.5, z: 4, lacet: 0 }]).get('p')!, 16)
    const e = emprisesDuMaillage(m)
    expect(e.map((b) => [b.minX, b.maxX, b.minY].map((v) => +v.toFixed(3)))).toEqual([[2.5, 3.5, 0], [9.5, 10.5, 0]])
    ;(m.material as PBRMaterial).unlit = true
    expect(emprisesDuMaillage(m)).toEqual([])
  })
})

describe('tache', () => {
  it('opaque au centre, nulle aux bords, en alpha', () => {
    const t = tache()
    const a = (i: number, j: number) => t[4 * (j * 128 + i) + 3]
    expect([a(64, 64), a(0, 0), a(127, 64), a(64, 0)]).toEqual([255, 0, 0, 0])
    expect(a(24, 64)).toBeGreaterThan(80)
    expect(a(24, 64)).toBeLessThan(180)
  })
})
