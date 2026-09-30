/**
 * La VR sans casque : ce que les manettes et le Cardboard demandent à la marche.
 */
import { describe, expect, it } from 'vitest'

import { CRAN, ETAT_VR, capDuRegard, confort, lireEntrees, type Manette } from '../vr'

const manette = (handedness: Manette['handedness'], x: number, y: number, boutons: boolean[] = []): Manette => ({ handedness, targetRayMode: 'tracked-pointer', axes: [0, 0, x, y], boutons })
const regard: Manette = { handedness: 'none', targetRayMode: 'gaze', axes: [], boutons: [] }

describe('lireEntrees', () => {
  it('fait marcher au stick gauche, vers l’avant quand on le pousse, sans dérive au repos', () => {
    expect(lireEntrees([manette('left', 0, -1)], 0, ETAT_VR).entree.avance).toBeCloseTo(1)
    expect(lireEntrees([manette('left', 1, 0)], 0, ETAT_VR).entree.cote).toBeCloseTo(1)
    const repos = lireEntrees([manette('left', 0.1, -0.12)], 0, ETAT_VR).entree
    expect(Math.abs(repos.avance) + Math.abs(repos.cote)).toBe(0)
    expect(lireEntrees([manette('left', 0, -1, [false, false, false, true])], 0, ETAT_VR).entree.hate).toBe(true)
  })

  it('tourne d’un cran au stick droit, une fois par poussée', () => {
    let etat = ETAT_VR
    const tours: number[] = []
    for (const x of [0.9, 0.95, 0.9, 0.1, -0.8, -0.9]) {
      const r = lireEntrees([manette('left', 0, 0), manette('right', x, 0)], 0, etat)
      tours.push(r.entree.tourner)
      etat = r.etat
    }
    expect(tours).toEqual([-CRAN, 0, 0, 0, CRAN, 0])
  })

  it('au Cardboard, un tapotement lance la marche au regard, un autre l’arrête', () => {
    let r = lireEntrees([regard], 1, ETAT_VR)
    expect(r.entree.avance).toBe(1)
    r = lireEntrees([regard], 0, r.etat)
    expect(r.entree.avance).toBe(1)
    r = lireEntrees([regard], 1, r.etat)
    expect(r.entree.avance).toBe(0)
    // Deux tapotements dans la même image s'annulent.
    expect(lireEntrees([regard], 2, ETAT_VR).entree.avance).toBe(0)
  })

  it('rend la main au stick : pousser un stick arrête la marche au regard', () => {
    const r = lireEntrees([manette('left', 0, 0.9)], 1, ETAT_VR)
    expect(r.etat.marche).toBe(false)
    expect(r.entree.avance).toBeLessThan(0)
  })
})

describe('capDuRegard', () => {
  it('suit la convention du visiteur : 0 regarde vers −z, π/2 vers −x', () => {
    expect(capDuRegard(0, -1)).toBeCloseTo(0)
    expect(capDuRegard(-1, 0)).toBeCloseTo(Math.PI / 2)
  })
})

describe('confort', () => {
  it('se ferme vite au départ, se rouvre doucement à l’arrêt', () => {
    let c = 0
    for (let i = 0; i < 15; i++) c = confort(c, 3.5, 0, 1 / 60)
    expect(c).toBeGreaterThan(0.8)
    let d = c
    for (let i = 0; i < 15; i++) d = confort(d, 0, 0, 1 / 60)
    // En un quart de seconde, il s'est plus fermé qu'il ne se rouvre.
    expect(c - d).toBeLessThan(c * 0.5)
    for (let i = 0; i < 180; i++) d = confort(d, 0, 0, 1 / 60)
    expect(d).toBeLessThan(0.02)
  })
})
