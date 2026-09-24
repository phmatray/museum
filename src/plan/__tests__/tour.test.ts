/**
 * La visite guidée du plan (#31), suivie comme le ferait `PlanPlayer` : chaque
 * pas passe par `step()`, qui ne franchit aucun mur. Si l'itinéraire menait à
 * travers une cloison, le visiteur resterait bloqué contre elle et l'arrêt ne
 * serait jamais atteint — c'est ce que ces tests attrapent.
 */
import { describe, expect, it } from 'vitest'

import { exposedRooms } from '../hang.ts'
import { MUSEE } from '../musee.ts'
import { avancer, buildTourItinerary, capVers } from '../tour.ts'
import { step, type Walker } from '../walk.ts'

const DT = 1 / 120
const depart = (): Walker => ({ ...MUSEE.spawn, surface: '0:hall', y: 0, yaw: 0 })

describe('buildTourItinerary', () => {
  const stops = buildTourItinerary(MUSEE)

  it("passe une fois par chaque salle exposée, salle d'honneur comprise", () => {
    const attendues = exposedRooms(MUSEE).map(({ room, level }) => `${level.id}:${room.id}`).sort()
    expect(stops.map((s) => `${s.level}:${s.roomId}`).sort()).toEqual(attendues)
    expect(stops.some((s) => s.roomId === 'honneur')).toBe(true)
    expect(stops.every((s) => s.points.length > 0)).toBe(true)
  })

  it("se parcourt à pied de bout en bout, sans traverser de mur", () => {
    let w = depart()
    const vus: string[] = []
    for (let i = 0; i < stops.length; i++) {
      let c = { stop: i, point: 0 }
      for (let n = 0; n < 120 / DT; n++) {
        c = avancer(stops, c, w)
        if (c.point >= stops[i].points.length) break
        const [x, z] = stops[i].points[c.point]
        w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, x, z) }, DT)
      }
      expect(c.point, `arrêt ${i} (${stops[i].name}) jamais atteint, bloqué en ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`).toBe(stops[i].points.length)
      expect(w.surface).toBe(`${stops[i].level}:${stops[i].roomId}`)
      vus.push(w.surface)
    }
    expect(new Set(vus).size).toBe(stops.length)
  })
})
