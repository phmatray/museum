/**
 * Les ombres et les reflets du musée, ce qui s'en décide sans canvas.
 *
 * - `sondeDeReflet` : quel environnement le visiteur voit dans le laiton et le
 *   verre — le ciel dehors, la nef sous la verrière, sinon sa salle. Lu sur la
 *   surface du marcheur (`plan/walk.ts`). `melangeDeReflets` : près d'une
 *   porte, la part de la sonde d'à côté.
 * - `cadrerOmbre` : la carte d'ombre du soleil suit le visiteur, mais ne glisse
 *   que d'un texel entier à la fois ; sans quoi chaque pas ferait scintiller le
 *   bord de toutes les ombres.
 * - `redessinerOmbre` : cette carte n'est redessinée que si quelque chose a
 *   changé — la boîte, le soleil, un porteur d'ombre qui bouge.
 * - `regrouperEmprises` : les pièces d'un même meuble (bois, cuir, laiton…) ne
 *   font qu'une ombre de contact, pas trois superposées.
 *
 * Pur : ni three ni React.
 */

/**
 * La sonde dont le visiteur voit le reflet : `ciel` dehors, `nef` sous la
 * verrière (hall, balcons, paliers, volées), sinon sa salle même (`0:r-o2`,
 * `1:honneur`) — le laiton d'une salle rouge ne reflète pas un mur vert.
 */
export function sondeDeReflet(surface: string | null | undefined): string {
  if (!surface || surface.startsWith('parc:')) return 'ciel'
  const salle = surface.slice(surface.indexOf(':') + 1)
  if (surface.startsWith('palier:') || surface.startsWith('volee:') || salle === 'hall' || salle.startsWith('balcon')) return 'nef'
  return surface
}

/** La demi-largeur du fondu entre deux sondes, de part et d'autre d'une porte (m). */
export const FONDU_REFLET = 1.5

interface NiveauDeReflet {
  id: number
  rooms: readonly { id: string; x: number; z: number; width: number; depth: number }[]
  openings: readonly { kind: string; a: string; b: string | null; x: number; z: number; width: number }[]
}

/**
 * Les deux sondes à mélanger là où se tient le visiteur, et la part de la
 * voisine (0 à ½). Sur le seuil même d'une porte, moitié-moitié ; à
 * `FONDU_REFLET` mètres de part ou d'autre, sa seule sonde. La part ne dépend
 * que de la distance au plan du mur : elle vaut ½ des deux côtés de la ligne où
 * `sondeDeReflet` bascule, le reflet passe la porte sans saut.
 */
export function melangeDeReflets(
  niveau: NiveauDeReflet | undefined,
  x: number,
  z: number,
  surface: string | null | undefined,
): { sonde: string; voisine: string; part: number } {
  const sonde = sondeDeReflet(surface)
  let res = { sonde, voisine: sonde, part: 0 }
  if (!niveau) return res
  const cle = (id: string | null) => (id === null ? 'ciel' : sondeDeReflet(`${niveau.id}:${id}`))
  for (const o of niveau.openings) {
    if (o.kind === 'bay') continue
    const [ka, kb] = [cle(o.a), cle(o.b)]
    const voisine = ka === sonde ? kb : kb === sonde ? ka : null
    const a = niveau.rooms.find((r) => r.id === o.a)
    if (voisine === null || voisine === sonde || !a) continue
    // Le mur est nord-sud si l'ouverture est posée sur une arête x de sa salle.
    const nordSud = Math.abs(o.x - a.x) < 1e-6 || Math.abs(o.x - a.x - a.width) < 1e-6
    const [travers, long] = nordSud ? [x - o.x, z - o.z] : [z - o.z, x - o.x]
    // Le long du mur, le fondu s'éteint au-delà des tableaux de la porte : pas de saut non plus.
    const cote = Math.max(0, 1 - Math.max(0, Math.abs(long) - o.width / 2) / FONDU_REFLET)
    const part = 0.5 * Math.max(0, 1 - Math.abs(travers) / FONDU_REFLET) * cote
    if (part > res.part) res = { sonde, voisine, part }
  }
  return res
}

type V3 = readonly [number, number, number]

/**
 * Le centre de la boîte d'ombre, recalé sur la grille des texels vue du soleil
 * (`d`, unitaire, du sol vers le soleil). Seule la composante le long du rayon
 * reste libre : elle ne déplace rien sur la carte.
 */
