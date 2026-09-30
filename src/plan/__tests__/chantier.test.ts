/**
 * La baraque du chantier du musée : on y entre par sa porte et nulle part
 * ailleurs, le jardin la laisse en place (ni arbre, ni allée, ni eau), Bavette
 * en fait le tour, la visite guidée y finit, et le journal s'y accroche sans
 * qu'un cadre en chevauche un autre.
 */
import { describe, expect, it } from 'vitest'

import JOURNAL from '../../../public/data/chantier.json' with { type: 'json' }
import { accrocherChantier, cadreVise, CHANTIER, dansLeChantier, EMPRISE_CHANTIER, GRANDS, SEUIL_CHANTIER } from '../chantier.ts'
import { presDeLEau } from '../jardin.ts'
import { coupe } from '../mobilier.ts'
import { MUSEE } from '../musee.ts'
import { distanceRect, parkPlacements, surUneAllee } from '../park.ts'
import { itineraire } from '../promenade.ts'
import { hauteurDuParc } from '../relief.ts'
import { PARC } from '../rules.ts'
import { avancer, capVers, VISITE } from '../tour.ts'
import { step, type Walker } from '../walk.ts'

const E = EMPRISE_CHANTIER
const DT = 1 / 60
const dehors = (x: number, z: number): Walker => ({ level: 0, surface: PARC, x, z, y: hauteurDuParc(x, z), yaw: 0 })
function marcher(w: Walker, x: number, z: number, secondes = 30): Walker {
  for (let i = 0; i < secondes / DT && Math.hypot(x - w.x, z - w.z) > 0.05; i++) w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, x, z) }, DT)
  return w
}

describe('la baraque du chantier', () => {
  it('se visite par sa porte, face à l’axe de l’entrée', () => {
    const w = marcher(dehors(...SEUIL_CHANTIER.dehors), ...SEUIL_CHANTIER.dedans)
    expect(Math.hypot(w.x - SEUIL_CHANTIER.dedans[0], w.z - SEUIL_CHANTIER.dedans[1])).toBeLessThan(0.05)
    expect(w.surface).toBe(PARC)
  })

  it('arrête le visiteur à ses murs : on n’entre ni par le nord, ni par le sud, ni par le fond', () => {
    const [cx, cz] = [E.x + E.width / 2, E.z + E.depth / 2]
    for (const [x, z] of [[cx - 2, E.z - 3], [cx - 2, E.z + E.depth + 3], [E.x - 3, cz]] as const) {
      const w = marcher(dehors(x, z), cx - 2, cz, 10)
      expect(dansLeChantier(w.x, w.z), `depuis (${x}, ${z})`).toBe(false)
    }
  })

  it('pose son plancher de niveau, à sa cote, sur une plate-forme raccordée au relief', () => {
    for (let x = E.x; x <= E.x + E.width; x += 0.5) for (let z = E.z; z <= E.z + E.depth; z += 0.5) expect(hauteurDuParc(x, z)).toBeCloseTo(CHANTIER.cote, 6)
  })

  it('ne coupe ni allée ni eau, et le parc n’y plante rien', () => {
    const parc = parkPlacements(MUSEE)
    for (let x = E.x - 0.5; x <= E.x + E.width + 0.5; x += 0.25)
      for (let z = E.z - 0.5; z <= E.z + E.depth + 0.5; z += 0.25) {
        expect(surUneAllee(parc.allees, x, z, 0.5), `allée en (${x}, ${z})`).toBe(false)
        expect(presDeLEau(x, z, 2)).toBe(false)
      }
    for (const p of parc.plantations) expect(distanceRect(E, p.x, p.z), `${p.espece} en (${p.x}, ${p.z})`).toBeGreaterThan(1)
  })

  it('Bavette en fait le tour : son chemin ne traverse jamais la baraque', () => {
    const cx = E.x + E.width / 2
    const lieu = { surface: PARC, x: cx, z: E.z + E.depth + 3, cap: 0, genre: 'arbre' as const }
    const pts = itineraire(MUSEE, { surface: PARC, x: cx, z: E.z - 3 }, lieu)
    expect(pts).not.toBeNull()
    let ici: [number, number] = [cx, E.z - 3]
    for (const p of pts!) {
      expect(coupe(ici, p, E), `de (${ici}) à (${p})`).toBe(false)
      ici = p
    }
  })

  it('finit la visite guidée : de la salle d’honneur à la baraque, à pied', () => {
    const i = VISITE.findIndex((s) => s.roomId === 'chantier')
    const arret = VISITE[i]
    const avant = VISITE[i - 1].points.at(-1)!
    let w: Walker = { level: 1, surface: '1:honneur', x: avant[0], z: avant[1], y: MUSEE.storey, yaw: 0 }
    let c = { stop: i, point: 0 }
    for (let n = 0; n < 240 / DT && c.point < arret.points.length; n++) {
      c = avancer(VISITE, c, w)
      if (c.point >= arret.points.length) break
      w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, ...arret.points[c.point]) }, DT)
    }
    expect(c.point, `bloqué en ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`).toBe(arret.points.length)
    expect(dansLeChantier(w.x, w.z)).toBe(true)
  })
})

