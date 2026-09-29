import { expect, it } from 'vitest'

import { facade } from '../facade'
import { cleDeBoite, coordonneesDeFace, emballer, facesVisibles, MARGE, surfacesCuites } from '../lumiere'
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
