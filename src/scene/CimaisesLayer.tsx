/**
 * Les cimaises modulables (`plan/cimaises.ts`) : le stratifié blanc mat des
 * modules, et l'aluminium de leurs jonctions, de la plinthe et des pieds —
 * deux lots d'instances par niveau. Elles ne sont pas dans l'atlas de la
 * lumière cuite : pas de carte, l'éclairage direct et les ombres suffisent.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { boitesDesCimaises } from '../plan/cimaises'
import { MUSEE } from '../plan/musee'
import { Boites } from './PlanBuilding'

export function CimaisesLayer() {
  const niveaux = useMemo(() => MUSEE.levels.map((l) => boitesDesCimaises(MUSEE, l.id)), [])
  const matieres = useMemo(() => ({
    stratifie: new THREE.MeshStandardMaterial({ name: 'cimaise:stratifie', color: '#efece6', roughness: 0.82, metalness: 0 }),
    alu: new THREE.MeshStandardMaterial({ name: 'cimaise:alu', color: '#a7acb1', roughness: 0.45, metalness: 0.55 }),
  }), [])
  useEffect(() => () => {
    matieres.stratifie.dispose()
    matieres.alu.dispose()
  }, [matieres])
  return (
    <group name="cimaises">
      {niveaux.map((b, i) => b.panneaux.length > 0 && (
        <group key={i}>
          <Boites boites={b.panneaux} material={matieres.stratifie} />
          <Boites boites={b.alu} material={matieres.alu} />
        </group>
      ))}
    </group>
  )
}
