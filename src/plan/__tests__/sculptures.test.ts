/**
 * Les sculptures du plan : une pièce dans le hall, sur son socle, là où
 * la marche ne peut pas la traverser.
 *
 * Le musée publié n'en expose plus dans le hall — Bavette se promène
 * désormais librement (`promenade.ts`) —, mais la config d'un fork peut en
 * déclarer : on éprouve le placement sur une pièce d'essai. Les siennes vont
 * aux vitrines de la salle d'honneur, à côté de leur projet.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { Catalogue } from '../../domain/types.ts'
import { MUSEE } from '../musee.ts'
import { sculpturePlacements, sculpturesDesVitrines } from '../sculptures.ts'
import { choisirVitrines, OBSTACLES_BORNES, OBSTACLES_SOCLES, SALLE_VITRINES, SOCLE, VITRINES } from '../vitrines.ts'
import { step, type Walker } from '../walk.ts'

const dans = (r: { x: number; z: number; width: number; depth: number }, x0: number, x1: number, z0: number, z1: number) =>
  x0 >= r.x && x1 <= r.x + r.width && z0 >= r.z && z1 <= r.z + r.depth

const ESSAI = {
  id: 'bavette',
  file: 'bavette.glb',
  height: 0.65,
  facing: 'south',
  plinth: { width: 1.1, depth: 1.1, height: 0.25 },
  cartel: { author: 'Philippe Matray', title: 'Bavette', year: 2026, medium: 'Modèle 3D', credit: "Collection de l'artiste" },
}

describe('sculpturePlacements', () => {
  const placements = sculpturePlacements(MUSEE, [ESSAI])
  const bavette = placements.find((p) => p.id === 'bavette')

  it('ne pose rien quand la config n’en déclare pas — le musée publié', () => {
    expect(sculpturePlacements(MUSEE)).toEqual([])
  })

  it('pose Bavette dans le hall, au rez-de-chaussée', () => {
    expect(bavette).toBeDefined()
    const p = bavette!
    const hall = MUSEE.levels[0].rooms.find((r) => r.id === 'hall')!
    const [x0, x1, z0, z1] = [p.x - p.plinth.width / 2, p.x + p.plinth.width / 2, p.z - p.plinth.depth / 2, p.z + p.plinth.depth / 2]
    expect(p.y).toBe(0)
    expect(dans(hall, x0, x1, z0, z1)).toBe(true)
  })

  it('pose chaque socle dans un obstacle du plan : la marche le contourne', () => {
    for (const p of placements) {
      const [x0, x1, z0, z1] = [p.x - p.plinth.width / 2, p.x + p.plinth.width / 2, p.z - p.plinth.depth / 2, p.z + p.plinth.depth / 2]
      expect(MUSEE.levels[0].obstacles.some((o) => dans(o, x0, x1, z0, z1))).toBe(true)
    }
  })

  it('un visiteur qui marche droit sur Bavette s’arrête avant le socle', () => {
    const p = bavette!
    let w: Walker = { ...MUSEE.spawn, surface: '0:hall', y: 0, yaw: 0 }
    for (let t = 0; t < 30; t += 1 / 60) {
      const yaw = Math.atan2(-(p.x - w.x), -(p.z - w.z))
      w = step(MUSEE, w, { forward: 1, strafe: 0, yaw }, 1 / 60)
      expect(Math.abs(w.x - p.x) < p.plinth.width / 2 && Math.abs(w.z - p.z) < p.plinth.depth / 2).toBe(false)
    }
    // Il est venu tout près : la pièce se regarde à moins de deux mètres.
    expect(Math.hypot(w.x - p.x, w.z - p.z)).toBeLessThan(2)
  })

  it('tourne la pièce vers le sud, face à l’entrée', () => {
    expect(bavette!.rotation).toBe(0)
  })
})

describe('sculpturesDesVitrines', () => {
  const catalogue = JSON.parse(readFileSync('public/data/catalogue.json', 'utf8')) as Catalogue
  const projets = choisirVitrines(catalogue.artworks, catalogue.owners).map((a) => a.key)
  const pieces = sculpturesDesVitrines(projets)
  const honneur = MUSEE.levels[1].rooms.find((r) => r.id === SALLE_VITRINES)!

  it('donne sa pièce à chaque projet des vitrines, dans le rang de sa vitrine', () => {
    expect(pieces.map((p) => p.project)).toEqual(projets)
    pieces.forEach((p, rang) => expect(p.x).toBeCloseTo(VITRINES[rang].x + SOCLE.u))
  })

  it('ne montre rien pour un projet sans pièce déclarée', () => {
    expect(sculpturesDesVitrines(['quelqu-un/autre-chose', projets[1]]).map((p) => p.project)).toEqual([projets[1]])
  })

  it('pose chaque socle dans son emplacement, un obstacle de la salle d’honneur', () => {
    expect(MUSEE.levels[1].obstacles).toEqual(expect.arrayContaining(OBSTACLES_SOCLES))
    for (const p of pieces) {
      const [x0, x1, z0, z1] = [p.x - p.plinth.width / 2, p.x + p.plinth.width / 2, p.z - p.plinth.depth / 2, p.z + p.plinth.depth / 2]
      expect(p.y).toBe(MUSEE.levels[1].elevation)
      expect(dans(honneur, x0, x1, z0, z1)).toBe(true)
      expect(OBSTACLES_SOCLES.some((o) => dans(o, x0, x1, z0, z1))).toBe(true)
    }
  })

  it('laisse du jeu entre chaque socle et chaque borne', () => {
    for (const s of OBSTACLES_SOCLES) {
      for (const b of OBSTACLES_BORNES) {
        const ecart = Math.max(b.x - (s.x + s.width), s.x - (b.x + b.width), b.z - (s.z + s.depth), s.z - (b.z + b.depth))
        expect(ecart).toBeGreaterThan(0.4)
      }
    }
  })

  it('tient chaque pièce à l’échelle d’un bronze de musée : 0,8 à 1,5 m, 1,6 à 2,4 m socle compris', () => {
    for (const p of pieces) {
      expect(p.height).toBeGreaterThanOrEqual(0.8)
      expect(p.height).toBeLessThanOrEqual(1.5)
      expect(p.height + p.plinth.height).toBeGreaterThanOrEqual(1.6)
      expect(p.height + p.plinth.height).toBeLessThanOrEqual(2.4)
    }
  })

  it('la pose devant son panneau, à 1,5–2 m, et laisse le passage vers les bancs', () => {
    pieces.forEach((p, rang) => {
      const recul = p.z - VITRINES[rang].z
      expect(recul).toBeGreaterThanOrEqual(1.5)
      expect(recul).toBeLessThanOrEqual(2.3)
      // Du devant du socle au dossier des bancs Batlló : bien plus que 2 m.
      const bancs = MUSEE.levels[1].obstacles.filter((o) => o.z > 6 && o.z < 10 && o.x > 16 && o.x < 32)
      for (const b of bancs) expect(b.z - (p.z + p.plinth.depth / 2)).toBeGreaterThan(2)
    })
  })
})
