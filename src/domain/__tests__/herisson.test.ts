/**
 * Le hérisson : il reste au sec, dans son domaine, hors des obstacles ; se
 * roule en boule quand on approche et se déroule quand on s'en va ; sort la
 * nuit bien plus que le jour, et jamais l'hiver.
 */
import { describe, expect, it } from 'vitest'

import { distanceEtang } from '../../plan/koi.ts'
import { cielA } from '../soleil.ts'
import {
  DEMI_LONGUEUR, ECHELLE_HERISSON, FAMILLE, PORTEE_BOULE, activite, avancerFamille, avancerHerisson, ecartMinimal, familleInitiale, herissonInitial, libre, nid, type Herisson,
} from '../herisson.ts'

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
    let museauMouille = 0
    let marche = 0
    let flaire = 0
    let chemin = 0
    let avant = herissonInitial(1, 7)
    vivre(avant, 7200, 1, () => null, (h) => {
      if (h.etat !== 'nid' && !libre(h.x, h.z)) hors++
      // Vingt centimètres : même le bout du museau reste au sec.
      if (h.etat !== 'nid' && distanceEtang(h.x + Math.cos(h.cap) * DEMI_LONGUEUR, h.z + Math.sin(h.cap) * DEMI_LONGUEUR) < 0.3) museauMouille++
      if (h.etat === 'marche') marche++
      if (h.etat === 'flaire') flaire++
      chemin += Math.hypot(h.x - avant.x, h.z - avant.z)
      avant = h
    })
    expect(hors).toBe(0)
    expect(museauMouille).toBe(0)
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

  it('sort surtout à la brune et à l’aube, beaucoup la nuit, rarement le jour, et hiberne l’hiver', () => {
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
    // La courbe : le soleil en degrés au-dessus de l'horizon.
    expect(activite(0, false)).toBe(1)
    expect(activite(3, false)).toBe(1)
    expect(activite(-5, false)).toBe(1)
    expect(activite(-40, false)).toBeCloseTo(0.8)
    expect(activite(40, false)).toBeCloseTo(0.15)
    expect(activite(0, true)).toBe(0)
    const [brune, nuit, jour] = [dehors(activite(0, false)), dehors(activite(-40, false)), dehors(activite(40, false))]
    expect(brune).toBeGreaterThan(0.8)
    expect(nuit).toBeGreaterThan(0.5)
    expect(nuit).toBeLessThan(brune)
    expect(jour).toBeLessThan(0.3)
    expect(jour).toBeGreaterThan(0)
    expect(dehors(activite(0, true))).toBe(0)
  })

  it('à Bruxelles fin septembre : au plus fort au coucher, fort la nuit, rare l’après-midi', () => {
    const a = (h: number, m: number) => activite(cielA(new Date(Date.UTC(2026, 8, 30, h - 2, m)), 50.85, 4.35).elevation, false)
    expect(a(19, 30)).toBe(1) // le soleil vient de se coucher
    expect(a(7, 30)).toBe(1) // il va se lever
    expect(a(23, 0)).toBeCloseTo(0.8, 1)
    expect(a(15, 0)).toBeCloseTo(0.15, 1)
    expect(a(6, 45)).toBeGreaterThan(a(23, 0))
  })
})

