import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../hang'
import { MUSEE } from '../musee'
import { parkPlacements } from '../park'
import { avancerPnj, monde, pnjInitiaux, VITESSE_PNJ, type Pilote, type Pnj, type Point3 } from '../pnj'
import { lieuxCalmes } from '../promenade'
import { PARC, surfaceAt } from '../rules'

const ACCROCHAGE = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage
const M = monde(MUSEE, ACCROCHAGE, lieuxCalmes(MUSEE, parkPlacements(MUSEE)))

/** Un pilote de banc d'essai : tout point est sur le sol, on y va en ligne droite (la vraie foule : babylon/navigation.ts). */
function piloteDroit(): Pilote & { avancer(p: Pnj, dt: number): void } {
  const buts = new Map<Pnj, Point3 | null>()
  return {
    aller(p, x, y, z) {
      buts.set(p, [x, y, z])
      return [x, y, z]
    },
    arreter(p) {
      buts.set(p, null)
    },
    avancer(p, dt) {
      const b = buts.get(p)
      if (!b) return
      const d = Math.hypot(b[0] - p.w.x, b[2] - p.w.z)
      const k = Math.min(1, (VITESSE_PNJ * dt) / (d || 1))
      p.w.x += (b[0] - p.w.x) * k
      p.w.z += (b[2] - p.w.z) * k
      p.w.y = b[1]
    },
  }
}

describe('les visiteurs PNJ', () => {
  it('ont des toiles et des coins de jardin à viser', () => {
    expect(M.toiles.length).toBeGreaterThan(80)
    expect(M.jardin.length).toBeGreaterThan(3)
    expect(M.jardin.every((d) => d.surface === PARC)).toBe(true)
  })

  it('partent de places toutes différentes, devant des toiles ou au jardin', () => {
    const pnj = pnjInitiaux(M, { musee: 8, jardin: 4 }, 8, 42)
    expect(pnj).toHaveLength(12)
    expect(new Set(pnj.map((p) => `${p.w.x.toFixed(2)},${p.w.z.toFixed(2)}`)).size).toBe(12)
    expect(pnj.filter((p) => p.zone === 'jardin').every((p) => surfaceAt(MUSEE, p.w.x, p.w.z, 0) === PARC)).toBe(true)
    expect(new Set(pnj.map((p) => p.modele)).size).toBe(8)
  })

  it('cinq minutes de vie : ils vont de toile en toile, se tournent vers elles, et le jardin suit son circuit', () => {
    const pnj = pnjInitiaux(M, { musee: 8, jardin: 4 }, 8, 7)
    const pilote = piloteDroit()
    const arrets = new Map(pnj.map((p) => [p, 0]))
    const etapes = new Map(pnj.map((p) => [p, new Set<number>()]))
    const dt = 1 / 20
    for (let t = 0; t < 300; t += dt)
      for (const p of pnj) {
        pilote.avancer(p, dt)
        const etait = p.activite
        avancerPnj(M, p, dt, pilote)
        if (etait === 'marche' && p.activite === 'regarde') {
          arrets.set(p, arrets.get(p)! + 1)
          // Arrivé devant une toile : il la regarde.
          if (p.zone === 'musee') expect(p.w.yaw).toBe(p.destination!.cap)
        }
        if (p.zone === 'jardin') etapes.get(p)!.add(p.etape)
      }
    const auMusee = pnj.filter((p) => p.zone === 'musee')
    expect(auMusee.reduce((n, p) => n + arrets.get(p)!, 0)).toBeGreaterThanOrEqual(auMusee.length * 4)
    for (const p of pnj.filter((p) => p.zone === 'jardin')) expect(etapes.get(p)!.size, `PNJ ${p.n}`).toBeGreaterThan(5)
  })

  it('coincé, il change d\'idée ; sans destination atteignable, il attend', () => {
    const [p] = pnjInitiaux(M, { musee: 1, jardin: 0 }, 8, 3)
    const nulle: Pilote = { aller: () => null, arreter: () => {} }
    p.reste = 0
    avancerPnj(M, p, 0.1, nulle)
    expect(p.activite).toBe('attente')
    // Un pilote qui accepte mais ne bouge jamais le PNJ : au bout de quelques secondes, nouvelle destination.
    let demandes = 0
    const fige: Pilote = { aller: (_, x, y, z) => (demandes++, [x, y, z]), arreter: () => {} }
    for (let t = 0; t < 10; t += 0.1) avancerPnj(M, p, 0.1, fige)
    expect(demandes).toBeGreaterThan(2)
  })
})
