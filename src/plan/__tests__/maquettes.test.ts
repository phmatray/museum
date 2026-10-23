// @vitest-environment node
/**
 * Les GLB commités (`tools/blender/build-*.py`) sont modelés aux cotes du plan :
 * un ré-export qui oublierait la conversion d'axes, une pièce qui déborderait
 * dans une baie, un vélo enfoncé dans le sol ne se verraient qu'à l'œil, sur
 * le site publié. On les lit tels quels (`glb.ts`) et on les confronte au plan.
 */
import { describe, expect, it } from 'vitest'

import { BAIE_BATLLO } from '../batllo'
import { MOBILIER } from '../mobilier'
import { MUSEE } from '../musee'
import { MODELES_PNJ } from '../pnj'
import { VOUTE } from '../plafonds'
import { ARCHITRAVE, LINTEAU, PLINTHE } from '../portes'
import { solDuParc } from '../relief'
import { BORNE, PANNEAU, SALLE, TOILE } from '../vitrines'
import { boite, lireGlb, noeud, racines, sommets } from './glb'

const toutes = async (f: string) => {
  const d = await lireGlb(f)
  return { d, b: boite(sommets(racines(d))) }
}

it('batllo.glb remplit la baie de la salle d’honneur, sur ses deux faces', async () => {
  const { b } = await toutes('architecture/batllo.glb')
  const niveau = MUSEE.levels.find((l) => l.id === BAIE_BATLLO.level)!
  const [g, d] = [BAIE_BATLLO.x - BAIE_BATLLO.width / 2, BAIE_BATLLO.x + BAIE_BATLLO.width / 2]
  // Le chambranle déborde un peu sur le mur, de chaque côté.
  expect(b.min[0]).toBeGreaterThan(g - 0.2)
  expect(b.min[0]).toBeLessThan(g)
  expect(b.max[0]).toBeLessThan(d + 0.2)
  expect(b.max[0]).toBeGreaterThan(d)
  expect(b.min[1]).toBeCloseTo(niveau.elevation, 2)
  expect(b.max[1]).toBeCloseTo(niveau.elevation + MUSEE.storey - MUSEE.slab, 2)
  // Dans l'épaisseur du mur, en saillie des deux côtés, loin du tableau des départs.
  expect(b.min[2]).toBeGreaterThan(BAIE_BATLLO.z - 0.3)
  expect(b.min[2]).toBeLessThan(BAIE_BATLLO.z - 0.15)
  expect(b.max[2]).toBeGreaterThan(BAIE_BATLLO.z + 0.15)
  expect(b.max[2]).toBeLessThan(BAIE_BATLLO.z + 0.5)
})

it('chambranle.glb : architrave, plinthe et entablement aux cotes du plan, hors de la baie', async () => {
  const d = await lireGlb('architecture/chambranle.glb')
  const W0 = 2
  const pts = sommets(noeud(d, 'Chambranle'))
  const c = boite(pts)
  expect(c.min[1]).toBeCloseTo(PLINTHE.h, 2)
  expect(c.max[1]).toBeCloseTo(LINTEAU + ARCHITRAVE, 2)
  expect(c.max[0]).toBeCloseTo(W0 / 2 + ARCHITRAVE, 2)
  expect(c.min[2]).toBeCloseTo(0, 2)
  expect(c.max[2]).toBeGreaterThan(0.06)
  expect(c.max[2]).toBeLessThan(0.1)
  // Aucun sommet dans la baie : sous le linteau, |x| reste au-delà de W0 / 2.
  for (const [x, y] of pts) if (y < LINTEAU - 1e-3) expect(Math.abs(x)).toBeGreaterThan(W0 / 2 - 1e-3)

  const pl = boite(sommets(noeud(d, 'Plinthe')))
  expect(pl.max[0] - pl.min[0]).toBeCloseTo(PLINTHE.l, 2)
  expect(pl.max[1]).toBeCloseTo(PLINTHE.h, 2)

  const e = boite(sommets(noeud(d, 'Entablement')))
  expect(e.min[1]).toBeCloseTo(LINTEAU + ARCHITRAVE, 2)
  expect(e.max[2]).toBeLessThan(0.25)
})

