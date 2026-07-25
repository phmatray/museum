/**
 * LOT 1 — Regroupement thématique des dépôts (spec §6).
 *
 * Une salle du musée = un cluster. Le corpus de référence est très déséquilibré
 * (`dotnet` sur 62 % des dépôts, `csharp` sur 55 %) : un regroupement par topic
 * dominant produirait une salle géante et des placards. C'est l'IDF qui règle
 * ce problème — un terme quasi universel voit son poids s'effondrer, un terme
 * porté par une poignée de dépôts pèse dix fois plus.
 *
 * Rien ici n'est aléatoire ni daté : deux exécutions sur la même entrée
 * produisent le même résultat, octet pour octet. Tous les départages d'égalité
 * se font par ordre alphabétique de clé de dépôt ou de terme.
 *
 * Aucun import graphique : ce module tourne dans vitest sans canvas et dans
 * Node au moment du build.
 */
import type { Artwork, RepoKey } from './types'

// ── Contrat public ───────────────────────────────────────────────────────

export interface Cluster {
  id: string
  name: string
  /** Termes de plus fort poids cumulé, pour le cartel de salle. */
  topics: string[]
  keys: RepoKey[]
}

export interface ClusteringOptions {
  minSize: number
  maxSize: number
}

/** Salle de repli : recueille ce qu'aucun cluster ne peut absorber (spec §6.3). */
export const NOM_DIVERS = 'Divers'

/** Nom donné à un cluster dont aucun terme ne ressort — corpus sans signal. */
export const NOM_SANS_THEME = 'Collection'

/** Nombre de termes exposés dans `Cluster.topics`. */
const TOPICS_PAR_CLUSTER = 5

// Pondération par source (spec §6.1). Un topic est une étiquette voulue par
// l'auteur, une description est du texte libre : le rapport 3 pour 1 traduit
// cette différence d'intention.
const POIDS_TOPIC = 3.0
const POIDS_NOM = 1.5
const POIDS_DESCRIPTION = 1.0
const POIDS_LANGAGE = 2.0

/** Un vecteur creux : terme → poids. Absent = 0. */
type Vecteur = Map<string, number>

// ── Stop-words ───────────────────────────────────────────────────────────

/**
 * Français ET anglais : les descriptions du corpus mélangent les deux langues,
 * parfois dans la même phrase. La liste ne contient que des mots de trois
 * lettres ou plus — les plus courts sont déjà éliminés par le filtre de
 * longueur.
 */
const STOP_WORDS = new Set([
  // français
  'afin', 'alors', 'aucun', 'aussi', 'autre', 'autres', 'avait', 'avant',
  'avec', 'avoir', 'bien', 'car', 'ceci', 'cela', 'ces', 'cet', 'cette',
  'ceux', 'chaque', 'chez', 'comme', 'comment', 'dans', 'depuis', 'des',
  'deux', 'dont', 'donc', 'elle', 'elles', 'encore', 'entre', 'est', 'etre',
  'était', 'étaient', 'été', 'être', 'fait', 'faire', 'fois', 'font', 'hors',
  'ici', 'ils', 'juste', 'leur', 'leurs', 'lors', 'mais', 'même', 'mêmes',
  'moins', 'mon', 'notre', 'nous', 'ont', 'our', 'par', 'parce', 'pas',
  'peut', 'plus', 'plusieurs', 'pour', 'pourquoi', 'près', 'puis', 'quand',
  'que', 'quel', 'quelle', 'quelles', 'quels', 'qui', 'sans', 'ses', 'seul',
  'seule', 'seulement', 'son', 'sont', 'sous', 'sur', 'tous', 'tout', 'toute',
  'toutes', 'très', 'une', 'vers', 'vos', 'votre', 'vous',
  // anglais
  'about', 'above', 'after', 'again', 'against', 'all', 'almost', 'along',
  'also', 'and', 'another', 'any', 'anything', 'are', 'around', 'available',
  'based', 'because', 'been', 'before', 'being', 'below', 'best', 'better',
  'between', 'both', 'but', 'can', 'cannot', 'could', 'did', 'does', 'doing',
  'don', 'down', 'during', 'each', 'either', 'else', 'even', 'ever', 'every',
  'few', 'for', 'from', 'full', 'further', 'get', 'gets', 'getting', 'had',
  'has', 'have', 'having', 'here', 'how', 'however', 'into', 'its', 'itself',
  'just', 'let', 'like', 'made', 'make', 'makes', 'making', 'many', 'may',
  'might', 'more', 'most', 'much', 'must', 'need', 'needs', 'new', 'non',
  'not', 'now', 'off', 'once', 'one', 'only', 'onto', 'other', 'others',
  'our', 'out', 'over', 'own', 'per', 'put', 'same', 'set', 'should', 'since',
  'some', 'still', 'such', 'take', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'thus', 'too',
  'two', 'under', 'until', 'upon', 'use', 'used', 'uses', 'using', 'very',
  'via', 'want', 'was', 'way', 'well', 'were', 'what', 'when', 'where',
  'whether', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'within',
  'without', 'would', 'yet', 'you', 'your', 'yours',
])

