/**
 * Le cinéma du sous-sol, d'après Les Variétés de Waremme : murs tendus de
 * tissu rouge sur un lambris de bois clair, appliques dorées à plusieurs bras,
 * enceintes noires aux murs, plafond à caissons sombre piqué de spots, fauteuils
 * de velours rouge en gradins, scène à façade de bois, rideaux dorés autour
 * d'un écran large, et au fond, un promenoir comme un balcon, sous les fenêtres
 * de la cabine de projection.
 *
 * ── Le volume ──
 *
 * La salle (x 3–16, z 2–20) est sous les galeries ouest du rez-de-chaussée :
 * 4,50 m sous plafond. L'écran est au nord, au-dessus de la scène. Les gradins
 * montent vers le sud : deux allées en escalier contre les murs latéraux
 * (`VOLEES_CINEMA`, 15 contremarches de 15 cm), et entre elles cinq rangs de
 * trois marches (0,96 m de profondeur, 0,45 m de hauteur). Au sommet, le
 * promenoir (`PROMENOIR`, à −2,55) laisse 2,25 m sous la dalle.
 *
 * Pur : ni three ni React. `musee.ts` importe les volées, le palier et les
 * obstacles ; le rendu lit le reste.
 */
import type { Flight, Landing, Rect } from './types.ts'

/** Le plancher du sous-sol, et le dessous de la dalle du rez-de-chaussée. */
export const SOL = -4.8
export const PLAFOND = -0.3

export const SALLE: Rect = { x: 3, z: 2, width: 13, depth: 18 }

/** Les gradins : cinq rangs de trois contremarches. */
const RANGS = 5
const CONTREMARCHE = 0.15
const PAR_RANG = 3
const RANG = { profondeur: 0.96, hauteur: CONTREMARCHE * PAR_RANG }
const DEBUT = 11
/** La cote du promenoir : le dessus du dernier rang. */
export const COTE_PROMENOIR = SOL + RANGS * RANG.hauteur

/** Le bloc des fauteuils, entre les deux allées. */
export const BLOC_GRADINS: Rect = { x: 4.5, z: DEBUT, width: 10, depth: RANGS * RANG.profondeur }

export const VOLEES_CINEMA: Flight[] = [
  { id: 'gradins-o', x: SALLE.x, z: DEBUT, width: 1.5, depth: BLOC_GRADINS.depth, direction: 'south', bottom: SOL, top: COTE_PROMENOIR, risers: RANGS * PAR_RANG },
  { id: 'gradins-e', x: BLOC_GRADINS.x + BLOC_GRADINS.width, z: DEBUT, width: 1.5, depth: BLOC_GRADINS.depth, direction: 'south', bottom: SOL, top: COTE_PROMENOIR, risers: RANGS * PAR_RANG },
]

export const PROMENOIR: Landing = {
  id: 'promenoir', x: SALLE.x, z: DEBUT + BLOC_GRADINS.depth, width: SALLE.width,
  depth: SALLE.z + SALLE.depth - DEBUT - BLOC_GRADINS.depth, elevation: COTE_PROMENOIR,
}

/** La scène, toute la largeur de la salle, sa façade de bois au sud. */
export const SCENE = { x: SALLE.x, z: SALLE.z, width: SALLE.width, depth: 2, hauteur: 0.5 }

/** Ce que la marche contourne au sous-sol : la scène, les fauteuils, le dessous du promenoir. */
export const OBSTACLES_CINEMA: Rect[] = [
  { x: SCENE.x, z: SCENE.z, width: SCENE.width, depth: SCENE.depth },
  BLOC_GRADINS,
  { x: PROMENOIR.x, z: PROMENOIR.z, width: PROMENOIR.width, depth: PROMENOIR.depth },
]

/** Un rang : la bande `z0–z1` de son plancher, à la cote `dessus`. */
export interface Rang {
  rang: number
  z0: number
  z1: number
  dessus: number
}

