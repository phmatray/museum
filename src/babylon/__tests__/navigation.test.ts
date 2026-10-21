import { readFileSync } from 'node:fs'

import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { beforeAll, describe, expect, it } from 'vitest'

import type { RecastNavigationJSPluginV2 } from '@babylonjs/addons/navigation/plugin/RecastNavigationJSPlugin'
import type { Segment } from '../../plan/geometry'
import type { Accrochage } from '../../plan/hang'
import { MUSEE } from '../../plan/musee'
import { entraves, soupeDeNavigation } from '../../plan/navigation'
import { parkPlacements } from '../../plan/park'
import { avancerPnj, monde, pnjInitiaux, type Pnj } from '../../plan/pnj'
import { SALLE_CABINE } from '../../plan/cinema'
import { lieuxCalmes } from '../../plan/promenade'
import { propPlacements } from '../../plan/props'
import { EXT, INT } from '../../plan/svg'
import type { Rect } from '../../plan/types'
import { fouleDesPnj, navmesh } from '../navigation'
import { cuireNavmesh, RAYON_AGENT } from '../navmesh'

const ACCROCHAGE = JSON.parse(readFileSync('public/data/accrochage.json', 'utf8')) as Accrochage
const PARC = parkPlacements(MUSEE)
const M = monde(MUSEE, ACCROCHAGE, lieuxCalmes(MUSEE, PARC))
const E = entraves(MUSEE, PARC, propPlacements(MUSEE, ACCROCHAGE.rooms))

const dedans = (r: Rect, x: number, z: number, marge = 0) =>
  x > r.x + marge && x < r.x + r.width - marge && z > r.z + marge && z < r.z + r.depth - marge
function distance(s: Segment, x: number, z: number): number {
  const [dx, dz] = [s.x2 - s.x1, s.z2 - s.z1]
  const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(x - s.x1 - t * dx, z - s.z1 - t * dz)
}
const BATI: Rect = { x: -EXT, z: -EXT, width: MUSEE.width + 2 * EXT, depth: MUSEE.depth + 2 * EXT }
const ENTREE = MUSEE.levels[0].openings.find((o) => o.kind === 'entrance')!
const SEUIL: Rect = { x: ENTREE.x - ENTREE.width / 2, z: ENTREE.z - 1, width: ENTREE.width, depth: EXT + 1 }
/** Le corps du PNJ : à moins de 10 cm d'un mur, d'un meuble ou d'un tronc, il le touche. */
const CORPS = 0.1

/**
 * Ce que le PNJ en (x, y, z) heurte, ou null : un mur ou un garde-corps (leur épaisseur
 * et `CORPS`), un obstacle du plan sur son plancher, un sujet du parc, la façade.
 */
function heurte(x: number, y: number, z: number): string | null {
  if (dedans(SALLE_CABINE, x, z) && y < -1) return 'dans la cabine de projection'
  if (dedans(BATI, x, z) && !dedans(SEUIL, x, z)) {
    const plancher = MUSEE.levels.find((l) => Math.abs(l.elevation - y) < 0.02 && l.rooms.some((r) => dedans(r, x, z, -1e-6)))
    const niveau = plancher ?? MUSEE.levels.filter((l) => l.elevation <= y + 0.02).reduce((a, b) => (b.elevation > a.elevation ? b : a))
    const mur = E.murs.get(niveau.id)!.find((s) => distance(s, x, z) < INT + CORPS)
    if (mur) return `mur ${JSON.stringify(mur)} (niveau ${niveau.id})`
    const o = plancher && E.obstacles.get(plancher.id)!.find((r) => dedans(r, x, z, -CORPS))
    if (o) return `obstacle ${JSON.stringify(o)} (niveau ${plancher.id})`
    if (!dedans({ x: 0, z: 0, width: MUSEE.width, depth: MUSEE.depth }, x, z)) return 'façade'
    return null
  }
  const o = E.obstacles.get(0)!.find((r) => dedans(r, x, z, -CORPS))
  if (o) return `obstacle du parc ${JSON.stringify(o)}`
  const corde = E.cordes.find((s) => distance(s, x, z) < CORPS)
  if (corde) return `corde ${JSON.stringify(corde)}`
  const c = E.cercles.find((c) => Math.hypot(c.x - x, c.z - z) < c.r + CORPS)
  return c ? `sujet du parc ${JSON.stringify(c)}` : null
}