/** En dessous de trois caractères, un token de texte libre n'informe sur rien. */
const LONGUEUR_MIN = 3

// ── Tokenisation ─────────────────────────────────────────────────────────

/**
 * Découpe un nom de dépôt en tokens : camelCase, kebab, snake et points.
 * `MudBlazor.Extensions` → mud, blazor, extensions ; `ASTral` → astral ;
 * `HTMLParser` → html, parser (la seconde passe isole l'acronyme du mot).
 */
export function tokenizeName(nom: string): string[] {
  const espace = nom
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return decoupeTexte(espace)
}

/** Découpe un texte libre sur tout ce qui n'est ni lettre ni chiffre. */
function decoupeTexte(texte: string): string[] {
  const bruts = texte.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  return bruts.filter((t) => t.length >= LONGUEUR_MIN && !STOP_WORDS.has(t))
}

/**
 * Topics et langages ne sont PAS tokenisés ni filtrés par longueur : ce sont
 * des étiquettes choisies, pas du texte extrait. Découper `mudblazor` en
 * `mud` + `blazor` le noierait dans les 21 dépôts Blazor, et le filtre de
 * longueur supprimerait `ai`, `3d` ou le langage `Go`.
 */
function normaliseEtiquette(brut: string): string {
  return brut.trim().toLowerCase().replace(/\s+/g, '-')
}

// ── Vectorisation ────────────────────────────────────────────────────────

export interface Vectorisation {
  /** Clés des dépôts, triées, dédoublonnées. L'index i vaut pour tous les tableaux. */
  keys: RepoKey[]
  /** Sacs de termes bruts, avant IDF. Sert au nommage des clusters. */
  tf: Vecteur[]
  /** Vecteurs tf×idf normalisés L2. */
  vectors: Vecteur[]
  /** Nombre de dépôts portant chaque terme. */
  df: Map<string, number>
  /** ln(N / (1 + df)), plancher à 0. */
  idf: Map<string, number>
  n: number
}

function sacDeTermes(a: Artwork): Vecteur {
  const tf: Vecteur = new Map()
  const ajoute = (terme: string, poids: number): void => {
    if (!terme) return
    tf.set(terme, (tf.get(terme) ?? 0) + poids)
  }

  for (const topic of a.topics) ajoute(normaliseEtiquette(topic), POIDS_TOPIC)
  for (const token of tokenizeName(a.name)) ajoute(token, POIDS_NOM)
  for (const token of decoupeTexte(a.description ?? '')) ajoute(token, POIDS_DESCRIPTION)
  if (a.language) ajoute(normaliseEtiquette(a.language), POIDS_LANGAGE)

  return tf
}

/**
 * Sac de termes pondéré → tf×idf → normalisation L2.
 *
 * L'IDF est plafonnée par le bas à 0 : sans ce plancher, un terme présent sur
 * TOUS les dépôts obtient un poids négatif et deux dépôts qui le partagent
 * deviendraient moins similaires que deux dépôts sans rien en commun.
 */
export function vectorize(artworks: Artwork[]): Vectorisation {
  const uniques = dedoublonne(artworks)
  const n = uniques.length

  const tf = uniques.map(sacDeTermes)

  const df = new Map<string, number>()
  for (const sac of tf) {
    for (const terme of sac.keys()) df.set(terme, (df.get(terme) ?? 0) + 1)
  }

  const idf = new Map<string, number>()
  for (const [terme, compte] of df) {
    idf.set(terme, Math.max(0, Math.log(n / (1 + compte))))
  }

  const vectors = tf.map((sac) => {
    const brut: Vecteur = new Map()
    let carre = 0
    for (const [terme, poids] of sac) {
      const w = poids * (idf.get(terme) ?? 0)
      if (w <= 0) continue
      brut.set(terme, w)
      carre += w * w
    }
    if (carre === 0) return brut // vecteur nul : aucun terme discriminant
    const norme = Math.sqrt(carre)
    const normalise: Vecteur = new Map()
    for (const [terme, w] of brut) normalise.set(terme, w / norme)
    return normalise
  })

  return { keys: uniques.map((a) => a.key), tf, vectors, df, idf, n }
}

