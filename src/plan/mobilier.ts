/**
 * Le mobilier du musée : où poser chaque banc, et comment la marche les évite.
 *
 * « Je trouve que ça manque de mobilier » (Philippe). Chaque pièce est dans le
 * style de son lieu, modelée par `tools/blender/build-mobilier.py` :
 *
 * - dans chaque galerie, une banquette de velours vert capitonné sur chêne
 *   tourné, dans l'axe long de la salle — on s'y assoit face aux grands murs ;
 * - dans la nef, deux paires de longs bancs de chêne et de cuir, entre les
 *   bandes de granit, de part et d'autre de l'allée centrale ;
 * - près de l'entrée, la banque d'accueil de noyer, de laiton et de marbre ;
 * - dans la salle d'honneur, deux bancs doubles de la Casa Batlló, face aux vitrines ;
 * - au jardin, un banc de granit brut au bord de l'étang et trois bancs de
 *   cèdre tournés vers l'eau ou vers le musée.
 *
 * Et ce qui fait un vrai musée, modelé par Meshy (`tools/blender/build-accessoires.py`) :
 * un cordon de velours devant les vitrines, la chaise du gardien, la table de
 * livres près de l'accueil, des extincteurs au mur ; dehors, un abri à vélos,
 * des caisses de Versailles, le panneau des horaires et une fontaine.
 *
 * Et les grandes plantes (`tools/blender/build-plantes.py`) : deux kentias en
 * vasque de bronze au pied du grand escalier — le palmier des halls 1900 —, et
 * deux figuiers lyres qui encadrent la baie de la salle d'honneur. Jamais
 * devant une toile ni dans une allée ; les oliviers et d'autres figuiers vont
 * dans les angles des galeries (`props.ts`).
 *
 * ── Hors des passages ──
 *
 * La visite (`tour.ts`) et Bavette (`promenade.ts`) marchent en ligne droite
 * d'une porte à l'autre et jusqu'au centre de chaque salle. Une banquette posée
 * pile au centre barrerait ces lignes : chacune est décalée juste assez pour
 * les laisser libres (`DEGAGEMENT`, vérifié par les tests). Dans la nef, les
 * diagonales d'une porte à l'autre traversent forcément les bancs : `contourner`
 * y ajoute les points de passage qui les évitent, et `step()` les arrête
 * de toute façon — leurs emprises sont des obstacles du plan (`musee.ts`).
 *
 * Pur : ni three ni React. Les emprises sont celles des modèles Blender.
 */
import { cimaisesDe, emprise as empriseCimaise } from './cimaises.ts'
import { solDuParc } from './relief.ts'
import type { Rect } from './types.ts'

export type PieceMobilier =
  | 'Banquette' | 'BancNef' | 'Accueil' | 'BancBatllo' | 'BancPierre' | 'BancJardin'
  | 'ChaiseGardien' | 'Presentoir' | 'Extincteur' | 'PanneauHoraires' | 'Fontaine' | 'Versailles'
  | 'Lampadaire'
  | 'Kentia' | 'Lyrata'
  // Les ensembles : une seule emprise pour la marche, plusieurs modèles posés (`garniture`).
  | 'AbriVelos'
  | 'Cordon'

/** L'emprise au sol de chaque modèle, à plat : `largeur` selon son x, `profondeur` selon son z (son avant). */
export const DIMENSIONS: Record<PieceMobilier, { largeur: number; profondeur: number }> = {
  Banquette: { largeur: 2.2, profondeur: 0.7 },
  BancNef: { largeur: 2.8, profondeur: 0.6 },
  Accueil: { largeur: 2.9, profondeur: 0.85 },
  BancBatllo: { largeur: 1.4, profondeur: 0.64 },
  BancPierre: { largeur: 1.66, profondeur: 0.56 },
  BancJardin: { largeur: 1.8, profondeur: 0.5 },
  ChaiseGardien: { largeur: 0.43, profondeur: 0.5 },
  Presentoir: { largeur: 1.4, profondeur: 0.86 },
  Extincteur: { largeur: 0.24, profondeur: 0.14 },
  PanneauHoraires: { largeur: 1.6, profondeur: 0.24 },
  Fontaine: { largeur: 3, profondeur: 3 },
  Versailles: { largeur: 0.83, profondeur: 0.83 },
  // Le pied du lampadaire, 21 cm ; la crosse passe au-dessus des têtes (`build-lampadaire.py`).
  Lampadaire: { largeur: 0.25, profondeur: 0.25 },
  // Les plantes : l'emprise de leur bac ; le feuillage passe au-dessus des têtes, ou contre le mur.
  Kentia: { largeur: 0.87, profondeur: 0.87 },
  Lyrata: { largeur: 0.65, profondeur: 0.65 },
  // Sept potelets de 32 cm de pied, à 2,20 m d'axe en axe.
  Cordon: { largeur: 6 * 2.2 + 0.32, profondeur: 0.32 },
  // Le toit de l'abri (4,60 × 2,30 m) couvre ses poteaux, ses cinq arceaux et ses vélos.
  AbriVelos: { largeur: 4.6, profondeur: 2.3 },
}