describe('accrocherChantier', () => {
  const cadres = accrocherChantier(JOURNAL.etapes.length)

  it('accroche chaque étape une fois, les dernières en grand', () => {
    expect(cadres.map((c) => c.etape).sort((a, b) => a - b)).toEqual(JOURNAL.etapes.map((_, i) => i))
    expect(cadres.filter((c) => c.grand).map((c) => c.etape)).toEqual(Array.from({ length: GRANDS }, (_, j) => JOURNAL.etapes.length - GRANDS + j))
  })

  it('pose les cadres sur le lambris, dedans, sans qu’ils se touchent ni débordent la porte', () => {
    const { mur: M, porte: P, lambris } = CHANTIER
    for (const c of cadres) {
      // Contre un mur, à 2 cm du lambris, la face tournée vers la salle.
      const [nx, nz] = c.normal
      const mur = nz !== 0 ? (nz > 0 ? E.z + M : E.z + E.depth - M) : nx > 0 ? E.x + M : E.x + E.width - M
      expect(Math.abs((nz !== 0 ? c.z : c.x) - mur)).toBeCloseTo(0.02, 6)
      const long = nz !== 0 ? c.x : c.z
      const [a, b] = nz !== 0 ? [E.x + M, E.x + E.width - M] : [E.z + M, E.z + E.depth - M]
      expect(long - c.cote / 2).toBeGreaterThan(a)
      expect(long + c.cote / 2).toBeLessThan(b)
      expect(c.y + c.cote / 2).toBeLessThan(CHANTIER.cote + lambris)
      expect(c.y - c.cote / 2).toBeGreaterThan(CHANTIER.cote + 0.8)
      if (nx < 0) expect(Math.abs(c.z - P.z)).toBeGreaterThan(P.largeur / 2 + c.cote / 2)
    }
    for (const [i, p] of cadres.entries())
      for (const q of cadres.slice(i + 1)) {
        if (p.normal[0] !== q.normal[0] || p.normal[1] !== q.normal[1]) continue
        const ecart = Math.max(Math.abs(p.x - q.x) + Math.abs(p.z - q.z) - (p.cote + q.cote) / 2, Math.abs(p.y - q.y) - (p.cote + q.cote) / 2)
        expect(ecart, `étapes ${p.etape} et ${q.etape}`).toBeGreaterThan(0.03)
      }
  })

  it('reconnaît le cadre regardé, et aucun de derrière un mur', () => {
    const c = cadres.find((x) => !x.grand && x.normal[1] === -1)!
    const oeil = { x: c.x, y: c.y, z: c.z - 1.5 }
    expect(cadreVise(cadres, oeil, { x: 0, y: 0, z: 1 })).toBe(c)
    // Le même regard, depuis le jardin au sud, de l'autre côté du mur : rien.
    expect(cadreVise(cadres, { x: c.x, y: c.y, z: c.z + 1 }, { x: 0, y: 0, z: -1 })).toBeNull()
    // Levé de 20° : le rang du haut, pas celui du bas.
    const bas = cadres.find((x) => x.normal[1] === -1 && x.x === c.x && x.y < c.y)
    if (bas) {
      const o = { x: bas.x, y: bas.y, z: bas.z - 1.5 }
      const [dy, dz] = [c.y - o.y, c.z - o.z]
      const l = Math.hypot(dy, dz)
      expect(cadreVise(cadres, o, { x: 0, y: dy / l, z: dz / l })).toBe(c)
    }
  })
})
