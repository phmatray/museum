/**
 * La lumière précalculée : quelles faces du bâtiment reçoivent une carte de
 * lumière cuite par Blender (`tools/blender/bake-lumiere.py`), et où chacune se
 * range dans l'atlas.
 *
 * Le bâtiment est fait de boîtes alignées (`mesh.ts`, `parement.ts`,
 * `plafonds.ts`) : chaque face visible d'une boîte reçoit son rectangle dans un
 * atlas unique, à densité constante. Blender cuit sur ces rectangles, la scène
 * les relit par face (`scene/lumiere.ts`). Les deux côtés partagent la même
 * convention, décrite par `coordonneesDeFace`.
 *
 * Une boîte se retrouve par sa CLÉ — sa géométrie arrondie au millimètre — et
 * non par son rang : si le plan change sans nouvelle cuisson, les boîtes
 * inchangées gardent leur lumière et les autres n'en ont simplement pas.
 *
 * Pur : ni three ni React.
 */
import { bandesDuSol, parementDuHall, peintureDesSalles } from './parement.ts'
import { meshLevel, type Box } from './mesh.ts'
import { plafonds } from './plafonds.ts'
import { EXT } from './svg.ts'
import type { Plan } from './types.ts'

const EPS = 1e-6
/** Marge autour de chaque face dans l'atlas, en texels : le filtrage bilinéaire lit un texel au-delà du bord. */
export const MARGE = 2

/**
 * Une face : 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z — l'ordre des groupes de
 * `BoxGeometry`. Ses coordonnées (s, t) ∈ [0, 1]² courent selon (z, y) pour
 * ±x, (x, z) pour ±y, (x, y) pour ±z.
 */
export type Face = 0 | 1 | 2 | 3 | 4 | 5

/** Ce que Blender doit savoir d'une surface pour que la lumière y rebondisse juste. */
export type Matiere = 'platre' | 'pierre' | 'terrazzo' | 'parquet' | 'granit' | `#${string}`

export interface Surface {
  cle: string
  boite: Box
  matiere: Matiere
}

export const cleDeBoite = (b: Box): string => [b.x, b.y, b.z, b.w, b.h, b.d].map((v) => Math.round(v * 1000)).join(',')

/** Les deux dimensions (s, t) d'une face, en mètres. */
export function dimensionsDeFace(b: Box, f: Face): [number, number] {
  return f < 2 ? [b.d, b.h] : f < 4 ? [b.w, b.d] : [b.w, b.h]
}

/**
 * Les surfaces cuites, tous niveaux confondus : murs, linteaux, dalles, parement,
 * peintures, plafonds de plâtre, bandes du sol. Pas l'escalier (le marbre de
 * Blender remplace ses marches), ni le verre, ni les profilés.
 */
export function surfacesCuites(plan: Plan): Surface[] {
  const out: Surface[] = []
  const vues = new Set<string>()
  const ajouter = (b: Box, matiere: Matiere) => {
    const cle = cleDeBoite(b)
    if (vues.has(cle)) return
    vues.add(cle)
    out.push({ cle, boite: b, matiere })
  }
  for (const l of plan.levels) {
    const balcons = l.rooms.filter((r) => r.kind === 'balcony')
    const galeries = l.rooms.filter((r) => r.kind === 'gallery')
    const centreDe = (b: Box) => (r: { x: number; z: number; width: number; depth: number }) =>
      Math.abs(r.x + r.width / 2 - b.x) < EPS && Math.abs(r.z + r.depth / 2 - b.z) < EPS
    for (const b of meshLevel(plan, l.id)) {
      if (b.kind === 'wall' || b.kind === 'lintel') ajouter(b, 'platre')
      else if (b.kind === 'slab' && b.y + b.h / 2 <= l.elevation + EPS)
        ajouter(b, balcons.some(centreDe(b)) ? 'pierre' : l.id === 0 && !galeries.some(centreDe(b)) ? 'terrazzo' : 'parquet')
    }
    for (const b of parementDuHall(plan, l.id)) ajouter(b, 'pierre')
    for (const p of peintureDesSalles(plan, l.id)) for (const b of p.boites) ajouter(b, p.couleur as Matiere)
    for (const b of plafonds(plan, l.id).platre) ajouter(b, 'platre')
  }
  for (const b of bandesDuSol(plan)) ajouter(b, 'granit')
  return out
}