/**
 * Tri par clé et dédoublonnage. Le tri fait coïncider l'ordre des index avec
 * l'ordre alphabétique : tous les départages d'égalité du reste du module se
 * ramènent alors à « le plus petit index gagne ». Une clé en double
 * (catalogue mal formé) est conservée une seule fois — deux œuvres identiques
 * accrochées au même mur seraient un bug visible.
 */
function dedoublonne(artworks: Artwork[]): Artwork[] {
  const vues = new Set<RepoKey>()
  const gardes: Artwork[] = []
  for (const a of artworks) {
    if (vues.has(a.key)) continue
    vues.add(a.key)
    gardes.push(a)
  }
  return gardes.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
}

// ── Similarité ───────────────────────────────────────────────────────────

/** Vecteurs déjà normalisés : le produit scalaire EST le cosinus. */
function cosinus(a: Vecteur, b: Vecteur): number {
  const [petit, grand] = a.size <= b.size ? [a, b] : [b, a]
  let somme = 0
  for (const [terme, poids] of petit) {
    const autre = grand.get(terme)
    if (autre !== undefined) somme += poids * autre
  }
  return somme
}

/** Moyenne des vecteurs membres, renormalisée L2. */
function centroide(membres: number[], vectors: Vecteur[]): Vecteur {
  const somme: Vecteur = new Map()
  for (const i of membres) {
    for (const [terme, poids] of vectors[i]) {
      somme.set(terme, (somme.get(terme) ?? 0) + poids)
    }
  }
  let carre = 0
  for (const poids of somme.values()) carre += poids * poids
  if (carre === 0) return somme
  const norme = Math.sqrt(carre)
  const normalise: Vecteur = new Map()
  for (const [terme, poids] of somme) normalise.set(terme, poids / norme)
  return normalise
}

// ── Agglomératif (average linkage) ───────────────────────────────────────

interface Noeud {
  membres: number[]
  gauche: number | null
  droite: number | null
}

/**
 * Fusion itérative de la paire la plus proche jusqu'à une racine unique.
 *
 * La similarité du groupe fusionné est obtenue par Lance-Williams
 * (`(|A|·s(A,C) + |B|·s(B,C)) / (|A|+|B|)`), ce qui donne exactement la
 * moyenne des similarités deux à deux sans jamais reparcourir les membres.
 *
 * Un groupe occupe toujours le slot du plus petit index qu'il contient, donc
 * du plus petit `RepoKey` : comparer deux paires de slots revient à comparer
 * deux paires de clés, et le départage alphabétique est gratuit.
 */
function agglomere(vectors: Vecteur[]): { noeuds: Noeud[]; racine: number } {
  const n = vectors.length
  const noeuds: Noeud[] = vectors.map((_, i) => ({ membres: [i], gauche: null, droite: null }))
  if (n === 0) return { noeuds, racine: -1 }

  const s = new Float64Array(n * n).fill(Number.NEGATIVE_INFINITY)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = cosinus(vectors[i], vectors[j])
      s[i * n + j] = v
      s[j * n + i] = v
    }
  }

  const actif = new Array<boolean>(n).fill(true)
  const taille = new Array<number>(n).fill(1)
  const noeudDuSlot = new Array<number>(n)
  for (let i = 0; i < n; i++) noeudDuSlot[i] = i

  // Meilleur partenaire de chaque slot, cherché uniquement vers la droite :
  // chaque paire n'est ainsi représentée qu'une fois.
  const partenaire = new Array<number>(n).fill(-1)
  const meilleure = new Array<number>(n).fill(Number.NEGATIVE_INFINITY)
  const recalcule = (i: number): void => {
    let best = -1
    let bestSim = Number.NEGATIVE_INFINITY
    for (let j = i + 1; j < n; j++) {
      if (!actif[j]) continue
      if (s[i * n + j] > bestSim) {
        bestSim = s[i * n + j]
        best = j
      }
    }
    partenaire[i] = best
    meilleure[i] = bestSim
  }
  for (let i = 0; i < n; i++) recalcule(i)

  let restants = n
  while (restants > 1) {
    let ia = -1
    let ja = -1
    let simMax = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n; i++) {
      if (!actif[i] || partenaire[i] < 0) continue
      if (meilleure[i] > simMax) {
        simMax = meilleure[i]
        ia = i
        ja = partenaire[i]
      }
    }
    if (ia < 0) break // ne devrait pas arriver : restants > 1 implique une paire

    const ti = taille[ia]
    const tj = taille[ja]
    for (let k = 0; k < n; k++) {
      if (!actif[k] || k === ia || k === ja) continue
      const fusion = (ti * s[ia * n + k] + tj * s[ja * n + k]) / (ti + tj)
      s[ia * n + k] = fusion
      s[k * n + ia] = fusion
    }

    const fusionne: Noeud = {
      membres: fusionneTries(noeuds[noeudDuSlot[ia]].membres, noeuds[noeudDuSlot[ja]].membres),
      gauche: noeudDuSlot[ia],
      droite: noeudDuSlot[ja],
    }
    noeuds.push(fusionne)
    noeudDuSlot[ia] = noeuds.length - 1
    taille[ia] = ti + tj
    actif[ja] = false
    restants--

    recalcule(ia)
    for (let x = 0; x < n; x++) {
      if (!actif[x] || x === ia) continue
      // Un slot est à recalculer s'il pointait sur l'un des deux fusionnés, ou
      // si la similarité mise à jour vers `ia` peut lui disputer la première place.
      if (partenaire[x] === ja || partenaire[x] === ia || (x < ia && s[x * n + ia] >= meilleure[x])) {
        recalcule(x)
      }
    }
  }

  let racine = -1
  for (let i = 0; i < n; i++) if (actif[i]) racine = noeudDuSlot[i]
  return { noeuds, racine }
}

