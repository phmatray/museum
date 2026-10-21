import { expect, it } from 'vitest'

import { facade } from '../facade'
import { cleDeBoite, coordonneesDeFace, emballer, facesVisibles, MARGE, rectsHerites, surfacesCuites } from '../lumiere'
import { meshLevel } from '../mesh'
import LUMIERE_JSON from '../lumiere.json' with { type: 'json' }
import { MUSEE } from '../musee'

const surfaces = surfacesCuites(MUSEE)
const f = facade(MUSEE)
const visibles = facesVisibles(MUSEE, surfaces, [...f.brique, ...f.pierre, ...f.piliers, ...f.menuiseries])

it('range chaque face visible dans l’atlas, sans chevauchement, marges comprises', () => {
  const atlas = emballer(surfaces, visibles, 14, 4096, 4096)
  expect(atlas).not.toBeNull()
  const rects = atlas!.rects.flat().filter((r) => r !== null)
  expect(rects).toHaveLength(visibles.flat().length)
  const avecMarge = rects.map(([a, b, c, d]) => [a - MARGE, b - MARGE, c + MARGE, d + MARGE])
  for (const [a, b, c, d] of avecMarge) expect(a >= 0 && b >= 0 && c <= 4096 && d <= atlas!.hauteur).toBe(true)
  for (let i = 0; i < avecMarge.length; i++)
    for (let j = i + 1; j < avecMarge.length; j++) {
      const [p, q] = [avecMarge[i], avecMarge[j]]
      expect(p[2] <= q[0] || q[2] <= p[0] || p[3] <= q[1] || q[3] <= p[1]).toBe(true)
    }
})

it('ne cuit ni le dessous du rez-de-chaussée, ni un mur sous sa peinture, mais bien le sol de la nef', () => {
  const hall = surfaces.findIndex((s) => s.matiere === 'terrazzo')
  expect(visibles[hall]).toContain(2)
  expect(visibles[hall]).not.toContain(3)
  // Le plus grand mur de galerie repeint : sa face peinte appartient à la peinture.
  const peints = surfaces.filter((s) => s.matiere.startsWith('#'))
  expect(peints.length).toBeGreaterThan(50)
  expect(visibles.flat().length).toBeLessThan(surfaces.length * 6 * 0.6)
})

it('partage la convention (s, t) des faces avec la cuisson : chaque face couvre [0, 1]²', () => {
  for (const face of [0, 1, 2, 3, 4, 5] as const) {
    const n = [0, 0, 0]
    n[face >> 1] = face % 2 === 0 ? 0.5 : -0.5
    const coins = [-0.5, 0.5].flatMap((a) => [-0.5, 0.5].map((b) => {
      const p = [...n] as [number, number, number]
      const libres = [0, 1, 2].filter((k) => k !== face >> 1)
      p[libres[0]] = a
      p[libres[1]] = b
      return coordonneesDeFace(face, p)
    }))
    expect(new Set(coins.map((c) => c.join()))).toEqual(new Set(['0,0', '0,1', '1,0', '1,1']))
  }
})

it('l’atlas commité connaît presque toutes les boîtes d’aujourd’hui (sinon : npm run bake)', () => {
  const connues = surfaces.filter((s) => cleDeBoite(s.boite) in LUMIERE_JSON.boites).length
  expect(connues / surfaces.length).toBeGreaterThan(0.8)
})

it('rend à la dalle du hall, découpée par la trémie du sous-sol, la tranche de sa lumière cuite', () => {
  const boites = LUMIERE_JSON.boites as Record<string, (number[] | number)[]>
  // La dalle entière du hall, telle que cuite : x 16–32, z 12–40.
  const entiere = boites[cleDeBoite({ x: 24, y: -0.15, z: 26, w: 16, h: 0.3, d: 28, kind: 'slab' })] as number[][]
  expect(Array.isArray(entiere[2])).toBe(true)
  const sud = meshLevel(MUSEE, 0).find((b) => b.kind === 'slab' && b.x === 24 && b.z === 30)!
  expect(boites[cleDeBoite(sud)]).toBeUndefined()
  const r = rectsHerites(sud, boites)!
  // z 20–40 : les cinq septièmes sud du rectangle du dessus, toute sa largeur.
  const [a, b, c, d] = entiere[2]
  expect(r[2]).toEqual([a, expect.closeTo(b + (d - b) * (8 / 28), 6), c, d])
  expect([r[0], r[1], r[4], r[5]]).toEqual([0, 0, 0, 0])
  // Une boîte qu'aucune boîte cuite ne contient n'hérite de rien.
  expect(rectsHerites({ x: 9.5, y: -4.95, z: 11, w: 13, h: 0.3, d: 18, kind: 'slab' }, boites)).toBeUndefined()
})
