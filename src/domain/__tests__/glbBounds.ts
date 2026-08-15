/**
 * Mesure les bornes réelles d'un GLB, sans le décoder.
 *
 * ── Pourquoi ce fichier existe ──
 *
 * `PROP_METRICS` porte en commentaire « mesuré sur les GLB eux-mêmes ». C'était
 * vrai le jour où la table a été écrite, et rien ne le maintenait vrai : le kit
 * est reconstruit par `tools/blender/build-props.py`, et la première fois qu'un
 * prop a changé de forme — un projecteur qui passe d'un fût vertical à une tête
 * inclinée — la table est devenue fausse en silence. Un rayon sous-estimé ne
 * casse aucun test : il laisse simplement un prop entrer dans un mur, ce qui ne
 * se voit qu'à l'écran, depuis le bon angle, si on passe par là.
 *
 * Le commentaire devient donc une épreuve.
 *
 * ── Pourquoi on ne décode rien ──
 *
 * Les primitives du kit sont compressées en Draco : lire les positions
 * imposerait d'embarquer le décodeur dans les tests. Inutile — la spécification
 * glTF EXIGE que l'accesseur POSITION porte ses `min` et `max`, y compris quand
 * les données sont compressées, précisément pour que le culling n'ait pas à
 * décoder. On lit donc le chunk JSON, on compose les transformations de nœuds,
 * et on obtient des bornes exactes pour quelques kilo-octets lus.
 *
 * Conséquence assumée : les bornes sont celles de la BOÎTE ALIGNÉE de chaque
 * primitive, pas de l'enveloppe convexe. Sur une pièce tournée dans son propre
 * fichier, elles seraient légèrement pessimistes. Aucune ne l'est ici, et une
 * borne pessimiste réserve trop de place — elle ne plante pas un prop dans un
 * mur.
 */
import { readFileSync } from 'node:fs'

export interface Bornes {
  min: [number, number, number]
  max: [number, number, number]
}

/** Rayon horizontal (plan XZ) autour de l'origine du fichier, et bornes en Y. */
export interface MetriquesGlb {
  rayon: number
  minY: number
  maxY: number
}

interface Noeud {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  name?: string
}

interface Primitive {
  attributes: Record<string, number>
  indices?: number
  /** 4 = TRIANGLES, et c'est le défaut de la spécification. */
  mode?: number
}

interface Gltf {
  scenes?: { nodes?: number[] }[]
  scene?: number
  nodes?: Noeud[]
  meshes?: { primitives: Primitive[] }[]
  accessors?: { min?: number[]; max?: number[]; count?: number }[]
}

const MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a

/** Le chunk JSON d'un `.glb`, décodé. Lance si le fichier n'en est pas un. */
export function lireGltf(chemin: string): Gltf {
  const buf = readFileSync(chemin)
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error(`${chemin} n'est pas un GLB`)

  let curseur = 12
  while (curseur < buf.length) {
    const taille = buf.readUInt32LE(curseur)
    const type = buf.readUInt32LE(curseur + 4)
    const debut = curseur + 8
    if (type === CHUNK_JSON) {
      return JSON.parse(buf.subarray(debut, debut + taille).toString('utf8')) as Gltf
    }
    // Les chunks sont alignés sur 4 octets ; un GLB conforme l'est déjà, mais
    // un producteur négligent laisserait le curseur à côté de l'en-tête suivant.
    curseur = debut + taille + ((4 - (taille % 4)) % 4)
  }
  throw new Error(`${chemin} : aucun chunk JSON`)
}

type Matrice = number[]

const IDENTITE: Matrice = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Produit colonne-major, convention glTF. */
function multiplier(a: Matrice, b: Matrice): Matrice {
  const r = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c += 1) {
    for (let l = 0; l < 4; l += 1) {
      let somme = 0
      for (let k = 0; k < 4; k += 1) somme += a[k * 4 + l] * b[c * 4 + k]
      r[c * 4 + l] = somme
    }
  }
  return r
}

function matriceDeNoeud(n: Noeud): Matrice {
  if (n.matrix) return n.matrix
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]

  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const rot = [
    1 - (y * y2 + z * z2),
    x * y2 + w * z2,
    x * z2 - w * y2,
    0,
    x * y2 - w * z2,
    1 - (x * x2 + z * z2),
    y * z2 + w * x2,
    0,
    x * z2 + w * y2,
    y * z2 - w * x2,
    1 - (x * x2 + y * y2),
    0,
    0,
    0,
    0,
    1,
  ]
  for (let i = 0; i < 4; i += 1) rot[i] *= sx
  for (let i = 4; i < 8; i += 1) rot[i] *= sy
  for (let i = 8; i < 12; i += 1) rot[i] *= sz
  rot[12] = tx
  rot[13] = ty
  rot[14] = tz
  return rot
}

