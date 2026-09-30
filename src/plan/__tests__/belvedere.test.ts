/**
 * Le belvédère du fond du jardin et son roji : on y monte par l'escalier et
 * nulle part ailleurs, on n'en tombe pas, le roji ne passe que par sa porte, la
 * percée laisse voir l'étang et la façade, et la visite guidée y finit.
 */
import { describe, expect, it } from 'vitest'

import { BELVEDERE, HAUT_DE_L_ESCALIER, MARCHE, PIED_DE_L_ESCALIER, POINT_DE_VUE, coteDuBelvedere, dansLaPercee, dansLeBelvedere, pierresDuBelvedere } from '../belvedere.ts'
import { distanceRuisseau, presDeLEau } from '../jardin.ts'
import { MUSEE } from '../musee.ts'
import { parkPlacements, surUneAllee } from '../park.ts'
import { hauteurDuParc } from '../relief.ts'
import { PARC } from '../rules.ts'
import { avancer, capVers, VISITE } from '../tour.ts'
import { S, cadreDehors, renderDehors } from '../svg.ts'
import { step, type Walker } from '../walk.ts'

const { emprise: E, cote: H, palissade: F, porte: G } = BELVEDERE
const DT = 1 / 60
const dehors = (x: number, z: number): Walker => ({ level: 0, surface: PARC, x, z, y: hauteurDuParc(x, z), yaw: 0 })
function marcher(w: Walker, x: number, z: number, secondes = 40): Walker {
  for (let i = 0; i < secondes / DT && Math.hypot(x - w.x, z - w.z) > 0.05; i++) w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, x, z) }, DT)
  return w
}
const surLaTerrasse = (w: Walker) => w.x > E.x && w.x < E.x + E.width && w.z > E.z && w.z < E.z + E.depth
const parc = parkPlacements(MUSEE)

describe('le belvédère', () => {
  it('se monte par son escalier : du pied du roji au dallage, à la cote de la terrasse', () => {
    let w = marcher(dehors(...PIED_DE_L_ESCALIER), ...HAUT_DE_L_ESCALIER)
    expect(Math.hypot(w.x - HAUT_DE_L_ESCALIER[0], w.z - HAUT_DE_L_ESCALIER[1])).toBeLessThan(0.05)
    expect(w.y).toBeCloseTo(H, 5)
    w = marcher(w, ...POINT_DE_VUE)
    expect(surLaTerrasse(w)).toBe(true)
    expect(w.surface).toBe(PARC)
  })

  it('a des marches de 16 à 17 cm pour 33 cm de giron, comme un vrai escalier de jardin', () => {
    expect(MARCHE.haut).toBeGreaterThan(0.15)
    expect(MARCHE.haut).toBeLessThan(0.18)
    expect(2 * MARCHE.haut + MARCHE.giron).toBeGreaterThan(0.6)
    expect(2 * MARCHE.haut + MARCHE.giron).toBeLessThan(0.7)
  })

  it('ne se gravit pas par ses murs, et on ne tombe pas du parapet', () => {
    const [cx, cz] = [E.x + E.width / 2, E.z + E.depth / 2]
    for (const [x, z] of [[E.x - 3, cz], [cx, E.z + E.depth + 3], [E.x + E.width + 1, cz], [E.x + 2, E.z - 3]] as const) {
      const w = marcher(dehors(x, z), cx, cz, 15)
      expect(surLaTerrasse(w), `depuis (${x}, ${z})`).toBe(false)
    }
    const haut = marcher(marcher(dehors(...PIED_DE_L_ESCALIER), ...HAUT_DE_L_ESCALIER), ...POINT_DE_VUE)
    expect(Math.hypot(haut.x - POINT_DE_VUE[0], haut.z - POINT_DE_VUE[1])).toBeLessThan(0.05)
    for (const [x, z] of [[E.x - 4, cz], [cx, E.z + E.depth + 4], [E.x - 1, E.z - 4], [E.x + E.width + 3, cz]] as const) {
      const w = marcher(haut, x, z, 15)
      expect(surLaTerrasse(w), `vers (${x}, ${z})`).toBe(true)
      expect(w.y).toBeCloseTo(H, 5)
    }
  })

  it('est de niveau sur la terrasse, en pente douce sur la volée, et nulle part ailleurs', () => {
    expect(coteDuBelvedere(E.x + 3, E.z + 3)).toBe(H)
    expect(coteDuBelvedere(E.x - 1, E.z + 3)).toBeNull()
    expect(coteDuBelvedere(...PIED_DE_L_ESCALIER)).toBeNull()
    expect(hauteurDuParc(...HAUT_DE_L_ESCALIER)).toBe(H)
  })

  it('pose ses pierres sur le sol : aucun mur ne flotte, rien sous la cote de fondation', () => {
    for (const b of pierresDuBelvedere(hauteurDuParc)) {
      expect(b.h).toBeGreaterThan(0)
      const bas = b.y - b.h / 2
      // Un mur, une marche ou un limon descend sous le sol à son pied ; un parapet, un chaperon ou le dallage est porté.
      if (bas < H - 0.3) expect(bas, `boîte en (${b.x}, ${b.z})`).toBeLessThanOrEqual(hauteurDuParc(b.x, b.z) + 1e-6 + (dansLeBelvedere(b.x, b.z) ? H : 0))
    }
  })

  it('reste au sec, hors de l’eau et du ruisseau, et laisse la pelouse autour', () => {
    for (let x = E.x - 1; x <= E.x + E.width + 1; x += 0.5)
      for (let z = BELVEDERE.escalier.z0 - 1; z <= E.z + E.depth + 1; z += 0.5) expect(presDeLEau(x, z, 2)).toBe(false)
    for (let z = F.z0; z <= F.z1; z += 0.5) expect(distanceRuisseau(F.x, z)).toBeGreaterThan(1.5)
  })
})

