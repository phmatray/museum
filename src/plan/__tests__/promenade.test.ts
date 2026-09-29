/**
 * La promenade de Bavette : semée, jamais hors d'une surface, jamais coincée,
 * et assez variée pour qu'on le croise partout — étages, escalier, jardin.
 */
import { describe, expect, it } from 'vitest'

import { MUSEE } from '../musee.ts'
import { presDeLEau } from '../jardin.ts'
import { parkPlacements } from '../park.ts'
import { ASSISES, MOBILIER, emprise } from '../mobilier.ts'
import {
  avancerPromenade, couchettes, itineraire, lieuxCalmes, posture, promenadeInitiale, regardeBavette, SIESTE, siesteForcee, type Couchette,
  type Promenade,
} from '../promenade.ts'
import { PARC, PASSABLE, contains, surfaceAt } from '../rules.ts'

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
    for (const q of ['marche', 'debout', 'assis']) expect(postures).toContain(q)
    // Jamais bloqué assez longtemps pour renoncer.
    expect(Math.max(...vues.map((p) => p.bloque))).toBeLessThan(2.5)
    // Au pas d'un chat : aucun bond entre deux images — sauf le bond sur le banc, et celui qui en redescend.
    for (let i = 1; i < vues.length; i++) {
      const [a, b] = [vues[i - 1].walker, vues[i].walker]
      const saute = ['saut', 'descente'].includes(vues[i].sieste?.phase ?? '')
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(saute ? 0.35 : 0.05)
      expect(Math.abs(b.y - a.y)).toBeLessThan(saute ? 0.35 : 0.05)
    }
  })

  it('s’assoit seulement pendant un arrêt long, et se relève avant de repartir', () => {
    const vues = rejouer(5, 900)
    for (let i = 1; i < vues.length; i++)
      if (posture(vues[i]) === 'marche') expect(posture(vues[i - 1])).not.toBe('assis')
  })
})

