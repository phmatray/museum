/**
 * Les props du plan : une plante dans chaque angle des salles qui exposent.
 *
 * ── Les angles, et rien d'autre ──
 *
 * La marche (`walk.ts`) ne connaît pas le mobilier : un banc au milieu d'une
 * salle serait traversé, une jardinière devant une porte barrerait la vue. Les
 * angles sont le seul endroit qui n'est ni un passage — `checkPlan` tient les
 * ouvertures loin des angles — ni un mur d'accrochage — `hangPlan` y laisse un
 * mètre libre. Une plante y donne l'échelle de la salle sans rien gêner.
 *
 * ── Le thème choisit les espèces ──
 *
 * Le tirage est semé par le nom du thème attribué à la salle (`assignRooms`,
 * écrit dans `accrochage.json`), à défaut par son nom de plan : une salle garde
 * ses plantes tant que son thème ne change pas.
 */
import { exposedRooms } from './hang.ts'
import type { Level, Opening, Plan, Rect } from './types.ts'

export type PropId = 'jardiniere' | 'plante-01' | 'plante-02' | 'plante-03' | 'plante-04'

export interface PropPlacement {
  id: PropId
  roomId: string
  level: number
  /** Position monde, cote du niveau comprise. */
  x: number
  y: number
  z: number
  rotation: number
  scale: number
}

/** Rayon d'encombrement à l'échelle 1, mesuré sur les GLB (ancien `PROP_METRICS`). */
export const PROP_RAYON: Record<PropId, number> = {
  jardiniere: 0.495,
  'plante-01': 0.807,
  'plante-02': 0.44,
  'plante-03': 0.578,
  'plante-04': 0.131,
}

/** Les deux planches botaniques s'arrêtent à la motte : elles vont en jardinière. */
const ESPECES: { id: PropId; autoportante: boolean; echelle: [number, number] }[] = [
  { id: 'plante-01', autoportante: false, echelle: [1, 1.2] },
  { id: 'plante-02', autoportante: false, echelle: [1.4, 1.7] },
  { id: 'plante-03', autoportante: true, echelle: [1, 1.2] },
  { id: 'plante-04', autoportante: false, echelle: [2, 2.4] },
]

const HAUTEUR_JARDINIERE = 0.5
/** Sous la margelle : le disque de terre du modèle ne flotte pas au ras du bord. */
const ENFONCEMENT = 0.06
/** Du centre de la plante à l'axe des deux murs de l'angle. */
const RECUL_ANGLE = 1.2

/** Le couloir devant et derrière une ouverture : sa largeur plus un rayon de visiteur, 1,60 m de part et d'autre. */
const PASSAGE = 1.6
const RAYON_VISITEUR = 0.3

export function passage(level: Level, o: Opening): Rect {
  const r = level.rooms.find((s) => s.id === o.a)
  const vertical = r !== undefined && (Math.abs(o.x - r.x) < 1e-6 || Math.abs(o.x - r.x - r.width) < 1e-6)
  const demi = o.width / 2 + RAYON_VISITEUR
  return vertical
    ? { x: o.x - PASSAGE, z: o.z - demi, width: 2 * PASSAGE, depth: 2 * demi }
    : { x: o.x - demi, z: o.z - PASSAGE, width: 2 * demi, depth: 2 * PASSAGE }
}

const touche = (r: Rect, x: number, z: number, rayon: number) =>
  Math.hypot(x - Math.max(r.x, Math.min(x, r.x + r.width)), z - Math.max(r.z, Math.min(z, r.z + r.depth))) < rayon

function generateur(texte: string): () => number {
  let etat = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) etat = Math.imul(etat ^ texte.charCodeAt(i), 0x01000193)
  etat >>>= 0
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function propPlacements(plan: Plan, rooms: readonly { id: string; name: string }[]): PropPlacement[] {
  return exposedRooms(plan).flatMap(({ room, level }) => {
    const theme = rooms.find((r) => r.id === room.id)?.name ?? room.name
    const alea = generateur(theme)
    const [x0, x1] = [room.x + RECUL_ANGLE, room.x + room.width - RECUL_ANGLE]
    const [z0, z1] = [room.z + RECUL_ANGLE, room.z + room.depth - RECUL_ANGLE]
    const passages = level.openings.map((o) => passage(level, o))
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].flatMap(([x, z]): PropPlacement[] => {
      const e = ESPECES[Math.floor(alea() * ESPECES.length)]
      const scale = e.echelle[0] + alea() * (e.echelle[1] - e.echelle[0])
      const base = { roomId: room.id, level: level.id, x, z }
      // Un angle trop près d'une porte reste vide : une salle un peu nue plutôt qu'un passage encombré.
      const rayon = Math.max(PROP_RAYON[e.id] * scale, e.autoportante ? 0 : PROP_RAYON.jardiniere)
      if (passages.some((r) => touche(r, x, z, rayon))) return []
      const plante = {
        ...base,
        id: e.id,
        y: level.elevation + (e.autoportante ? 0 : HAUTEUR_JARDINIERE - ENFONCEMENT),
        rotation: alea() * Math.PI * 2,
        scale,
      }
      if (e.autoportante) return [plante]
      return [{ ...base, id: 'jardiniere', y: level.elevation, rotation: 0, scale: 1 }, plante]
    })
  })
}