/** Fusion de deux listes d'index croissantes ; les membres restent triés. */
function fusionneTries(a: number[], b: number[]): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) out.push(a[i] < b[j] ? a[i++] : b[j++])
  while (i < a.length) out.push(a[i++])
  while (j < b.length) out.push(b[j++])
  return out
}

// ── Coupe sous contrainte de capacité ────────────────────────────────────

interface Groupe {
  membres: number[]
  centroide: Vecteur
}

/**
 * Descente depuis la racine (spec §6.3) : trop gros → on descend dans les deux
 * enfants ; trop petit → à recaser ; sinon → on émet.
 *
 * L'ordre de parcours (enfant gauche d'abord, donc plus petite clé d'abord)
 * fixe l'ordre des salles du musée.
 */
function coupe(
  noeuds: Noeud[],
  racine: number,
  maxSize: number,
  minSize: number,
): { emis: number[][]; petits: number[][] } {
  const emis: number[][] = []
  const petits: number[][] = []
  if (racine < 0) return { emis, petits }

  const pile = [racine]
  while (pile.length > 0) {
    const idx = pile.pop()!
    const noeud = noeuds[idx]
    const taille = noeud.membres.length
    if (taille > maxSize && noeud.gauche !== null && noeud.droite !== null) {
      pile.push(noeud.droite, noeud.gauche) // gauche dépilé en premier
    } else if (taille < minSize) {
      petits.push(noeud.membres)
    } else {
      emis.push(noeud.membres)
    }
  }
  return { emis, petits }
}

/**
 * Recasage des groupes sous la taille minimale : chacun rejoint le voisin dont
 * le centroïde est le plus proche, à condition que la fusion ne dépasse pas
 * `maxSize`. Un groupe qu'aucun voisin ne peut absorber part en résidu.
 *
 * Le voisin peut lui-même être trop petit : deux placards voisins forment une
 * salle correcte, ce que le spec autorise en ne restreignant pas « le voisin ».
 */
function recase(
  emis: number[][],
  petits: number[][],
  vectors: Vecteur[],
  minSize: number,
  maxSize: number,
): { groupes: Groupe[]; residu: number[] } {
  const construis = (membres: number[]): Groupe => ({
    membres,
    centroide: centroide(membres, vectors),
  })
  const groupes: Groupe[] = [...emis, ...petits].map(construis)
  // Ordre stable et lisible : par plus petit index membre, donc par clé.
  groupes.sort((a, b) => a.membres[0] - b.membres[0])
  const residu: number[] = []

  for (;;) {
    // Un groupe unique et rien en résidu : on l'émet tel quel même s'il est
    // sous la taille minimale. Un corpus de trois dépôts doit donner une salle
    // nommée, pas une salle « Divers ». Si du résidu existe en revanche, ce
    // dernier survivant le rejoint plutôt que de produire un musée bancal.
    if (groupes.length === 1 && residu.length === 0) break

    const iPetit = groupes.findIndex((g) => g.membres.length < minSize)
    if (iPetit < 0) break

    const petit = groupes[iPetit]
    let iCible = -1
    let simMax = Number.NEGATIVE_INFINITY
    for (let i = 0; i < groupes.length; i++) {
      if (i === iPetit) continue
      if (groupes[i].membres.length + petit.membres.length > maxSize) continue
      const sim = cosinus(petit.centroide, groupes[i].centroide)
      if (sim > simMax) {
        simMax = sim
        iCible = i
      }
    }

    if (iCible < 0) {
      residu.push(...petit.membres)
      groupes.splice(iPetit, 1)
      continue
    }

    const fusionne = construis(fusionneTries(petit.membres, groupes[iCible].membres))
    const survivants = groupes.filter((_, i) => i !== iPetit && i !== iCible)
    survivants.push(fusionne)
    survivants.sort((a, b) => a.membres[0] - b.membres[0])
    groupes.length = 0
    groupes.push(...survivants)
  }

  residu.sort((a, b) => a - b)
  return { groupes, residu }
}

