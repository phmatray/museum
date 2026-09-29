/**
 * Le hérisson : il reste au sec, dans son domaine, hors des obstacles ; se
 * roule en boule quand on approche et se déroule quand on s'en va ; sort la
 * nuit bien plus que le jour, et jamais l'hiver.
 */
import { describe, expect, it } from 'vitest'

import { PORTEE_BOULE, activite, avancerHerisson, herissonInitial, libre, type Herisson } from '../herisson.ts'

const DT = 0.1
function vivre(h: Herisson, secondes: number, envie: number, visiteur: (h: Herisson, t: number) => { x: number; z: number } | null = () => null, surveiller?: (h: Herisson) => void) {
  for (let t = 0; t < secondes; t += DT) {
    h = avancerHerisson(h, DT, visiteur(h, t), envie)
    surveiller?.(h)
  }
  return h
}

describe('hérisson', () => {
  it('trotte deux heures de nuit sans jamais entrer dans l’eau ni traverser un obstacle', () => {
    let hors = 0
    let marche = 0
    let flaire = 0
    let chemin = 0
    let avant = herissonInitial(1, 7)
    vivre(avant, 7200, 1, () => null, (h) => {
      if (h.etat !== 'nid' && !libre(h.x, h.z)) hors++
      if (h.etat === 'marche') marche++
      if (h.etat === 'flaire') flaire++
      chemin += Math.hypot(h.x - avant.x, h.z - avant.z)
      avant = h
    })
    expect(hors).toBe(0)
    // Il se promène vraiment, et s'arrête souvent pour flairer.
    expect(chemin).toBeGreaterThan(150)
    expect(flaire).toBeGreaterThan(marche * 0.3)
  })

  it('se roule en boule quand on approche, se déroule quelques secondes après notre départ', () => {
    let h = vivre(herissonInitial(1, 3), 20, 1)
    expect(h.etat).not.toBe('nid')
    const pres = { x: h.x + PORTEE_BOULE - 0.3, z: h.z }
    h = vivre(h, 3, 1, () => pres)
    expect(h.etat).toBe('boule')
    expect(h.boule).toBe(1)
    // On reste : il reste en boule.
    h = vivre(h, 20, 1, () => pres)
    expect(h.boule).toBe(1)
    // On recule : encore roulé 3 s après, déroulé et reparti 12 s après.
    const loin = { x: h.x + 6, z: h.z }
    expect(vivre(h, 3, 1, () => loin).boule).toBe(1)
    h = vivre(h, 12, 1, () => loin)
    expect(h.etat).not.toBe('boule')
    expect(h.boule).toBe(0)
  })

  it('sort la nuit bien plus que le jour, et hiberne l’hiver', () => {
    const dehors = (envie: number) => {
      let n = 0
      let total = 0
      for (let g = 1; g <= 6; g++)
        vivre(herissonInitial(envie, g), 1800, envie, () => null, (h) => {
          total++
          if (h.etat !== 'nid') n++
        })
      return n / total
    }
    expect(activite(0, false)).toBe(1)
    expect(activite(1, true)).toBe(0)
    const [nuit, jour] = [dehors(activite(0, false)), dehors(activite(1, false))]
    expect(nuit).toBeGreaterThan(0.8)
    expect(jour).toBeLessThan(0.3)
    expect(jour).toBeGreaterThan(0)
    expect(dehors(activite(0, true))).toBe(0)
  })
})
