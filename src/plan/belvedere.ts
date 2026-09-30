/**
 * Le BELVÉDÈRE du fond du jardin, et le ROJI qui y mène.
 *
 * ── Pourquoi ──
 *
 * Le jardin se lisait d'un seul regard depuis le portique : une pelouse plate,
 * l'étang, le mur de brique, le ciel. Rien ne tirait l'œil au-delà, aucun point
 * d'où voir le tout, aucune allée qui cadre quoi que ce soit. Le belvédère en
 * est la réponse de composition :
 *
 * - un REPÈRE : une terrasse de pierre de 2,70 m dans l'angle sud-est, un
 *   pavillon de thé (azumaya) dessus, qu'on voit de l'autre bout de l'étang et
 *   dont la lanterne brille la nuit — on a envie d'y aller ;
 * - une COMPRESSION : on n'y monte pas par la pelouse. Le roji, l'allée étroite
 *   du chemin de thé, part du pont, passe une petite porte couverte et file
 *   entre une palissade de bambou (kenninji-gaki), qui cache l'eau et le musée,
 *   et le mur d'enceinte sous les érables ;
 * - une RÉVÉLATION : l'escalier monte dos au jardin ; en haut, on se retourne,
 *   et l'on a d'un coup l'étang au premier plan, la cascade, les érables
 *   rouges, et au fond la façade et sa verrière — une PERCÉE où l'on a
 *   éclairci les grands arbres (`dansLaPercee`) ;
 *
 * La terrasse est le relief du parc (`relief.ts` lit `coteDuBelvedere`) : on y
 * marche comme sur une butte, les murs et le parapet sont des obstacles du
 * rez-de-chaussée, comme ceux de la baraque du chantier.
 *
 * Tout vit dans `belvedere.json`, lu aussi par `tools/blender/build-belvedere.py`.
 * Pur : ni three ni React.
 */
import BELVEDERE_JSON from './belvedere.json' with { type: 'json' }
import type { Box } from './mesh.ts'
import type { Rect } from './types.ts'

export const BELVEDERE = BELVEDERE_JSON as unknown as {
  emprise: Rect
  /** La cote du dallage de la terrasse. */
  cote: number
  mur: number
  fondation: number
  parapet: { haut: number; epaisseur: number; chaperon: number; debord: number }
  escalier: { x: number; largeur: number; z0: number; pied: number; marches: number; limon: number; garde: number }
  pavillon: { x: number; z: number; cote: number; poteau: number; egout: number; faitage: number; debord: number; banc: { profondeur: number; hauteur: number } }
  roji: { x: number; z0: number; largeur: number; ondulation: number }
  palissade: { x: number; z0: number; z1: number; haut: number; epaisseur: number }
  porte: { z: number; passage: number; poteau: number; haut: number }
  percee: { x: number; z: number; de: number; a: number; portee: number }
  /** Plantés à dessein ; `lacet` fixe l'orientation (le lierre regarde le dehors du mur), sinon elle est tirée. */
  sujets: { espece: 'erable-rouge' | 'erable-vert' | 'buis' | 'azalee' | 'fougere' | 'lierre'; x: number; z: number; scale: number; belvedere?: boolean; lacet?: number }[]
}

const { emprise: E, cote: H, mur: M, escalier: S, pavillon: P, palissade: F, porte: G, roji: J } = BELVEDERE

/** L'escalier : sa volée, du pied au mur nord de la terrasse (sans les limons). */
export const VOLEE: Rect = { x: S.x, z: S.z0, width: S.largeur, depth: E.z - S.z0 }
/** Tout ce qui est bâti au sol : la terrasse, sa volée et ses limons. */
export const EMPRISE_BELVEDERE: Rect[] = [E, { x: S.x - S.limon, z: S.z0, width: S.largeur + 2 * S.limon, depth: E.z - S.z0 }]
/** Là où l'on arrive en haut de l'escalier, et d'où l'on voit le mieux (le coin nord-ouest de la terrasse). */
export const HAUT_DE_L_ESCALIER: [number, number] = [S.x + S.largeur / 2, E.z + M + 0.8]
export const POINT_DE_VUE: [number, number] = [E.x + M + 1.1, E.z + M + 1.4]
/** Le pied de l'escalier, dans l'axe du roji. */
export const PIED_DE_L_ESCALIER: [number, number] = [J.x, S.z0 - 0.6]

const dedans = (r: Rect, x: number, z: number) => x > r.x && x < r.x + r.width && z > r.z && z < r.z + r.depth

