/**
 * Le signalement d'un bug visuel (outil de dév, `babylon/ui/signalement.ts`) : l'adresse qui rejoue la
 * vue signalée dans `tools/comparer-captures.ts --lieu`, au même temps et sur le même moteur.
 */
import type { Meteo } from './meteo.ts'

/** Posés par la capture elle-même (`heure`, `qualite`), ou remplacés par la pose du visiteur (`p`, `projet`). */
const ECARTES = ['p', 'projet', 'heure', 'qualite', 'moteur']

/** Le `?meteo=` le plus proche du temps vivant. ponytail : seuils grossiers ; le relevé exact reste dans signalement.json. */
export function nomDeMeteo(m: Meteo): string {
  if (m.orage) return 'orage'
  if (m.neige > 0) return 'neige'
  if (m.pluie > 0) return 'pluie'
  if (m.brouillard > 0.3) return 'brouillard'
  return 'clair'
}

/** La requête de reprise : la météo figée (sinon le relevé du moment, qui aura changé), WebGL2 forcé s'il l'était. */
export function requeteDeReprise(recherche: string, meteo: Meteo, webgpu: boolean): string {
  const p = new URLSearchParams(recherche)
  for (const c of ECARTES) p.delete(c)
  if (!p.has('meteo')) p.set('meteo', nomDeMeteo(meteo))
  if (!webgpu && !p.has('gpu')) p.set('gpu', '0')
  return p.toString()
}
