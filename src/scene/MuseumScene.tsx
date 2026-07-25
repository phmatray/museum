/**
 * LOT 2 — Le bâtiment entier.
 *
 * Ce composant charge `museum.json` (via `io/loadMuseum`, qui le valide) et
 * l'assemble : un groupe par niveau, plus les rampes qui les relient. Il ne
 * calcule aucune géométrie et ne prend aucune décision de disposition — tout
 * cela vit dans `domain/` et `builders/`. Ce qu'il décide, ce sont les seules
 * choses qui n'existent que pour l'écran : la lumière et le fond.
 *
 * ── Éclairage (spec §9.2) : deux lumières, pas deux cent cinquante-six ──
 *
 * Le budget est de 4 lumières temps réel et d'UNE shadow map. Le lot 2 en
 * consomme deux :
 *
 *  - une `hemisphereLight`, qui donne le ciel et le rebond du sol. Elle ne
 *    projette pas d'ombre et ne coûte rien ;
 *  - une `directionalLight` pour la verrière zénithale, seule à porter la
 *    shadow map. C'est elle qui fait exister le puits de lumière de l'atrium :
 *    la toiture du dernier niveau est percée de la même trémie que la dalle, le
 *    faisceau descend donc par le vide central jusqu'au rez-de-chaussée.
 *
 * Il reste deux lumières de marge pour les deux sources locales de la salle du
 * joueur, prévues au lot 3. Pas de lumière par œuvre : jamais.
 *
 * ── Chargement ──
 *
 * `use()` sur la promesse MÉMORISÉE de `museumResource()`. `App` consomme la
 * même pour le spawn du joueur et le plan : une seule requête réseau, un seul
 * objet `Museum`, donc aucun risque que la scène et le joueur travaillent sur
 * deux bâtiments différents.
 */
import { use, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'

import type { Museum, Rect } from '../domain/types'
import { floorAbove, museumResource } from '../io/loadMuseum'
import { FloorMesh } from './FloorMesh'
import { RampMesh } from './RampMesh'

/** Charge le musée puis le rend. À placer sous un `<Suspense>`. */
export function MuseumScene() {
  const museum = use(museumResource())
  return <MuseumBuilding museum={museum} />
}

export interface MuseumBuildingProps {
  museum: Museum
}

/**
 * Le bâtiment, à partir d'un musée déjà chargé.
 *
 * Séparé de `MuseumScene` pour que le rendu ne dépende pas du réseau : c'est
 * cette moitié-là qu'un futur éditeur (spec §10) rendra à partir d'un musée
 * modifié en mémoire, sans repasser par un fichier.
 */
/**
 * Expose le rendu sur `window.__MUSEUM__` en développement seulement.
 *
 * Deux usages, tous deux indispensables et impossibles autrement : mesurer le
 * budget du §9 (`gl.info.render.calls`) et déplacer la caméra pour inspecter le
 * bâtiment sans avoir à le traverser à pied. `import.meta.env.DEV` le retire
 * intégralement du bundle de production.
 */
function SceneDebugHandle() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __MUSEUM__?: unknown }
    w.__MUSEUM__ = {
      gl,
      scene,
      camera,
      stats: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        programs: gl.info.programs?.length ?? -1,
        textures: gl.info.memory.textures,
        geometries: gl.info.memory.geometries,
      }),
      /** Place la caméra en survol pour juger le bâtiment d'un coup d'œil. */
      survol: (x = 46, y = 34, z = 46) => {
        camera.position.set(x, y, z)
        camera.lookAt(0, 6, 0)
        camera.updateProjectionMatrix()
      },
    }
    return () => {
      delete w.__MUSEUM__
    }
  }, [gl, scene, camera])
  return null
}

