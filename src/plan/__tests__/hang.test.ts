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
import { assignRooms } from '../hang.ts'
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
