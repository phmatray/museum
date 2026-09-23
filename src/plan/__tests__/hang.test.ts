/**
 * L'accrochage du plan : la collection versionnée remplit les 14 salles.
 *
 * On ne teste que des propriétés — aucune salle vide, aucune salle trop pleine,
 * aucune toile sur une porte — jamais un nom de cluster, qui change avec les
 * topics du catalogue.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { capacity } from '../rules.ts'
import { assignRooms, hangPlan } from '../hang.ts'
import type { Artwork } from '../../domain/types.ts'

const catalogue = JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/catalogue.json'), 'utf8'))
const ARTWORKS: Artwork[] = catalogue.artworks

const exposees = MUSEE.levels.flatMap((level) =>
  level.rooms.filter((r) => r.kind === 'gallery' || r.kind === 'honneur').map((room) => ({ room, level })))

describe('assignRooms', () => {
  const salles = assignRooms(MUSEE, ARTWORKS)

  it('donne au moins une œuvre à chacune des 14 salles, sans dépasser leur capacité', () => {
    expect(exposees).toHaveLength(14)
    for (const { room, level } of exposees) {
      const n = salles.get(room.id)?.artworks.length ?? 0
      expect(n, room.id).toBeGreaterThan(0)
      expect(n, room.id).toBeLessThanOrEqual(capacity(room, level))
    }
  })

  it('accroche chaque œuvre une fois et une seule', () => {
    const cles = [...salles.values()].flatMap((s) => s.artworks.map((a) => a.key))
    expect(new Set(cles).size).toBe(cles.length)
    expect(new Set(cles)).toEqual(new Set(ARTWORKS.map((a) => a.key)))
  })

  it('réserve la salle d’honneur aux dépôts les plus étoilés', () => {
    const { room, level } = exposees.find((e) => e.room.kind === 'honneur')!
    const honneur = salles.get(room.id)!.artworks
    expect(honneur).toHaveLength(Math.min(capacity(room, level), ARTWORKS.length))
    const seuil = Math.min(...honneur.map((a) => a.stars))
    const dehors = ARTWORKS.filter((a) => !honneur.includes(a))
    expect(Math.max(...dehors.map((a) => a.stars))).toBeLessThanOrEqual(seuil)
  })

  it('rend un résultat identique d’un appel à l’autre', () => {
    const json = (m: ReturnType<typeof assignRooms>) => JSON.stringify([...m])
    expect(json(assignRooms(MUSEE, ARTWORKS))).toBe(json(salles))
    expect(json(assignRooms(MUSEE, [...ARTWORKS].reverse()))).toBe(json(salles))
  })
})

describe('hangPlan', () => {
  const salles = assignRooms(MUSEE, ARTWORKS)
  const accrochage = hangPlan(MUSEE, salles, catalogue.generatedAt)

  it('accroche chaque œuvre attribuée, et rien d’autre', () => {
    for (const r of accrochage.rooms) {
      const attendues = salles.get(r.id)!.artworks.map((a) => a.key).sort()
      expect(r.placements.map((p) => p.key).sort(), r.id).toEqual(attendues)
    }
  })

  // Des salles pleines à leur capacité : c'est là que les toiles frôlent les portes.
  const pleines = hangPlan(MUSEE, new Map(exposees.map(({ room, level }) =>
    [room.id, { name: room.name, artworks: ARTWORKS.slice(-capacity(room, level)) }])), '')

  it('ne pose aucune toile sur une ouverture ni sur son dégagement de 0,60 m', () => {
    for (const r of [...accrochage.rooms, ...pleines.rooms]) {
      const level = MUSEE.levels.find((l) => l.id === r.level)!
      const ouvertures = level.openings.filter((o) => o.a === r.id || o.b === r.id)
      for (const p of r.placements) {
        for (const o of ouvertures) {
          // L'ouverture est sur une arête ; la toile est sur le même mur si elle
          // en est à moins d'une épaisseur, le long de sa normale.
          const [nx] = p.normal
          const ecart = Math.abs(nx !== 0 ? p.x - o.x : p.z - o.z)
          if (ecart > 0.3) continue
          const leLong = Math.abs(nx !== 0 ? p.z - o.z : p.x - o.x)
          expect(leLong, `${p.key} / ${o.a}-${o.b}`).toBeGreaterThanOrEqual(o.width / 2 + 0.6 + p.width / 2 - 1e-6)
        }
      }
    }
  })

  it('rend un JSON identique octet pour octet d’un appel à l’autre', () => {
    const encore = hangPlan(MUSEE, assignRooms(MUSEE, ARTWORKS), catalogue.generatedAt)
    expect(JSON.stringify(encore)).toBe(JSON.stringify(accrochage))
  })
})
