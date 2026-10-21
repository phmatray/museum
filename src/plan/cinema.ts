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
 * (`VOLEES_CINEMA`, 15 contremarches de 15 cm), ouvertes sur les rangs (on y entre
 * comme dans une vraie salle, sans garde-corps), et entre elles cinq rangs de
 * trois marches (0,96 m de profondeur, 0,45 m de hauteur). Le dernier, sans
 * fauteuils, est l'allée transversale (`TRAVERSE`) qui relie les deux allées au
 * promenoir (`PROMENOIR`, à −2,55), lequel laisse 2,25 m sous la dalle.
 *
 * Pur : ni three ni React. `musee.ts` importe les volées, le palier et les
 * obstacles ; le rendu lit le reste.
 */
import type { Flight, Landing, Opening, Rect } from './types.ts'

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

/** Le bloc des gradins, entre les deux allées (son dernier rang est la traverse). */
export const BLOC_GRADINS: Rect = { x: 4.5, z: DEBUT, width: 10, depth: RANGS * RANG.profondeur }
/** Les rangs à fauteuils : tous sauf le dernier, où l'on circule (et où passerait le faisceau, à hauteur des têtes). */
const ASSIS: Rect = { ...BLOC_GRADINS, depth: (RANGS - 1) * RANG.profondeur }

export const VOLEES_CINEMA: Flight[] = [
  { id: 'gradins-o', x: SALLE.x, z: DEBUT, width: 1.5, depth: BLOC_GRADINS.depth, direction: 'south', bottom: SOL, top: COTE_PROMENOIR, risers: RANGS * PAR_RANG, ouverts: ['east'] },
  { id: 'gradins-e', x: BLOC_GRADINS.x + BLOC_GRADINS.width, z: DEBUT, width: 1.5, depth: BLOC_GRADINS.depth, direction: 'south', bottom: SOL, top: COTE_PROMENOIR, risers: RANGS * PAR_RANG, ouverts: ['west'] },
]

/** Le dernier rang, de plain-pied avec le promenoir : l'allée transversale, d'une allée à l'autre. */
export const TRAVERSE: Landing = {
  id: 'traverse', x: BLOC_GRADINS.x, z: DEBUT + ASSIS.depth, width: BLOC_GRADINS.width, depth: RANG.profondeur, elevation: COTE_PROMENOIR,
  // Une marche de rang (0,45 m) au-dessus du dernier rang assis : pas de garde-corps, qui barrerait la vue de l'écran.
  ouverts: ['north'],
}

export const PROMENOIR: Landing = {
  id: 'promenoir', x: SALLE.x, z: DEBUT + BLOC_GRADINS.depth, width: SALLE.width,
  depth: SALLE.z + SALLE.depth - DEBUT - BLOC_GRADINS.depth, elevation: COTE_PROMENOIR,
}

/** La scène, toute la largeur de la salle, sa façade de bois au sud. */
export const SCENE = { x: SALLE.x, z: SALLE.z, width: SALLE.width, depth: 2, hauteur: 0.5 }

/**
 * Le foyer (x 16–32, z 4–12) : on y descend par le coin sud-ouest, la porte de la salle est
 * au mur ouest. Un comptoir de confiserie contre le mur est, face à l'arrivée ; les affiches
 * au mur nord, au-dessus et de part et d'autre de la banquette (mobilier.ts, x 26).
 */
export const FOYER: Rect = { x: 16, z: 4, width: 16, depth: 8 }
/** Le comptoir et l'espace du vendeur derrière lui, jusqu'au mur est. */
export const COMPTOIR: Rect = { x: 29.6, z: 6, width: FOYER.x + FOYER.width - 0.15 - 29.6, depth: 4 }
/** Le centre des affiches au mur nord (sa face z = 4,15), de 1,0 × 1,45 m. */
export const AFFICHES = [19.5, 22.5, 29.5].map((x) => ({ x, y: SOL + 1.65, z: FOYER.z + 0.15, largeur: 1.0, hauteur: 1.45 }))

/**
 * La cabine de projection, derrière le mur du fond, de plain-pied avec le promenoir (le plancher
 * de la pièce, au sous-sol, ne se foule pas : la cabine est sur un palier). On y entre par une porte
 * de service au bout du promenoir ; elle ne s'ouvre qu'au visiteur qui a dix tampons (`succes.ts`).
 */
export const SALLE_CABINE: Rect = { x: 5.5, z: SALLE.z + SALLE.depth, width: 7, depth: 3.5 }

export const SOL_CABINE: Landing = { id: 'cabine', ...SALLE_CABINE, elevation: COTE_PROMENOIR }

/** La porte de la cabine, dans le mur du fond, et sa hauteur (2,05 m : la dalle est à 2,25 m). */
export const PORTE_CABINE: Opening = { kind: 'service', a: 'cinema', b: 'ss-cabine', x: 7, z: SALLE.z + SALLE.depth, width: 1, cote: COTE_PROMENOIR, hauteur: 2.05 }

/**
 * Les meubles de la cabine (leur emprise au sol, sur le palier) : le projecteur dans l'axe de la
 * lucarne de projection, la tour à plateaux dans l'angle sud-est, la table de rembobinage au mur
 * sud, l'étagère des bobines au mur ouest. Le palier ne connaît pas d'obstacles : le visiteur les
 * contourne par `BARRIERES` (visiteur.ts).
 */
