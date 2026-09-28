/**
 * La constellation de la nef : chaque dépôt accroché est une étoile suspendue
 * dans le vide du hall, chaque salle un amas qui porte son nom, ses étoiles
 * reliées par un filet d'or. Elle flotte entre les deux balcons, chaque amas à
 * sa hauteur, de l'étage (le plancher des balcons est à +4,80) jusque sous la
 * voûte : on la traverse du regard depuis les balcons, on la voit d'en bas
 * comme un lustre de lumières.
 *
 * Elle était d'abord plaquée sous la verrière, à vingt mètres : coincée dans le
 * plafond et illisible. Chaque étoile pend maintenant à un fil, jusqu'à la voûte.
 *
 * Pur : ni three ni React. Déterministe : même accrochage, même ciel.
 */
import type { Accrochage } from './hang.ts'

/**
 * Le volume libre de la nef : entre les garde-corps des balcons, au-dessus de
 * l'escalier. Chaque amas y prend SA hauteur (entre `y0` et `y1`), et ses étoiles
 * s'étagent de ±`epaisseur`/2 autour : des groupes tous au même niveau faisaient
 * une nappe, pas un ciel.
 */
export const VOLUME = { x0: 19.9, x1: 28.1, z0: 16.5, z1: 39.2, y0: 5.6, y1: 10.6, epaisseur: 1.4 }
/** Les lanternes de `build-nef.py` : deux files, trois par file ; les étoiles s'en écartent. */
const LANTERNES = [20.5, 27.5].flatMap((x) => [20.75, 27.75, 34.75].map((z) => ({ x, z })))
const GARDE_LANTERNE = 0.9
/** La nef, pour les fils : axe, naissance et intrados de la voûte. */
const NEF = { cx: 24, naissance: 12.6, intrados: 7.55 }
const COLONNES = 7
const MARGE = 0.35

export interface Etoile {
  key: string
  salle: string
  x: number
  y: number
  z: number
  /** Le rayon de l'étoile, en mètres : elle grandit avec le logarithme de ses étoiles GitHub. */
  taille: number
  /** La hauteur où son fil s'accroche à la voûte. */
  accroche: number
}

export interface Constellation {
  salle: string
  nom: string
  etoiles: Etoile[]
  /** Les filets d'or : un arbre couvrant minimal, indices dans `etoiles`. */
  filets: [number, number][]
  /** Où poser le nom : au-dessus de l'amas. */
  etiquette: { x: number; y: number; z: number }
}

/** FNV-1a : un hachage stable d'une chaîne, dans [0, 1). */
function hache(texte: string, sel: string): number {
  let h = 0x811c9dc5
  for (const c of `${sel}:${texte}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return (h >>> 0) / 4294967296
}

/** Écarte une étoile des lanternes, vers l'axe de la nef. */
function horsDesLanternes(x: number, z: number): number {
  for (const l of LANTERNES) {
    const d = Math.hypot(x - l.x, z - l.z)
    if (d >= GARDE_LANTERNE) continue
    const dz = Math.min(GARDE_LANTERNE, Math.abs(z - l.z))
    const dx = Math.sqrt(GARDE_LANTERNE * GARDE_LANTERNE - dz * dz)
    return l.x < NEF.cx ? l.x + dx : l.x - dx
  }
  return x
}

/** La voûte au-dessus d'un point : l'intrados des arcs, où les fils s'accrochent. */
const voute = (x: number) => NEF.naissance + Math.sqrt(Math.max(0, NEF.intrados ** 2 - (x - NEF.cx) ** 2))

function arbreCouvrant(pts: { x: number; y: number; z: number }[]): [number, number][] {
  if (pts.length < 2) return []
  const dans = new Set([0])
  const out: [number, number][] = []
  while (dans.size < pts.length) {
    let meilleur: [number, number] | null = null
    let dmin = Infinity
    for (const i of dans)
      for (let j = 0; j < pts.length; j++) {
        if (dans.has(j)) continue
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z)
        if (d < dmin) [dmin, meilleur] = [d, [i, j]]
      }
    out.push(meilleur!)
    dans.add(meilleur![1])
  }
  return out
}

export function constellations(accrochage: Accrochage, etoilesGithub: ReadonlyMap<string, number>): Constellation[] {
  const salles = accrochage.rooms.filter((r) => r.placements.length > 0)
  const rangs = Math.ceil(salles.length / COLONNES)
  const [dz, dx] = [(VOLUME.z1 - VOLUME.z0) / COLONNES, (VOLUME.x1 - VOLUME.x0) / rangs]
  return salles.map((salle, i) => {
    const [cz, cx] = [VOLUME.z0 + (i % COLONNES) * dz, VOLUME.x0 + Math.floor(i / COLONNES) * dx]
    const cy = VOLUME.y0 + hache(salle.id, 'hauteur') * (VOLUME.y1 - VOLUME.y0)
    const etoiles = salle.placements.map((p) => {
      const z = cz + MARGE + hache(p.key, 'z') * (dz - 2 * MARGE)
      const x = horsDesLanternes(cx + MARGE + hache(p.key, 'x') * (dx - 2 * MARGE), z)
      return {
        key: p.key,
        salle: salle.id,
        x,
        y: cy + (hache(p.key, 'y') - 0.5) * VOLUME.epaisseur,
        z,
        taille: Math.min(0.2, 0.05 + 0.03 * Math.log2(1 + (etoilesGithub.get(p.key) ?? 0))),
        accroche: voute(x),
      }
    })
    return {
      salle: salle.id,
      nom: salle.name,
      etoiles,
      filets: arbreCouvrant(etoiles),
      etiquette: { x: cx + dx / 2, y: cy + VOLUME.epaisseur / 2 + 0.15, z: cz + dz / 2 },
    }
  })
}
