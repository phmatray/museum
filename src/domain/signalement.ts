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

/** Une pose du visiteur sur son trajet : les pieds (`y`, le plancher), le regard, et `t` en secondes (0 : la capture, négatif avant). */
export interface PoseTrajet { x: number; z: number; y: number; yaw: number; pitch: number; t: number }

/** Deux poses qui se suivent sans que le visiteur ait bougé (5 cm, ~1°). */
const immobile = (a: PoseTrajet, b: PoseTrajet) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.05 && Math.abs(a.yaw - b.yaw) < 0.02 && Math.abs(a.pitch - b.pitch) < 0.02

/**
 * `n` poses réparties sur le trajet, de la plus ancienne à la dernière : de quoi rejouer un bug qui n'apparaît
 * qu'en bougeant. Un arrêt compte pour une seule pose ; un visiteur resté immobile n'a pas de trajet (une pose).
 */
export function echantillonner(trajet: PoseTrajet[], n = 5): PoseTrajet[] {
  const distinctes = trajet.filter((p, i) => i === 0 || !immobile(p, trajet[i - 1]))
  if (distinctes.length <= n) return distinctes
  return Array.from({ length: n }, (_, i) => distinctes[Math.round((i * (distinctes.length - 1)) / (n - 1))])
}

/** La pose signalée : la surface du visiteur (une volée aussi), ses pieds et son regard. */
export interface PoseSignalee extends Omit<PoseTrajet, 't'> { surface?: string }

/**
 * Les vues à rejouer pour un constat : `lieu` (la pose de la capture, sur sa surface), puis `trajet-1` … `trajet-n`
 * si le visiteur marchait (un bug qui n'apparaît qu'en bougeant se cherche entre deux points du trajet).
 */
export function vuesDuConstat(lieu: PoseSignalee, trajet: PoseTrajet[]): ({ nom: string } & PoseSignalee)[] {
  const points = echantillonner(trajet)
  const { surface, x, z, y, yaw, pitch } = lieu
  return [{ nom: 'lieu', surface, x, z, y, yaw, pitch }, ...(points.length > 1 ? points.map((p, i) => ({ nom: `trajet-${i + 1}`, x: p.x, z: p.z, y: p.y, yaw: p.yaw, pitch: p.pitch })) : [])]
}

/**
 * Le prompt du bouton 🐞, à coller dans une session Claude : la commande du skill du projet d'abord (la procédure
 * vit dans `.claude/skills/signalement/SKILL.md`, pas dans le prompt), la note, et où tout se trouve.
 */
export function promptDuConstat(id: string, note: string, dossier: string, racine: string): string {
  return `/signalement ${id}

Note du visiteur : « ${note} »
Capture : ${dossier}/utilisateur.png — constat complet : ${dossier}/signalement.json
Procédure : ${racine}/.claude/skills/signalement/SKILL.md
`
}
