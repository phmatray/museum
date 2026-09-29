import { describe, expect, it } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { JARDIN } from '../../plan/jardin'
import { parkPlacements } from '../../plan/park'
import { PARC } from '../../plan/rules'
import {
  BOURDON, avancerPas, carillonDu, intervallePas, lieuDe, matiereSous, mixage, partitionAnnonce, partitionHeure, pluieEntendue, volumeRonron,
} from '../son'

const parc = parkPlacements(MUSEE)

describe('lieuDe', () => {
  it('range le hall, les balcons et l’escalier dans la nef, le reste en galerie, le parc dehors', () => {
    expect(lieuDe('0:hall')).toBe('nef')
    expect(lieuDe('1:balcon-o')).toBe('nef')
    expect(lieuDe('palier:palier')).toBe('nef')
    expect(lieuDe('volee:v1')).toBe('nef')
    expect(lieuDe('0:r-o1')).toBe('galerie')
    expect(lieuDe('1:honneur')).toBe('galerie')
    expect(lieuDe(PARC)).toBe('dehors')
  })
})

describe('matiereSous', () => {
  it('pierre dans la nef, parquet en galerie', () => {
    expect(matiereSous({ surface: '0:hall', x: 24, z: 20 }, parc)).toBe('pierre')
    expect(matiereSous({ surface: '1:honneur', x: 24, z: 6 }, parc)).toBe('parquet')
  })
  it('dehors : le parvis, le pont, les pierres de gué, les allées et le gazon', () => {
    expect(matiereSous({ surface: PARC, x: 24, z: 43 }, parc)).toBe('pierre')
    expect(matiereSous({ surface: PARC, x: JARDIN.pont.x, z: JARDIN.pont.z }, parc)).toBe('bois')
    const [gx, gz] = JARDIN.pas[0]
    expect(matiereSous({ surface: PARC, x: gx, z: gz }, parc)).toBe('pierre')
    const { a, b } = parc.allees[0]
    expect(matiereSous({ surface: PARC, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, parc)).toBe('gravier')
    // Un érable pousse sur le gazon, jamais sur une allée.
    const arbre = parc.plantations.find((p) => p.espece === 'erable-rouge')!
    expect(matiereSous({ surface: PARC, x: arbre.x, z: arbre.z }, parc)).toBe('herbe')
  })
})

describe('la cadence des pas', () => {
  it('un pas toutes les 0,55 s à la marche, plus vite à la hâte, rien à l’arrêt', () => {
    expect(intervallePas(3.5)).toBeCloseTo(0.55)
    expect(intervallePas(6)!).toBeLessThan(0.45)
    expect(intervallePas(1.8)).toBeCloseTo(0.75)
    expect(intervallePas(0)).toBeNull()
  })
  it('compte neuf pas en cinq secondes de marche, simulées à 60 im/s', () => {
    let etat = { phase: 0, pas: false }
    let pas = 0
    for (let i = 0; i < 300; i++) {
      etat = avancerPas(etat.phase, 3.5, 1 / 60)
      if (etat.pas) pas++
    }
    expect(pas).toBe(9)
  })
  it('repart d’un pas rapide après un arrêt', () => {
    const arret = avancerPas(0.2, 0, 1 / 60)
    expect(arret).toEqual({ phase: 0.7, pas: false })
    let etat = arret
    let images = 0
    while (!etat.pas) { etat = avancerPas(etat.phase, 3.5, 1 / 60); images++ }
    expect(images / 60).toBeLessThan(0.2)
  })
})

describe('mixage', () => {
  it('fait du dehors et de la nef deux mondes qui ne se recouvrent presque pas', () => {
    expect(mixage('dehors').dehors).toBe(1)
    expect(mixage('galerie').dehors).toBe(0)
    expect(mixage('nef').sourcesNef).toBe(1)
    expect(mixage('galerie').sourcesNef).toBeLessThan(0.3)
    expect(mixage('dehors').reverbNef + mixage('dehors').reverbGalerie).toBe(0)
  })
})

describe('le carillon', () => {
  it('sonne à l’heure pleine, une seule fois, le bon nombre de coups', () => {
    const quinze = new Date(2026, 8, 29, 15, 0, 3)
    const c = carillonDu(quinze, null)
    expect(c?.coups).toBe(3)
    expect(carillonDu(new Date(2026, 8, 29, 15, 0, 20), c!.cle)).toBeNull()
    expect(carillonDu(new Date(2026, 8, 29, 0, 0, 0), null)?.coups).toBe(12)
    expect(carillonDu(new Date(2026, 8, 29, 12, 0, 0), null)?.coups).toBe(12)
  })
  it('se tait hors de l’heure pleine, et après ses trente premières secondes', () => {
    expect(carillonDu(new Date(2026, 8, 29, 14, 20, 0), null)).toBeNull()
    expect(carillonDu(new Date(2026, 8, 29, 15, 0, 45), null)).toBeNull()
  })
  it('joue seize notes de Westminster puis frappe l’heure au bourdon, dans l’ordre', () => {
    const p = partitionHeure(3)
    expect(p.filter((c) => !c.bourdon)).toHaveLength(16)
    expect(p.filter((c) => c.bourdon).map((c) => c.frequence)).toEqual([BOURDON, BOURDON, BOURDON])
    expect(p.every((c, i) => i === 0 || c.t > p[i - 1].t)).toBe(true)
    expect(partitionAnnonce()).toHaveLength(4)
  })
})

describe('volumeRonron', () => {
  it('ronronne à moins d’1,5 m, pleinement tout près', () => {
    expect(volumeRonron(2)).toBe(0)
    expect(volumeRonron(1.5)).toBe(0)
    expect(volumeRonron(1.2)).toBeGreaterThan(0)
    expect(volumeRonron(0.5)).toBe(1)
  })
})

describe('pluieEntendue', () => {
  it("s'entend du dedans, plus bas et plus sourde que dehors", () => {
    const [dehors, nef, galerie] = (['dehors', 'nef', 'galerie'] as const).map((l) => pluieEntendue(l, 1))
    expect(nef.gain).toBeGreaterThan(0)
    expect(galerie.gain).toBeGreaterThan(0)
    expect(nef.gain).toBeLessThan(dehors.gain)
    expect(galerie.coupure).toBeLessThan(nef.coupure)
    expect(nef.coupure).toBeLessThan(dehors.coupure)
    expect(pluieEntendue('dehors', 0).gain).toBe(0)
  })
})