/**
 * Le dessus des bancs où Bavette fait la sieste : sa hauteur au-dessus du pied
 * et sa demi-profondeur (selon le z du modèle), relevées au lancer de rayons
 * sur `mobilier.glb`. Pas les bancs Batlló : deux assises de 30 cm séparées
 * par le dossier, trop étroites pour un chat enroulé.
 */
export const ASSISES: Partial<Record<PieceMobilier, { hauteur: number; demiProfondeur: number }>> = {
  Banquette: { hauteur: 0.46, demiProfondeur: 0.3 },
  BancNef: { hauteur: 0.458, demiProfondeur: 0.28 },
  BancJardin: { hauteur: 0.45, demiProfondeur: 0.2 },
  BancPierre: { hauteur: 0.48, demiProfondeur: 0.25 },
}

export interface Meuble {
  piece: PieceMobilier
  /** La surface de `surfaceAt` où il est posé : `<niveau>:<salle>` ou `parc:terrain`. */
  surface: string
  niveau: number
  x: number
  /** La cote du pied : le plancher, ou la pelouse du parc. */
  y: number
  z: number
  /** Lacet, en radians : le modèle regarde +Z, une rotation θ l'envoie vers (sin θ, cos θ). */
  lacet: number
  /** Au-dessus du sol : un extincteur est accroché au mur, pas posé par terre. */
  accroche?: number
}

const RDC = 0
const ETAGE = 4.8
const [SUD, EST, NORD] = [0, Math.PI / 2, Math.PI]
const PARC = 'parc:terrain'

const dans = (piece: PieceMobilier, surface: string, x: number, z: number, lacet: number): Meuble => {
  const [niveau] = surface.split(':')
  const n = niveau === 'parc' ? RDC : Number(niveau)
  return { piece, surface, niveau: n, x, z, lacet, y: surface === PARC ? solDuParc(x, z) : n === 1 ? ETAGE : RDC }
}
/** Le pied à 45 cm du sol, la poignée vers 1 m : à portée de main, sous les yeux sans les attirer. */
const auMur = (surface: string, x: number, z: number, lacet: number): Meuble => ({ ...dans('Extincteur', surface, x, z, lacet), accroche: 0.45 })

/** La face d'un mur du hall, peau de pierre comprise (`parement.ts`) ; celle de la salle d'honneur est peinte. */
const PIERRE = 0.15 + 0.03

/**
 * Les banquettes des ailes : la même place aux deux niveaux, puisque les portes
 * s'y superposent. Au centre, décalée hors des lignes de porte à porte : vers
 * le nord (salles 1), le sud (salles 3), ou vers le dehors quand trois portes
 * se croisent au centre (salles 2).
 */
/**
 * Les lampadaires du parc : « ça manque de lumière à l'extérieur » (Philippe).
 * Un Lindby « Daphne » de 2,20 m (`build-lampadaire.py`), sa crosse tendue
 * au-dessus de l'allée : le lacet envoie son x local — la crosse — vers
 * (cos θ, −sin θ). Un tous les 12 à 14 m, sur le gazon au bord du gravier :
 *
 * - la ceinture, côté musée, à 2,40 m de son axe : quatre par côté, un par
 *   angle, symétriques autour des accès ;
 * - les quatre accès, deux chacun, en quinconce, à 2,10 m de leur axe ;
 * - l'axe de l'entrée, par paires, à 2,60 m : la dernière encadre la grille.
 *
 * Relevés par projection sur le tracé des allées (`park.ts`) ; les tests
 * vérifient qu'aucun ne mord une allée, l'eau, un arbre ni un banc.
 */