/** Vrai sur le bâti du belvédère (terrasse, volée, limons), élargi de `marge`. */
export const dansLeBelvedere = (x: number, z: number, marge = 0) =>
  EMPRISE_BELVEDERE.some((r) => x > r.x - marge && x < r.x + r.width + marge && z > r.z - marge && z < r.z + r.depth + marge)

/**
 * La cote du sol du belvédère, ou `null` hors de lui : la terrasse, de niveau,
 * et la volée, en plan incliné du pied au dallage (la marche l'y monte comme
 * les volées du musée, sans sauter de marche en marche).
 */
export function coteDuBelvedere(x: number, z: number): number | null {
  if (dedans(E, x, z)) return H
  if (dedans(VOLEE, x, z)) return S.pied + (H - S.pied) * Math.min(1, (z - S.z0) / (E.z - S.z0))
  return null
}

/** La marche d'escalier : sa hauteur et son giron. */
export const MARCHE = { haut: (H - S.pied) / S.marches, giron: (E.z - S.z0) / S.marches }

/**
 * Ce qui arrête la marche : les quatre murs (le nord percé de la volée), les
 * limons, les poteaux et le banc du pavillon, la palissade du roji et sa porte.
 * Du haut, les murs sont le parapet ; d'en bas, ils sont le mur.
 */
export const OBSTACLES_BELVEDERE: Rect[] = (() => {
  const t = F.epaisseur / 2
  const [ga, gb] = [J.x - G.passage / 2, J.x + G.passage / 2]
  const p = P.cote / 2
  return [
    { x: E.x, z: E.z, width: M, depth: E.depth },
    { x: E.x + E.width - M, z: E.z, width: M, depth: E.depth },
    { x: E.x, z: E.z + E.depth - M, width: E.width, depth: M },
    { x: E.x, z: E.z, width: S.x - S.limon - E.x, depth: M },
    { x: S.x + S.largeur + S.limon, z: E.z, width: E.x + E.width - S.x - S.largeur - S.limon, depth: M },
    // Les limons, jusqu'au parapet : dans l'épaisseur du mur nord aussi.
    { x: S.x - S.limon, z: S.z0, width: S.limon, depth: E.z + M - S.z0 },
    { x: S.x + S.largeur, z: S.z0, width: S.limon, depth: E.z + M - S.z0 },
    // Les poteaux du pavillon, et son banc le long du côté sud.
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => ({ x: P.x + u * p - P.poteau / 2, z: P.z + v * p - P.poteau / 2, width: P.poteau, depth: P.poteau })),
    { x: P.x - p + P.poteau / 2, z: P.z + p - P.poteau / 2 - P.banc.profondeur, width: P.cote - P.poteau, depth: P.banc.profondeur },
    // La palissade du roji, côté ruisseau, et la porte : deux poteaux, deux ailes jusqu'à la palissade et au mur d'enceinte.
    { x: F.x - t, z: F.z0, width: F.epaisseur, depth: F.z1 - F.z0 },
    { x: F.x - t, z: G.z - t, width: ga - (F.x - t), depth: F.epaisseur },
    { x: gb, z: G.z - t, width: E.x + E.width + 2 - gb, depth: F.epaisseur },
    ...[ga, gb].map((x) => ({ x: x - G.poteau / 2, z: G.z - G.poteau / 2, width: G.poteau, depth: G.poteau })),
  ]
})()

/**
 * La percée : un secteur ouvert depuis la terrasse vers l'étang et la façade,
 * où les grands arbres ont été éclaircis. Les boules et les azalées y restent :
 * elles font le premier plan, sous le regard.
 */
export function dansLaPercee(x: number, z: number): boolean {
  const { x: cx, z: cz, de, a, portee } = BELVEDERE.percee
  const d = Math.hypot(x - cx, z - cz)
  if (d > portee || d < 1) return false
  let angle = (Math.atan2(z - cz, x - cx) * 180) / Math.PI
  if (angle > 0) angle -= 360
  return angle >= de && angle <= a
}

/**
 * Les pierres du belvédère, en boîtes (la pierre du parvis et du chaperon du
 * mur d'enceinte, `ParkLayer`) : les murs de soutènement, fondés sous le sol le
 * plus bas de leur pied ; le parapet et son chaperon ; le dallage ; les seize
 * marches et leurs limons, en redans comme le mur d'enceinte. Le dallage et les
 * marches (`slab`, `step`) prennent la pierre foulée du parvis, le reste celle du mur.
 */
