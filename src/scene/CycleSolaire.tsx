/**
 * Le cycle jour/nuit : toutes les 30 s, la position du soleil au lieu du musée
 * est recalculée et publiée (`gameStore.ciel`). Le ciel, la lumière, la
 * verrière et la constellation la lisent ; rien n'est animé image par image.
 */
import { useEffect } from 'react'

import { cielDuMoment, useGameStore } from '../stores/gameStore'

export function CycleSolaire() {
  useEffect(() => {
    const id = setInterval(() => useGameStore.setState({ ciel: cielDuMoment() }), 30000)
    return () => clearInterval(id)
  }, [])
  return null
}