export function MuseumBuilding({ museum }: MuseumBuildingProps) {
  // Ordre stable, du bas vers le haut. `museum.floors` est déjà trié, mais s'en
  // remettre à un ordre d'écriture non contractuel se paie tôt ou tard.
  const floors = useMemo(
    () => [...museum.floors].sort((a, b) => a.elevation - b.elevation),
    [museum],
  )

  const sun = useMemo(() => sunSetup(museum), [museum])

  return (
    <>
      <SceneDebugHandle />
      {/* Le ciel qu'on aperçoit par la trémie de la toiture. */}
      <color attach="background" args={['#0e1116']} />

      {/*
        Le sol de l'hémisphérique est volontairement CLAIR (et non un gris
        sombre « réaliste ») : c'est la seule lumière qui atteigne l'intérieur
        des salles, que la dalle du dessus prive complètement du soleil. Avec un
        sol sombre, tout ce qui n'est pas dans le puits de lumière tombe au noir
        — vérifié à l'écran, ce n'est pas une précaution théorique.
      */}
      <hemisphereLight args={['#e8eef7', '#9d968a', 1.7]} />

      {/*
        La seule ombre du bâtiment. La caméra d'ombre est ORTHOGRAPHIQUE et
        dimensionnée sur l'emprise réelle : trop petite, les étages hauts
        n'entrent pas dans le champ et leurs ombres disparaissent d'un coup ;
        trop grande, la résolution s'effondre et les contours deviennent des
        escaliers.
      */}
      <directionalLight
        castShadow
        intensity={2.1}
        position={sun.position}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-camera-left={-sun.halfExtent}
        shadow-camera-right={sun.halfExtent}
        shadow-camera-top={sun.halfExtent}
        shadow-camera-bottom={-sun.halfExtent}
        shadow-camera-near={1}
        shadow-camera-far={sun.far}
      />

      {floors.map((floor) => (
        <FloorMesh
          key={floor.id}
          floor={floor}
          slabThickness={museum.config.building.slabThickness}
          // Décision prise ICI, sur la donnée, et pas dans `FloorMesh` : le
          // niveau qui n'a pas de dalle au-dessus de lui porte la toiture.
          isTopFloor={floorAbove(museum, floor) === undefined}
        />
      ))}

      {museum.ramps.map((ramp) => (
        <RampMesh key={ramp.id} ramp={ramp} />
      ))}
    </>
  )
}

// ── Cadrage de la lumière ────────────────────────────────────────────────

interface SunSetup {
  position: [number, number, number]
  /** Demi-côté de la caméra d'ombre orthographique, en mètres. */
  halfExtent: number
  far: number
}

/**
 * Place le soleil au-dessus du bâtiment et dimensionne sa caméra d'ombre.
 *
 * La cible est l'origine, qui est aussi le centre de l'atrium : le plan en
 * anneau du spec §7.2 centre l'atrium sur l'origine, et le `target` par défaut
 * d'une `directionalLight` de three est précisément (0, 0, 0). On garde donc la
 * cible implicite plutôt que d'introduire un objet `target` qu'il faudrait
 * penser à ajouter au graphe pour que sa matrice soit à jour.
 *
 * L'inclinaison est volontairement faible en `x` et `z` par rapport à la
 * hauteur : un soleil trop rasant n'éclaire plus le fond de l'atrium, et le
 * puits de lumière — la seule raison d'être de cette lumière — disparaît.
 */
function sunSetup(museum: Museum): SunSetup {
  const enveloppe = union(museum.floors.map((f) => f.footprint))
  const rayon = Math.hypot(enveloppe.width, enveloppe.depth) / 2

  const bas = Math.min(...museum.floors.map((f) => f.elevation))
  const haut = Math.max(
    ...museum.floors.map((f) => f.elevation + f.ceilingHeight),
  )
  const hauteurSoleil = haut + rayon

  return {
    position: [rayon * 0.45, hauteurSoleil, rayon * 0.65],
    // Le bâtiment tourne autour de l'origine : la caméra d'ombre doit contenir
    // la diagonale de l'emprise, pas son côté.
    halfExtent: rayon * 1.1,
    // Assez loin pour que la dalle la plus basse reste dans le champ.
    far: hauteurSoleil - bas + rayon,
  }
}

/** Plus petit rectangle contenant tous les autres. */
function union(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x))
  const minZ = Math.min(...rects.map((r) => r.z))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const maxZ = Math.max(...rects.map((r) => r.z + r.depth))
  return { x: minX, z: minZ, width: maxX - minX, depth: maxZ - minZ }
}
