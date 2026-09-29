/**
 * Le mobilier : chaque banc dans sa salle, hors des passages, des escaliers,
 * des bornes et de l'eau ; et la marche qui le contourne au lieu de s'y cogner.
 */
import { describe, expect, it } from 'vitest'

import { presDeLEau } from '../jardin'
import { MOBILIER, contourner, coupe, emprise, garniture, obstaclesDuMobilier, type Meuble } from '../mobilier'
import { MUSEE } from '../musee'
import { parkPlacements } from '../park'
import { lieuxCalmes } from '../promenade'
import { PARC, PASSABLE, surfaceAt } from '../rules'
import { passages } from '../tour'
import type { Rect } from '../types'
import { OBSTACLES_BORNES } from '../vitrines'

const touche = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.z < b.z + b.depth && b.z < a.z + a.depth
const gonfler = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, width: r.width + 2 * m, depth: r.depth + 2 * m })
const coins = (r: Rect): [number, number][] => [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]]
const niveau = (m: Meuble) => MUSEE.levels.find((l) => l.id === m.niveau)!
const nom = (m: Meuble) => `${m.piece} en ${m.surface} (${m.x}, ${m.z})`

/** Devant et derrière chaque ouverture praticable : sa largeur, 1,20 m de part et d'autre du mur. */
function degagements(levelId: number): Rect[] {
  const level = MUSEE.levels.find((l) => l.id === levelId)!
  return level.openings.filter((o) => PASSABLE.has(o.kind)).map((o) => {
    const a = level.rooms.find((r) => r.id === o.a)!
    const vertical = Math.abs(o.x - a.x) < 1e-6 || Math.abs(o.x - a.x - a.width) < 1e-6
    return vertical ? { x: o.x - 1.2, z: o.z - o.width / 2, width: 2.4, depth: o.width } : { x: o.x - o.width / 2, z: o.z - 1.2, width: o.width, depth: 2.4 }
  })
}

describe('MOBILIER', () => {
  it('pose chaque meuble tout entier sur sa surface, à la cote de son sol', () => {
    for (const m of MOBILIER) {
      const cote = m.surface === PARC ? 0 : niveau(m).elevation
      for (const [x, z] of coins(emprise(m))) expect(surfaceAt(MUSEE, x, z, cote), nom(m)).toBe(m.surface)
      if (m.surface !== PARC) expect(m.y, nom(m)).toBe(niveau(m).elevation)
    }
  })

  it('met une banquette dans chaque galerie, dans son axe long, à deux mètres des murs', () => {
    for (const level of MUSEE.levels)
      for (const r of level.rooms.filter((r) => r.kind === 'gallery')) {
        const ici = MOBILIER.filter((m) => m.surface === `${level.id}:${r.id}`)
        expect(ici.map((m) => m.piece), r.id).toEqual(['Banquette'])
        const e = emprise(ici[0])
        expect(e.width > e.depth, r.id).toBe(r.width > r.depth)
        expect(e.x - r.x).toBeGreaterThanOrEqual(2)
        expect(e.z - r.z).toBeGreaterThanOrEqual(2)
        expect(r.x + r.width - e.x - e.width).toBeGreaterThanOrEqual(2)
        expect(r.z + r.depth - e.z - e.depth).toBeGreaterThanOrEqual(2)
      }
  })

  it('laisse libres, à 90 cm près, les lignes de porte à porte et de porte au centre de chaque salle', () => {
    const g = passages(MUSEE)
    for (const m of MOBILIER.filter((m) => m.piece === 'Banquette' || m.piece === 'BancBatllo')) {
      const room = niveau(m).rooms.find((r) => `${m.niveau}:${r.id}` === m.surface)!
      const portes = (g.get(m.surface) ?? []).map((p) => p.points[0])
      const noeuds = [...portes, [room.x + room.width / 2, room.z + room.depth / 2] as [number, number]]
      const bloc = gonfler(emprise(m), 0.9)
      for (const a of noeuds) for (const b of noeuds) if (a !== b) expect(coupe(a, b, bloc), `${nom(m)} : ${a} → ${b}`).toBe(false)
    }
  })

  it('ne touche ni le dégagement d’une porte, ni un escalier, ni une borne des vitrines', () => {
    for (const m of MOBILIER) {
      const e = emprise(m)
      for (const d of degagements(m.niveau)) expect(touche(e, d), `${nom(m)} devant une porte`).toBe(false)
      for (const f of [...MUSEE.flights, ...MUSEE.landings]) expect(touche(e, gonfler(f, 1)), `${nom(m)} au pied de ${f.id}`).toBe(false)
      // Le cordon, lui, est là pour les vitrines : il passe entre la toile et sa borne.
      if (m.niveau === 1 && m.piece !== 'Cordon') for (const b of OBSTACLES_BORNES) expect(touche(e, gonfler(b, 1.5)), `${nom(m)} contre une borne`).toBe(false)
    }
  })

  it('laisse libres l’allée de la nef, ses couloirs latéraux, l’axe de l’entrée et le passage de la salle d’honneur', () => {
    const libres: [string, Rect][] = [
      ['0:hall', { x: 22.4, z: 12, width: 3.2, depth: 28 }],
      ['0:hall', { x: 16, z: 12, width: 3, depth: 28 }],
      ['0:hall', { x: 29, z: 12, width: 2, depth: 24 }],
      [PARC, { x: 21.8, z: 40, width: 4.4, depth: 45 }],
      ['1:honneur', { x: 16, z: 5, width: 16, depth: 2 }],
    ]
    for (const m of MOBILIER) for (const [s, r] of libres) if (m.surface === s) expect(touche(emprise(m), r), nom(m)).toBe(false)
  })

  it('pose les bancs de la nef entre les bandes de granit, hors de l’axe des portes', () => {
    for (const m of MOBILIER.filter((m) => m.piece === 'BancNef')) {
      const e = emprise(m)
      // Les bandes en travers, tous les 3,50 m depuis z = 12, larges de 18 cm.
      for (let z = 12; z <= 40; z += 3.5) expect(touche(e, { x: 16, z: z - 0.09, width: 16, depth: 0.18 }), nom(m)).toBe(false)
      for (const z of [24, 34]) expect(touche(e, { x: 16, z: z - 1.2, width: 16, depth: 2.4 }), nom(m)).toBe(false)
    }
  })

  it('garde les bancs du jardin au sec, à un mètre au moins de l’eau, et posés sur la pelouse', () => {
    for (const m of MOBILIER.filter((m) => m.surface === PARC)) {
      for (const [x, z] of coins(gonfler(emprise(m), 1))) expect(presDeLEau(x, z), nom(m)).toBe(false)
      expect(Number.isFinite(m.y)).toBe(true)
    }
  })

  it('tient les potelets dans l’emprise du cordon, le cordon entre la toile et la borne', () => {
    for (const m of MOBILIER.filter((m) => m.piece === 'Cordon')) {
      const e = gonfler(emprise(m), 1e-9)
      const g = garniture(m)
      expect(g.length, nom(m)).toBeGreaterThan(2)
      for (const p of g) expect(touche(e, { x: p.x, z: p.z, width: 0, depth: 0 }), `${p.piece} de ${nom(m)}`).toBe(true)
    }
    const cordon = emprise(MOBILIER.find((m) => m.piece === 'Cordon')!)
    for (const b of OBSTACLES_BORNES) expect(cordon.z + cordon.depth).toBeLessThan(b.z - 0.6)
  })

  it('fait de chaque emprise un obstacle de son niveau', () => {
    for (const level of MUSEE.levels) {
      const attendus = obstaclesDuMobilier(level.id)
      expect(attendus.length).toBeGreaterThan(0)
      for (const r of attendus) expect(level.obstacles).toContainEqual(r)
    }
  })
})

