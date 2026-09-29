/**
 * Les oiseaux : perchés sur les érables ou picorant le gravier des allées, jamais dans le
 * musée ni dans l'eau ; ils changent d'arbre, et fuient le visiteur.
 */
import { describe, expect, it } from 'vitest'

import { presDeLEau } from '../jardin.ts'
import { MUSEE } from '../musee.ts'
import { avancerOiseaux, oiseauxInitiaux, perchoirs, PORTEE_FUITE } from '../oiseaux.ts'
import { generateur, parkPlacements } from '../park.ts'

const PS = perchoirs(parkPlacements(MUSEE))
const dansLeMusee = (x: number, z: number) => x > 0 && x < 48 && z > 0 && z < 40
const DT = 1 / 15

describe('oiseaux', () => {
  it('se perchent dehors : houppiers et allées, jamais dans le musée ni l’eau', () => {
    expect(PS.filter((p) => !p.sol).length).toBeGreaterThan(30)
    expect(PS.filter((p) => p.sol).length).toBeGreaterThan(10)
    for (const p of PS) {
      expect(dansLeMusee(p.x, p.z)).toBe(false)
      if (p.sol) expect(presDeLEau(p.x, p.z, 1)).toBe(false)
      else expect(p.y).toBeGreaterThan(2)
    }
  })

  it('volent d’arbre en arbre sans jamais traverser le musée', () => {
    const alea = generateur('banc')
    let o = oiseauxInitiaux(PS, 16, alea)
    let vols = 0
    let dedans = 0
    for (let t = 0; t < 300; t += DT) {
      const avant = o
      o = avancerOiseaux(o, PS, DT, null, alea)
      o.forEach((b, i) => {
        if (b.etat === 'vol' && avant[i].etat !== 'vol') vols++
        if (dansLeMusee(b.x, b.z)) dedans++
      })
    }
    expect(vols).toBeGreaterThan(10)
    expect(dedans).toBe(0)
  })

  it('s’envolent quand le visiteur approche à moins de 4 m, et se posent loin de lui', () => {
    const alea = generateur('fuite')
    let o = oiseauxInitiaux(PS, 16, alea)
    const cible = o[0]
    const visiteur = { x: cible.x + 1, z: cible.z }
    o = avancerOiseaux(o, PS, DT, visiteur, alea)
    expect(o[0].etat).toBe('vol')
    for (let t = 0; t < 20; t += DT) o = avancerOiseaux(o, PS, DT, visiteur, alea)
    expect(Math.hypot(o[0].x - visiteur.x, o[0].z - visiteur.z)).toBeGreaterThan(PORTEE_FUITE)
  })
})
