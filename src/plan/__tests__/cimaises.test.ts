/**
 * Les cimaises modulables : dans chaque galerie chargée, hors des portes et
 * des passages, à 3 m des murs, infranchissables, et accrochées comme un mur — sans qu'une toile, son
 * cadre ou son cartel déborde du panneau ni ne touche sa voisine.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { FRAME_BORDER } from '../../builders/artwork.ts'
import { SALLE_ATELIERS } from '../ateliers.ts'
import { CARTEL_LARGEUR, cartelPlacements } from '../cartels.ts'
import { CIMAISES, MARGE_ANGLE, MODULE, boitesDesCimaises, cimaiseSous, emprise, faces, placesDesCimaises, type Cimaise } from '../cimaises.ts'
import type { Accrochage } from '../hang.ts'
import { coupe, emprise as empriseMeuble, MOBILIER } from '../mobilier.ts'
import { MUSEE } from '../musee.ts'
import { projecteurs, rails, RECUL } from '../projecteurs.ts'
import { capacity, NORMES, PASSABLE } from '../rules.ts'
import { INT } from '../svg.ts'
import { passages } from '../tour.ts'
import type { Rect } from '../types.ts'
import { step, type Walker } from '../walk.ts'

const accrochage: Accrochage = JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/accrochage.json'), 'utf8'))

const salle = (c: Cimaise) => MUSEE.levels.find((l) => l.id === c.niveau)!.rooms.find((r) => r.id === c.salle)!
const nom = (c: Cimaise) => `cimaise ${c.salle} (${c.x}, ${c.z})`
const gonfler = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, width: r.width + 2 * m, depth: r.depth + 2 * m })
/** Distance entre deux rectangles (0 s'ils se touchent). */
const distance = (a: Rect, b: Rect) =>
  Math.hypot(Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width), Math.max(0, a.z - b.z - b.depth, b.z - a.z - a.depth))

