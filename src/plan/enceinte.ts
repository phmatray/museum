/**
 * Le MUR D'ENCEINTE du parc : de la brique, comme le musée, couverte de pierre,
 * tenue par des piles, et une grille de fer forgé au bout de chaque accès.
 *
 * Sans lui, le parc s'arrêtait net : au bout de l'axe de l'entrée, l'allée
 * filait jusqu'à un horizon gris posé sur rien (audit du jardin). Un parc de
 * ville est clos ; ses allées finissent à une grille, et derrière le mur la
 * campagne continue (`ParkLayer`, le sol du dehors).
 *
 * Le mur suit le relief (`relief.ts`) par redans : chaque travée, entre deux
 * piles, a sa propre arase, posée au plus haut de son pied — rien ne flotte.
 * Sa face intérieure est le bord du terrain : la marche (`walk.ts`) s'y arrête
 * déjà.
 *
 * Pur : ni three ni React.
 */
import { generateur, type Allee, type PlantPlacement } from './park.ts'
import { hauteurDuParc } from './relief.ts'
import type { Box } from './mesh.ts'
import type { Rect } from './types.ts'

const EPAISSEUR = 0.4
/** Au-dessus du sol, au plus haut de la travée : l'œil (1,60 m) ne passe pas par-dessus. */
const HAUTEUR = 2.2
/** Le pied du mur descend d'autant sous le sol : sur la pente, jamais de jour dessous. */
const FONDATION = 0.4
const PAS = 4.5
const PILE = { cote: 0.62, sur: 0.3 }
const CHAPERON = { debord: 0.06, h: 0.1 }
const CHAPITEAU = { debord: 0.08, h: 0.14 }
/** Les piles d'une grille, plus fortes et plus hautes ; la grille, un barreau tous les 12 cm. */
const PORTAIL = { jeu: 0.5, cote: 0.8, sur: 0.75, pas: 0.12, barreau: 0.026, haut: 2.1 }

export interface Enceinte {
  brique: Box[]
  pierre: Box[]
  fer: Box[]
  /**
   * Le lierre qui grimpe au mur, par plaques, côté parc : de quoi casser la
   * répétition des travées. Le pied au sol, tourné vers le parc (le modèle
   * `src_lierre` regarde +z, `rotation` en lacet comme les plantations).
   */
  lierre: PlantPlacement[]
}

type Cote = { axe: 'x' | 'z'; cote: number; dehors: number; u0: number; u1: number }

