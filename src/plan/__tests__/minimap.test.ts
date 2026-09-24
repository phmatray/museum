/**
 * La minimap suit une vraie marche (#31) : du point d'apparition à la salle
 * d'honneur par l'escalier impérial, sans téléporter. Le niveau affiché, la
 * salle surlignée et le point du visiteur viennent tous de `projectForMinimap`.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { projectForMinimap } from '../minimap.ts'
import { step, type Walker } from '../walk.ts'

const DT = 1 / 120
const depart = (): Walker => ({ ...MUSEE.spawn, surface: '0:hall', y: 0, yaw: 0 })
const capVers = (w: Walker, x: number, z: number) => Math.atan2(-(x - w.x), -(z - w.z))
const vers = (w: Walker, x: number, z: number, apres: (w: Walker) => void) => {
  for (let i = 0; i < 20 / DT && Math.hypot(x - w.x, z - w.z) > 0.02; i++) {
    w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, x, z) }, DT)
    apres(w)
  }
  return w
}

describe('projectForMinimap', () => {
  it("place le visiteur dans le hall au point d'apparition, sur le repère du plan dessiné", () => {
    const m = projectForMinimap(MUSEE, depart())
    expect(m.level).toBe(0)
    expect(m.room?.name).toBe('Hall')
    // Le plan dessiné est en x vers l'est, z vers le sud : le point garde l'ordre.
    const nord = projectForMinimap(MUSEE, { ...depart(), z: 20 })
    expect(nord.player.y).toBeLessThan(m.player.y)
    expect(nord.player.x).toBe(m.player.x)
    // Le cadre (viewBox) contient le visiteur.
    const [x0, y0, w, h] = m.viewBox
    expect(m.player.x).toBeGreaterThan(x0)
    expect(m.player.x).toBeLessThan(x0 + w)
    expect(m.player.y).toBeGreaterThan(y0)
    expect(m.player.y).toBeLessThan(y0 + h)
  })

  it("suit la marche jusqu'à la salle d'honneur : niveau, salle, et aucune salle sur l'escalier", () => {
    const salles: (string | null)[] = []
    const niveaux = new Set<number>()
    const suivre = (w: Walker) => {
      const m = projectForMinimap(MUSEE, w)
      niveaux.add(m.level)
      if (salles.at(-1) !== (m.room?.id ?? null)) salles.push(m.room?.id ?? null)
    }
    const points: [number, number][] = [[24, 14], [17.5, 14], [17.5, 24], [14, 24], [8, 24], [8, 11], [8, 6], [20, 6]]
    const w = points.reduce((w, [x, z]) => vers(w, x, z, suivre), depart())

    expect(w.surface).toBe('1:honneur')
    expect(projectForMinimap(MUSEE, w).room?.name).toBe("Salle d'honneur")
    expect(niveaux).toEqual(new Set([0, 1]))
    // Sur la volée ou le palier, pas de salle active ; puis balcon, galeries, honneur.
    expect(salles).toEqual(['hall', null, 'balcon-o', 'e-o2', 'e-o1', 'honneur'])
  })
})
