/**
 * Les grands arbres du parc (`arbres.ts`) : plantés où on les a mis, en terre,
 * hors des allées et de l'eau ; leur tronc arrête la marche ; rien ne pousse au
 * travers de leur houppier.
 */
import { describe, expect, it } from 'vitest'
import { DEGAGEMENT, GRANDS_ARBRES, TRONC } from '../arbres.ts'
import { distanceEtang, distanceRuisseau } from '../jardin.ts'
import { MUSEE } from '../musee.ts'
import { parkPlacements, surUneAllee } from '../park.ts'
import { hauteurDuParc } from '../relief.ts'
import { PARC } from '../rules.ts'
import { capVers } from '../tour.ts'
import { step, type Walker } from '../walk.ts'

const parc = parkPlacements(MUSEE)
const DT = 1 / 60
const dehors = (x: number, z: number): Walker => ({ level: 0, surface: PARC, x, z, y: hauteurDuParc(x, z), yaw: 0 })

describe('les grands arbres', () => {
  it('sont plantés chacun une fois, en terre, hors des allées et de l’eau', () => {
    for (const a of GRANDS_ARBRES) {
      const ici = parc.plantations.filter((p) => p.espece === a.espece && p.x === a.x && p.z === a.z)
      expect(ici, `${a.espece} (${a.x}, ${a.z})`).toHaveLength(1)
      // Le pied ne flotte pas : posé au plus bas du sol autour du tronc.
      expect(ici[0].y).toBeLessThanOrEqual(hauteurDuParc(a.x, a.z) + 1e-9)
      expect(surUneAllee(parc.allees, a.x, a.z, TRONC[a.espece] + 1)).toBe(false)
      expect(Math.min(distanceEtang(a.x, a.z), distanceRuisseau(a.x, a.z))).toBeGreaterThan(TRONC[a.espece] + 1)
    }
  })

  it('ne se traversent pas : le tronc arrête la marche', () => {
    for (const a of GRANDS_ARBRES) {
      let w = dehors(a.x - 4, a.z)
      for (let i = 0; i < 8 / DT; i++) w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, a.x + 4, a.z) }, DT)
      expect(w.x, `${a.espece} (${a.x}, ${a.z})`).toBeLessThan(a.x - TRONC[a.espece] * a.scale + 0.01)
    }
  })

  it('écartent les érables de leur houppier, et les touffes de leur pied', () => {
    for (const a of GRANDS_ARBRES) {
      const d = DEGAGEMENT[a.espece]
      for (const p of parc.plantations) {
        if (p.x === a.x && p.z === a.z) continue
        const r = Math.hypot(p.x - a.x, p.z - a.z)
        if (p.espece.startsWith('erable')) expect(r, `${p.espece} (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(d.grands * a.scale)
        else if (!GRANDS_ARBRES.some((b) => b.espece === p.espece)) expect(r, `${p.espece} (${p.x}, ${p.z})`).toBeGreaterThanOrEqual(d.petits * a.scale)
      }
    }
  })
})
