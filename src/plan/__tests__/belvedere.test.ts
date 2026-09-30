/**
 * Le belvédère du fond du jardin et son roji : on y monte par l'escalier et
 * nulle part ailleurs, on n'en tombe pas, le roji ne passe que par sa porte, la
 * percée laisse voir l'étang et la façade, et la visite guidée y finit.
 */
import { describe, expect, it } from 'vitest'

import { BELVEDERE, VOLEES, HAUT_DE_LA_VOLEE_OUEST, HAUT_DE_L_ESCALIER, PAS_DE_LA_RIVE, PIED_DE_LA_VOLEE_OUEST, MARCHE, PIED_DE_L_ESCALIER, POINT_DE_VUE, coteDuBelvedere, dansLaPercee, dansLeBelvedere, pierresDuBelvedere } from '../belvedere.ts'
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

  it('pose ses pierres sur le sol : chaque pierre est fondée sous le sol, ou portée par une autre', () => {
    const pierres = pierresDuBelvedere(hauteurDuParc)
    const dessous = (b: (typeof pierres)[number], c: (typeof pierres)[number]) =>
      Math.abs(b.x - c.x) < (b.w + c.w) / 2 - 0.01 && Math.abs(b.z - c.z) < (b.d + c.d) / 2 - 0.01 && c.y + c.h / 2 >= b.y - b.h / 2 - 0.03 && c.y < b.y
    for (const b of pierres) {
      expect(b.h).toBeGreaterThan(0)
      const bas = b.y - b.h / 2
      const fonde = bas <= hauteurDuParc(b.x, b.z) + 1e-6 || (dansLeBelvedere(b.x, b.z) && bas >= H - 0.3)
      expect(fonde || pierres.some((c) => c !== b && dessous(b, c)), `boîte en (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})`).toBe(true)
    }
  })

  it('a un parement en bossage qui s’évase vers le pied (le fruit du mur)', () => {
    const ouest = pierresDuBelvedere(hauteurDuParc).filter((b) => b.x < E.x && b.z > E.z + 1 && b.z < E.z + 5)
    const saillie = (b: (typeof ouest)[number]) => E.x - (b.x - b.w / 2)
    const [basse, haute] = [ouest.reduce((a, b) => (b.y < a.y ? b : a)), ouest.reduce((a, b) => (b.y > a.y ? b : a))]
    expect(saillie(basse)).toBeGreaterThan(saillie(haute) + 0.1)
    expect(new Set(ouest.map((b) => b.z.toFixed(2))).size).toBeGreaterThan(8)
  })

  it('reste au sec, hors de l’eau et du ruisseau, et laisse la pelouse autour', () => {
    for (let x = E.x - 1; x <= E.x + E.width + 1; x += 0.5)
      for (let z = VOLEES[0].u0 - 1; z <= E.z + E.depth + 1; z += 0.5) expect(presDeLEau(x, z, 2)).toBe(false)
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
  /** Marche un arrêt de la visite, de son premier point à son dernier. */
  function parcourir(i: number, depuis: Walker) {
    const arret = VISITE[i]
    let w = depuis
    let c = { stop: i, point: 0 }
    for (let n = 0; n < 300 / DT && c.point < arret.points.length; n++) {
      c = avancer(VISITE, c, w)
      if (c.point >= arret.points.length) break
      w = step(MUSEE, w, { forward: 1, strafe: 0, yaw: capVers(w, ...arret.points[c.point]) }, DT)
    }
    expect(c.point, `${arret.roomId} : bloqué en ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`).toBe(arret.points.length)
    return w
  }

  it('monte au belvédère par le pont, le roji et l’escalier, puis redescend par la volée ouest et la rive sud jusqu’à l’axe', () => {
    const [terrasse, rive] = [VISITE.length - 2, VISITE.length - 1]
    expect(VISITE[terrasse].roomId).toBe('belvedere')
    expect(VISITE[rive].roomId).toBe('rive')
    let w = parcourir(terrasse, dehors(...VISITE[terrasse].points[0]))
    expect(surLaTerrasse(w)).toBe(true)
    expect(w.y).toBeCloseTo(H, 5)
    w = parcourir(rive, w)
    // Au bout : sur l'axe de l'entrée, au sol, face au nord — la façade encadrée.
    expect(Math.abs(w.x - 24)).toBeLessThan(0.2)
    expect(w.y).toBeCloseTo(hauteurDuParc(w.x, w.z), 5)
    expect(Math.abs(w.yaw)).toBeLessThan(0.2)
  })
})

describe('la rive sud', () => {
  it('descend la volée ouest, de la terrasse au pied, à plain-pied au bout', () => {
    const w = marcher(marcher(marcher(dehors(...PIED_DE_L_ESCALIER), ...HAUT_DE_L_ESCALIER), ...HAUT_DE_LA_VOLEE_OUEST), ...PIED_DE_LA_VOLEE_OUEST)
    expect(Math.hypot(w.x - PIED_DE_LA_VOLEE_OUEST[0], w.z - PIED_DE_LA_VOLEE_OUEST[1])).toBeLessThan(0.05)
    expect(w.y).toBeLessThan(0.1)
  })

  it('pose ses pas japonais au sec, sans en chevaucher un autre ni une plante', () => {
    expect(PAS_DE_LA_RIVE.length).toBeGreaterThan(50)
    PAS_DE_LA_RIVE.forEach((p, i) => {
      expect(presDeLEau(p.x, p.z, 2)).toBe(false)
      const suivant = PAS_DE_LA_RIVE[i + 1]
      if (suivant) {
        expect(Math.hypot(suivant.x - p.x, suivant.z - p.z)).toBeGreaterThan(p.rayon + suivant.rayon)
        expect(Math.hypot(suivant.x - p.x, suivant.z - p.z)).toBeLessThan(1)
      }
      for (const q of parc.plantations) {
        if (q.espece === 'petales') continue
        const pied = q.espece.startsWith('erable') ? 0.5 * q.scale : q.rayon * 0.8
        expect(Math.hypot(q.x - p.x, q.z - p.z), `${q.espece} (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`).toBeGreaterThan(p.rayon + pied)
      }
    })
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
