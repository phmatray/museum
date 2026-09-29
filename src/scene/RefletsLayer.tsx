/**
 * Les reflets : ce que le laiton, le bronze, le marbre poli et le verre ont à
 * refléter (`scene.environment`), selon où se tient le visiteur.
 *
 * - Dehors, le CIEL de l'heure : la sphère de `Ciel` rendue seule en carte
 *   d'environnement pré-filtrée (PMREM) — le jour, la nuit, l'or du couchant.
 * - Dedans, une SONDE par salle et une pour la nef : la scène elle-même, rendue
 *   depuis le centre de la pièce. Le laiton d'une salle rouge reflète du rouge,
 *   la verrière brille dans l'horloge.
 *
 * Rien n'est rendu à chaque image : une sonde par image, en file, au montage,
 * une seconde fois quand les modèles sont arrivés, puis quand le soleil a
 * tourné d'environ une heure. En changeant de pièce, l'environnement bascule
 * sur la sonde voulue et son intensité remonte en un éclair (pas de saut franc).
 *
 * Toutes les cartes ont la même taille : changer de carte ne recompile aucun
 * matériau.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { sondeDeReflet } from '../domain/ombres'
import { MUSEE } from '../plan/musee'
import { useGameStore } from '../stores/gameStore'

/** Côté d'une face de sonde : les reflets sont flous, 128 suffit. */
const TAILLE = 128
/**
 * L'intensité des reflets, dehors (le ciel éclaire déjà par l'hémisphérique) et
 * dedans, et la part qui en reste la nuit. L'environnement éclaire AUSSI le
 * diffus de toute la scène : la sonde de la nef, pleine de lampes, rendait le
 * parc vu par la porte aussi clair qu'en plein jour à 23 h.
 */
const INTENSITE = { ciel: 0.6, dedans: 0.8, nuit: 0.25 }
/** La seconde passe, quand les modèles et les textures sont arrivés (ms). */
const RATTRAPAGE = 9000

/** Le centre de chaque salle, à 2 m du plancher ; la nef au-dessus du hall. */
const SONDES = new Map<string, THREE.Vector3>()
for (const l of MUSEE.levels)
  for (const r of l.rooms) {
    const centre = new THREE.Vector3(r.x + r.width / 2, l.elevation + 2, r.z + r.depth / 2)
    if (r.kind === 'hall') SONDES.set('nef', centre.setY(3))
    else if (r.kind !== 'balcony') SONDES.set(`${l.id}:${r.id}`, centre)
  }
const TOUTES = ['ciel', ...SONDES.keys()]

export function RefletsLayer() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl])
  const cartes = useRef(new Map<string, THREE.WebGLRenderTarget>())
  const file = useRef<string[]>([])
  const courante = useRef<string | null>(null)
  // Le ciel seul, dans sa propre scène : même géométrie, même matériau que `Ciel`.
  const cielSeul = useMemo(() => new THREE.Scene(), [])

  // Environ une heure de soleil : 8° d'élévation, ou un sixième du jour qui tombe.
  const { elevation, jour } = useGameStore((s) => s.ciel)
  const epoque = `${Math.round(elevation / 8)}:${Math.round(jour * 6)}`
  useEffect(() => {
    file.current = [...TOUTES]
  }, [epoque])
  useEffect(() => {
    const id = setTimeout(() => (file.current = [...new Set([...file.current, ...TOUTES])]), RATTRAPAGE)
    return () => clearTimeout(id)
  }, [])
  useEffect(() => {
    const toutes = cartes.current
    return () => {
      for (const c of toutes.values()) c.dispose()
      toutes.clear()
      pmrem.dispose()
    }
  }, [pmrem])

  /* eslint-disable react-hooks/immutability -- l'environnement est un état de la scène three */
  useFrame((_, dt) => {
    const cle = file.current[0]
    if (cle !== undefined) {
      let carte: THREE.WebGLRenderTarget | null = null
      if (cle === 'ciel') {
        const ciel = scene.getObjectByName('ciel') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined
        if (ciel && ciel.material.uniforms.charge.value === 1) {
          if (cielSeul.children.length === 0) {
            const sphere = new THREE.Mesh(ciel.geometry, ciel.material)
            sphere.scale.setScalar(800)
            cielSeul.add(sphere)
          }
          carte = pmrem.fromScene(cielSeul, 0, 1, 1000, { size: TAILLE })
        }
      } else {
        // La sonde voit le ciel dans les métaux qu'elle capture, pas sa propre carte périmée.
        const avant = scene.environment
        scene.environment = cartes.current.get('ciel')?.texture ?? avant
        carte = pmrem.fromScene(scene, 0, 0.1, 1000, { size: TAILLE, position: SONDES.get(cle) })
        scene.environment = avant
      }
      file.current.shift()
      if (carte) {
        cartes.current.get(cle)?.dispose()
        cartes.current.set(cle, carte)
        if (courante.current === cle) scene.environment = carte.texture
      } else file.current.push(cle) // le ciel n'est pas encore chargé : plus tard
    }

    const voulue = sondeDeReflet(useGameStore.getState().visiteur?.surface)
    const carte = cartes.current.get(voulue) ?? cartes.current.get('ciel')
    if (carte && courante.current !== voulue && (cartes.current.has(voulue) || courante.current === null)) {
      courante.current = cartes.current.has(voulue) ? voulue : 'ciel'
      scene.environment = carte.texture
      scene.environmentIntensity *= 0.3
    }
    const jour = useGameStore.getState().ciel.jour
    const cible = (voulue === 'ciel' ? INTENSITE.ciel : INTENSITE.dedans) * (INTENSITE.nuit + (1 - INTENSITE.nuit) * jour)
    scene.environmentIntensity += (cible - scene.environmentIntensity) * (1 - Math.exp(-6 * dt))
  })
  /* eslint-enable react-hooks/immutability */
  return null
}