/** Le mur autour de `terrain`, ouvert d'une grille là où une allée touche le bord. */
export function enceinte(terrain: Rect, allees: Allee[]): Enceinte {
  const out: Enceinte = { brique: [], pierre: [], fer: [], lierre: [] }
  // Son propre tirage : le mur ne change pas d'une brique.
  const alea = generateur('enceinte:lierre')
  const [x0, x1, z0, z1] = [terrain.x, terrain.x + terrain.width, terrain.z, terrain.z + terrain.depth]
  const e = EPAISSEUR
  // Le nord et le sud prennent les angles ; l'ouest et l'est s'arrêtent à leur face.
  const cotes: Cote[] = [
    { axe: 'x', cote: z0, dehors: -1, u0: x0 - e, u1: x1 + e },
    { axe: 'x', cote: z1, dehors: 1, u0: x0 - e, u1: x1 + e },
    { axe: 'z', cote: x0, dehors: -1, u0: z0, u1: z1 },
    { axe: 'z', cote: x1, dehors: 1, u0: z0, u1: z1 },
  ]
  const bouts = allees.flatMap((a) => [a.a, a.b].map((p) => ({ ...p, largeur: a.largeur })))
  for (const c of cotes) {
    /** Le point du plan à l'abscisse `u` du côté, à `v` vers le dehors depuis la face intérieure. */
    const point = (u: number, v = 0): [number, number] => (c.axe === 'x' ? [u, c.cote + c.dehors * v] : [c.cote + c.dehors * v, u])
    const sol = (u: number) => hauteurDuParc(...point(u))
    /** Une boîte de `a` à `b` le long du côté, de `v0` à `v1` vers le dehors, de `y0` à `y1`. */
    const boite = (a: number, b: number, v0: number, v1: number, y0: number, y1: number): Box => {
      const [p, q] = [c.cote + c.dehors * v0, c.cote + c.dehors * v1]
      const [ua, ub, va, vb] = [(a + b) / 2, b - a, (p + q) / 2, Math.abs(q - p)]
      return c.axe === 'x' ? { x: ua, z: va, w: ub, d: vb, y: (y0 + y1) / 2, h: y1 - y0, kind: 'wall' } : { x: va, z: ua, w: vb, d: ub, y: (y0 + y1) / 2, h: y1 - y0, kind: 'wall' }
    }
    /** Le plus bas et le plus haut du sol sur [a, b], au pas d'un demi-mètre. */
    const bornes = (a: number, b: number): [number, number] => {
      const n = Math.max(1, Math.ceil((b - a) / 0.5))
      const hs = Array.from({ length: n + 1 }, (_, i) => sol(a + ((b - a) * i) / n))
      return [Math.min(...hs), Math.max(...hs)]
    }

    // Les grilles : là où une allée finit sur ce côté.
    const portails = bouts
      .filter((p) => Math.abs((c.axe === 'x' ? p.z : p.x) - c.cote) < 1e-6)
      .map((p) => ({ u: c.axe === 'x' ? p.x : p.z, demi: p.largeur / 2 + PORTAIL.jeu }))
    // Les piles : aux angles, de part et d'autre de chaque grille, et régulièrement entre.
    // L'ouest et l'est n'ont pas de pile d'angle : leur mur bute sur celui du nord ou du sud.
    const angle = (u: number, s: number) => (c.axe === 'x' ? { u: u + (s * PILE.cote) / 2, cote: PILE.cote, portail: false } : { u, cote: 0, portail: false })
    const fixes: { u: number; cote: number; portail: boolean }[] = [
      angle(c.u0, 1),
      angle(c.u1, -1),
      ...portails.flatMap((g) => [-1, 1].map((s) => ({ u: g.u + s * (g.demi + PORTAIL.cote / 2), cote: PORTAIL.cote, portail: true }))),
    ].sort((a, b) => a.u - b.u)
    const piles: typeof fixes = []
    for (let i = 0; i < fixes.length; i++) {
      piles.push(fixes[i])
      const suivante = fixes[i + 1]
      if (!suivante || portails.some((g) => Math.abs((fixes[i].u + suivante.u) / 2 - g.u) < 1e-6)) continue
      const n = Math.round((suivante.u - fixes[i].u) / PAS)
      for (let k = 1; k < n; k++) piles.push({ u: fixes[i].u + ((suivante.u - fixes[i].u) * k) / n, cote: PILE.cote, portail: false })
    }

    const arases: number[] = []
    for (let i = 0; i + 1 < piles.length; i++) {
      const [a, b] = [piles[i].u + piles[i].cote / 2, piles[i + 1].u - piles[i + 1].cote / 2]
      const grille = portails.find((g) => Math.abs((a + b) / 2 - g.u) < 1e-6)
      const [bas, haut] = bornes(a, b)
      if (grille) {
        arases.push(haut + PORTAIL.haut)
        // Deux vantaux fermés : barreaux, traverses basse et haute, montant du milieu.
        const [y0, y1] = [bas + 0.06, haut + PORTAIL.haut]
        const v = [e / 2 - PORTAIL.barreau / 2, e / 2 + PORTAIL.barreau / 2] as const
        const n = Math.round((b - a) / PORTAIL.pas)
        for (let k = 1; k < n; k++) {
          const u = a + ((b - a) * k) / n
          out.fer.push(boite(u - PORTAIL.barreau / 2, u + PORTAIL.barreau / 2, ...v, y0, y1 + (k % 2 ? 0.08 : 0)))
        }
        for (const y of [y0 + 0.12, y1 - 0.35, y1 - 0.05]) out.fer.push(boite(a, b, v[0] - 0.01, v[1] + 0.01, y - 0.025, y + 0.025))
        out.fer.push(boite(grille.u - 0.03, grille.u + 0.03, v[0] - 0.012, v[1] + 0.012, y0, y1))
        continue
      }
      const arase = haut + HAUTEUR
      arases.push(arase)
      out.brique.push(boite(a, b, 0, e, bas - FONDATION, arase))
      // Une travée sur deux à peu près porte une plaque de lierre, parfois deux.
      const tirage = alea()
      for (let k = 0; k < (tirage < 0.12 ? 2 : tirage < 0.5 ? 1 : 0); k++) {
        const u = a + 1 + alea() * Math.max(0, b - a - 2)
        const [x, z] = point(u, -0.01)
        const vers = c.axe === 'x' ? (c.dehors < 0 ? 0 : Math.PI) : c.dehors < 0 ? Math.PI / 2 : -Math.PI / 2
        const scale = 0.75 + alea() * 0.4
        out.lierre.push({ espece: 'lierre', x, z, y: sol(u) - 0.05, rotation: vers, scale, rayon: 1.1 * scale })
      }
      out.pierre.push(boite(a, b, -CHAPERON.debord, e + CHAPERON.debord, arase, arase + CHAPERON.h))
    }
    piles.forEach((p, i) => {
      if (p.cote === 0) return
      const [a, b] = [p.u - p.cote / 2, p.u + p.cote / 2]
      const [bas] = bornes(a, b)
      const cote = Math.max(arases[i - 1] ?? -Infinity, arases[i] ?? -Infinity) + CHAPERON.h + (p.portail ? PORTAIL.sur : PILE.sur)
      const saillie = (p.cote - e) / 2
      out.brique.push(boite(a, b, -saillie, e + saillie, bas - FONDATION, cote))
      const d = CHAPITEAU.debord
      out.pierre.push(boite(a - d, b + d, -saillie - d, e + saillie + d, cote, cote + CHAPITEAU.h))
      // Sur les piles d'une grille, une boule de pierre : on lit l'entrée de loin.
      if (p.portail) out.pierre.push(boite(p.u - 0.22, p.u + 0.22, e / 2 - 0.22, e / 2 + 0.22, cote + CHAPITEAU.h, cote + CHAPITEAU.h + 0.44))
    })
  }
  return out
}