// ── Nommage ──────────────────────────────────────────────────────────────

/** Poids cumulé d'un terme dans un groupe : idf(t) × Σ tf(t) sur les membres. */
function termesDominants(membres: number[], v: Vectorisation, combien: number): string[] {
  const cumul = new Map<string, number>()
  for (const i of membres) {
    for (const [terme, poids] of v.tf[i]) {
      const w = poids * (v.idf.get(terme) ?? 0)
      if (w <= 0) continue
      cumul.set(terme, (cumul.get(terme) ?? 0) + w)
    }
  }
  return [...cumul.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, combien)
    .map(([terme]) => terme)
}

/** `design-patterns` → `Design Patterns`, `c#` → `C#`. */
function capitalise(terme: string): string {
  return terme
    .split(/[-_.\s]+/)
    .filter((mot) => mot.length > 0)
    .map((mot) => mot.charAt(0).toUpperCase() + mot.slice(1))
    .join(' ')
}

function slug(nom: string): string {
  const s = nom
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return s.length > 0 ? s : 'cluster'
}

/**
 * Distributeur de suffixes numériques : le premier venu garde son nom nu, les
 * suivants prennent « 2 », « 3 »… Déterministe parce que l'ordre d'appel l'est.
 */
function unicifieur(): (nom: string) => string {
  const comptes = new Map<string, number>()
  return (nom: string): string => {
    const vus = comptes.get(nom) ?? 0
    comptes.set(nom, vus + 1)
    return vus === 0 ? nom : `${nom} ${vus + 1}`
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────

/**
 * Regroupe les dépôts en salles thématiques.
 *
 * Cas limites, tous décidés ici parce que le spec ne les couvre pas :
 *  - 0 œuvre → aucun cluster ;
 *  - moins de `minSize` œuvres au total → un cluster unique, nommé normalement.
 *    Il vaut mieux un petit musée qu'un musée qui ne contient que « Divers » ;
 *  - `maxSize < minSize` → `maxSize` est relevé à `minSize`, sinon aucune
 *    taille n'est acceptable et tout finirait en résidu ;
 *  - corpus sans aucun signal (ni topic, ni description, ni langage, ou tous
 *    les dépôts identiques) → les vecteurs sont nuls, l'arbre se construit par
 *    ordre alphabétique et les clusters portent le nom `Collection`.
 *
 * Le cluster `Divers` est le seul à échapper aux bornes : il existe justement
 * pour recueillir ce qui ne rentre nulle part.
 */
export function clusterArtworks(artworks: Artwork[], opts: ClusteringOptions): Cluster[] {
  const minSize = Math.max(1, Math.floor(opts.minSize) || 1)
  const maxSize = Math.max(minSize, Math.floor(opts.maxSize) || minSize)

  const v = vectorize(artworks)
  if (v.n === 0) return []

  const { noeuds, racine } = agglomere(v.vectors)
  const { emis, petits } = coupe(noeuds, racine, maxSize, minSize)
  const { groupes, residu } = recase(emis, petits, v.vectors, minSize, maxSize)

  const nomUnique = unicifieur()
  const clusters: Cluster[] = groupes.map((groupe) => {
    const topics = termesDominants(groupe.membres, v, TOPICS_PAR_CLUSTER)
    const brut = topics.slice(0, 2).map(capitalise).join(' / ')
    const name = nomUnique(brut.length > 0 ? brut : NOM_SANS_THEME)
    return {
      id: slug(name),
      name,
      topics,
      keys: groupe.membres.map((i) => v.keys[i]),
    }
  })

  if (residu.length > 0) {
    const name = nomUnique(NOM_DIVERS)
    clusters.push({
      id: slug(name),
      name,
      topics: termesDominants(residu, v, TOPICS_PAR_CLUSTER),
      keys: residu.map((i) => v.keys[i]),
    })
  }

  return clusters
}