describe('CIMAISES', () => {
  it('ne va que dans des galeries de 16 × 12 à 14 m, une à trois lignes par salle', () => {
    expect(CIMAISES.length).toBeGreaterThan(0)
    for (const c of CIMAISES) {
      const r = salle(c)
      expect(r.kind, nom(c)).toBe('gallery')
      expect(r.width * r.depth, nom(c)).toBeGreaterThanOrEqual(16 * 12)
    }
    for (const c of CIMAISES) expect(CIMAISES.filter((d) => d.niveau === c.niveau && d.salle === c.salle).length, nom(c)).toBeLessThanOrEqual(3)
  })

  it('laisse au moins 3 m entre chaque cimaise et chaque mur : de quoi reculer devant une toile de l’un comme de l’autre', () => {
    for (const c of CIMAISES) {
      const [r, e] = [salle(c), emprise(c)]
      expect(e.x - (r.x + INT), nom(c)).toBeGreaterThanOrEqual(3)
      expect(e.z - (r.z + INT), nom(c)).toBeGreaterThanOrEqual(3)
      expect(r.x + r.width - INT - (e.x + e.width), nom(c)).toBeGreaterThanOrEqual(3)
      expect(r.z + r.depth - INT - (e.z + e.depth), nom(c)).toBeGreaterThanOrEqual(3)
    }
  })

  it('laisse au moins 2 m de circulation autour des autres cimaises et des bancs', () => {
    for (const c of CIMAISES) {
      // Deux lignes perpendiculaires qui se touchent ne font qu'une cimaise en équerre.
      const equerre = (d: Cimaise) => d.axe !== c.axe && distance(emprise(c), emprise(d)) === 0
      const autres = [
        ...CIMAISES.filter((d) => d !== c && d.niveau === c.niveau && d.salle === c.salle && !equerre(d)).map(emprise),
        ...MOBILIER.filter((m) => m.surface === `${c.niveau}:${c.salle}`).map(empriseMeuble),
      ]
      for (const o of autres) expect(distance(emprise(c), o), nom(c)).toBeGreaterThanOrEqual(2)
    }
  })

  it('reste à 2 m de chaque porte et ne coupe aucune ligne de porte à porte ni de porte au centre', () => {
    const g = passages(MUSEE)
    for (const c of CIMAISES) {
      const level = MUSEE.levels.find((l) => l.id === c.niveau)!
      const r = salle(c)
      for (const o of level.openings.filter((o) => PASSABLE.has(o.kind) && (o.a === c.salle || o.b === c.salle))) {
        const vertical = Math.abs(o.x - r.x) < 1e-6 || Math.abs(o.x - r.x - r.width) < 1e-6
        const baie: Rect = vertical ? { x: o.x, z: o.z - o.width / 2, width: 0, depth: o.width } : { x: o.x - o.width / 2, z: o.z, width: o.width, depth: 0 }
        expect(distance(emprise(c), baie), `${nom(c)} / porte ${o.a}-${o.b}`).toBeGreaterThanOrEqual(2)
      }
      // Les lignes que suivent la visite et Bavette, avec la marge d'un visiteur et plus.
      const portes = (g.get(`${c.niveau}:${c.salle}`) ?? []).map((p) => p.points[0])
      const noeuds = [...portes, [r.x + r.width / 2, r.z + r.depth / 2] as [number, number]]
      for (const a of noeuds) for (const b of noeuds) if (a !== b) expect(coupe(a, b, gonfler(emprise(c), 0.9)), `${nom(c)} : ${a} → ${b}`).toBe(false)
    }
  })

  it('est un obstacle de son niveau, et la marche ne la traverse pas', () => {
    for (const c of CIMAISES) {
      const level = MUSEE.levels.find((l) => l.id === c.niveau)!
      expect(level.obstacles, nom(c)).toContainEqual(emprise(c))
      // De part et d'autre du milieu, on fonce droit dessus pendant quatre secondes.
      for (const s of [1, -1]) {
        const [x, z] = c.axe === 'x' ? [c.x, c.z + s * 1.2] : [c.x + s * 1.2, c.z]
        const yaw = c.axe === 'x' ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2)
        let w: Walker = { level: c.niveau, surface: `${c.niveau}:${c.salle}`, x, z, y: level.elevation, yaw }
        for (let t = 0; t < 4; t += 1 / 120) w = step(MUSEE, w, { forward: 1, strafe: 0, yaw, hate: true }, 1 / 120)
        const cote = c.axe === 'x' ? w.z - c.z : w.x - c.x
        expect(Math.sign(cote), nom(c)).toBe(s)
        expect(Math.abs(cote), nom(c)).toBeGreaterThanOrEqual(0.29)
      }
    }
  })

  it('compte ses deux faces dans la capacité de sa salle, en plus de ses murs', () => {
    for (const [niveau, id] of new Set(CIMAISES.map((c) => [c.niveau, c.salle] as const))) {
      const level = MUSEE.levels.find((l) => l.id === niveau)!
      const r = level.rooms.find((s) => s.id === id)!
      // La même salle sous un autre nom, que `cimaisesDe` ne trouve pas : ses murs seuls.
      const nu = (x: string | null) => (x === id ? '_' : x)
      const sans = { ...level, openings: level.openings.map((o) => ({ ...o, a: nu(o.a)!, b: nu(o.b) })) }
      const places = placesDesCimaises(niveau, id, NORMES.pasAccrochage)
      expect(places, id).toBeGreaterThanOrEqual(4)
      expect(capacity(r, level), id).toBe(capacity({ ...r, id: '_' }, sans) + places)
    }
  })

  it('va dans chaque galerie qui accroche plus de six dixièmes de ses murs', () => {
    for (const level of MUSEE.levels)
      // Sauf la galerie des ateliers en coupe : ils occupent la bande où irait la cimaise (ateliers.ts).
      for (const r of level.rooms.filter((r) => r.kind === 'gallery' && !(level.id === 0 && r.id === SALLE_ATELIERS))) {
        const n = accrochage.rooms.find((a) => a.level === level.id && a.id === r.id)!.placements.length
        const murs = capacity(r, level) - placesDesCimaises(level.id, r.id, NORMES.pasAccrochage)
        if (n > 0.6 * murs) expect(CIMAISES.some((c) => c.niveau === level.id && c.salle === r.id), `${r.id} : ${n} toiles pour ${murs} places`).toBe(true)
      }
  })

  it('raccourcit la face contre la branche d’une équerre et marque ses angles rentrants', () => {
    const e = MODULE.epaisseur / 2
    const ligne: Cimaise = { niveau: 0, salle: 't', x: 0, z: 0, axe: 'x', modules: 8 }
    const branche: Cimaise = { niveau: 0, salle: 't', x: 4 - e, z: e + 2, axe: 'z', modules: 4 }
    const [sud, nord] = faces(ligne, [ligne, branche])
    expect(sud).toMatchObject({ a: { x: -4, z: e }, normal: { x: 0, z: 1 }, angles: [false, true] })
    expect(sud.b.x).toBeCloseTo(4 - 2 * e)
    expect(nord).toMatchObject({ a: { x: -4 }, b: { x: 4 }, angles: [false, false] })
    const [est, ouest] = faces(branche, [ligne, branche])
    // La face est prolonge le bout de la ligne : un angle vif, pas d'angle rentrant.
    expect(est).toMatchObject({ normal: { x: 1, z: 0 }, angles: [false, false] })
    expect(ouest).toMatchObject({ normal: { x: -1, z: 0 }, angles: [true, false] })
    expect(ouest.a.z).toBeCloseTo(e)
    // Seule, chaque ligne a ses deux faces entières.
    for (const f of [...faces(ligne, [ligne]), ...faces(branche, [branche])]) expect(f.angles).toEqual([false, false])
  })

  it('donne plus de mur à la salle la plus chargée : une équerre de six places à Trading & finance', () => {
    expect(CIMAISES.filter((c) => c.niveau === 0 && c.salle === 'r-e1').map((c) => c.axe).sort()).toEqual(['x', 'z'])
    expect(placesDesCimaises(0, 'r-e1', NORMES.pasAccrochage)).toBe(6)
    expect(MARGE_ANGLE).toBeGreaterThan(0.5)
  })

  it('a des modules de 1 m, des jonctions d’aluminium à chaque joint et des pieds', () => {
    for (const niveau of [0, 1]) {
      const { panneaux, alu } = boitesDesCimaises(MUSEE, niveau)
      const ici = CIMAISES.filter((c) => c.niveau === niveau)
      const modules = ici.reduce((s, c) => s + c.modules, 0)
      expect(panneaux).toHaveLength(modules)
      // Une jonction et un pied par joint (bouts compris), une plinthe par ligne.
      expect(alu).toHaveLength(ici.reduce((s, c) => s + 2 * (c.modules + 1) + 1, 0))
      const sol = MUSEE.levels.find((l) => l.id === niveau)!.elevation
      for (const b of panneaux) expect(b.y + b.h / 2).toBeCloseTo(sol + MODULE.hauteur, 6)
    }
  })
})