describe('la famille hérisson', () => {
  const nuit = -40
  /** `heures` de vie de la famille, un pas de 0,1 s ; `surveiller` voit chaque pas. */
  function vivreEnFamille(heures: number, elevation: number, graine: number, surveiller: (f: Herisson[], t: number) => void) {
    let f = familleInitiale(elevation, false, graine)
    for (let t = 0; t < heures * 3600; t += DT) {
      f = avancerFamille(f, DT, null, elevation, false)
      surveiller(f, t)
    }
    return f
  }

  it('une mère, deux petits, un vieux : chacun sa taille, les grands un peu plus vifs', () => {
    expect(FAMILLE.map((i) => i.role)).toEqual(['mere', 'petit', 'petit', 'solitaire'])
    // Le petit de #196 n'a pas changé.
    expect(FAMILLE[1].echelle).toBeCloseTo(ECHELLE_HERISSON)
    for (const i of FAMILLE) {
      const cm = i.echelle * 15
      if (i.role === 'petit') {
        expect(cm).toBeGreaterThanOrEqual(18)
        expect(cm).toBeLessThanOrEqual(20)
      } else {
        expect(cm).toBeGreaterThanOrEqual(25)
        expect(cm).toBeLessThanOrEqual(27)
        expect(i.vitesse).toBeGreaterThan(FAMILLE[1].vitesse)
      }
    }
  })

  it('la mère et ses petits partagent un buis ; le vieux a le sien, loin du leur', () => {
    const [m, p1, p2, v] = [0, 1, 2, 3].map((q) => nid(q))
    for (const p of [p1, p2]) expect(Math.hypot(p[0] - m[0], p[1] - m[1])).toBeLessThan(2.5)
    expect(p1).not.toEqual(m)
    expect(p2).not.toEqual(p1)
    expect(Math.hypot(v[0] - m[0], v[1] - m[1])).toBeGreaterThan(10)
  })

  it('trois heures de nuit : personne dans l’eau, personne sur personne, les petits dans les pattes de leur mère', () => {
    let hors = 0
    let mouille = 0
    let chevauche = 0
    const suivi = [0, 0]
    const ensemble = [0, 0]
    const centre = [0, 0, 0, 0]
    const dehors = [0, 0, 0, 0]
    vivreEnFamille(3, nuit, 11, (f) => {
      for (const h of f) {
        if (h.etat === 'nid') continue
        const { echelle, demiLongueur } = FAMILLE[h.qui]
        if (!libre(h.x, h.z, echelle)) hors++
        if (distanceEtang(h.x + Math.cos(h.cap) * demiLongueur, h.z + Math.sin(h.cap) * demiLongueur) < 0.3) mouille++
        centre[h.qui] += Math.hypot(h.x - 46, h.z - 65)
        dehors[h.qui]++
        for (const o of f) if (o.qui > h.qui && o.etat !== 'nid' && Math.hypot(o.x - h.x, o.z - h.z) < ecartMinimal(h, o) - 1e-9) chevauche++
      }
      const mere = f[0]
      if (mere.etat !== 'nid' && !mere.rentre)
        for (const p of [1, 2]) {
          if (f[p].etat === 'nid') continue
          ensemble[p - 1]++
          if (Math.hypot(f[p].x - mere.x, f[p].z - mere.z) < 2.5) suivi[p - 1]++
        }
    })
    expect(hors).toBe(0)
    expect(mouille).toBe(0)
    expect(chevauche).toBe(0)
    for (const q of [0, 1, 2, 3]) expect(dehors[q]).toBeGreaterThan(3 * 36000 * 0.3)
    for (const p of [0, 1]) {
      expect(ensemble[p]).toBeGreaterThan(3 * 36000 * 0.3)
      expect(suivi[p] / ensemble[p]).toBeGreaterThan(0.75)
    }
    // Le vieux court plus loin de l'eau que la mère.
    expect(centre[3] / dehors[3]).toBeGreaterThan(centre[0] / dehors[0] + 1)
  })

  it('les petits s’écartent parfois pour flairer, puis rattrapent leur mère', () => {
    let flane = 0
    let loin = 0
    let n = 0
    vivreEnFamille(1, nuit, 5, (f) => {
      if (f[0].etat === 'nid' || f[0].rentre || f[1].etat === 'nid') return
      n++
      if (f[1].flane) flane++
      if (Math.hypot(f[1].x - f[0].x, f[1].z - f[0].z) > 2) loin++
    })
    expect(flane / n).toBeGreaterThan(0.05)
    expect(loin / n).toBeGreaterThan(0.01)
    expect(loin / n).toBeLessThan(0.3)
  })

  it('chacun se roule en boule pour soi, quand on l’approche lui', () => {
    let f = familleInitiale(nuit, false, 3)
    for (let t = 0; t < 60; t += DT) f = avancerFamille(f, DT, null, nuit, false)
    expect(f[3].etat).not.toBe('nid')
    const pres = { x: f[3].x + 1, z: f[3].z }
    for (let t = 0; t < 2; t += DT) f = avancerFamille(f, DT, pres, nuit, false)
    expect(f[3].boule).toBe(1)
    for (const h of f) if (Math.hypot(h.x - pres.x, h.z - pres.z) > PORTEE_BOULE + 0.5) expect(h.etat).not.toBe('boule')
  })

  it('même heure pour tous, pas la même seconde ; l’hiver, tous au nid', () => {
    const sorties = [-1, -1, -1, -1]
    vivreEnFamille(0.25, 2, 9, (f, t) => f.forEach((h, q) => { if (sorties[q] < 0 && h.etat !== 'nid') sorties[q] = t }))
    // Tous dehors avant un quart d'heure, et jamais deux à la même seconde.
    for (const s of sorties) expect(s).toBeGreaterThanOrEqual(0)
    const apres = sorties.filter((s) => s > 0.05).sort((a, b) => a - b)
    for (let i = 1; i < apres.length; i++) expect(apres[i] - apres[i - 1]).toBeGreaterThan(0.5)
    let dehors = 0
    let f = familleInitiale(0, true, 9)
    for (let t = 0; t < 1800; t += DT) {
      f = avancerFamille(f, DT, null, 0, true)
      dehors += f.filter((h) => h.etat !== 'nid').length
    }
    expect(dehors).toBe(0)
  })
})