const LAMPADAIRES: [number, number, number][] = [
  // La ceinture : le sud, le nord…
  [3.32, 49.14, -1.74], [16.71, 49.51, -1.38], [31, 48.6, -1.571], [45, 48.6, -1.571],
  [3.32, -9.14, 1.74], [16.71, -9.51, 1.38], [31.29, -9.51, 1.761], [44.68, -9.14, 1.402],
  // … l'ouest, l'est…
  [-9.09, 2.37, 2.952], [-9.53, 13.66, -2.918], [-9.53, 26.34, 2.918], [-9.09, 37.63, -2.952],
  [56.6, 2, 0], [56.6, 14, 0], [56.6, 26, 0], [56.6, 38, 0],
  // … et ses quatre angles.
  [-6.59, -6.74, 2.4], [54.74, -6.59, 0.829], [54.59, 46.74, -0.742], [-6.74, 46.59, -2.313],
  // Les accès : nord, ouest, est (de part et d'autre du pont).
  [24.61, -24.35, -2.619], [23.07, -34.78, 0.23], [-22.25, 23.03, 2.094], [-35.74, 16.84, -1.341],
  [65.77, 21.7, 1.438], [81.38, 17.69, -1.31],
  // L'axe de l'entrée, par paires.
  ...[57, 68, 78.4].flatMap((z): [number, number, number][] => [[21.4, z, 0], [26.6, z, Math.PI]]),
]

const AILES: [string, string, number, number][] = [
  ['r-o1', 'e-o1', 8, 4.7], ['r-e2', 'e-e2', 42.2, 20], ['r-e3', 'e-e3', 40, 35.3],
  // Les galeries 2 de l'ouest ont leur cimaise dans la moitié ouest (cimaises.ts) :
  // la banquette passe dans l'angle nord-est, hors des lignes de la porte du hall, et regarde la salle.
  ['r-o2', 'e-o2', 12.6, 15.8],
]

export const MOBILIER: Meuble[] = [
  ...AILES.flatMap(([rdc, etage, x, z]) => [dans('Banquette', `0:${rdc}`, x, z, SUD), dans('Banquette', `1:${etage}`, x, z, SUD)]),
  // Là où un seul des deux niveaux a une cimaise (cimaises.ts), la banquette de
  // l'autre garde sa place ; celle de la salle à cimaise se tourne vers elle.
  dans('Banquette', '0:r-o3', 8, 35.3, SUD),
  dans('Banquette', '1:e-o3', 5.5, 31, SUD),
  dans('Banquette', '1:e-e1', 40, 4.7, SUD),
  // Trading & finance : l'équerre (cimaises.ts) tient l'angle nord-est ; la banquette
  // passe au sud de sa branche, à l'est de l'axe x = 40 de la porte sud, et regarde l'équerre.
  dans('Banquette', '0:r-e1', 43.3, 10.62, NORD),
  // La galerie du nord, traversée d'ouest en est par z = 6 : la cimaise au nord de l'axe, la banquette au sud, face à elle.
  dans('Banquette', '0:r-n', 24, 8.4, NORD),
  // La nef : entre le filet de granit (x = 20, 28) et l'allée centrale (22,4–25,6),
  // dans les deux travées qui ne font face à aucune porte (z 26–29,5 et 29,5–33).
  // Entre les deux, sur la bande de granit, on traverse la nef d'un mur à l'autre.
  ...[21.2, 26.8].flatMap((x) => [27.6, 31.35].map((z) => dans('BancNef', '0:hall', x, z, EST))),
  // L'accueil, dans l'angle sud-est du hall, tourné vers l'ouest : on le voit en entrant, sur sa droite.
  dans('Accueil', '0:hall', 30.5, 37.8, -EST),
  // La salle d'honneur : au sud de l'axe des portes (z = 6), face aux vitrines du mur nord.
  dans('BancBatllo', '1:honneur', 21, 8.3, NORD),
  dans('BancBatllo', '1:honneur', 27, 8.3, NORD),
  // Le jardin : le granit sur la rive nord de l'étang, entre les fougères, face à l'eau…
  dans('BancPierre', PARC, 42.5, 53.9, SUD),
  // … le cèdre sur la rive ouest, sous l'érable et près de la lanterne, face à l'étang,
  dans('BancJardin', PARC, 29.4, 62, EST),
  // et sur la pelouse du sud, entre les buis, deux bancs qui regardent la façade.
  dans('BancJardin', PARC, 36.5, 47.6, NORD),
  dans('BancJardin', PARC, 13.5, 47.6, NORD),
  // Là où les accès du nord, de l'ouest et de l'est touchent le chemin de ceinture,
  // un banc, dos au musée, tourné vers le parc : l'allée mène quelque part. Un peu
  // à côté de l'axe, qui reste un passage le long de la façade.
  dans('BancJardin', PARC, 56.6, 22.6, EST),
  dans('BancJardin', PARC, -8.6, 22.6, -EST),
  dans('BancJardin', PARC, 26.6, -8.6, NORD),

  // ── Ce qui fait un vrai musée ──
  // Un cordon de velours devant le mur des vitrines, à 70 cm du mur : on voit la
  // toile de près sans la toucher, et la borne reste devant, du bon côté.
  dans('Cordon', '1:honneur', 24, 0.7, SUD),
  // La chaise du gardien, contre le mur est de la nef, entre les deux portes : il voit tout le hall.
  dans('ChaiseGardien', '0:hall', 32 - PIERRE - 0.25, 29.5, -EST),
  // La table de livres, contre le mur sud à droite en entrant, à côté de l'accueil : la boutique.
  dans('Presentoir', '0:hall', 27.5, 40 - PIERRE - 0.45, NORD),
  // Les extincteurs : près de l'entrée, au pied des volées, et dans la salle d'honneur.
  auMur('0:hall', 20.2, 40 - PIERRE - 0.07, NORD),
  auMur('0:hall', 32 - PIERRE - 0.07, 21.4, -EST),
  auMur('1:honneur', 32 - 0.15 - 0.07, 9.6, -EST),
  // Les kentias encadrent le pied du grand escalier (volée centrale x 21–27, départ z = 20),
  // à un mètre et demi de la première marche, entre l'allée centrale (22,4–25,6) et les
  // passages qui longent les volées (x = 20 et 28) : les palmes passent au-dessus des têtes.
  // Un bac carré se tourne d'un quart de tour au plus : de biais, son emprise déborderait.
  dans('Kentia', '0:hall', 21.25, 21.8, 0),
  dans('Kentia', '0:hall', 26.75, 21.8, EST),
  // Les figuiers lyres dans les angles sud de la salle d'honneur, de part et d'autre de la baie sur la nef.
  dans('Lyrata', '1:honneur', 17.25, 10.6, 0),
  dans('Lyrata', '1:honneur', 30.75, 10.6, NORD),
  // Dehors, sur le parvis : l'abri à vélos dos à l'aile est, entre sa bannière et
  // l'angle du musée, à 25 cm de la brique ; 2 m de dalles devant, pour sortir un vélo…
  dans('AbriVelos', PARC, 44.8, 40.45 + 0.25 + 2.3 / 2, SUD),
  // … deux caisses de Versailles de part et d'autre de l'entrée, deux aux angles du portique…
  ...[21.2, 26.8, 15.3, 32.7].map((x) => dans('Versailles', PARC, x, 42.25, SUD)),
  // … le panneau des horaires au bord de l'axe, tourné vers qui arrive du jardin…
  dans('PanneauHoraires', PARC, 20.9, 46.2, 0.35),
  // … et la fontaine sur la pelouse ouest, au-delà de la ceinture : l'étang est à l'est.
  dans('Fontaine', PARC, 17.5, 56, SUD),
  // Les lampadaires du parc (`LAMPADAIRES`).
  ...LAMPADAIRES.map(([x, z, lacet]) => dans('Lampadaire', PARC, x, z, lacet)),
]

