/**
 * L'extrusion du rez-de-chaussée : les portes restent ouvertes en 3D.
 *
 * On lit les boîtes rendues par `meshLevel` : aucune ne doit boucher une porte
 * sous le linteau, chaque porte a son linteau, et la dalle couvre l'emprise.
 */
import { describe, expect, it } from 'vitest'

import { meshLevel, type Box } from '../mesh.ts'
import { EXT } from '../svg.ts'
import { MUSEE } from '../musee.ts'

const boxes = meshLevel(MUSEE, 0)
const niveau = MUSEE.levels.find((l) => l.id === 0)!
const portes = niveau.openings.filter((o) => o.kind === 'door' || o.kind === 'entrance')

/** L'axe d'une ouverture : verticale si elle tombe sur un bord ouest ou est de sa salle. */
const verticale = (o: (typeof portes)[number]) => {
  const r = niveau.rooms.find((s) => s.id === o.a)!
  return Math.abs(o.x - r.x) < 1e-6 || Math.abs(o.x - r.x - r.width) < 1e-6
}
/** Le rectangle au sol d'une ouverture : sa largeur × l'épaisseur maximale d'une façade. */
const tableau = (o: (typeof portes)[number]) =>
  verticale(o)
    ? { x0: o.x - 0.45, x1: o.x + 0.45, z0: o.z - o.width / 2, z1: o.z + o.width / 2 }
    : { x0: o.x - o.width / 2, x1: o.x + o.width / 2, z0: o.z - 0.45, z1: o.z + 0.45 }
const chevauche = (b: Box, r: ReturnType<typeof tableau>) =>
  b.x - b.w / 2 < r.x1 - 1e-6 && b.x + b.w / 2 > r.x0 + 1e-6 && b.z - b.d / 2 < r.z1 - 1e-6 && b.z + b.d / 2 > r.z0 + 1e-6

describe('meshLevel au rez-de-chaussée', () => {
  it('ne pose aucun mur dans une porte', () => {
    expect(portes.length).toBeGreaterThan(0)
    for (const o of portes)
      expect(boxes.filter((b) => b.kind === 'wall' && b.y - b.h / 2 < 2.4 && chevauche(b, tableau(o))), `${o.a}/${o.b}`).toEqual([])
  })

  it('pose un linteau de 2,40 m au haut du mur au-dessus de chaque porte', () => {
    const haut = MUSEE.storey - MUSEE.slab
    for (const o of portes) {
      const l = boxes.filter((b) => b.kind === 'lintel' && chevauche(b, tableau(o)))
      expect(l, `${o.a}/${o.b}`).toHaveLength(1)
      expect(l[0].y - l[0].h / 2).toBeCloseTo(2.4)
      expect(l[0].y + l[0].h / 2).toBeCloseTo(haut)
      expect(verticale(o) ? l[0].d : l[0].w).toBeCloseTo(o.width)
    }
  })

  it('pose une dalle qui couvre l\'emprise, dessus au plancher', () => {
    const [dalle] = boxes.filter((b) => b.kind === 'slab')
    expect(dalle).toMatchObject({ x: 24, z: 20, w: 48, d: 40, h: MUSEE.slab })
    expect(dalle.y + dalle.h / 2).toBeCloseTo(niveau.elevation)
  })

  it('monte les murs du plancher au plafond', () => {
    const murs = boxes.filter((b) => b.kind === 'wall')
    expect(murs.length).toBeGreaterThan(0)
    for (const m of murs) {
      expect(m.y - m.h / 2).toBeCloseTo(niveau.elevation)
      expect(m.h).toBeCloseTo(MUSEE.storey - MUSEE.slab)
    }
  })

  it('ne bâtit pas de mur sous le palier : un obstacle arrête la marche, pas le regard', () => {
    const sous = boxes.filter((b) => b.kind === 'wall' && b.x > 16 + 0.5 && b.x < 32 - 0.5 && b.z > 12 + 0.5 && b.z < 20)
    expect(sous).toEqual([])
  })

  it('ferme la façade jusqu\'aux angles extérieurs', () => {
    const murs = boxes.filter((b) => b.kind === 'wall')
    expect(Math.min(...murs.map((b) => b.x - b.w / 2))).toBeCloseTo(-EXT)
    expect(Math.max(...murs.map((b) => b.x + b.w / 2))).toBeCloseTo(MUSEE.width + EXT)
    expect(Math.min(...murs.map((b) => b.z - b.d / 2))).toBeCloseTo(-EXT)
    expect(Math.max(...murs.map((b) => b.z + b.d / 2))).toBeCloseTo(MUSEE.depth + EXT)
  })
})
