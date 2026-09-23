/**
 * L'extrusion des niveaux : les portes restent ouvertes en 3D, l'escalier a ses
 * marches et chaque garde-corps du plan est bâti.
 *
 * On lit les boîtes rendues par `meshLevel` : aucune ne doit boucher une porte
 * sous le linteau, chaque porte a son linteau, et les dalles couvrent l'emprise.
 */
import { describe, expect, it } from 'vitest'

import { guardrails } from '../geometry.ts'
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

  it('pose des dalles qui couvrent l\'emprise, dessus au plancher', () => {
    const dalles = boxes.filter((b) => b.kind === 'slab' && b.y + b.h / 2 === niveau.elevation)
    expect(dalles.reduce((s, b) => s + b.w * b.d, 0)).toBeCloseTo(MUSEE.width * MUSEE.depth)
    for (const d of dalles) expect(d.h).toBe(MUSEE.slab)
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

describe("meshLevel et l'escalier impérial", () => {
  const dessus = (b: Box) => b.y + b.h / 2

  it('pose 15 marches de 0,16 m par volée', () => {
    const marches = boxes.filter((b) => b.kind === 'step')
    expect(marches).toHaveLength(45)
    for (const m of marches) expect(m.h).toBeCloseTo(0.16)
    expect(Math.max(...marches.map(dessus))).toBeCloseTo(4.8)
  })

  it('bâtit un garde-corps de 1,00 m sur toute la longueur de chaque segment de guardrails()', () => {
    const rampes = boxes.filter((b) => b.kind === 'railing')
    const segments = guardrails(MUSEE, 0)
    expect(segments.length).toBeGreaterThan(0)
    for (const g of segments) {
      const long = Math.hypot(g.x2 - g.x1, g.z2 - g.z1)
      for (let t = 0.05; t < long; t += 0.25) {
        const [x, z] = [g.x1 + ((g.x2 - g.x1) * t) / long, g.z1 + ((g.z2 - g.z1) * t) / long]
        const ici = rampes.filter((b) => Math.abs(b.x - x) <= b.w / 2 + 1e-6 && Math.abs(b.z - z) <= b.d / 2 + 1e-6)
        expect(ici.length, `${JSON.stringify(g)} en ${t}`).toBeGreaterThan(0)
        expect(Math.min(...ici.map((b) => Math.min(b.w, b.d)))).toBeCloseTo(0.05)
      }
    }
  })

  it('pose le palier à sa cote', () => {
    const [palier] = boxes.filter((b) => b.kind === 'landing')
    for (const [k, v] of Object.entries({ x: 24, z: 13.75, w: 16, d: 3.5, h: MUSEE.slab }))
      expect(palier[k as keyof Box], k).toBeCloseTo(v)
    expect(dessus(palier)).toBeCloseTo(2.4)
  })
})

describe("meshLevel à l'étage noble", () => {
  const etage = meshLevel(MUSEE, 1)

  it('ne couvre pas le vide du hall', () => {
    const dalles = etage.filter((b) => b.kind === 'slab' && b.x > 19 && b.x < 29 && b.z > 12 && b.z < 37)
    expect(dalles).toEqual([])
  })

  it('ne ferme pas les balcons par des murs, ni leur arrivée', () => {
    const murs = etage.filter((b) => b.kind === 'wall')
    // Le côté du balcon ouest sur le vide (x = 19) et son arrivée (z = 20).
    expect(murs.filter((b) => Math.abs(b.x - 19) < 0.5 && b.z > 20 && b.z < 37)).toEqual([])
    expect(murs.filter((b) => Math.abs(b.z - 20) < 0.5 && b.x > 16 && b.x < 19)).toEqual([])
    expect(etage.filter((b) => b.kind === 'railing').length).toBeGreaterThan(0)
  })

  it("vitre la baie de la salle d'honneur au lieu d'un mur", () => {
    const [verre] = etage.filter((b) => b.kind === 'glass')
    expect(verre).toMatchObject({ x: 24, w: 6 })
    expect(etage.filter((b) => b.kind === 'wall' && Math.abs(b.z - 12) < 0.5 && b.x - b.w / 2 < 27 && b.x + b.w / 2 > 21)).toEqual([])
  })
})
