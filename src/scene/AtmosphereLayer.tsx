/**
 * L'air et l'étalonnage, réglés une fois par image d'après le ciel et le
 * temps (`domain/atmosphere.ts`) : les uniformes partagés de la perspective
 * aérienne (`atmosphere.ts`), ceux de l'étalonnage (`etalonnage.ts`), et le
 * soleil que suivent les rayons à travers les arbres (`PostProcessing`).
 *
 * Aucun maillage de la scène : rien à dessiner ici.
 */
import { useFrame } from '@react-three/fiber'

import { airDuCiel, etalonnageDuCiel, forceDesRayonsDehors } from '../domain/atmosphere'
import { directionDuSoleil } from '../domain/soleil'
import { useGameStore } from '../stores/gameStore'
import { AIR, AIR_LUEUR, AIR_SOL, AIR_SOLEIL } from './atmosphere'
import { ETALONNAGE, SOLEIL_DES_RAYONS } from './etalonnage'
import { INTEMPERIES } from './intemperies'

/** La distance du disque que suivent les rayons : dans le ciel (800), devant le plan lointain. */
const LOIN = 600

export function AtmosphereLayer() {
  useFrame(({ camera }) => {
    const { ciel } = useGameStore.getState()
    const I = INTEMPERIES
    const b = I.uBrumeCouleur.value
    // Le temps lissé par `MeteoLayer` : l'air change avec la brume, pas d'un coup.
    const temps = { nuages: I.uNuages.value, brouillard: I.uBrume.value }
    const air = airDuCiel(ciel, temps, [b.r, b.g, b.b])
    Object.assign(AIR, { x: air.couleur[0], y: air.couleur[1], z: air.couleur[2], w: air.densite })
    Object.assign(AIR_SOL, { x: air.sol, y: air.decroissance })
    const [sx, sy, sz] = directionDuSoleil(ciel)
    Object.assign(AIR_SOLEIL, { x: sx, y: sy, z: sz, w: air.diffusion })
    Object.assign(AIR_LUEUR, { x: air.lueur[0], y: air.lueur[1], z: air.lueur[2] })

    const e = etalonnageDuCiel(ciel)
    ETALONNAGE.uLift.value.set(...e.lift)
    ETALONNAGE.uGamma.value.set(...e.gamma)
    ETALONNAGE.uGain.value.set(...e.gain)
    ETALONNAGE.uSaturation.value = e.saturation
    ETALONNAGE.uContraste.value = e.contraste
    ETALONNAGE.uNuit.value = 1 - ciel.jour

    const force = forceDesRayonsDehors(ciel, temps)
    const s = SOLEIL_DES_RAYONS
    s.position.set(camera.position.x + sx * LOIN, camera.position.y + sy * LOIN, camera.position.z + sz * LOIN)
    s.updateMatrixWorld()
    s.material.color.setRGB(air.lueur[0], air.lueur[1], air.lueur[2]).multiplyScalar(force)
    s.userData.force = force
  })
  return null
}