export function pierresDuBelvedere(sol: (x: number, z: number) => number): Box[] {
  const out: Box[] = []
  const boite = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, kind: Box['kind'] = 'wall'): Box =>
    ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: z1 - z0, h: y1 - y0, kind })
  const bas = (x0: number, x1: number, z0: number, z1: number) => {
    let m = Infinity
    for (let x = x0; x <= x1 + 1e-6; x += 0.5) for (let z = z0; z <= z1 + 1e-6; z += 0.5) m = Math.min(m, sol(x, z))
    return m - BELVEDERE.fondation
  }
  const { haut, epaisseur: e, chaperon, debord } = BELVEDERE.parapet
  const [x0, x1, z0, z1] = [E.x, E.x + E.width, E.z, E.z + E.depth]
  const [sa, sb] = [S.x - S.limon, S.x + S.largeur + S.limon]
  // Les murs : [x0, x1, z0, z1] de chaque pan, et le côté du parapet (sa face extérieure affleure).
  const pans: [number, number, number, number, 'o' | 'e' | 'n' | 's'][] = [
    [x0, x0 + M, z0, z1, 'o'], [x1 - M, x1, z0, z1, 'e'], [x0 + M, x1 - M, z1 - M, z1, 's'],
    [x0 + M, sa, z0, z0 + M, 'n'], [sb, x1 - M, z0, z0 + M, 'n'],
  ]
  for (const [a, b, c, d, cote] of pans) {
    out.push(boite(a, b, c, d, bas(a - 0.3, b + 0.3, c - 0.3, d + 0.3), H))
    const [pa, pb, pc, pd] = cote === 'o' ? [a, a + e, c, d] : cote === 'e' ? [b - e, b, c, d] : cote === 'n' ? [a, b, c, c + e] : [a, b, d - e, d]
    out.push(boite(pa, pb, pc, pd, H, H + haut))
    out.push(boite(pa - debord, pb + debord, pc - debord, pd + debord, H + haut, H + haut + chaperon))
  }
  // Le soubassement et le bandeau, en saillie de 6 cm sur les faces vues : l'ombre
  // de leurs arêtes dessine les assises, comme les bandeaux de pierre de la façade.
  const s = 0.06
  for (const [a, b, c, d, cote] of pans) {
    const [ga, gb, gc, gd] = cote === 'o' ? [a - s, a, c - s, d + s] : cote === 'e' ? [b, b + s, c - s, d + s] : cote === 'n' ? [a === x0 + M ? x0 - s : a, b === x1 - M ? x1 + s : b, c - s, c] : [x0 - s, x1 + s, d, d + s]
    const pied = bas(a - 0.3, b + 0.3, c - 0.3, d + 0.3)
    out.push(boite(ga, gb, gc, gd, pied, pied + BELVEDERE.fondation + 0.55))
    out.push(boite(ga, gb, gc, gd, H - 0.22, H - 0.04))
  }
  // Le dallage, 12 cm d'épaisseur, arasé à la cote.
  out.push(boite(x0 + M, x1 - M, z0 + M, z1 - M, H - 0.12, H, 'slab'))
  // Le palier du haut, dans l'épaisseur du mur nord.
  out.push(boite(S.x, S.x + S.largeur, z0, z0 + M, H - 0.12, H, 'slab'))
  // Les marches : chacune du pied au mur, sa contremarche à son nez ; les limons en redans, 75 cm au-dessus du nez.
  const pied = bas(sa, sb, S.z0 - 0.3, S.z0 + 0.3)
  for (let i = 0; i < S.marches; i++) {
    const [nez, dessus] = [S.z0 + i * MARCHE.giron, S.pied + (i + 1) * MARCHE.haut]
    out.push(boite(S.x, S.x + S.largeur, nez, z0, pied, dessus, 'step'))
    for (const [a, b] of [[sa, S.x], [S.x + S.largeur, sb]]) out.push(boite(a, b, nez, nez + MARCHE.giron, pied, dessus + S.garde))
  }
  // Dans l'épaisseur du mur nord, les limons rejoignent le parapet.
  for (const [a, b] of [[sa, S.x], [S.x + S.largeur, sb]]) {
    out.push(boite(a, b, z0, z0 + M, bas(a, b, z0, z0 + M), H + haut))
    out.push(boite(a - debord, b + debord, z0 - debord, z0 + M + debord, H + haut, H + haut + chaperon))
  }
  // Le chaperon des limons, en redans lui aussi.
  for (let i = 0; i < S.marches; i++) {
    const [nez, dessus] = [S.z0 + i * MARCHE.giron, S.pied + (i + 1) * MARCHE.haut + S.garde]
    for (const [a, b] of [[sa, S.x], [S.x + S.largeur, sb]]) out.push(boite(a - debord, b + debord, nez, nez + MARCHE.giron, dessus, dessus + chaperon))
  }
  return out
}
