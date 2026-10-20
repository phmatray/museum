/** Le chargement du musée, sans état : la barre de l'écran de chargement (three et Babylon). */

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
