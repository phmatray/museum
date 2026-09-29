/**
 * Les toits du musée, pour le temps qu'il fait : où la pluie et la neige ne
 * tombent pas, et où les dessiner pour qu'on les voie du dedans.
 *
 * Deux toits : les terrasses des ailes, à 11,5 m, et le berceau de la nef
 * (`tools/blender/build-nef.py` : naissance à 12,60 m, plein cintre sur les
 * 16 m du hall), qui monte jusqu'à 20,6 m. Sous la verrière, 8 m d'air sont
 * DEDANS : il ne doit pas y pleuvoir.
 *
 * Pur : ni three ni React. `toitsGlsl` en est la copie pour les shaders.
 */
import { MUSEE } from './musee.ts'

/** L'emprise du bâtiment, faces extérieures des façades comprises. */
const EMPRISE = { x0: -0.3, x1: MUSEE.width + 0.3, z0: -0.3, z1: MUSEE.depth + 0.3 }
/** Le dessus des terrasses des ailes. */
const TERRASSE = 11.5
const hall = MUSEE.levels[0].rooms.find((r) => r.kind === 'hall')!
/** Le berceau de la nef : naissance (deux étages moins la dalle, plus l'attique), rayon, axe. */
const NEF = { x0: hall.x, x1: hall.x + hall.width, z0: hall.z, z1: hall.z + hall.depth, naissance: 2 * MUSEE.storey - MUSEE.slab + 3.3, rayon: hall.width / 2, cx: hall.x + hall.width / 2 }
/** L'épaisseur de la verrière et de ses fers, au-dessus de l'intrados. */
const EPAISSEUR = 0.4

/** La cote du dessus du toit en (x, z), `-Infinity` hors de l'emprise. */
export function hauteurDesToits(x: number, z: number): number {
  if (x < EMPRISE.x0 || x > EMPRISE.x1 || z < EMPRISE.z0 || z > EMPRISE.z1) return -Infinity
  if (x > NEF.x0 && x < NEF.x1 && z > NEF.z0 && z < NEF.z1) return NEF.naissance + Math.sqrt(Math.max(0, NEF.rayon ** 2 - (x - NEF.cx) ** 2)) + EPAISSEUR
  return TERRASSE
}

/** Ce point est-il à l'abri, sous un toit du musée ? */
export const sousLesToits = (x: number, y: number, z: number) => y < hauteurDesToits(x, z)

/**
 * Le centre de la boîte de pluie (ou de neige) qui suit le visiteur. Dehors,
 * c'est lui. Dedans, elle ne tomberait que dans les salles, où elle est
 * effacée : on la pousse devant son regard, de `portee` mètres à l'horizontale,
 * et on la relève du sol — là où il la voit, par la porte grande ouverte, par
 * la baie de la salle d'honneur, sous la verrière.
 */
export function centreDesChutes(
  cam: { x: number; y: number; z: number },
  avant: { x: number; z: number },
  portee: number,
  demiHauteur: number,
): { x: number; y: number; z: number } {
  if (!sousLesToits(cam.x, cam.y, cam.z)) return { x: cam.x, y: cam.y, z: cam.z }
  const l = Math.hypot(avant.x, avant.z) || 1
  return { x: cam.x + (avant.x / l) * portee, y: Math.max(cam.y, demiHauteur - 1), z: cam.z + (avant.z / l) * portee }
}

const f = (v: number) => v.toFixed(3)
/** `float <nom>(vec2 xz)` : `hauteurDesToits` en GLSL (-1e4 hors de l'emprise). */
export const toitsGlsl = (nom: string) => /* glsl */ `
float ${nom}(vec2 xz) {
  if (xz.x < ${f(EMPRISE.x0)} || xz.x > ${f(EMPRISE.x1)} || xz.y < ${f(EMPRISE.z0)} || xz.y > ${f(EMPRISE.z1)}) return -1e4;
  if (xz.x > ${f(NEF.x0)} && xz.x < ${f(NEF.x1)} && xz.y > ${f(NEF.z0)} && xz.y < ${f(NEF.z1)})
    return ${f(NEF.naissance + EPAISSEUR)} + sqrt(max(0.0, ${f(NEF.rayon ** 2)} - (xz.x - ${f(NEF.cx)}) * (xz.x - ${f(NEF.cx)})));
  return ${f(TERRASSE)};
}
`