/** Un modèle d'un ensemble, en coordonnées monde. */
export interface Garniture {
  piece: 'Potelet'
  x: number
  z: number
  lacet: number
}

/**
 * Les modèles d'un ensemble, le long de son grand axe (son x local) : les
 * potelets du cordon.
 */
export function garniture(m: Meuble): Garniture[] {
  const [c, s] = [Math.cos(m.lacet), Math.sin(m.lacet)]
  // Le x local tourné de θ autour de y : (cos θ, −sin θ).
  const a = (u: number, v: number, piece: Garniture['piece']): Garniture => ({ piece, x: m.x + u * c + v * s, z: m.z - u * s + v * c, lacet: m.lacet })
  if (m.piece === 'Cordon') return Array.from({ length: 7 }, (_, i) => a((i - 3) * 2.2, 0, 'Potelet'))
  return []
}

/** L'emprise au sol d'un meuble posé : son rectangle tourné, aligné sur les axes. */
export function emprise(m: Meuble): Rect {
  const { largeur, profondeur } = DIMENSIONS[m.piece]
  const [c, s] = [Math.abs(Math.cos(m.lacet)), Math.abs(Math.sin(m.lacet))]
  const [w, d] = [c * largeur + s * profondeur, s * largeur + c * profondeur]
  return { x: m.x - w / 2, z: m.z - d / 2, width: w, depth: d }
}

/** Les emprises d'un niveau, comme obstacles de la marche — le parc compte au rez-de-chaussée. */
export const obstaclesDuMobilier = (niveau: number): Rect[] => MOBILIER.filter((m) => m.niveau === niveau).map(emprise)