/** Le plancher de chaque rang, du premier (devant) au dernier. Le dernier affleure le promenoir. */
export const GRADINS: Rang[] = Array.from({ length: RANGS }, (_, k) => ({
  rang: k,
  z0: DEBUT + k * RANG.profondeur,
  z1: DEBUT + (k + 1) * RANG.profondeur,
  dessus: SOL + (k + 1) * RANG.hauteur,
}))

/** Un fauteuil : le centre de son assise au sol du rang, tourné vers l'écran (lacet π : il regarde −z). */
export interface Siege {
  rang: number
  x: number
  y: number
  z: number
  lacet: number
}

export const FAUTEUIL = { largeur: 0.55, profondeur: 0.6 }
const PAR_RANGEE = Math.floor(BLOC_GRADINS.width / FAUTEUIL.largeur)

/**
 * Dix-huit fauteuils par rang, adossés au fond du rang : le passage est devant. Pas sur le
 * dernier rang (au niveau du promenoir) : c'est la circulation transversale, et le faisceau
 * du projecteur, sous un plafond de 4,50 m, y passerait à hauteur des têtes.
 */
export const SIEGES: Siege[] = GRADINS.slice(0, -1).flatMap((g) => {
  const marge = (BLOC_GRADINS.width - PAR_RANGEE * FAUTEUIL.largeur) / 2
  return Array.from({ length: PAR_RANGEE }, (_, i) => ({
    rang: g.rang,
    x: BLOC_GRADINS.x + marge + (i + 0.5) * FAUTEUIL.largeur,
    y: g.dessus,
    z: g.z1 - FAUTEUIL.profondeur / 2 - 0.05,
    lacet: Math.PI,
  }))
})

/** Une tête assise : au-dessus de l'assise du rang (le dessus de sa marche). */
export const TETE_ASSISE = 1.3

/** Les fenêtres de la cabine de projection, dans le mur du fond (sa face z = 19,85), juste sous le plafond. */
export const CABINE: { x: number; y0: number; y1: number; largeur: number; z: number }[] = [8, 11].map((x) => ({
  x, y0: PLAFOND - 0.6, y1: PLAFOND - 0.15, largeur: 0.8, z: SALLE.z + SALLE.depth - 0.15,
}))

/**
 * L'écran, sur le mur nord (face à z = 2,20), au-dessus de la scène, au format scope (2,39:1).
 * Haut placé : sous un plafond de 4,50 m, le bas de l'écran règle la pente du faisceau, qui
 * doit passer au-dessus des têtes du dernier rang assis (`TETE_ASSISE`, testé). `z` est sa face.
 */
const BAS_ECRAN = -3.5
const HAUT_ECRAN = PLAFOND - 0.35
export const ECRAN = { x: SALLE.x + SALLE.width / 2, z: SALLE.z + 0.15 + 0.05, largeur: (HAUT_ECRAN - BAS_ECRAN) * 2.39, bas: BAS_ECRAN, hauteur: HAUT_ECRAN - BAS_ECRAN }

/** Les rideaux dorés : un pan de chaque côté de l'écran et un lambrequin au-dessus, à 0,3 m devant le mur. */
export const RIDEAUX: { x0: number; x1: number; y0: number; y1: number; z: number }[] = [
  { x0: SALLE.x + 0.15, x1: ECRAN.x - ECRAN.largeur / 2, y0: SOL + SCENE.hauteur, y1: PLAFOND, z: SALLE.z + 0.45 },
  { x0: ECRAN.x + ECRAN.largeur / 2, x1: SALLE.x + SALLE.width - 0.15, y0: SOL + SCENE.hauteur, y1: PLAFOND, z: SALLE.z + 0.45 },
  { x0: SALLE.x + 0.15, x1: SALLE.x + SALLE.width - 0.15, y0: ECRAN.bas + ECRAN.hauteur, y1: PLAFOND, z: SALLE.z + 0.4 },
]

/** Le lambris de bois clair, au pied des murs de tissu rouge. */
export const LAMBRIS = { hauteur: 1.1 }

/** Un point lumineux ou sonore, et la direction (unitaire, horizontale ou verticale) vers laquelle il regarde. */
export interface Point {
  x: number
  y: number
  z: number
  nx: number
  nz: number
}