describe('la foule des PNJ sur le navmesh du plan', () => {
  let plugin: RecastNavigationJSPluginV2
  let scene: Scene
  let msNavmesh = 0
  beforeAll(async () => {
    scene = new Scene(new NullEngine())
    const t = performance.now()
    plugin = await navmesh(await cuireNavmesh(soupeDeNavigation(MUSEE, E)))
    msNavmesh = performance.now() - t
  })

  it('relie les trois niveaux, le cinéma et le jardin, en un temps de chargement raisonnable', () => {
    expect(msNavmesh).toBeLessThan(5000)
    const arrivee = { x: 24, y: 0, z: 37 }
    for (const [x, y, z] of [[8, 4.8, 20], [40, 4.8, 6], [24, -4.8, 8], [24, 0, 60], [-20, 0, 20]]) {
      const chemin = plugin.computePath(arrivee, { x, y, z })
      const fin = chemin[chemin.length - 1]
      expect(fin, `vers ${x}, ${y}, ${z}`).toBeDefined()
      expect(Math.hypot(fin.x - x, fin.z - z) + Math.abs(fin.y - y), `vers ${x}, ${y}, ${z}`).toBeLessThan(0.5)
    }
    // La cabine de projection : sa porte de service reste fermée aux PNJ.
    const cabine = { x: SALLE_CABINE.x + SALLE_CABINE.width / 2, y: MUSEE.landings.find((l) => l.id === 'cabine')!.elevation, z: SALLE_CABINE.z + SALLE_CABINE.depth / 2 }
    const fin = plugin.computePath(arrivee, cabine).at(-1)
    expect(fin && Math.hypot(fin.x - cabine.x, fin.z - cabine.z) < 1).toBeFalsy()
  })

  it.each([7, 42])('cinq minutes de vie (graine %i) : personne dans un mur, un meuble, un tronc ou un massif ; tous marchent et regardent', (graine) => {
    const pnj = pnjInitiaux(M, { musee: 8, jardin: 4 }, 8, graine)
    const foule = fouleDesPnj(scene, plugin, MUSEE, pnj)
    const parcouru = new Map<Pnj, number>(pnj.map((p) => [p, 0]))
    const arrets = new Map<Pnj, number>(pnj.map((p) => [p, 0]))
    const etages = new Map<Pnj, Set<number>>(pnj.map((p) => [p, new Set()]))
    const heurts: string[] = []
    let plusPres = Infinity
    const dt = 1 / 20
    foule.relever(null)
    for (let t = 0; t < 300; t += dt) {
      const avant = pnj.map((p) => ({ x: p.w.x, z: p.w.z }))
      foule.crowd.update(dt)
      // Le visiteur fait les cent pas dans le hall, sur le passage des PNJ.
      foule.relever({ x: 24 + 4 * Math.sin(t / 5), y: 0, z: 30 })
      for (const [i, p] of pnj.entries()) {
        parcouru.set(p, parcouru.get(p)! + Math.hypot(p.w.x - avant[i].x, p.w.z - avant[i].z))
        const etait = p.activite
        avancerPnj(M, p, dt, foule.pilote)
        if (etait === 'marche' && p.activite === 'regarde') arrets.set(p, arrets.get(p)! + 1)
        const h = heurte(p.w.x, p.w.y, p.w.z)
        if (h && heurts.length < 10) heurts.push(`PNJ ${p.n} à t=${t.toFixed(1)} s en (${p.w.x.toFixed(2)}, ${p.w.y.toFixed(2)}, ${p.w.z.toFixed(2)}) : ${h}`)
        if (p.zone === 'musee') etages.get(p)!.add(Math.round(p.w.y / MUSEE.storey))
      }
      // Personne ne se marche dessus : deux PNJ, ou un PNJ et le visiteur, au même étage.
      const lui = { x: 24 + 4 * Math.sin(t / 5), y: 0, z: 30 }
      const tous = [...pnj.map((p) => p.w), lui]
      for (let i = 0; i < tous.length; i++)
        for (let j = i + 1; j < tous.length; j++)
          if (Math.abs(tous[i].y - tous[j].y) < 0.5) plusPres = Math.min(plusPres, Math.hypot(tous[i].x - tous[j].x, tous[i].z - tous[j].z))
    }
    expect(plusPres).toBeGreaterThan(2 * RAYON_AGENT - 0.05)
    expect(heurts).toEqual([])
    for (const p of pnj) expect(parcouru.get(p), `PNJ ${p.n} n'a pas bougé`).toBeGreaterThan(100)
    const auMusee = pnj.filter((p) => p.zone === 'musee')
    expect(auMusee.reduce((n, p) => n + arrets.get(p)!, 0)).toBeGreaterThanOrEqual(auMusee.length * 2)
    // Ils changent d'étage : la foule prend les volées.
    expect(auMusee.filter((p) => etages.get(p)!.size > 1).length).toBeGreaterThanOrEqual(2)
    foule.crowd.dispose()
  })
})
