import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import type { Feuille } from '../../plan/lierre'
import { geometrieDuLierre, monterLierre } from '../lierre'

const carte = (sorte: number): Feuille => ({
  cote: 0, position: [1, 2, 3], normale: [0, 0, 1], haut: [0, 1, 0], largeur: 0.2, longueur: 0.4, sorte, jour: 0.5,
})

describe('lierre', () => {
  it('pend la carte à son pétiole, dans le quart de l’atlas de sa sorte', () => {
    const g = geometrieDuLierre([carte(0), carte(3)])
    // Haut × normale = +x : coins (−0,1, 0), (0,1, 0), (−0,1, −0,4), (0,1, −0,4) autour de la position.
    expect([...g.positions.slice(0, 12)].map((v) => +v.toFixed(4))).toEqual([0.9, 2, 3, 1.1, 2, 3, 0.9, 1.6, 3, 1.1, 1.6, 3])
    expect([...g.normals.slice(0, 3)]).toEqual([0, 0, 1])
    // Feuille adulte : cellule en haut à gauche (v = 1 au pétiole) ; tige : en bas à droite.
    expect([...g.uvs.slice(0, 8)]).toEqual([0, 1, 0.5, 1, 0, 0.5, 0.5, 0.5])
    expect([...g.uvs.slice(8, 16)]).toEqual([0.5, 0.5, 1, 0.5, 0.5, 0, 1, 0])
    // Le vent : nul au pétiole, en travers de la carte (X × 0,5) à la pointe.
    expect(g.vent.slice(0, 6).every((v) => v === 0)).toBe(true)
    expect(g.vent[6]).toBeCloseTo(0.1)
    expect([...g.feuille.slice(9, 11)]).toEqual([0, 0.5])
    expect([...g.indices]).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7])
  })

  it('monte un maillage par côté du parc et par tronçon, une matière greffée', () => {
    const ms = monterLierre(new Scene(new NullEngine()))
    expect(new Set(ms.map((m) => m.name.split('-')[0]))).toEqual(new Set(['lierre:0', 'lierre:1', 'lierre:2', 'lierre:3']))
    expect(ms.length).toBeGreaterThan(8)
    expect(ms.reduce((n, m) => n + m.getTotalIndices() / 3, 0)).toBe(2 * 78102)
    expect(new Set(ms.map((m) => m.material)).size).toBe(1)
    expect(ms[0].material?.pluginManager?.getPlugin('Lierre')).toBeTruthy()
    expect(ms.every((m) => m.isVerticesDataPresent('aFeuille') && m.isVerticesDataPresent('aVent'))).toBe(true)
  })
})
