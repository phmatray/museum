/** Le chargement du musée, sans état : la barre de l'écran de chargement (le gabarit statique puis Babylon). */

export type Etape = 'chargement' | 'finition' | 'pret'

/**
 * La part affichée de la barre, de 0 à 1.
 *
 * Les éléments arrivés mènent à 90 %, la finition à 97 %, et seul `pret`
 * donne 100 %. Le total n'est connu qu'au fil de l'eau (les premières données
 * arrivent avant que la 3D n'ait lancé ses modèles) : on divise par le plus
 * grand du total courant et d'`attendu`, le total du dernier chargement complet.
 * Jamais en arrière : un total qui grossit fait baisser la cible, pas la barre.
 * `dt` en secondes ; `doux` faux (mouvement réduit) saute droit à la cible.
 */
export function avancer(affiche: number, faits: number, total: number, etape: Etape, dt: number, doux = true, attendu = 0): number {
  const sur = Math.max(total, attendu)
  const cible = etape === 'pret' ? 1 : etape === 'finition' ? 0.97 : sur === 0 ? 0 : (0.9 * faits) / sur
  if (cible <= affiche) return affiche
  return doux ? affiche + (cible - affiche) * (1 - Math.exp(-5 * dt)) : cible
}

/** L'état que suit l'écran (babylon/chargement.ts) : les suivis, ce qu'on attend encore par son nom, et les chiffres du moteur. */
export interface EtatChargement {
  faits: number
  total: number
  etape: Etape
  /** Les noms des suivis pas encore arrivés (`suivre(p, nom)`), dans l'ordre de départ. */
  attendus: string[]
  /** Les octets des ressources reçues (corps encodés, cache compris). */
  octets: number
  /** Les shaders compilés depuis le socle. */
  shaders: number
  /** Les sondes de reflets prises / à prendre (la finition). */
  sondes: [number, number]
}

/** Des mégaoctets lisibles : une décimale sous 10 Mo, à la française. */
const mo = (o: number) => (o < 10e6 ? (o / 1e6).toFixed(1).replace('.', ',') : String(Math.round(o / 1e6)))

/**
 * Ce que l'écran dit sous la barre : les chiffres (les mégaoctets reçus, ou les reflets en finition ; les shaders
 * compilés), et ce qu'on attend encore. `octetsAttendus` : le poids du dernier chargement complet (0 si inconnu).
 */
export function detailDuChargement(s: EtatChargement, octetsAttendus = 0): { chiffres: string; attente: string } {
  const chiffres: string[] = []
  if (s.etape === 'finition' && s.sondes[1] > 0) chiffres.push(`reflets des salles ${s.sondes[0]} / ${s.sondes[1]}`)
  else if (s.octets > 0) chiffres.push(octetsAttendus > s.octets ? `${mo(s.octets)} / ${mo(octetsAttendus)} Mo` : `${mo(s.octets)} Mo`)
  if (s.shaders > 0) chiffres.push(`${s.shaders} ${s.shaders > 1 ? 'shaders compilés' : 'shader compilé'}`)
  const n = s.attendus.length
  const reste = n - 3
  const attente = s.etape !== 'chargement' || n === 0 ? '' : `Encore : ${s.attendus.slice(0, 3).join(', ')}${reste > 0 ? ` et ${reste} autre${reste > 1 ? 's' : ''}` : ''}`
  return { chiffres: chiffres.join(' · ') || '…', attente }
}