/**
 * Les faces qu'on peut voir. Une face est cachée si, poussée d'un millimètre
 * vers le dehors, son centre et ses quatre coins (rentrés de 10 %) entrent chacun
 * dans une autre boîte (un mur sous sa
 * peinture, un plafond sous la dalle), si elle regarde dehors depuis la façade,
 * sous la terre, ou le ciel depuis le haut du bâtiment.
 */
export function facesVisibles(plan: Plan, surfaces: Surface[], obstacles: Box[] = []): Face[][] {
  const toutes = [...surfaces.map((s) => s.boite), ...obstacles]
  const haut = plan.levels.length * plan.storey - plan.slab
  const dedans = (p: [number, number, number], soi: Box) =>
    toutes.some((b) => b !== soi && Math.abs(p[0] - b.x) < b.w / 2 - EPS && Math.abs(p[1] - b.y) < b.h / 2 - EPS && Math.abs(p[2] - b.z) < b.d / 2 - EPS)
  return surfaces.map(({ boite: b }) =>
    ([0, 1, 2, 3, 4, 5] as Face[]).filter((f) => {
      const axe = f >> 1
      const signe = f % 2 === 0 ? 1 : -1
      const demi = [b.w, b.h, b.d][axe] / 2
      const plan_ = [b.x, b.y, b.z][axe] + signe * demi
      if (axe === 1 && signe < 0 && plan_ <= -plan.slab + EPS) return false
      if (axe === 1 && signe > 0 && plan_ >= haut - EPS) return false
      if (axe === 0 && (plan_ <= -EXT + EPS || plan_ >= plan.width + EXT - EPS)) return false
      if (axe === 2 && (plan_ <= -EXT + EPS || plan_ >= plan.depth + EXT - EPS)) return false
      // Cinq points : le centre seul se laissait cacher par une bande du sol qui le traverse.
      const [u, v] = [[2, 1], [0, 2], [0, 1]][axe]
      const tailles = [b.w, b.h, b.d]
      return [[0, 0], [-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].some(([a, c]) => {
        const p: [number, number, number] = [b.x, b.y, b.z]
        p[axe] = plan_ + signe * 1e-3
        p[u] += a * tailles[u]
        p[v] += c * tailles[v]
        return !dedans(p, b)
      })
    }),
  )
}

/** Un rectangle d'atlas, en texels, origine en BAS à gauche (la convention UV de Blender et de three). */
export type Rect = [number, number, number, number]

export interface Emballage {
  largeur: number
  hauteur: number
  /** Par surface, par face (0…5) : le rectangle, ou `null` si la face n'est pas cuite. */
  rects: (Rect | null)[][]
}

/**
 * Range les faces par étagères, les plus hautes d'abord : chaque face occupe
 * `ceil(dimension × densité)` texels (au moins deux), plus `MARGE` autour.
 * Rend `null` si l'atlas déborde de `hauteurMax`.
 */
export function emballer(surfaces: Surface[], visibles: Face[][], densite: number, largeur: number, hauteurMax: number): Emballage | null {
  const texels = (m: number) => Math.max(2, Math.ceil(m * densite))
  const faces = surfaces.flatMap(({ boite }, i) =>
    visibles[i].map((f) => {
      const [s, t] = dimensionsDeFace(boite, f)
      return { i, f, w: texels(s), h: texels(t) }
    }),
  )
  // Tri stable et total : la même entrée rend toujours le même atlas.
  faces.sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i || a.f - b.f)
  const rects: (Rect | null)[][] = surfaces.map(() => [null, null, null, null, null, null])
  let [x, y, etagere] = [0, 0, 0]
  for (const c of faces) {
    const [w, h] = [c.w + 2 * MARGE, c.h + 2 * MARGE]
    if (w > largeur) return null
    if (x + w > largeur) [x, y, etagere] = [0, y + etagere, 0]
    if (y + h > hauteurMax) return null
    rects[c.i][c.f] = [x + MARGE, y + MARGE, x + MARGE + c.w, y + MARGE + c.h]
    x += w
    etagere = Math.max(etagere, h)
  }
  return { largeur, hauteur: y + etagere, rects }
}

/**
 * Les coordonnées (s, t) d'un coin de la boîte unité (±0,5) sur la face `f` —
 * la convention que partagent la cuisson et le shader.
 */
export function coordonneesDeFace(f: Face, p: [number, number, number]): [number, number] {
  const [x, y, z] = p.map((v) => v + 0.5)
  return f < 2 ? [z, y] : f < 4 ? [x, z] : [x, y]
}