function transformer(m: Matrice, p: [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

/**
 * Bornes monde d'un nœud nommé et de sa descendance.
 *
 * Les huit coins de chaque boîte de primitive sont transformés, pas seulement
 * `min` et `max` : sous une rotation, le coin transformé de `min` n'est plus le
 * minimum, et ne prendre que ces deux points-là rétrécirait la boîte au lieu de
 * l'élargir. C'est le sens de l'erreur qui compte — trop petit met un prop dans
 * un mur.
 */
export function bornesDuNoeud(gltf: Gltf, nom: string): Bornes | null {
  const noeuds = gltf.nodes ?? []
  const depart = noeuds.findIndex((n) => n.name === nom)
  if (depart < 0) return null

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]

  const pile: { index: number; parent: Matrice }[] = [{ index: depart, parent: IDENTITE }]
  while (pile.length > 0) {
    const { index, parent } = pile.pop() as { index: number; parent: Matrice }
    const noeud = noeuds[index]
    const monde = multiplier(parent, matriceDeNoeud(noeud))

    if (noeud.mesh !== undefined) {
      for (const prim of gltf.meshes?.[noeud.mesh]?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes.POSITION]
        if (!acc?.min || !acc.max) continue
        for (let coin = 0; coin < 8; coin += 1) {
          const p = transformer(monde, [
            coin & 1 ? acc.max[0] : acc.min[0],
            coin & 2 ? acc.max[1] : acc.min[1],
            coin & 4 ? acc.max[2] : acc.min[2],
          ])
          for (let a = 0; a < 3; a += 1) {
            if (p[a] < min[a]) min[a] = p[a]
            if (p[a] > max[a]) max[a] = p[a]
          }
        }
      }
    }
    for (const enfant of noeud.children ?? []) pile.push({ index: enfant, parent: monde })
  }

  return Number.isFinite(min[0]) ? { min, max } : null
}

/**
 * Triangles d'un nœud nommé et de sa descendance.
 *
 * ── Pourquoi ici, et pourquoi sans décoder non plus ──
 *
 * Le §9 plafonne les triangles, et `tools/capture.ts` le vérifie — mais il lui
 * faut un navigateur, un contexte WebGL et une scène montée. Cela le rend
 * excellent comme juge final et inutilisable comme garde-fou : quand il rougit,
 * le modèle est déjà commité. Le même compte se lit ici en quelques
 * millisecondes, sur le fichier, AVANT qu'il entre dans l'arbre.
 *
 * Aucun décodage, pour la raison qui vaut déjà pour les bornes : un accesseur
 * porte toujours son `count`, y compris sous `KHR_draco_mesh_compression`, où
 * seul le `bufferView` devient optionnel. On lit donc le nombre d'indices dans
 * le JSON et on divise par trois.
 *
 * Deux réserves, toutes deux du bon côté :
 *
 *  - une primitive NON indexée retombe sur `POSITION.count / 3`, ce que la
 *    spécification impose comme équivalent en mode TRIANGLES ;
 *  - une primitive qui n'est pas en mode TRIANGLES (`mode !== 4`) est IGNORÉE
 *    plutôt que comptée de travers. Le kit n'en contient aucune, et en compter
 *    une comme des triangles gonflerait le budget sans rien mesurer.
 *
 * Ce que ce compte N'EST PAS : le nombre de triangles DESSINÉS. Il faut le
 * multiplier par le nombre d'exemplaires posés — c'est justement ce que le
 * multiplicateur rend visible, et c'est là que se cachait le projecteur à
 * 940 triangles instancié cent fois.
 */
export function trianglesDuNoeud(gltf: Gltf, nom: string): number | null {
  const noeuds = gltf.nodes ?? []
  const depart = noeuds.findIndex((n) => n.name === nom)
  if (depart < 0) return null

  let total = 0
  const pile: number[] = [depart]
  while (pile.length > 0) {
    const index = pile.pop() as number
    const noeud = noeuds[index]

    if (noeud.mesh !== undefined) {
      for (const prim of gltf.meshes?.[noeud.mesh]?.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue
        const acc =
          prim.indices !== undefined
            ? gltf.accessors?.[prim.indices]
            : gltf.accessors?.[prim.attributes.POSITION]
        if (acc?.count === undefined) continue
        total += Math.floor(acc.count / 3)
      }
    }
    for (const enfant of noeud.children ?? []) pile.push(enfant)
  }

  return total
}

/**
 * Les métriques attendues par `PROP_METRICS`, dans ses conventions : un rayon
 * horizontal mesuré depuis l'ORIGINE du fichier — car c'est l'origine que le
 * poseur place — et non depuis le centre de la boîte.
 */
export function metriquesDuNoeud(gltf: Gltf, nom: string): MetriquesGlb | null {
  const b = bornesDuNoeud(gltf, nom)
  if (b === null) return null
  const rayon = Math.max(
    Math.hypot(b.min[0], b.min[2]),
    Math.hypot(b.min[0], b.max[2]),
    Math.hypot(b.max[0], b.min[2]),
    Math.hypot(b.max[0], b.max[2]),
  )
  return { rayon, minY: b.min[1], maxY: b.max[1] }
}
