import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import LUMIERE from '../../plan/lumiere.json' with { type: 'json' }
import { MUSEE } from '../../plan/musee'
import { geometrieCuite, matriceDeBoite, tableDeLumiere, trierBoites } from '../boites'

const INDEX = LUMIERE as { largeur: number; hauteur: number; boites: Record<string, (number[] | number)[]> }

describe('trierBoites', () => {
  const lots = trierBoites(MUSEE)

  it('cuit les 808 surfaces de lumiere.json, sans marche ni garde-corps', () => {
    expect(lots.cuites).toHaveLength(808)
    expect(lots.cuites.every((c) => c.cle in INDEX.boites)).toBe(true)
    expect(lots.cuites.some((c) => c.b.kind === 'step' || c.b.kind === 'railing')).toBe(false)
  })

  it('range marches, palier et paillasses parmi les opaques, et ne perd aucune boîte', () => {
    expect(lots.opaques.filter((t) => t.b.kind === 'step')).toHaveLength(45)
    expect(lots.opaques.some((t) => t.b.kind === 'landing')).toBe(true)
    expect(lots.opaques.some((t) => t.b.kind === 'slab')).toBe(true)
    expect(lots.cuites.length + lots.opaques.length + lots.verre.length + lots.lanterneau.length).toBe(1237)
  })
})

describe('matriceDeBoite', () => {
  it('cisaille une main courante de volée comme three, le long de son grand côté', () => {
    const b = trierBoites(MUSEE).opaques.map((t) => t.b).find((b) => b.kind === 'handrail' && b.pente)!
    const m = new Float32Array(16)
    matriceDeBoite(b, m, 0)
    const lx = b.w > b.d
    const p = Vector3.TransformCoordinates(new Vector3(lx ? 0.5 : 0, 0.5, lx ? 0 : 0.5), Matrix.FromArray(m))
    expect(p.y).toBeCloseTo(b.y + b.h / 2 + (b.pente! * (lx ? b.w : b.d)) / 2, 6)
    expect(lx ? p.x : p.z).toBeCloseTo(lx ? b.x + b.w / 2 : b.z + b.d / 2, 6)
  })
})

describe('geometrieCuite', () => {
  // Deux faces écrites à la main : +y puis +x (face 0 de la boîte choisie) (4 sommets chacune).
  const gabarit = {
    positions: [-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  }
  const b = { x: 8, y: -0.15, z: 6.5, w: 16, h: 0.3, d: 13, kind: 'slab' as const }
  const g = geometrieCuite(gabarit, [{ b, cle: '8000,-150,6500,16000,300,13000', couleur: '#ff0000' }, { b, cle: 'absente', couleur: '#ff0000' }], INDEX)

  it('pose la face +y dans son rectangle et une face 0 sur le texel (0, 0)', () => {
    const [u0, v0] = [g.uvs2[0], g.uvs2[1]]
    const [u2, v2] = [g.uvs2[4], g.uvs2[5]]
    expect([u0, v0]).toEqual([expect.closeTo(2480 / 4096, 6), expect.closeTo(2 / 2304, 6)])
    expect([u2, v2]).toEqual([expect.closeTo(2704 / 4096, 6), expect.closeTo(184 / 2304, 6)])
    expect([g.uvs2[8], g.uvs2[9]]).toEqual([expect.closeTo(0.5 / 4096, 6), expect.closeTo(0.5 / 2304, 6)])
    // La seconde boîte n'a pas d'entrée : texel (0, 0) partout.
    expect(g.uvs2[16]).toBeCloseTo(0.5 / 4096, 6)
  })

  it('met à l’échelle, teinte et décale les indices', () => {
    expect([g.positions[0], g.positions[1], g.positions[2]]).toEqual([0, 0, 0])
    expect(Array.from(g.colors.slice(0, 4))).toEqual([1, 0, 0, 1])
    expect(g.indices[12]).toBe(8)
  })
})

describe('tableDeLumiere', () => {
  it('ne touche rien sans force et assombrit un coin avec', () => {
    const neutre = tableDeLumiere(0, [[1, 1, 1]])
    expect(new Set(neutre.table)).toEqual(new Set([128]))
    expect(neutre.niveau).toBe(2)
    const { table: t } = tableDeLumiere(1, [[1, 1, 1]])
    expect(t[10]).toBeLessThan(t[200])
    expect(t[10]).toBeLessThan(128)
  })

  it('garde la teinte de chaque orientation, canal par canal', () => {
    // Un dessus au ciel brun de la nuit, un côté gris : le facteur 1 rend la teinte elle-même.
    const { table, niveau } = tableDeLumiere(0, [[0.5, 0.5, 0.5], [0.25, 0.17, 0.1]])
    const lu = (k: number, canal: number) => (table[(3 * k + canal) * 256 + 255] / 255) * niveau
    expect(lu(1, 0)).toBeCloseTo(0.25, 2)
    expect(lu(1, 2)).toBeCloseTo(0.1, 2)
    expect(lu(0, 1)).toBeCloseTo(0.5, 2)
  })
})

describe('gabarit sous NullEngine', () => {
  it('a 24 sommets et six faces distinctes, lues sur la normale', () => {
    const scene = new Scene(new NullEngine())
    scene.useRightHandedSystem = true
    const v = VertexData.ExtractFromMesh(CreateBox('g', { size: 1 }, scene))
    expect(v.positions!.length / 3).toBe(24)
    const n = v.normals!
    const faces = new Set<string>()
    for (let i = 0; i < 24; i++) faces.add([n[3 * i], n[3 * i + 1], n[3 * i + 2]].map(Math.round).join())
    expect(faces.size).toBe(6)
  })
})