/** Le pied d'une allée : un point lumineux au bas de chaque contremarche, côté fauteuils. */
export const LUMIERES_MARCHES: Point[] = VOLEES_CINEMA.flatMap((f) => {
  const g = f.depth / f.risers
  const h = (f.top - f.bottom) / f.risers
  const x = f.x < BLOC_GRADINS.x ? f.x + f.width - 0.12 : f.x + 0.12
  return Array.from({ length: f.risers }, (_, k) => ({ x, y: f.bottom + k * h + 0.05, z: f.z + k * g, nx: 0, nz: -1 }))
})

/** Les murs latéraux, leur face intérieure et la normale vers la salle. */
const MURS = [
  { x: SALLE.x + 0.15, nx: 1 },
  { x: SALLE.x + SALLE.width - 0.15, nx: -1 },
]

/** Le sol le long d'un mur latéral : le fond de la salle, puis l'allée en escalier (en rampe), puis le promenoir. */
export function solLeLongDesMurs(z: number): number {
  const f = VOLEES_CINEMA[0]
  if (z <= f.z) return SOL
  if (z >= f.z + f.depth) return COTE_PROMENOIR
  return SOL + ((z - f.z) / f.depth) * (COTE_PROMENOIR - SOL)
}

/**
 * Les appliques dorées, à 2,40 m au-dessus du sol QU'ELLES SURPLOMBENT : au fond, l'allée monte avec
 * le gradin, et une applique posée à hauteur fixe se trouvait à hauteur de tête dans l'escalier.
 */
export const APPLIQUES: Point[] = MURS.flatMap(({ x, nx }) => [4.6, 9.4, 13.6].map((z) => ({ x, y: solLeLongDesMurs(z) + 2.4, z, nx, nz: 0 })))

/** Les enceintes noires, entre les appliques, plus haut (au-dessus du linteau de la porte, z 6–8 à l'est), sous le plafond. */
export const ENCEINTES: Point[] = MURS.flatMap(({ x, nx }) => [7, 11.5].map((z) => ({ x, y: Math.min(solLeLongDesMurs(z) + 3.2, PLAFOND - 0.45), z, nx, nz: 0 })))

/** Les spots du plafond à caissons : un au centre de chaque caisson. */
export const CAISSON = 2.6
export const SPOTS: Point[] = (() => {
  const [nx, nz] = [Math.round(SALLE.width / CAISSON), Math.round(SALLE.depth / CAISSON)]
  const out: Point[] = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      out.push({ x: SALLE.x + ((i + 0.5) * SALLE.width) / nx, y: PLAFOND, z: SALLE.z + ((j + 0.5) * SALLE.depth) / nz, nx: 0, nz: 0 })
  return out
})()

/** La portée (m) à laquelle on peut viser un fauteuil pour s'y asseoir : la largeur d'un rang, depuis l'allée. */
export const PORTEE_ASSISE = 11
/** L'écart (m) toléré entre le regard et le dossier visé. */
const TOLERANCE = 0.4

/**
 * Le fauteuil que le regard désigne : le plus proche dont le centre (à mi-hauteur) passe à moins de
 * `TOLERANCE` du rayon, devant l'œil et à portée ; null sinon. Pur : l'œil et la direction (unitaire) en mètres.
 */
export function siegeVise(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, sieges: readonly Siege[] = SIEGES): Siege | null {
  let meilleur: Siege | null = null
  let tMin = Infinity
  for (const s of sieges) {
    const c = { x: s.x - o.x, y: s.y + 0.55 - o.y, z: s.z - o.z }
    const t = c.x * d.x + c.y * d.y + c.z * d.z
    if (t <= 0 || t > PORTEE_ASSISE || t >= tMin) continue
    const ecart = Math.hypot(c.x - t * d.x, c.y - t * d.y, c.z - t * d.z)
    if (ecart < TOLERANCE) {
      meilleur = s
      tMin = t
    }
  }
  return meilleur
}
