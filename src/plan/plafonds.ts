/**
 * Les plafonds des salles : un plafond de plâtre, et au milieu un lanterneau
 * de verre dépoli, comme les salles à éclairage zénithal des musées du XIXᵉ.
 *
 * Sans eux, les salles de l'étage étaient à ciel ouvert, et celles du
 * rez-de-chaussée montraient le dessous du parquet de l'étage. Le hall et ses
 * balcons n'en ont pas : ils sont sous la nef.
 *
 * Pur : ni three ni React.
 */
import type { Box } from './mesh.ts'
import type { Plan } from './types.ts'

const EP_PLAFOND = 0.02
const EP_VERRE = 0.01
/** Le lanterneau laisse ce cadre de plâtre sur chaque bord de la salle. */
const CADRE = 2
/** Les petits-bois du lanterneau : une résille d'un mètre et demi, cinq centimètres de large. */
const MAILLE = 1.5
const BOIS = 0.05

/**
 * La salle d'honneur n'a ni plâtre plat ni lanterneau : une voûte de plâtre en
 * tourbillon, à la manière de la Casa Batlló, la couvre (`tools/blender/
 * build-salle-honneur.py`). Du haut des murs, une gorge d'un quart de cercle
 * (`gorge`) monte à une corniche plate, d'où pendent les rails ; la voûte
 * s'élève au-delà, jusqu'à la lampe-soleil.
 */
export const VOUTE = { salle: 'honneur', gorge: 0.55 }

export interface Plafonds {
  platre: Box[]
  verre: Box[]
  resille: Box[]
}

export function plafonds(plan: Plan, levelId: number): Plafonds {
  const level = plan.levels.find((l) => l.id === levelId)
  const out: Plafonds = { platre: [], verre: [], resille: [] }
  if (!level) return out
  // Sous la dalle de l'étage au-dessus, ou au sommet des murs pour le dernier.
  const sous = level.elevation + plan.storey - plan.slab
  for (const r of level.rooms) {
    if ((r.kind !== 'gallery' && r.kind !== 'honneur') || r.id === VOUTE.salle) continue
    const [cx, cz] = [r.x + r.width / 2, r.z + r.depth / 2]
    out.platre.push({ x: cx, y: sous - EP_PLAFOND / 2, z: cz, w: r.width, h: EP_PLAFOND, d: r.depth, kind: 'slab' })
    const [w, d] = [r.width - 2 * CADRE, r.depth - 2 * CADRE]
    if (w <= 0 || d <= 0) continue
    const y = sous - EP_PLAFOND - EP_VERRE / 2
    out.verre.push({ x: cx, y, z: cz, w, h: EP_VERRE, d, kind: 'glass' })
    // La résille, centrée sur le lanterneau, juste sous le verre.
    const yb = y - EP_VERRE
    for (let i = 1; i < Math.round(w / MAILLE); i++) out.resille.push({ x: cx - w / 2 + (i * w) / Math.round(w / MAILLE), y: yb, z: cz, w: BOIS, h: EP_VERRE, d, kind: 'railing' })
    for (let i = 1; i < Math.round(d / MAILLE); i++) out.resille.push({ x: cx, y: yb, z: cz - d / 2 + (i * d) / Math.round(d / MAILLE), w, h: EP_VERRE, d: BOIS, kind: 'railing' })
  }
  return out
}