it('accessoires.glb pose chaque vélo de l’abri sur le sol, à 1 cm près', async () => {
  const abri = MOBILIER.find((m) => m.piece === 'AbriVelos')!
  const d = await lireGlb('architecture/accessoires.glb')
  const racine = noeud(d, 'AbriVelos')
  const velos = racine.listChildren().filter((n) => n.getName().startsWith('Velo'))
  expect(velos.map((n) => n.getName()).sort()).toEqual(['VeloCourse', 'VeloDame', 'VeloHollandais'])
  // Comme le mobilier : la pièce à la place du meuble, tournée de son lacet (racine de la scène, matrice propre ignorée).
  const [c, s] = [Math.cos(abri.lacet), Math.sin(abri.lacet)]
  const [r0, r1, r2] = racine.getTranslation()
  const poser = ([x, y, z]: [number, number, number]): [number, number, number] => {
    const [lx, ly, lz] = [x - r0, y - r1, z - r2]
    return [abri.x + c * lx + s * lz, abri.y + ly, abri.z - s * lx + c * lz]
  }
  for (const v of velos) {
    const b = boite(sommets(v, poser))
    const [cx, cz] = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2]
    expect(Math.abs(b.min[1] - solDuParc(cx, cz)), v.getName()).toBeLessThan(0.01)
  }
})

describe('escalier.glb', () => {
  it('tient dans l’emprise des volées et du palier, le palier à sa cote', async () => {
    const { d, b } = await toutes('architecture/escalier.glb')
    const tout = [...MUSEE.flights, ...MUSEE.landings]
    // Au plus un nez de marche (3,5 cm) et une moulure au-delà du plan.
    expect(b.min[0]).toBeGreaterThan(Math.min(...tout.map((r) => r.x)) - 0.1)
    expect(b.max[0]).toBeLessThan(Math.max(...tout.map((r) => r.x + r.width)) + 0.1)
    expect(b.min[2]).toBeGreaterThan(Math.min(...tout.map((r) => r.z)) - 0.1)
    expect(b.max[2]).toBeLessThan(Math.max(...tout.map((r) => r.z + r.depth)) + 0.1)
    expect(b.min[1]).toBeGreaterThan(-0.01)
    expect(b.max[1]).toBeLessThan(MUSEE.storey + 0.01)
    expect(boite(sommets(noeud(d, 'Escalier_Palier'))).max[1]).toBeCloseTo(MUSEE.landings[0].elevation, 2)
  })

  it('garde ses bulbes devant la volée centrale, loin de la niche de Bavette', async () => {
    const d = await lireGlb('architecture/escalier.glb')
    const centrale = MUSEE.flights.find((f) => f.id === 'volee-centrale')!
    const ouest = MUSEE.flights.find((f) => f.id === 'volee-ouest')!
    let debordMax = 0
    // Tout ce qui est sous les volées latérales (leur paillasse descend à 36 cm sous le palier).
    for (const [x, y, z] of sommets(racines(d))) {
      if (y > ouest.bottom - 0.4) continue
      const debord = Math.max(centrale.x - x, x - centrale.x - centrale.width)
      // Le limon et ses moulures sortent de quelques centimètres ; un bulbe, de plus.
      if (debord > 0.12) expect(z, `bulbe en (${x}, ${z})`).toBeGreaterThan(18.9)
      // Jamais dans le passage vers la niche de Bavette, ni dans la niche.
      if (x < centrale.x) expect(x).toBeGreaterThan(ouest.x + ouest.width + 0.5)
      debordMax = Math.max(debordMax, debord)
    }
    expect(debordMax).toBeGreaterThan(0.5)
    expect(debordMax).toBeLessThanOrEqual(0.8 + 0.04)
  })
})

it('nef.glb coiffe le hall, au-dessus des murs de l’étage', async () => {
  const hall = MUSEE.levels[0].rooms.find((r) => r.id === 'hall')!
  const { b } = await toutes('architecture/nef.glb')
  expect(b.min[0]).toBeCloseTo(hall.x - 0.4, 0)
  expect(b.max[0]).toBeCloseTo(hall.x + hall.width + 0.4, 0)
  expect(b.min[2]).toBeGreaterThan(hall.z - 0.5)
  expect(b.max[2]).toBeLessThan(hall.z + hall.depth + 0.5)
  // Seules les lanternes descendent sous les murs, et jamais au niveau des yeux d'un balcon.
  expect(b.min[1]).toBeGreaterThan(MUSEE.storey + 1.8)
  expect(b.max[1]).toBeGreaterThan(2 * MUSEE.storey - MUSEE.slab + MUSEE.levels.length)
})

