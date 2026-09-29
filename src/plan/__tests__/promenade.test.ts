/**
 * La promenade de Bavette : semée, jamais hors d'une surface, jamais coincée,
 * et assez variée pour qu'on le croise partout — étages, escalier, jardin.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { presDeLEau } from '../jardin.ts'
import { parkPlacements } from '../park.ts'
import { avancerPromenade, itineraire, lieuxCalmes, posture, promenadeInitiale, regardeBavette, type Promenade } from '../promenade.ts'
import { PARC, PASSABLE, surfaceAt } from '../rules.ts'

const LIEUX = lieuxCalmes(MUSEE, parkPlacements(MUSEE))

function rejouer(graine: number, duree: number, dt = 0.1) {
  let p = promenadeInitiale(MUSEE, LIEUX, graine)
  const vues: Promenade[] = [p]
  for (let t = 0; t < duree; t += dt) vues.push((p = avancerPromenade(MUSEE, LIEUX, p, dt)))
  return vues
}

describe('lieuxCalmes', () => {
  it('pose chaque lieu sur une surface praticable, loin des portes', () => {
    expect(LIEUX.length).toBeGreaterThan(20)
    for (const l of LIEUX) {
      if (l.surface.startsWith('palier:')) continue
      const level = l.surface === PARC ? MUSEE.levels[0] : MUSEE.levels.find((n) => l.surface.startsWith(`${n.id}:`))!
      expect(surfaceAt(MUSEE, l.x, l.z, level.elevation)).toBe(l.surface)
      for (const o of level.openings) if (PASSABLE.has(o.kind)) expect(Math.hypot(o.x - l.x, o.z - l.z)).toBeGreaterThan(2)
    }
  })

  it('propose le musée, l’escalier et le jardin', () => {
    const genres = new Set(LIEUX.map((l) => l.genre))
    for (const g of ['toile', 'hall', 'palier', 'balcon', 'arbre']) expect(genres).toContain(g)
  })
})

describe('itineraire', () => {
  it('sort du hall par l’entrée et contourne le bâtiment jusqu’au jardin nord', () => {
    const nord = LIEUX.filter((l) => l.genre === 'arbre').reduce((a, b) => (b.z < a.z ? b : a))
    const pts = itineraire(MUSEE, { surface: '0:hall', x: 24, z: 30 }, nord)!
    expect(pts).not.toBeNull()
    // Aucun point dans l'emprise une fois dehors : il en fait le tour.
    const sortie = pts.findIndex((p) => p[1] > 40)
    for (const [x, z] of pts.slice(sortie)) expect(x < 0 || x > MUSEE.width || z < 0 || z > MUSEE.depth).toBe(true)
  })

  it('monte à l’étage noble par l’escalier impérial', () => {
    const haut = LIEUX.find((l) => l.surface === '1:honneur')!
    expect(itineraire(MUSEE, { surface: '0:hall', x: 24, z: 30 }, haut)).not.toBeNull()
  })
})

describe('avancerPromenade', () => {
  it('est une fonction de sa graine', () => {
    const [a, b] = [rejouer(11, 120).at(-1)!, rejouer(11, 120).at(-1)!]
    expect(a).toEqual(b)
    expect(rejouer(12, 120).at(-1)!.walker).not.toEqual(a.walker)
  })

  it('en une demi-heure, marche sans jamais quitter une surface ni rester coincé', () => {
    const vues = rejouer(42, 1800)
    const surfaces = new Set(vues.map((p) => p.walker.surface))
    expect(surfaces.size).toBeGreaterThan(4)
    const postures = new Set(vues.map(posture))
    expect(postures).toEqual(new Set(['marche', 'debout', 'assis']))
    // Jamais bloqué assez longtemps pour renoncer.
    expect(Math.max(...vues.map((p) => p.bloque))).toBeLessThan(2.5)
    // Au pas d'un chat : aucun bond entre deux images.
    for (let i = 1; i < vues.length; i++) {
      const [a, b] = [vues[i - 1].walker, vues[i].walker]
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.05)
      expect(Math.abs(b.y - a.y)).toBeLessThan(0.05)
    }
  })

  it('s’assoit seulement pendant un arrêt long, et se relève avant de repartir', () => {
    const vues = rejouer(5, 900)
    for (let i = 1; i < vues.length; i++)
      if (posture(vues[i]) === 'marche') expect(posture(vues[i - 1])).not.toBe('assis')
  })
})

describe('regardeBavette', () => {
  const oeil = { x: 0, y: 1.62, z: 0 }
  const chat = { x: 0, y: 0.2, z: -1.5 }
  it('vrai quand on baisse les yeux sur lui, de près', () => {
    const regard = { x: chat.x - oeil.x, y: chat.y - oeil.y, z: chat.z - oeil.z }
    expect(regardeBavette(oeil, regard, chat)).toBe(true)
  })
  it('faux s’il est hors du regard, ou trop loin', () => {
    expect(regardeBavette(oeil, { x: 0, y: 0, z: -1 }, chat)).toBe(false)
    expect(regardeBavette(oeil, { x: 0, y: -0.2, z: -1 }, { x: 0, y: 0.2, z: -6 })).toBe(false)
  })
})

describe('promenade au jardin', () => {
  it('ne met jamais les pattes dans l’eau et ne reste pas coincé, en deux heures de promenade', () => {
    const lieux = lieuxCalmes(MUSEE, parkPlacements(MUSEE))
    let p = promenadeInitiale(MUSEE, lieux, 42)
    let [coinces, dehors] = [0, 0]
    for (let t = 0; t < 7200; t += 0.1) {
      const avant = p.bloque
      p = avancerPromenade(MUSEE, lieux, p, 0.1)
      if (avant > 0 && p.bloque === 0 && p.pause === 2) coinces++
      if (p.walker.surface === 'parc:terrain') {
        dehors++
        expect(presDeLEau(p.walker.x, p.walker.z), `${p.walker.x}, ${p.walker.z}`).toBe(false)
      }
    }
    expect(coinces).toBeLessThanOrEqual(2)
    // Ni cloîtré dans les salles, ni perdu au jardin.
    expect(dehors / 72000).toBeGreaterThan(0.2)
    expect(dehors / 72000).toBeLessThan(0.8)
  }) // deux heures simulées : 2 à 7 s selon la charge ; le délai global (vite.config.ts) s'applique
})