export function cadrerOmbre(c: V3, d: V3, texel: number): [number, number, number] {
  // u ⟂ d dans le plan horizontal ; si le soleil est au zénith, l'axe x.
  let u: V3 = [d[2], 0, -d[0]]
  const lu = Math.hypot(u[0], u[2])
  u = lu < 1e-6 ? [1, 0, 0] : [u[0] / lu, 0, u[2] / lu]
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const [cu, cv, cd] = [Math.round(dot(c, u) / texel) * texel, Math.round(dot(c, v) / texel) * texel, dot(c, d)]
  return [0, 1, 2].map((i) => u[i] * cu + v[i] * cv + d[i] * cd) as [number, number, number]
}

/**
 * Quand redessiner la carte d'ombre. Un porteur qui bouge à moins de `pres`
 * mètres du visiteur (Bavette qui passe, une aiguille) la redessine à chaque
 * image ; plus loin, jusqu'à `loin` (le bout de la boîte), `cadence` fois par
 * seconde : là-bas, un pas de chat entre deux dessins tient dans un pixel.
 * Et quoi qu'il arrive, toutes les `garde` secondes : ce qu'aucune veille ne
 * voit (une texture de feuillage qui arrive, un matériau changé) finit dessiné.
 */
export const RAFRAICHIR = { pres: 25, loin: 110, cadence: 15, garde: 2 }

/**
 * `cadre` : la boîte a glissé ou le soleil a tourné. `bouge` : la distance au
 * visiteur du plus proche porteur qui a bougé (`Infinity` : aucun).
 * `enAttente` : un mouvement lointain pas encore dessiné. `depuis` : secondes
 * écoulées depuis le dernier dessin.
 */
export function redessinerOmbre(cadre: boolean, bouge: number, enAttente: boolean, depuis: number): { dessiner: boolean; enAttente: boolean } {
  const attente = enAttente || bouge < RAFRAICHIR.loin
  const dessiner = cadre || bouge < RAFRAICHIR.pres || (attente && depuis >= 1 / RAFRAICHIR.cadence) || depuis >= RAFRAICHIR.garde
  return { dessiner, enAttente: attente && !dessiner }
}

/**
 * De combien (m) a pu se déplacer un point d'un objet de rayon `rayon` entre
 * deux matrices monde (4 × 4, par colonnes) : `ref` lue à partir de `k`, et
 * `m`. La translation, plus ce que la rotation ou l'échelle font parcourir au
 * bord de l'objet — une majoration, pas une mesure exacte.
 */
export function ecartDeMatrice(ref: ArrayLike<number>, k: number, m: ArrayLike<number>, rayon: number): number {
  let base = 0
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) base += (m[i] - ref[k + i]) ** 2
  // La norme de Frobenius de la différence majore ce qu'elle fait à un vecteur de longueur 1.
  return Math.hypot(m[12] - ref[k + 12], m[13] - ref[k + 13], m[14] - ref[k + 14]) + Math.sqrt(base) * rayon
}

/** Une boîte englobante posée au sol, en coordonnées monde. */
export interface Emprise {
  minX: number
  maxX: number
  minY: number
  minZ: number
  maxZ: number
}

/**
 * Fusionne les emprises qui se chevauchent au sol à la même cote (à `pas`
 * près) : les maillages d'un banc deviennent un seul banc. Quadratique — le
 * musée a quelques centaines de pièces, et c'est fait une fois.
 */
export function regrouperEmprises(emprises: readonly Emprise[], pas = 0.3): Emprise[] {
  const groupes: Emprise[] = []
  for (const e of emprises) {
    let courante: Emprise = { ...e }
    for (let i = groupes.length - 1; i >= 0; i--) {
      const g = groupes[i]
      const touche = g.minX <= courante.maxX && courante.minX <= g.maxX && g.minZ <= courante.maxZ && courante.minZ <= g.maxZ
      if (!touche || Math.abs(g.minY - courante.minY) > pas) continue
      courante = {
        minX: Math.min(g.minX, courante.minX), maxX: Math.max(g.maxX, courante.maxX),
        minY: Math.min(g.minY, courante.minY),
        minZ: Math.min(g.minZ, courante.minZ), maxZ: Math.max(g.maxZ, courante.maxZ),
      }
      groupes.splice(i, 1)
    }
    groupes.push(courante)
  }
  return groupes
}
