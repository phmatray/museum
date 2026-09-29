/**
 * Le compteur de visites de l'entrée : six tambours de laiton, comme sur un
 * compteur mécanique de tourniquet. Pur : un nombre et une horloge entrent, la
 * position de chaque tambour sort.
 *
 * ── La visite ──
 *
 * Le nombre vient d'un compteur public sans clé (abacus) : un GET l'incrémente
 * et le renvoie. Une seule fois par session de navigateur, sinon chaque
 * rechargement compterait un visiteur de plus ; ensuite on relit la valeur
 * gardée. En cas d'échec, `null` : le compteur affiche des tirets, la visite
 * continue.
 */

export const TAILLE = 6
/** Les onze faces d'un tambour : dix chiffres, puis le tiret des pannes. */
export const FACES = 11
export const TIRET = 10
/** Le temps d'un tambour pour passer d'un chiffre au suivant, en secondes. */
const CRAN_S = 0.12

export const URL_COMPTEUR = 'https://abacus.jasoncameron.dev/hit/phmatray-museum/visiteurs'
const CLE_SESSION = 'musee:visites'

/** Les chiffres de `n`, de gauche à droite, sur `TAILLE` tambours ; `null` : des tirets. */
export function chiffres(n: number | null): number[] {
  if (n === null) return Array<number>(TAILLE).fill(TIRET)
  const reste = Math.max(0, Math.floor(n)) % 10 ** TAILLE
  return [...String(reste).padStart(TAILLE, '0')].map(Number)
}

/**
 * La face montrée par un tambour `t` secondes après être parti de `de` vers `a`.
 * Un tambour de compteur ne tourne que dans un sens : de 7 à 2, il passe par 8,
 * 9, le tiret et 0 — le tiret est la onzième face, entre 9 et 0. Le résultat
 * est fractionnaire pendant la rotation (7,5 : à mi-chemin entre 7 et 8).
 */
export function faceDuTambour(de: number, a: number, t: number): number {
  const crans = (a - de + FACES) % FACES
  if (t >= crans * CRAN_S) return a
  const f = t / (crans * CRAN_S)
  // Un léger freinage à l'arrivée, comme un cliquet.
  return (de + crans * (1 - (1 - f) * (1 - f))) % FACES
}

/** La durée de rotation d'un changement de `de` à `a`, pour savoir quand cesser d'animer. */
export function dureeDuCompteur(de: number[], a: number[]): number {
  return Math.max(0, ...de.map((d, i) => ((a[i] - d + FACES) % FACES) * CRAN_S))
}

/**
 * Compte cette visite une fois par session ; aux chargements suivants, relit
 * le total (`/get/`, sans l'incrémenter). Rendre la valeur gardée telle quelle
 * figeait le compteur au nombre du premier chargement : un onglet ouvert (ou
 * restauré par le navigateur) le jour où le compteur valait 1 affichait 1 pour
 * toujours. En panne, la valeur gardée.
 */
export async function compterLaVisite(session: Pick<Storage, 'getItem' | 'setItem'> | null, recuperer: typeof fetch, url = URL_COMPTEUR): Promise<number | null> {
  const garde = Number(session?.getItem(CLE_SESSION)) || null
  try {
    const r = await recuperer(garde === null ? url : url.replace('/hit/', '/get/'))
    if (!r.ok) return garde
    const { value } = (await r.json()) as { value?: unknown }
    if (typeof value !== 'number' || !Number.isFinite(value)) return garde
    session?.setItem(CLE_SESSION, String(value))
    return value
  } catch {
    return garde
  }
}