describe('le roji', () => {
  it('est une allée, du pont au pied de l’escalier, sans arbre planté dedans', () => {
    for (let z = G.z + 1; z < PIED_DE_L_ESCALIER[1]; z += 1) expect(surUneAllee(parc.allees, BELVEDERE.roji.x, z)).toBe(true)
    for (const p of parc.plantations) expect(surUneAllee(parc.allees, p.x, p.z, p.espece.startsWith('erable') ? 0.3 : p.rayon * 0.5)).toBe(false)
  })

  it('se prend par sa porte : la palissade et ses ailes ferment le reste', () => {
    // Par la porte : du pont au pied de l'escalier, sans détour.
    const w = marcher(dehors(BELVEDERE.roji.x, G.z - 3), ...PIED_DE_L_ESCALIER, 60)
    expect(Math.hypot(w.x - PIED_DE_L_ESCALIER[0], w.z - PIED_DE_L_ESCALIER[1])).toBeLessThan(0.05)
    // Du ruisseau, on bute sur la palissade ; de la pelouse de l'est, sur l'aile de la porte.
    const [mx, mz] = [BELVEDERE.roji.x, (F.z0 + F.z1) / 2]
    expect(marcher(dehors(F.x - 1, mz), mx, mz, 10).x).toBeLessThan(F.x)
    expect(marcher(dehors(E.x + E.width + 1, G.z - 2), E.x + E.width + 1, G.z + 4, 10).z).toBeLessThan(G.z)
  })
})

describe('la percée', () => {
  it('ouvre la vue de la terrasse sur l’étang et la façade : plus un grand arbre dans le secteur', () => {
    for (const p of parc.plantations) if (p.espece.startsWith('erable') && p.y !== H) expect(dansLaPercee(p.x, p.z), `${p.espece} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false)
    expect(dansLaPercee(46, 65)).toBe(true)
    expect(dansLaPercee(48, 45)).toBe(true)
  })

  it('garde le premier plan : des boules et des azalées dans le secteur', () => {
    expect(parc.plantations.filter((p) => (p.espece === 'buis' || p.espece === 'azalee') && dansLaPercee(p.x, p.z)).length).toBeGreaterThan(10)
  })
})

describe('la visite guidée', () => {
  it('finit au belvédère : de la baraque, par le pont, le roji et l’escalier, à pied', () => {
    const i = VISITE.length - 1
    const arret = VISITE[i]
    expect(arret.roomId).toBe('belvedere')
    const [x, z] = arret.points[0]
    let w = dehors(x, z)
    let c = { stop: i, point: 0 }
    for (let n = 0; n < 300 / DT && c.point < arret.points.length; n++) {
      c = avancer(VISITE, c, w)
      if (c.point >= arret.points.length) break
      w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, ...arret.points[c.point]) }, DT)
    }
    expect(c.point, `bloqué en ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`).toBe(arret.points.length)
    expect(surLaTerrasse(w)).toBe(true)
    expect(w.y).toBeCloseTo(H, 5)
  })
})

describe('le plan du dehors', () => {
  it('montre le belvédère, nommé, dans son cadre', () => {
    const [x, y, w, h] = cadreDehors(MUSEE)
    expect(x).toBeLessThanOrEqual(E.x * S)
    expect(x + w).toBeGreaterThanOrEqual((E.x + E.width) * S)
    expect(y + h).toBeGreaterThanOrEqual((E.z + E.depth) * S)
    expect(renderDehors(MUSEE, 0)).toContain('Belvédère')
  })
})