describe('l’accrochage sur les cimaises', () => {
  const surCimaise = accrochage.rooms.flatMap((r) =>
    r.placements.flatMap((p) => {
      const c = cimaiseSous(r.level, r.id, p.x, p.z)
      return c ? [{ p, c }] : []
    }))
  const cartels = new Map(cartelPlacements(accrochage).map((c) => [c.key, c]))

  it('accroche au moins une toile sur chaque face', () => {
    for (const c of CIMAISES) for (const s of [1, -1]) {
      const ici = surCimaise.filter((t) => t.c === c && Math.sign(t.c.axe === 'x' ? t.p.normal[1] : t.p.normal[0]) === s)
      expect(ici.length, `${nom(c)}, face ${s}`).toBeGreaterThan(0)
    }
  })

  it('pose chaque toile sur la face, tournée vers le dehors du panneau, à la hauteur des autres', () => {
    for (const { p, c } of surCimaise) {
      const [u, v] = c.axe === 'x' ? [p.normal[0], p.z - c.z] : [p.normal[1], p.x - c.x]
      expect(u, p.key).toBe(0)
      expect(Math.sign(v), p.key).toBe(Math.sign(c.axe === 'x' ? p.normal[1] : p.normal[0]))
      expect(p.y - MUSEE.levels.find((l) => l.id === c.niveau)!.elevation, p.key).toBeCloseTo(1.55, 3)
      // Tout le cadre sous le haut du panneau.
      expect(1.55 + p.width / 4 + FRAME_BORDER, p.key).toBeLessThan(MODULE.hauteur)
    }
  })

  it('garde cadre et cartel sur le panneau, sans toucher la toile voisine', () => {
    const le = (c: Cimaise, x: number, z: number) => (c.axe === 'x' ? x - c.x : z - c.z)
    for (const c of CIMAISES) for (const s of [1, -1]) {
      const ici = surCimaise.filter((t) => t.c === c && Math.sign(c.axe === 'x' ? t.p.normal[1] : t.p.normal[0]) === s)
      // L'étendue de chaque toile le long du panneau : cadre, puis cartel.
      const etendues = ici.map(({ p }) => {
        const k = cartels.get(p.key)!
        const u = le(c, p.x, p.z)
        const uk = le(c, k.x, k.z)
        return [Math.min(u - p.width / 2 - FRAME_BORDER, uk - CARTEL_LARGEUR / 2), Math.max(u + p.width / 2 + FRAME_BORDER, uk + CARTEL_LARGEUR / 2)]
      }).sort((a, b) => a[0] - b[0])
      // La face, raccourcie contre l'autre branche d'une équerre : 10 cm de panneau au bout, 15 dans un angle.
      const f = faces(c).find((f) => (c.axe === 'x' ? f.normal.z : f.normal.x) === s)!
      const [fa, fb] = [le(c, f.a.x, f.a.z), le(c, f.b.x, f.b.z)]
      for (const [a, b] of etendues) {
        expect(a, nom(c)).toBeGreaterThanOrEqual(fa + (f.angles[0] ? 0.15 : 0.1))
        expect(b, nom(c)).toBeLessThanOrEqual(fb - (f.angles[1] ? 0.15 : 0.1))
      }
      for (let i = 1; i < etendues.length; i++) expect(etendues[i][0], nom(c)).toBeGreaterThan(etendues[i - 1][1])
    }
  })

  it('donne à chaque toile d’une cimaise un cartel, un projecteur visé sur elle et un rail à 1,60 m de sa face', () => {
    const tous = new Map(projecteurs(MUSEE, accrochage).map((p) => [p.key, p]))
    const lesRails = rails(MUSEE, accrochage)
    for (const { p } of surCimaise) {
      expect(cartels.has(p.key), p.key).toBe(true)
      const pr = tous.get(p.key)!
      expect(pr.cible).toEqual([p.x, p.y, p.z])
      const [x, z] = [p.x + p.normal[0] * RECUL, p.z + p.normal[1] * RECUL]
      expect(Math.hypot(pr.x - x, pr.z - z), p.key).toBeLessThan(1e-9)
      // Un rail passe au-dessus du projecteur, dans son sens.
      const rail = lesRails.find((b) => Math.abs(b.x - pr.x) <= b.w / 2 + 1e-9 && Math.abs(b.z - pr.z) <= b.d / 2 + 1e-9)
      expect(rail, p.key).toBeDefined()
    }
  })
})
