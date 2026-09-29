/**
 * Ne dessiner que ce qu'on peut voir (`plan/visibilite.ts`).
 *
 * Chaque fois que le visiteur a fait quelques pas, les zones visibles de là où
 * il est sont recalculées, et tout le reste de la scène est écarté du rendu —
 * sans qu'aucune couche n'ait à le savoir :
 *
 * - un maillage ordinaire l'est d'un bloc, selon les zones que touche sa boîte
 *   englobante. On passe par ses `layers` et pas par `visible`, que certaines
 *   couches pilotent déjà elles-mêmes ;
 * - un lot d'instances est COMPACTÉ : les instances des zones visibles sont
 *   recopiées en tête de tous ses attributs d'instance, et `count` s'arrête
 *   là. Un seul appel de dessin comme avant, mais seulement les toiles, les
 *   projecteurs ou les bancs qu'on peut voir. Les originaux sont gardés à part.
 *
 * Un lot qu'une couche réécrit (les étoiles de la constellation, l'éveil des
 * toiles, à chaque image) n'est jamais compacté : il faut qu'il soit resté
 * tel quel deux passes de suite. Et si une couche réécrit un lot déjà compacté
 * (un escalier qui arrive, par exemple), on le détecte à la version de ses
 * attributs, on remet les originaux et on recommence.
 */
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

import { MUSEE } from '../plan/musee'
import { RAYON_OEIL, zonesDuVolume, zonesVisibles, type Zone } from '../plan/visibilite'
import { trier } from './tri'

/** Même sans bouger : de quoi prendre en compte ce qui vient de se charger. */
const PERIODE = 0.5

export function VisibiliteLayer() {
  const scene = useThree((s) => s.scene)
  const etat = useRef({ x: NaN, y: NaN, z: NaN, vues: new Set<Zone>(), cle: '', attente: 0 })
  useFrame(({ camera }, dt) => {
    const e = etat.current
    const p = camera.position
    const bouge = !(Math.hypot(p.x - e.x, p.z - e.z) < RAYON_OEIL / 2 && Math.abs(p.y - e.y) < 0.5)
    e.attente -= dt
    if (!bouge && e.attente > 0) return
    e.attente = PERIODE
    if (bouge) {
      Object.assign(e, { x: p.x, y: p.y, z: p.z })
      e.vues = zonesVisibles(MUSEE, zonesDuVolume(MUSEE, p, p, RAYON_OEIL), p)
      e.cle = [...e.vues].sort().join()
    }
    // En développement, `window.__TOUT_VOIR__ = true` rend tout, pour mesurer avant/après.
    if (import.meta.env.DEV && (window as { __TOUT_VOIR__?: boolean }).__TOUT_VOIR__) trier(scene, null, 'tout')
    else trier(scene, e.vues, e.cle)
  })
  return null
}