describe('salle-honneur.glb', () => {
  const murs = SALLE.sol + MUSEE.storey - MUSEE.slab

  it('tient dans la salle, du plancher au-dessous du parapet du toit', async () => {
    const { d, b } = await toutes('architecture/salle-honneur.glb')
    expect(b.min[0]).toBeGreaterThan(SALLE.x0)
    expect(b.max[0]).toBeLessThan(SALLE.x1)
    expect(b.min[2]).toBeGreaterThan(SALLE.z0)
    expect(b.max[2]).toBeLessThan(SALLE.z1)
    expect(b.min[1]).toBeGreaterThanOrEqual(SALLE.sol - 1e-3)
    expect(b.min[1]).toBeLessThan(SALLE.sol + 0.01)
    expect(b.max[1]).toBeLessThan(murs + 1.2)
    for (const nom of ['Voute', 'Soleil', 'Peau', 'Lambris', 'Os', 'Portes', 'Parquet']) expect(() => noeud(d, nom), nom).not.toThrow()
    const parquet = noeud(d, 'Parquet').getMesh()!.listPrimitives()[0]
    expect(parquet.getAttribute('TEXCOORD_0')).toBeTruthy()
    expect(parquet.getAttribute('COLOR_0')).toBeTruthy()
  })

  it('porte les rails sur une corniche plate, là où `projecteurs.ts` les pend', async () => {
    const d = await lireGlb('architecture/salle-honneur.glb')
    const corniche = murs + VOUTE.gorge
    const i = 0.15
    for (const [x, y, z] of sommets(noeud(d, 'Voute'))) {
      const dist = Math.min(x - SALLE.x0 - i, SALLE.x1 - i - x, z - SALLE.z0 - i, SALLE.z1 - i - z)
      if (dist > 1.2 && dist < 1.9) expect(y).toBeCloseTo(corniche, 2)
    }
  })

  it('laisse libres les deux portes : aucun chêne sous le linteau dans la baie', async () => {
    const d = await lireGlb('architecture/salle-honneur.glb')
    const portes = MUSEE.levels.find((l) => l.elevation === SALLE.sol)!.openings.filter((o) => o.kind === 'door' && (o.a === 'honneur' || o.b === 'honneur'))
    expect(portes).toHaveLength(2)
    for (const [x, y, z] of sommets(noeud(d, 'Portes'))) {
      // Les angles hauts de la baie sont arrondis, comme chez Gaudí : on juge sous eux.
      if (y > SALLE.sol + 2.2) continue
      for (const o of portes) if (Math.abs(x - o.x) < 0.5) expect(Math.abs(z - o.z)).toBeGreaterThan(o.width / 2 - 0.015)
    }
  })
})

it('vitrines.glb : panneau, cadre et borne aux cotes de `plan/vitrines.ts`', async () => {
  const d = await lireGlb('architecture/vitrines.glb')
  const p = boite(sommets(noeud(d, 'Panneau')))
  expect(p.max[0] - p.min[0]).toBeCloseTo(PANNEAU.largeur, 1)
  expect(p.max[1] - p.min[1]).toBeCloseTo(PANNEAU.hauteur, 1)
  expect(p.min[2]).toBeCloseTo(0, 3)
  expect(p.max[2]).toBeCloseTo(PANNEAU.epaisseur, 3)

  // Le cadre ne mord pas sur l'image, et tient sur le panneau.
  const cadre = sommets(noeud(d, 'Cadre'))
  const c = boite(cadre)
  expect(c.min[2]).toBeGreaterThanOrEqual(-1e-3)
  expect(c.max[0] - c.min[0]).toBeLessThan(TOILE.largeur + 2 * TOILE.profil + 0.3)
  for (const [x, y] of cadre) expect(Math.abs(x) >= TOILE.largeur / 2 - 1e-3 || Math.abs(y) >= TOILE.hauteur / 2 - 1e-3).toBe(true)

  // La borne tient dans son obstacle, à hauteur de pupitre.
  const b = boite(sommets(noeud(d, 'Borne')))
  expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(BORNE.largeur)
  expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(BORNE.profondeur)
  expect(b.max[1]).toBeGreaterThan(1.1)
  expect(b.max[1]).toBeLessThan(1.3)
})