describe('contourner', () => {
  it('traverse la nef en diagonale sans couper un banc', () => {
    const [a, b]: [number, number][] = [[16.8, 34], [31.2, 24]]
    const blocs = MOBILIER.filter((m) => m.surface === '0:hall').map((m) => gonfler(emprise(m), 0.3))
    expect(blocs.some((r) => coupe(a, b, r))).toBe(true)
    const pts = contourner('0:hall', a, b)
    expect(pts[pts.length - 1]).toEqual(b)
    let ici = a
    for (const p of pts) {
      for (const r of blocs) expect(coupe(ici, p, r), `${ici} → ${p}`).toBe(false)
      ici = p
    }
  })

  it('va droit quand rien ne gêne', () => {
    expect(contourner('0:hall', [24, 38], [24, 22])).toEqual([[24, 22]])
  })

  it('sort de la marge d’un banc où il se tient, et le contourne au lieu de le traverser', () => {
    // Au pied du banc du jardin (36,5 ; 47,6), dans sa marge, et l'arbre de l'autre côté.
    const banc = emprise(MOBILIER.find((m) => m.piece === 'BancJardin' && m.x === 36.5)!)
    const [a, b]: [number, number][] = [[36.75, 48.15], [36.3, 46.3]]
    const pts = contourner(PARC, a, b)
    expect(pts.length).toBeGreaterThan(1)
    let ici = a
    for (const p of pts) {
      expect(coupe(ici, p, banc), `${ici} → ${p}`).toBe(false)
      ici = p
    }
  })
})

describe('les lieux de Bavette', () => {
  const lieux = lieuxCalmes(MUSEE, parkPlacements(MUSEE))
  it('en compte au pied des bancs, jamais dans un meuble', () => {
    expect(lieux.filter((l) => l.genre === 'banc').length).toBeGreaterThan(1)
    for (const l of lieux)
      for (const m of MOBILIER.filter((m) => m.surface === l.surface))
        expect(touche(gonfler(emprise(m), 0.3), { x: l.x, z: l.z, width: 0, depth: 0 }), `${l.genre} en ${l.x}, ${l.z}`).toBe(false)
  })
})
