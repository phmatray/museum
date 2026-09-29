/**
 * Les carpes : elles restent dans l'étang loin des berges, entre deux eaux,
 * sans se chevaucher — et viennent gober devant le visiteur qui s'approche du bord.
 */
import { describe, expect, it } from 'vitest'

import { distanceEtang } from '../jardin.ts'
import { MARGE_BERGE, SURFACE, avancerKoi, fondEtang, koiInitiaux, pointDAppel, type Koi } from '../koi.ts'

const DT = 1 / 15
const nager = (banc: Koi[], secondes: number, visiteur: { x: number; z: number } | null, surveiller?: (b: Koi[]) => void) => {
  for (let t = 0; t < secondes; t += DT) {
    banc = avancerKoi(banc, DT, visiteur)
    surveiller?.(banc)
  }
  return banc
}

describe('koi', () => {
  it('errent cinq minutes dans l’étang, loin des berges, entre deux eaux', () => {
    let pire = -Infinity
    let collees = 0
    let horsDEau = 0
    const depart = koiInitiaux()
    const loin = depart.map(() => 0)
    nager(depart, 300, null, (b) => {
      b.forEach((k, i) => { loin[i] = Math.max(loin[i], Math.hypot(k.x - depart[i].x, k.z - depart[i].z)) })
      for (const k of b) {
        pire = Math.max(pire, distanceEtang(k.x, k.z))
        // Entre deux eaux, jamais sous le fond.
        if (k.prof < 0.019 || k.prof > 0.61 || SURFACE - k.prof <= fondEtang(k.x, k.z)) horsDEau++
      }
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) if (Math.hypot(b[i].x - b[j].x, b[i].z - b[j].z) < 0.25) collees++
    })
    expect(pire).toBeLessThan(-MARGE_BERGE / 2)
    expect(horsDEau).toBe(0)
    // Des croisements, pas un banc soudé.
    expect(collees / (300 / DT)).toBeLessThan(0.2)
    // Elles se promènent vraiment : pas figées au milieu.
    expect(loin.filter((d) => d > 4).length).toBeGreaterThan(5)
  })

  it('viennent au visiteur accoudé à la berge, et montent à la surface', () => {
    // Au bord sud de l'étang, à un mètre de l'eau.
    const visiteur = { x: 46, z: 75.5 }
    expect(distanceEtang(visiteur.x, visiteur.z)).toBeLessThan(3)
    const appel = pointDAppel(visiteur)!
    const banc = nager(koiInitiaux(), 90, visiteur)
    const pres = banc.filter((k) => Math.hypot(k.x - appel[0], k.z - appel[1]) < 2.5)
    expect(pres.length).toBeGreaterThanOrEqual(5)
    expect(pres.filter((k) => k.prof < 0.08).length).toBeGreaterThanOrEqual(3)
  })

  it('ignorent le visiteur loin de l’eau', () => {
    expect(pointDAppel({ x: 24, z: 50 })).toBeNull()
  })
})
