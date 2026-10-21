import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { Accrochage } from '../hang'
import { MUSEE } from '../musee'
import { parkPlacements } from '../park'
import { avancerPnj, monde, pnjInitiaux } from '../pnj'
import { lieuxCalmes } from '../promenade'
import { PARC, surfaceAt } from '../rules'

const ACCROCHAGE = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage
const M = monde(MUSEE, ACCROCHAGE, lieuxCalmes(MUSEE, parkPlacements(MUSEE)))

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
    expect(pnj.filter((p) => p.zone === 'jardin').every((p) => p.w.surface === PARC)).toBe(true)
    expect(new Set(pnj.map((p) => p.modele)).size).toBe(8)
  })

  it('cinq minutes de vie : ils restent sur le plan, vont de toile en toile, et personne ne reste planté', () => {
    const pnj = pnjInitiaux(M, { musee: 8, jardin: 4 }, 8, 7)
    const arrets = new Map(pnj.map((p) => [p, 0]))
    const parcouru = new Map(pnj.map((p) => [p, 0]))
    const dt = 1 / 20
    for (let t = 0; t < 300; t += dt) {
      for (const p of pnj) {
        const avant = { x: p.w.x, z: p.w.z, a: p.activite }
        const autres = pnj.filter((o) => o !== p).map((o) => ({ x: o.w.x, z: o.w.z, level: o.w.level }))
        avancerPnj(M, p, dt, autres)
        parcouru.set(p, parcouru.get(p)! + Math.hypot(p.w.x - avant.x, p.w.z - avant.z))
        if (avant.a === 'marche' && p.activite === 'regarde') arrets.set(p, arrets.get(p)! + 1)
      }
    }
    for (const p of pnj) {
      const elevation = MUSEE.levels.find((l) => l.id === p.w.level)!.elevation
      // Sur une surface du plan (une volée compte : son élévation est entre deux niveaux).
      expect(surfaceAt(MUSEE, p.w.x, p.w.z, p.w.y) ?? surfaceAt(MUSEE, p.w.x, p.w.z, elevation), `PNJ ${p.n} hors du plan`).not.toBeNull()
      expect(parcouru.get(p), `PNJ ${p.n} n'a pas bougé`).toBeGreaterThan(20)
    }
    const auMusee = pnj.filter((p) => p.zone === 'musee')
    expect(auMusee.reduce((n, p) => n + arrets.get(p)!, 0)).toBeGreaterThanOrEqual(auMusee.length * 2)
  })

  it('au jardin, ils restent sur le circuit de la visite (jamais à travers arbres et massifs)', () => {
    const pnj = pnjInitiaux(M, { musee: 0, jardin: 4 }, 8, 3)
    expect(pnj.every((p) => p.zone === 'jardin')).toBe(true)
    const segments = M.circuit.map((a, i) => [a, M.circuit[(i + 1) % M.circuit.length]] as const)
    const ecart = (x: number, z: number) => Math.min(...segments.map(([[ax, az], [bx, bz]]) => {
      const [dx, dz] = [bx - ax, bz - az]
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
      return Math.hypot(x - ax - t * dx, z - az - t * dz)
    }))
    let pire = 0
    let parcouru = 0
    for (let t = 0; t < 240; t += 1 / 20)
      for (const p of pnj) {
        const [x0, z0] = [p.w.x, p.w.z]
        avancerPnj(M, p, 1 / 20, pnj.filter((o) => o !== p).map((o) => ({ x: o.w.x, z: o.w.z, level: o.w.level })))
        parcouru += Math.hypot(p.w.x - x0, p.w.z - z0)
        pire = Math.max(pire, ecart(p.w.x, p.w.z))
      }
    // Se ranger à droite pour croiser quelqu'un écarte d'un mètre au plus.
    expect(pire).toBeLessThan(1.2)
    expect(parcouru).toBeGreaterThan(4 * 60)
  })
})
