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
 * Le budget est de 4 lumières temps réel et d'UNE shadow map. Le bâtiment en
 * consomme DEUX, et le lot 3 n'en a ajouté aucune :
 *
 *  - une `hemisphereLight`, qui donne le ciel et le rebond du sol. Elle ne
 *    projette pas d'ombre et ne coûte rien ;
 *  - une `directionalLight` pour la verrière zénithale, seule à porter la
 *    shadow map. C'est elle qui fait exister le puits de lumière de l'atrium :
 *    la toiture du dernier niveau est percée de la même trémie que la dalle, le
 *    faisceau descend donc par le vide central jusqu'au rez-de-chaussée.
 *
 * Tout le reste de l'ambiance — flaques de lumière sur les murs, lèche-mur,
 * dégradé du puits de lumière — est PEINT dans le matériau de mur, voir
 * `lighting.ts`. Pas de lumière par œuvre : jamais. Les deux lumières de marge
 * restent disponibles pour un besoin qui ne soit pas décoratif.
 *
 * ── Rendu des tons ──
 *
 * R3F impose `ACESFilmicToneMapping` au `Canvas`. Sa courbe en S écrase les
 * basses lumières : avec deux sources seulement, TOUT l'intérieur du bâtiment
 * tombait dans le pied de la courbe et le musée apparaissait noir alors que ses
 * matériaux étaient clairs. On le remplace ici, sur le `gl`, plutôt que dans
 * `App` : c'est une décision d'éclairage, elle appartient à la scène et non au
 * conteneur React. Voir `TONE_MAPPING` dans `lighting.ts`.
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

import { landings } from '../domain/culling'
import type { Museum, Rect, Vec2 } from '../domain/types'
import { floorAbove, museumResource } from '../io/loadMuseum'
import { CartelLayer } from './CartelLayer'
import { FloorMesh } from './FloorMesh'
import { RampMesh } from './RampMesh'
import type { FloorCulling } from './floorCulling'
import { FloorCullingContext, useFloorCullingRegistry } from './floorCulling'
import {
  ENVIRONMENT_INTENSITY,
  TONE_EXPOSURE,
  TONE_MAPPING,
  buildAmbientEnvironment,
} from './lighting'

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
function SceneDebugHandle({ culling }: { culling: FloorCulling }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __MUSEUM__?: unknown }
    w.__MUSEUM__ = {
      gl,
      scene,
      camera,
      stats: () => {
        // Le budget du §9 plafonne les lumières TEMPS RÉEL à 4 et les shadow
        // maps à 1. Les compter ici, dans le graphe rendu, est la seule mesure
        // qui ne mente pas : relire le JSX ne dirait rien de ce qu'un autre
        // composant aurait pu ajouter.
        let lights = 0
        let shadowCasters = 0
        scene.traverse((o) => {
          const l = o as unknown as { isLight?: boolean; castShadow?: boolean }
          if (!l.isLight) return
          lights++
          if (l.castShadow) shadowCasters++
        })
        return {
          calls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          programs: gl.info.programs?.length ?? -1,
          textures: gl.info.memory.textures,
          geometries: gl.info.memory.geometries,
          lights,
          shadowCasters,
          toneMapping: gl.toneMapping,
          exposure: gl.toneMappingExposure,
          // Quel plateau est encore dessiné, et à quel niveau le registre croit
          // que se tient le joueur. Sans cette ligne, un culling trop agressif
          // ne se distingue pas d'un bâtiment qui n'a jamais été construit.
          culling: culling.snapshot(),
        }
      },
      /**
       * Coupe le culling par étage. Le « avant / après » du §9 se mesure ainsi
       * dans la MÊME session, depuis la MÊME position de caméra : comparer deux
       * rechargements comparerait aussi deux états de cache et deux points de
       * vue, ce qui ne prouverait rien.
       */
      setCulling: (actif: boolean) => {
        culling.setActive(actif)
      },
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
  }, [gl, scene, camera, culling])
  return null
}

/**
 * Impose le rendu des tons de la scène.
 *
 * Le `Canvas` de R3F force `ACESFilmicToneMapping` et une exposition de 1 à
 * chaque montage. On les reprend ici plutôt que dans `App` parce que c'est une
 * décision d'ÉCLAIRAGE : elle vit avec les lumières et la palette, pas avec le
 * conteneur React qui n'en sait rien.
 */
function ToneMapping() {
  const { gl } = useThree()
  useEffect(() => {
    // Le `WebGLRenderer` est un objet three mutable, pas un état React : R3F ne
    // propose aucun autre moyen de reprendre un réglage qu'il a lui-même posé
    // au montage du `Canvas`. Même convention que `Player` et
    // `PointerLockOverlay`, qui mutent la caméra pour la même raison.
    /* eslint-disable react-hooks/immutability */
    gl.toneMapping = TONE_MAPPING
    gl.toneMappingExposure = TONE_EXPOSURE
    /* eslint-enable react-hooks/immutability */
  }, [gl])
  return null
}

/**
 * Pose la carte d'environnement de la scène.
 *
 * Ce n'est PAS une lumière au sens du budget du §9 : rien n'est ajouté au
 * graphe, `scene.environment` est un uniforme lu par des shaders qui existent
 * déjà. Elle sert au spéculaire — sans elle, tout ce qui est métallique dans le
 * bâtiment (les garde-corps de l'atrium) réfléchit le noir.
 */
function AmbientEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const env = buildAmbientEnvironment(gl)
    // La `Scene` de R3F est mutable par contrat — c'est déjà ce que fait
    // `<color attach="background" />` juste à côté, en JSX. Il n'existe pas
    // d'équivalent déclaratif pour `environmentIntensity`, d'où l'effet.
    /* eslint-disable react-hooks/immutability */
    scene.environment = env
    scene.environmentIntensity = ENVIRONMENT_INTENSITY
    /* eslint-enable react-hooks/immutability */
    return () => {
      // Sans libération, chaque rechargement à chaud laisse une cubemap
      // pré-filtrée en VRAM.
      scene.environment = null
      env.dispose()
    }
  }, [gl, scene])
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

  // Le culling par étage (§9.3). Un seul registre pour tout le bâtiment : la
  // question « à quel niveau est le joueur ? » doit recevoir la même réponse
  // pour les quatre plateaux au même instant, sinon deux d'entre eux peuvent
  // basculer à une image d'écart et le contenu clignote à la frontière.
  const paliers = useMemo(() => landings(museum), [museum])
  const culling = useFloorCullingRegistry(paliers)

  return (
    <>
      <SceneDebugHandle culling={culling} />
      <ToneMapping />
      <AmbientEnvironment />
      {/*
        Le ciel. Il n'est PAS décoratif : c'est ce qu'on voit par la trémie de la
        toiture, et aussi par les côtés du rez-de-chaussée, que la disposition
        laisse ouverts faute de salle sur trois faces. Un fond presque noir
        (#0e1116, valeur du lot 2) faisait lire ces ouvertures comme des murs
        noirs et tirait toute l'image vers le bas. Un ciel diurne les rend à ce
        qu'elles sont : du dehors.
      */}
      <color attach="background" args={['#9aabc0']} />

      {/*
        Le sol de l'hémisphérique est volontairement CLAIR (et non un gris
        sombre « réaliste ») : c'est la seule lumière qui atteigne l'intérieur
        des salles, que la dalle du dessus prive complètement du soleil. Avec un
        sol sombre, tout ce qui n'est pas dans le puits de lumière tombe au noir
        — vérifié à l'écran, ce n'est pas une précaution théorique.

        Elle est le PLANCHER d'exposition du bâtiment : ce qu'elle donne, aucune
        salle ne descend en dessous. Le relief, lui, vient des flaques peintes de
        `lighting.ts` — c'est pour ça qu'on peut la monter sans aplatir l'image.
      */}
      <hemisphereLight args={['#dbe6f5', '#dcd8d0', 2.9]} />

      {/*
        La seule ombre du bâtiment. La caméra d'ombre est ORTHOGRAPHIQUE et
        dimensionnée sur l'emprise réelle : trop petite, les étages hauts
        n'entrent pas dans le champ et leurs ombres disparaissent d'un coup ;
        trop grande, la résolution s'effondre et les contours deviennent des
        escaliers.

        Son intensité est descendue de 2,1 à 1,5 : à 2,1 les façades extérieures
        et la toiture partaient en blanc pur — le bâtiment était SUREXPOSÉ dehors
        et noir dedans en même temps. Ce qui manquait n'était pas du soleil.
      */}
      <directionalLight
        castShadow
        intensity={1.5}
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

      <FloorCullingContext.Provider value={culling}>
        {floors.map((floor) => (
          <FloorMesh
            key={floor.id}
            floor={floor}
            museum={museum}
            slabThickness={museum.config.building.slabThickness}
            // Décision prise ICI, sur la donnée, et pas dans `FloorMesh` : le
            // niveau qui n'a pas de dalle au-dessus de lui porte la toiture.
            isTopFloor={floorAbove(museum, floor) === undefined}
            shadowDrift={sun.drift}
            baseElevation={sun.base}
          />
        ))}
      </FloorCullingContext.Provider>

      {museum.ramps.map((ramp) => (
        <RampMesh key={ramp.id} ramp={ramp} />
      ))}

      {/*
        Les cartels, UNE seule couche pour tout le bâtiment (spec §9.3).

        Ce n'est pas un oubli du culling par étage : la couche n'affiche que les
        œuvres à moins de six mètres de l'œil, et trois niveaux d'écart en font
        plus de quinze. Un cartel d'un plateau lointain est donc structurellement
        impossible — la contrainte du §9.3 est déjà tenue, et plus strictement,
        par le seuil de distance. Un pool par étage aurait au contraire quadruplé
        le nombre de `Text` montés pour n'en allumer jamais plus de treize.

        Elle reste sous le `<Suspense>` du canvas : `Text` de drei suspend le
        temps de précharger sa police.
      */}
      <CartelLayer museum={museum} />
    </>
  )
}

// ── Cadrage de la lumière ────────────────────────────────────────────────

interface SunSetup {
  position: [number, number, number]
  /** Demi-côté de la caméra d'ombre orthographique, en mètres. */
  halfExtent: number
  far: number
  /**
   * Déplacement horizontal de l'ombre par mètre de chute.
   *
   * La lumière vise l'origine : un point situé `h` mètres au-dessus du sol voit
   * donc son ombre glisser de `-position.xz / position.y × h`. C'est ce que le
   * culling par étage doit connaître pour ne pas escamoter l'ombre d'un plateau
   * sorti du cadre (voir `domain/culling.shadowSweptBox`).
   */
  drift: Vec2
  /** Altitude du plancher le plus bas : là où les ombres finissent par tomber. */
  base: number
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
  const position: [number, number, number] = [
    rayon * 0.45,
    hauteurSoleil,
    rayon * 0.65,
  ]

  return {
    position,
    drift: { x: position[0] / position[1], z: position[2] / position[1] },
    base: bas,
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