export const MEUBLES_CABINE: Rect[] = [
  { x: SALLE.x + SALLE.width / 2 - 0.35, z: SALLE_CABINE.z + 0.15, width: 0.7, depth: 1.5 },
  { x: SALLE_CABINE.x + SALLE_CABINE.width - 0.15 - 1.35, z: SALLE_CABINE.z + SALLE_CABINE.depth - 0.15 - 1.35, width: 1.35, depth: 1.35 },
  { x: SALLE_CABINE.x + 0.15 + 0.5, z: SALLE_CABINE.z + SALLE_CABINE.depth - 0.15 - 0.75, width: 1.8, depth: 0.75 },
  { x: SALLE_CABINE.x + 0.15, z: SALLE_CABINE.z + SALLE_CABINE.depth / 2 - 0.6, width: 0.4, depth: 1.8 },
]

/** Ce que la marche contourne au sous-sol : la scène, les rangs de fauteuils, le dessous de la traverse et du promenoir, le comptoir. */
export const OBSTACLES_CINEMA: Rect[] = [
  { x: SCENE.x, z: SCENE.z, width: SCENE.width, depth: SCENE.depth },
  BLOC_GRADINS,
  { x: PROMENOIR.x, z: PROMENOIR.z, width: PROMENOIR.width, depth: PROMENOIR.depth },
  COMPTOIR,
  SALLE_CABINE,
]

/** Un rang : la bande `z0–z1` de son plancher, à la cote `dessus`. */
export interface Rang {
  rang: number
  z0: number
  z1: number
  dessus: number
}

/** Le plancher de chaque rang, du premier (devant) au dernier, la traverse, qui affleure le promenoir. */
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

/** Dix-huit fauteuils par rang, adossés au fond du rang : le passage est devant. Pas sur la traverse. */
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

/**
 * Les spectateurs (PNJ assis) : neuf fauteuils tirés une fois pour toutes (Park-Miller), ni au bord
 * d'une allée (on y entre), ni deux côte à côte. Le visiteur ne peut s'asseoir que dans les autres.
 */
export const SPECTATEURS: Siege[] = (() => {
  let graine = 2026
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647
  const pris = new Set<number>()
  const parRang = SIEGES.filter((s) => s.rang === 0).length
  for (let essai = 0; pris.size < 9 && essai < 1000; essai++) {
    const i = Math.floor(hasard() * SIEGES.length)
    const col = i % parRang
    if (col === 0 || col === parRang - 1 || pris.has(i) || pris.has(i - 1) || pris.has(i + 1)) continue
    pris.add(i)
  }
  return [...pris].sort((a, b) => a - b).map((i) => SIEGES[i])
})()
export const SIEGES_LIBRES: Siege[] = SIEGES.filter((s) => !SPECTATEURS.includes(s))

/** Une tête assise : au-dessus de l'assise du rang (le dessus de sa marche). */
export const TETE_ASSISE = 1.3

/**
 * Les fenêtres de la cabine, dans le mur du fond (sa face z = 19,85), juste sous le plafond : au
 * milieu, la lucarne de projection (l'objectif du projecteur, d'où part le faisceau), à côté, celle
 * du projectionniste.
 */
export const CABINE: { x: number; y0: number; y1: number; largeur: number; z: number; projection: boolean }[] = [
  { x: SALLE.x + SALLE.width / 2, largeur: 1.1, projection: true },
  { x: SALLE.x + SALLE.width / 2 + 1.7, largeur: 0.7, projection: false },
].map((f) => ({ ...f, y0: PLAFOND - 0.6, y1: PLAFOND - 0.15, z: SALLE.z + SALLE.depth - 0.15 }))

/** Les lucarnes de la cabine, percées dans le mur du fond. */
export const LUCARNES: Opening[] = CABINE.map((f) => ({ kind: 'lucarne', a: 'cinema', b: 'ss-cabine', x: f.x, z: SALLE.z + SALLE.depth, width: f.largeur, cote: f.y0, hauteur: f.y1 - f.y0 }))

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

/**
 * Combien l'œil est DANS le faisceau du projecteur (de l'objectif à la toile), de 0 (dehors) à 1
 * (dedans) : la distance de l'œil aux faces du faisceau, en mètres à sa hauteur, fondue sur ±30 cm.
 * On ne voit pas un faisceau de l'intérieur : il s'efface quand on y entre, peu à peu.
 */
export function dansLeFaisceau(o: { x: number; y: number; z: number }): number {
  const lucarne = CABINE.find((f) => f.projection)!
  const s = { x: lucarne.x, y: (lucarne.y0 + lucarne.y1) / 2, z: lucarne.z - 0.05 }
  if (o.z >= s.z || o.z <= ECRAN.z) return 0
  // Le point de la toile dans l'alignement objectif → œil, et l'agrandissement de l'œil à la toile.
  const k = (s.z - ECRAN.z) / (s.z - o.z)
  const qx = s.x + (o.x - s.x) * k
  const qy = s.y + (o.y - s.y) * k
  const marge = Math.min(qx - (ECRAN.x - ECRAN.largeur / 2), ECRAN.x + ECRAN.largeur / 2 - qx, qy - ECRAN.bas, ECRAN.bas + ECRAN.hauteur - qy) / k
  return Math.min(1, Math.max(0, (marge + 0.3) / 0.6))
}

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