describe('la sieste sur un banc', () => {
  const COUCHETTES = couchettes(MUSEE)
  const surLeBanc = (c: Couchette, x: number, z: number) => contains(emprise(MOBILIER[c.banc]), x, z)

  it('a une couchette sur chaque banc à assise, l’appel au sol, sur sa surface et hors de l’eau', () => {
    const bancs = MOBILIER.map((m, i) => [m, i] as const).filter(([m]) => ASSISES[m.piece])
    expect(new Set(COUCHETTES.map((c) => c.banc))).toEqual(new Set(bancs.map(([, i]) => i)))
    for (const c of COUCHETTES) {
      const m = MOBILIER[c.banc]
      expect(c.y).toBeCloseTo(m.y + ASSISES[m.piece]!.hauteur, 6)
      // L'assise est dans l'emprise du banc, l'appel au-dehors, à l'élan du saut.
      expect(surLeBanc(c, c.x, c.z)).toBe(true)
      expect(surLeBanc(c, c.appel.x, c.appel.z)).toBe(false)
      expect(Math.hypot(c.appel.x - c.x, c.appel.z - c.z)).toBeCloseTo(SIESTE.elan, 6)
      expect(surfaceAt(MUSEE, c.appel.x, c.appel.z, m.surface === PARC ? 0 : MUSEE.levels.find((l) => l.id === m.niveau)!.elevation)).toBe(c.surface)
      if (c.surface === PARC) expect(presDeLEau(c.appel.x, c.appel.z)).toBe(false)
      // Accessible depuis le hall.
      expect(itineraire(MUSEE, { surface: '0:hall', x: 24, z: 30 }, { surface: c.surface, x: c.appel.x, z: c.appel.z, cap: c.cap, genre: 'banc' })).not.toBeNull()
    }
  })

  /** Il va dormir sur la couchette `c` : la promenade rejouée jusqu'à ce qu'il en soit redescendu et reparti. */
  function siesteSur(c: Couchette, graine = 3, visiteur?: { surface: string; x: number; z: number }) {
    let p: Promenade = siesteForcee(MUSEE, promenadeInitiale(MUSEE, LIEUX, graine), c)
    const vues: Promenade[] = [p]
    for (let t = 0; t < 600 && !(vues.some((v) => v.sieste?.phase === 'descente') && p.points.length); t += 0.1)
      vues.push((p = avancerPromenade(MUSEE, LIEUX, p, 0.1, visiteur)))
    return vues
  }

  for (const nom of ['BancNef', 'BancJardin', 'Banquette', 'BancPierre'] as const)
    it(`${nom} : il y marche, saute sur l’assise, dort deux à six minutes, s’étire, redescend et repart`, () => {
      const c = COUCHETTES.find((k) => MOBILIER[k.banc].piece === nom)!
      const vues = siesteSur(c)
      const phases = vues.map((v) => v.sieste?.phase ?? posture(v))
      // Dans l'ordre, chacune une fois.
      const suite = phases.filter((q, i) => q !== phases[i - 1])
      expect(suite.slice(suite.indexOf('saut'), suite.indexOf('descente') + 2)).toEqual(['saut', 'enroule', 'dort', 'reveil', 'descente', 'debout'])
      expect(suite.at(-1)).toBe('marche')
      const dort = phases.filter((q) => q === 'dort').length * 0.1
      expect(dort).toBeGreaterThanOrEqual(SIESTE.dort[0] - 0.2)
      expect(dort).toBeLessThanOrEqual(SIESTE.dort[1] + 0.2)
      for (const v of vues) {
        const w = v.walker
        const q = v.sieste?.phase
        if (q === 'enroule' || q === 'dort' || q === 'reveil') {
          // Posé sur l'assise, à sa cote.
          expect(w.y).toBeCloseTo(c.y, 6)
          expect([w.x, w.z]).toEqual([c.x, c.z])
        } else if (!q) expect(surLeBanc(c, w.x, w.z), `${w.x}, ${w.z}`).toBe(false)
      }
      // Il saute du point d'appel, y revient, et repart dos au banc.
      const debut = vues.find((v) => v.sieste?.phase === 'saut')!.walker
      expect(Math.hypot(debut.x - c.appel.x, debut.z - c.appel.z)).toBeLessThan(0.3)
      const fin = vues.find((v, i) => i > 0 && !v.sieste && vues[i - 1].sieste)!.walker
      expect([fin.x, fin.z, fin.y]).toEqual([c.appel.x, c.appel.z, c.appel.y])
    })

  it('ne monte pas sur un banc où se tient le visiteur', () => {
    const c = COUCHETTES.find((k) => k.surface === '0:hall')!
    const vues = siesteSur(c, 3, { surface: c.surface, x: c.x, z: c.z })
    // Il est venu jusqu’à l’appel, et n’y a pas sauté.
    expect(vues.some((v) => Math.hypot(v.walker.x - c.appel.x, v.walker.z - c.appel.z) < 0.3)).toBe(true)
    expect(vues.some((v) => v.sieste?.couchette.banc === c.banc)).toBe(false)
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
    let [coinces, dehors, siestes] = [0, 0, 0]
    for (let t = 0; t < 7200; t += 0.1) {
      const avant = p.bloque
      const avantSieste = p.sieste
      p = avancerPromenade(MUSEE, lieux, p, 0.1)
      if (avant > 0 && p.bloque === 0 && p.pause === 2) coinces++
      if (p.walker.surface === 'parc:terrain') {
        dehors++
        expect(presDeLEau(p.walker.x, p.walker.z), `${p.walker.x}, ${p.walker.z}`).toBe(false)
      }
      // Les siestes : jamais dans un banc — dessus, à la cote de l'assise, ou à côté.
      if (p.sieste && !avantSieste) siestes++
      const q = p.sieste?.phase
      if (q === 'enroule' || q === 'dort' || q === 'reveil') expect(p.walker.y).toBeCloseTo(p.sieste!.couchette.y, 6)
      else if (!q)
        for (const m of MOBILIER)
          if (m.surface === p.walker.surface && ASSISES[m.piece]) expect(contains(emprise(m), p.walker.x, p.walker.z), `${m.piece} ${p.walker.x}, ${p.walker.z}`).toBe(false)
    }
    // Il dort sur un banc au moins une fois en deux heures, sans y passer tout son temps.
    expect(siestes).toBeGreaterThanOrEqual(1)
    expect(siestes).toBeLessThanOrEqual(12)
    expect(coinces).toBeLessThanOrEqual(2)
    // Ni cloîtré dans les salles, ni perdu au jardin.
    expect(dehors / 72000).toBeGreaterThan(0.2)
    expect(dehors / 72000).toBeLessThan(0.8)
  }) // deux heures simulées : 2 à 7 s selon la charge ; le délai global (vite.config.ts) s'applique
})