it('plantes.glb : chaque cuve centrée sur son pivot et posée à y = 0 (props.ts les pose sans recentrer)', async () => {
  const d = await lireGlb('architecture/plantes.glb')
  for (const nom of ['Kentia-vasque', 'Lyrata-cuve', 'Olivier-cuve']) {
    const b = boite(sommets(noeud(d, nom)))
    expect(Math.abs(b.min[0] + b.max[0]) / 2, nom).toBeLessThan(0.01)
    expect(Math.abs(b.min[2] + b.max[2]) / 2, nom).toBeLessThan(0.01)
    expect(Math.abs(b.min[1]), nom).toBeLessThan(0.01)
  }
})

/**
 * La peau d'un PNJ dans l'action `nom`, posée par son squelette (skinning glTF sur le processeur, comme
 * le shader : Σ poids · monde(os) · inverse de liaison) : la part des arêtes qui s'étirent au double
 * (et plus d'un centimètre), au pire de onze images.
 */
async function etirement(n: number, nom: RegExp): Promise<number> {
  const d = await lireGlb(`pnj/pnj-${n}.glb`)
  const peau = d.getRoot().listSkins()[0]
  const os = peau.listJoints()
  const liaison = peau.getInverseBindMatrices()!
  const prim = d.getRoot().listMeshes()[0].listPrimitives()[0]
  const [P, J, W] = (['POSITION', 'JOINTS_0', 'WEIGHTS_0'] as const).map((a) => prim.getAttribute(a)!)
  const repos = Array.from({ length: P.getCount() }, (_, i) => P.getElement(i, []))
  const quoi = Array.from({ length: P.getCount() }, (_, i) => [J.getElement(i, []), W.getElement(i, [])])
  const ix = prim.getIndices()!.getArray()!
  const aretes: [number, number][] = []
  for (let k = 0; k < ix.length; k += 3) aretes.push([ix[k], ix[k + 1]], [ix[k + 1], ix[k + 2]], [ix[k + 2], ix[k]])
  const longueur = (p: number[][], [a, b]: [number, number]) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1], p[a][2] - p[b][2])
  const avant = aretes.map((e) => longueur(repos, e))
  const fois = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((s, k) => s + a[k * 4 + (i % 4)] * b[Math.floor(i / 4) * 4 + k], 0))
  const action = d.getRoot().listAnimations().find((a) => nom.test(a.getName()))!
  const fin = Math.max(...action.listSamplers().map((s) => s.getInput()!.getMax([])[0]))
  let pire = 0
  for (let f = 0; f <= 10; f++) {
    const t = (fin * f) / 10
    for (const c of action.listChannels()) {
      const s = c.getSampler()!
      const temps = s.getInput()!.getArray()!
      const i = Math.max(1, temps.findIndex((x) => x >= t))
      const u = Math.min(1, Math.max(0, (t - temps[i - 1]) / (temps[i] - temps[i - 1] || 1)))
      const [a, b] = [i - 1, i].map((k) => s.getOutput()!.getElement(k, []))
      const v = a.map((x, k) => x + (b[k] - x) * u)
      const noeud = c.getTargetNode()!
      if (c.getTargetPath() === 'rotation') noeud.setRotation(v.map((x) => x / Math.hypot(...v)) as [number, number, number, number])
      else if (c.getTargetPath() === 'translation') noeud.setTranslation(v as [number, number, number])
      else if (c.getTargetPath() === 'scale') noeud.setScale(v as [number, number, number])
    }
    const M = os.map((o, i) => fois(o.getWorldMatrix(), liaison.getElement(i, [])))
    const pose = repos.map((p, i) => {
      const [j, w] = quoi[i]
      return [0, 1, 2].map((c) => w.reduce((s, wk, k) => s + wk * (M[j[k]][c] * p[0] + M[j[k]][4 + c] * p[1] + M[j[k]][8 + c] * p[2] + M[j[k]][12 + c]), 0))
    })
    pire = Math.max(pire, aretes.filter((e, i) => longueur(pose, e) > 2 * avant[i] + 0.01).length / aretes.length)
  }
  return pire
}

it('pnj-*.glb : seuls les modèles au squelette juste sont montrés (la peau tient, bras ballants)', async () => {
  // Sain : 0,65 ‰ au plus ; les premiers pnj-2 (cou étiré) 5,6 ‰, pnj-3 (jean tiré par les mains) 2,1 ‰.
  for (let n = 0; n < 8; n++) expect((await etirement(n, /^idle/i)) < 0.0015, `pnj-${n}`).toBe(MODELES_PNJ.includes(n))
})
