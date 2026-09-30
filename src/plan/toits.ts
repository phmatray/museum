/**
 * Les toits du musée, pour le temps qu'il fait : où la pluie et la neige ne
 * tombent pas, et où les dessiner pour qu'on les voie du dedans.
 *
 * Deux toits : les terrasses des ailes, à 11,5 m, et le berceau de la nef
 * (`tools/blender/build-nef.py` : naissance à 12,60 m, plein cintre sur les
 * 16 m du hall), qui monte jusqu'à 20,6 m. Sous la verrière, 8 m d'air sont
 * DEDANS : il ne doit pas y pleuvoir. Et, au jardin, la verrière à deux pentes
 * de la baraque du chantier (`chantier.ts`) : il n'y pleut pas non plus.
 *
 * Et dans le jardin, les ABRIS où l'on passe dessous : le pavillon du belvédère
 * (un toit en pavillon au galbe creux) et la porte couverte du roji (deux
 * pans) — `build-belvedere.py` en tient les mêmes cotes.
 *
 * Pur : ni three ni React. `toitsGlsl` en est la copie pour les shaders.
 */
import { BELVEDERE } from './belvedere.ts'
import { CHANTIER } from './chantier.ts'
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
/** La baraque : faîtage d'est en ouest (dans sa longueur), pentes vers le nord et le sud, de l'égout au faîtage. */
const { emprise: B, cote: BC, egout: BE, faitage: BF } = CHANTIER
const BARAQUE = { x0: B.x, x1: B.x + B.width, z0: B.z, z1: B.z + B.depth, cz: B.z + B.depth / 2, demi: B.depth / 2, egout: BC + BE + 0.15, faitage: BC + BF + 0.15 }

/**
 * Le pavillon du belvédère : un carré de `r` de demi-côté (poteaux et débord),
 * du faîte à l'égout ; la pente se creuse vers le bas (le même galbe que le
 * modèle), plus l'épaisseur des tuiles.
 */
const PAVILLON = (() => {
  const P = BELVEDERE.pavillon
  return { x: P.x, z: P.z, r: P.cote / 2 + P.debord, faite: BELVEDERE.cote + P.faitage + 0.1, egout: BELVEDERE.cote + P.egout + 0.1 }
})()
const GALBE = 1.45
/** La porte du roji : deux pans de `prof` de part et d'autre du faîte, sur toute la traverse. */
const PORTE = (() => {
  const { porte: G, roji: J } = BELVEDERE
  return { x0: J.x - G.passage / 2 - 0.7, x1: J.x + G.passage / 2 + 0.7, z: G.z, prof: 0.85, faite: G.haut + 0.66, egout: G.haut + 0.16 }
})()

/** La cote du dessus d'un abri du jardin en (x, z), `-Infinity` hors de ses toits. */
function hauteurDesAbris(x: number, z: number): number {
  const u = Math.max(Math.abs(x - PAVILLON.x), Math.abs(z - PAVILLON.z)) / PAVILLON.r
  if (u < 1) return PAVILLON.faite - (PAVILLON.faite - PAVILLON.egout) * (1 - (1 - u) ** GALBE)
  const v = Math.abs(z - PORTE.z) / PORTE.prof
  if (x > PORTE.x0 && x < PORTE.x1 && v < 1) return PORTE.faite - (PORTE.faite - PORTE.egout) * v
  return -Infinity
}

/** La cote du dessus du toit en (x, z), `-Infinity` hors de l'emprise. */
export function hauteurDesToits(x: number, z: number): number {
  return Math.max(hauteurDuMusee(x, z), hauteurDesAbris(x, z))
}

/** Les toits du musée et de la baraque du chantier, ce qui est DEDANS. */
function hauteurDuMusee(x: number, z: number): number {
  if (x > BARAQUE.x0 && x < BARAQUE.x1 && z > BARAQUE.z0 && z < BARAQUE.z1)
    return BARAQUE.faitage - (BARAQUE.faitage - BARAQUE.egout) * (Math.abs(z - BARAQUE.cz) / BARAQUE.demi)
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
  // Sous un abri du jardin, la pluie tombe tout autour : elle reste centrée sur le visiteur.
  if (cam.y >= hauteurDuMusee(cam.x, cam.z)) return { x: cam.x, y: cam.y, z: cam.z }
  const l = Math.hypot(avant.x, avant.z) || 1
  return { x: cam.x + (avant.x / l) * portee, y: Math.max(cam.y, demiHauteur - 1), z: cam.z + (avant.z / l) * portee }
}

const f = (v: number) => v.toFixed(3)
/** `float <nom>(vec2 xz)` : `hauteurDesAbris` en GLSL (-1e4 hors des abris du jardin). */
export const abrisGlsl = (nom: string) => /* glsl */ `
float ${nom}(vec2 xz) {
  float u = max(abs(xz.x - ${f(PAVILLON.x)}), abs(xz.y - ${f(PAVILLON.z)})) / ${f(PAVILLON.r)};
  if (u < 1.0) return ${f(PAVILLON.faite)} - ${f(PAVILLON.faite - PAVILLON.egout)} * (1.0 - pow(1.0 - u, ${f(GALBE)}));
  float v = abs(xz.y - ${f(PORTE.z)}) / ${f(PORTE.prof)};
  if (xz.x > ${f(PORTE.x0)} && xz.x < ${f(PORTE.x1)} && v < 1.0) return ${f(PORTE.faite)} - ${f(PORTE.faite - PORTE.egout)} * v;
  return -1e4;
}
`

/** `float <nom>(vec2 xz)` : `hauteurDesToits` en GLSL (-1e4 hors de l'emprise). Les abris sont loin du musée : le premier trouvé suffit. */
export const toitsGlsl = (nom: string) => /* glsl */ `
${abrisGlsl(`${nom}Abri`)}
float ${nom}(vec2 xz) {
  float abri = ${nom}Abri(xz);
  if (abri > -1e3) return abri;
  if (xz.x > ${f(BARAQUE.x0)} && xz.x < ${f(BARAQUE.x1)} && xz.y > ${f(BARAQUE.z0)} && xz.y < ${f(BARAQUE.z1)})
    return ${f(BARAQUE.faitage)} - ${f((BARAQUE.faitage - BARAQUE.egout) / BARAQUE.demi)} * abs(xz.y - ${f(BARAQUE.cz)});
  if (xz.x < ${f(EMPRISE.x0)} || xz.x > ${f(EMPRISE.x1)} || xz.y < ${f(EMPRISE.z0)} || xz.y > ${f(EMPRISE.z1)}) return -1e4;
  if (xz.x > ${f(NEF.x0)} && xz.x < ${f(NEF.x1)} && xz.y > ${f(NEF.z0)} && xz.y < ${f(NEF.z1)})
    return ${f(NEF.naissance + EPAISSEUR)} + sqrt(max(0.0, ${f(NEF.rayon ** 2)} - (xz.x - ${f(NEF.cx)}) * (xz.x - ${f(NEF.cx)})));
  return ${f(TERRASSE)};
}
`
