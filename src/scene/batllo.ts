/**
 * La baie de la salle d'honneur, sur le hall : c'est la fenêtre à la Casa
 * Batlló (`assets/architecture/batllo.glb`) qui la vitre, plus la boîte de verre
 * que `meshLevel` y pose. La baie reste une baie pour le plan — on ne la
 * franchit toujours pas — seul son rendu change.
 */
import { MUSEE } from '../plan/musee'
import type { Box } from '../plan/mesh'

const NIVEAU = MUSEE.levels.find((l) => l.openings.some((o) => o.kind === 'bay' && o.a === 'honneur'))!
export const BAIE_BATLLO = { ...NIVEAU.openings.find((o) => o.kind === 'bay' && o.a === 'honneur')!, level: NIVEAU.id }

/** Les boîtes de verre d'un niveau, sans celle de la baie Batlló. */
export function sansBaieBatllo(boites: Box[], level: number): Box[] {
  if (level !== BAIE_BATLLO.level) return boites
  return boites.filter((b) => !(Math.abs(b.x - BAIE_BATLLO.x) < 1e-6 && Math.abs(b.z - BAIE_BATLLO.z) < 1e-6))
}