// ── Contourner ──────────────────────────────────────────────────────────────

type Point = [number, number]

/** Le rayon du visiteur (`walk.ts`), plus une marge : on frôle un banc, on ne s'y frotte pas. */
const MARGE = 0.3 + 0.15
/**
 * Les coins de contournement, au-delà de la marge : un pas de l'un à l'autre
 * longe le banc sans le toucher, même quand le chat, qui tourne en arc, coupe
 * le virage — il vise le coin suivant dès qu'il est à 25 cm de celui-ci.
 */
const COIN = MARGE + 0.35

/** Ce qu'on rogne d'un bloc pour en sortir : moins que toute marge (`MARGE`, les 60 cm du bâtiment dans `promenade.ts`). */
const SORTIE = 0.4

const gonfler = (r: Rect, m: number): Rect => ({ x: r.x - m, z: r.z - m, width: r.width + 2 * m, depth: r.depth + 2 * m })
const coins = (r: Rect): Point[] => [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]]

/** Le segment [a, b] coupe-t-il le rectangle ? (Liang–Barsky) */
export function coupe(a: Point, b: Point, r: Rect): boolean {
  let [t0, t1] = [0, 1]
  const d = [b[0] - a[0], b[1] - a[1]]
  const bornes: [number, number][] = [[-d[0], a[0] - r.x], [d[0], r.x + r.width - a[0]], [-d[1], a[1] - r.z], [d[1], r.z + r.depth - a[1]]]
  for (const [p, q] of bornes) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

/**
 * Le plus court chemin de a à b qui ne coupe aucun bloc, par les nœuds donnés
 * (Dijkstra sur le graphe de visibilité). Rend les points à suivre, b compris ;
 * `[b]` si la ligne droite est libre, ou si rien ne passe.
 */
export function contournement(a: Point, b: Point, blocs: Rect[], noeuds: Point[]): Point[] {
  // Parti de la marge d'un bloc — au pied d'un banc, au sortir d'une sieste —,
  // on en sort : pour le premier pas, seul son cœur arrête. Sans quoi tout
  // chemin coupait ce bloc, et la ligne droite de secours traversait le banc.
  const dedans = (p: Point, r: Rect) => p[0] > r.x && p[0] < r.x + r.width && p[1] > r.z && p[1] < r.z + r.depth
  const libre = (p: Point, q: Point) => blocs.every((r) => !coupe(p, q, p === a && dedans(a, r) ? gonfler(r, -SORTIE) : r))
  if (libre(a, b)) return [b]
  const n = [a, b, ...noeuds]
  const dist = n.map(() => Infinity)
  const venu = n.map(() => -1)
  const fait = n.map(() => false)
  dist[0] = 0
  for (;;) {
    let i = -1
    for (let k = 0; k < n.length; k++) if (!fait[k] && dist[k] < Infinity && (i < 0 || dist[k] < dist[i])) i = k
    if (i < 0 || i === 1) break
    fait[i] = true
    for (let k = 0; k < n.length; k++) {
      if (fait[k] || !libre(n[i], n[k])) continue
      const d = dist[i] + Math.hypot(n[k][0] - n[i][0], n[k][1] - n[i][1])
      if (d < dist[k]) [dist[k], venu[k]] = [d, i]
    }
  }
  if (venu[1] < 0) return [b]
  const out: Point[] = []
  for (let k = 1; k > 0; k = venu[k]) out.unshift(n[k])
  return out
}

/** Les blocs et les coins du mobilier d'une surface — cimaises comprises : de quoi le contourner, ou l'ajouter à d'autres blocs. */
export function blocsDuMobilier(surface: string): { blocs: Rect[]; noeuds: Point[] } {
  const [niveau, salle] = surface.split(':')
  const cimaises = niveau === 'parc' ? [] : cimaisesDe(Number(niveau), salle).map(empriseCimaise)
  const e = [...MOBILIER.filter((m) => m.surface === surface).map(emprise), ...cimaises]
  const blocs = e.map((r) => gonfler(r, MARGE))
  // Un coin pris dans un autre meuble ne mène nulle part.
  const noeuds = e.flatMap((r) => coins(gonfler(r, COIN))).filter(([x, z]) => blocs.every((r) => !coupe([x, z], [x, z], r)))
  return { blocs, noeuds }
}

/** De a à b dans une même surface, en contournant son mobilier : les points à suivre, b compris. */
export function contourner(surface: string, a: Point, b: Point): Point[] {
  const { blocs, noeuds } = blocsDuMobilier(surface)
  return contournement(a, b, blocs, noeuds)
}
