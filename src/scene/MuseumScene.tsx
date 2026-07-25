/**
 * LOT 2 — Le bâtiment entier.
 *
 * Ce composant charge `museum.json` (via `io/loadMuseum`, qui le valide) et
 * l'assemble : un groupe par niveau, plus les rampes qui les relient. Il ne
 * calcule aucune géométrie et ne prend aucune décision de disposition — tout
 * cela vit dans `domain/` et `builders/`. Ce qu'il décide, ce sont les seules
 * choses qui n'existent que pour l'écran : la lumière et le fond.
 *
 * ── Éclairage (spec §9.4) : trois lumières permanentes, neuf allouées ──
 *
 * Le budget est de 12 lumières temps réel et de DEUX shadow maps (§9.4, qui
 * révise les 4 du §9.2). Ce fichier ne porte que les TROIS permanentes ; les
 * neuf autres sont allouées aux salles proches par `RoomLights` et ne coûtent
 * rien aux salles lointaines.
 *
 *  - une `hemisphereLight`, qui donne le ciel et le rebond du sol. Elle ne
 *    projette pas d'ombre et ne coûte rien. Elle a BAISSÉ depuis le lot 3 : à
 *    2,9 elle était le seul éclairage de l'intérieur et écrasait tout à la même
 *    valeur ; à 1,15, elle laisse aux sources locales de quoi révéler un angle ;
 *  - une `directionalLight` pour la verrière zénithale, première des deux
 *    shadow maps. C'est elle qui fait exister le puits de lumière de l'atrium :
 *    la toiture du dernier niveau est percée de la même trémie que la dalle, le
 *    faisceau descend donc par le vide central jusqu'au rez-de-chaussée ;
 *  - une `directionalLight` de REBOND, posée SOUS le bâtiment et visant vers le
 *    haut. Toutes les autres sources sont zénithales : sans elle, les faces
 *    tournées vers le bas — dessous des dalles, dessous de la rampe — ne
 *    reçoivent aucune lumière directe et forment la masse noire qui occupait le
 *    bas de la vue d'entrée. Voir `REBOND` dans `lighting.ts`.
 *
 * Les flaques de lumière sur les murs et le lèche-mur restent PEINTS dans le
 * matériau (§9.2, `lighting.ts`) : ils sont gratuits, et la lumière calculée
 * fait autre chose qu'eux — elle révèle la géométrie, ce qu'un motif plaqué sur
 * une face ne peut pas faire. Pas de lumière par œuvre : jamais.
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

import { useGameStore } from '../stores/gameStore'
import { useThree } from '@react-three/fiber'

import { landings } from '../domain/culling'
import type { Museum, Rect, Vec2 } from '../domain/types'
import { floorAbove, museumResource } from '../io/loadMuseum'
import { CartelLayer } from './CartelLayer'
import { FloorMesh } from './FloorMesh'
import { ParkLayer } from './ParkLayer'
/*
  Hauteur de l'œil au-dessus des pieds, pour que `ouSuisJe()` rende une position
  de VISITEUR et non de caméra. IMPORTÉE, jamais recopiée : la valeur est
  définie avec le corps du visiteur, et l'avoir écrite deux fois a déjà produit
  un relevé faux de 1,10 m — un visiteur resté au rez-de-chaussée semblait avoir
  monté une marche.
*/
import { HAUTEUR_OEIL } from '../components/Player'
import { PropsLayer } from './PropsLayer'
import { RampMesh } from './RampMesh'
import { RoomLights } from './RoomLights'
import type { FloorCulling } from './floorCulling'
import { FloorCullingContext, useFloorCullingRegistry } from './floorCulling'
import {
  AMBIANCE,
  BUDGET_LUMIERES,
  BUDGET_OMBRES,
  ENVIRONMENT_INTENSITY,
  REBOND,
  SOLEIL,
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
      /**
       * Mesure HONNÊTE des draw calls, sur une image entière.
       *
       * `gl.info` se remet à zéro à chaque `render()`, et le composeur de
       * post-traitement en fait plusieurs par image : `stats().calls` ne lit
       * donc plus que la dernière passe plein écran, et rapporte 1. On coupe la
       * remise à zéro automatique, on encadre UNE image, et on rétablit. Le
       * total inclut toutes les passes, shadow maps comprises — c'est ce que la
       * carte dessine réellement, pas ce que la scène contient.
       */
      mesure: () =>
        new Promise<Record<string, number>>((resolve) => {
          requestAnimationFrame(() => {
            gl.info.autoReset = false
            gl.info.reset()
            requestAnimationFrame(() => {
              // Les lumières et les porteurs d'ombre voyagent AVEC les draw
              // calls, dans un seul relevé. Séparés, un contrôle de budget
              // pouvait lire une clé absente, la comprendre comme zéro et
              // afficher un vert sur un plafond jamais vérifié — c'est
              // précisément ce qui est arrivé.
              let lights = 0
              let shadowCasters = 0
              scene.traverse((o) => {
                const l = o as unknown as { isLight?: boolean; castShadow?: boolean }
                if (!l.isLight) return
                lights++
                if (l.castShadow) shadowCasters++
              })
              const releve = {
                calls: gl.info.render.calls,
                triangles: gl.info.render.triangles,
                frame: gl.info.render.frame,
                lights,
                shadowCasters,
              }
              gl.info.autoReset = true
              resolve(releve)
            })
          })
        }),
      stats: () => {
        // Le budget du §9.4 plafonne les lumières TEMPS RÉEL à 12 et les shadow
        // maps à 2. Les compter ici, dans le graphe rendu, est la seule mesure
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
          // Les plafonds du §9.4, à côté de la mesure : un chiffre seul ne dit
          // pas s'il est bon.
          budget: { lights: BUDGET_LUMIERES, shadowCasters: BUDGET_OMBRES },
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
      /*
        ── Jouer, et non regarder ──

        `survol()` place une caméra là où JE décide qu'il faut regarder. C'est
        commode et c'est un piège : on ne voit que ce qu'on a choisi de cadrer,
        et un défaut de PARCOURS — un escalier qu'on ne peut pas atteindre —
        n'apparaît sur aucune de ces vues. Il a fallu qu'on me le dise.

        Ces trois-là permettent de piloter le VRAI personnage, avec sa physique,
        depuis le point d'apparition : `tools/walk.ts` s'en sert pour marcher au
        clavier et relever la trajectoire. Ce qu'ils prouvent n'est pas « ça a
        l'air bien » mais « on y arrive ».
      */
      demarrer: () => {
        useGameStore.getState().setPaused(false)
      },
      /** Oriente le regard. Le verrouillage du pointeur n'existe pas en headless. */
      regarder: (yaw: number, pitch = 0) => {
        camera.rotation.order = 'YXZ'
        camera.rotation.y = yaw
        camera.rotation.x = pitch
      },
      /** Position du VISITEUR — pieds au sol, pas l'œil. */
      ouSuisJe: () => ({
        x: camera.position.x,
        y: camera.position.y - HAUTEUR_OEIL,
        z: camera.position.z,
        yaw: camera.rotation.y,
      }),
      /**
       * Place la caméra et lui donne un point à viser.
       *
       * La cible est un paramètre, et pas le centre du bâtiment en dur : la
       * moitié des vues qui prouvent quelque chose ne regardent pas le centre.
       * Juger un angle de salle, une embrasure ou une sous-face de dalle demande
       * de viser exactement ce point-là — avec un `lookAt` figé, ces vues sont
       * simplement impossibles à cadrer, et c'est ce qui a manqué au premier jeu
       * de captures. Par défaut, le survol d'ensemble d'avant.
       *
       * (22, 14, 22) et non (46, 34, 46) : le bâtiment fait 30 × 30 × 14 m, il
       * sortait minuscule au centre du cadre depuis 75 m.
       */
      survol: (
        x = 22,
        y = 14,
        z = 22,
        cx = 0,
        cy = 4,
        cz = 0,
      ) => {
        camera.position.set(x, y, z)
        camera.lookAt(cx, cy, cz)
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
        sombre « réaliste ») : c'est lui qui éclaire les faces tournées vers le
        bas, qu'aucune source zénithale n'atteint jamais.

        Elle est le PLANCHER d'exposition du bâtiment : ce qu'elle donne, aucune
        salle ne descend en dessous. Le §9.4 l'a fait BAISSER de 2,9 à 1,15 —
        voir `AMBIANCE` : un plancher trop haut donne un bâtiment uniformément
        clair, où deux murs perpendiculaires sortent à la même valeur. Ce qui
        manquait au lot 3 n'était pas de la lumière, c'était de l'écart.
      */}
      <hemisphereLight
        args={[AMBIANCE.ciel, AMBIANCE.sol, AMBIANCE.intensite]}
      />

      {/*
        La seule ombre du bâtiment. La caméra d'ombre est ORTHOGRAPHIQUE et
        dimensionnée sur l'emprise réelle : trop petite, les étages hauts
        n'entrent pas dans le champ et leurs ombres disparaissent d'un coup ;
        trop grande, la résolution s'effondre et les contours deviennent des
        escaliers.

        Son intensité était descendue de 2,1 à 1,5 au lot 3, quand elle devait
        cohabiter avec une hémisphérique à 2,9 : à 2,1 les façades et la toiture
        partaient en blanc pur. L'hémisphérique ayant baissé à 1,15, elle remonte
        à 1,8 (`SOLEIL`) — c'est elle, désormais, qui doit faire la différence
        entre le plein soleil de la toiture et le fond d'une salle.
      */}
      <directionalLight
        castShadow
        color={SOLEIL.couleur}
        intensity={SOLEIL.intensite}
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

      {/*
        LE REBOND (§9.4) — la troisième permanente, et la correction du défaut
        le plus visible après les angles.

        Une directionnelle posée SOUS le bâtiment et visant l'origine : sa
        lumière voyage vers le HAUT, donc elle n'atteint QUE les faces tournées
        vers le bas. Dessous des dalles, dessous de la rampe, dessous des bancs :
        tout ce que le soleil, les plafonniers et le puits — tous zénithaux — ne
        pouvaient structurellement pas éclairer, et qui tombait au noir.

        Sans ombre : un rebond diffus n'en projette pas, et les deux shadow maps
        du budget sont dépensées ailleurs. Sa teinte est celle du sol qui la
        renvoie, marbre et parquet, donc chaude.
      */}
      <directionalLight
        color={REBOND.couleur}
        intensity={REBOND.intensite}
        position={sun.bounce}
      />

      {/*
        Les NEUF lumières allouées (§9.4) : le projecteur de la salle courante
        — seconde et dernière shadow map —, cinq plafonniers réaffectés aux
        salles proches, et trois sources dans le puits de l'atrium.

        Elles sont montées ICI, à la racine du bâtiment, et non dans `RoomMesh` :
        une lumière par salle serait une lumière par salle, c'est-à-dire dix-sept
        pour ce musée et cent pour le suivant. C'est un POOL de taille fixe qui
        se déplace, ce qui rend le plafond du §9 indépendant du nombre de salles.
      */}
      <RoomLights museum={museum} culling={culling} />

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

      {/*
        Le mobilier et la végétation (§9.4) : bancs, socles, jardinières,
        plantes et rail de projecteurs.

        UNE seule couche pour tout le bâtiment, comme les cartels et pour une
        raison mesurée, pas par facilité : découpés par étage, les mêmes deux
        cent cinquante props coûtaient 32 draw calls au lieu de 9, sans jamais
        rien économiser — les quatre plateaux sont dans le frustum en même temps
        depuis presque n'importe où (voir l'en-tête de `PropsLayer`).

        Aucune lumière n'entre ici. Les projecteurs du plafond sont des objets ;
        l'éclairage des toiles reste peint dans le shader (§9.2).
      */}
      <PropsLayer museum={museum} />

      {/*
        LE PARC. Hors de tout groupe d'étage, et c'est délibéré : il
        n'appartient à aucun niveau, il est SOUS le bâtiment et visible depuis
        tous. Le masquer avec un plateau le ferait disparaître par les fenêtres
        du plateau voisin — c'est-à-dire par ce qu'on vient de percer pour le
        voir.

        Le musée n'avait aucun sol : il flottait sur un fond de ciel, ce qui le
        faisait lire comme une maquette posée sur une table.
      */}
      <ParkLayer footprint={museum.floors[0].footprint} elevation={0} />
    </>
  )
}

// ── Cadrage de la lumière ────────────────────────────────────────────────

interface SunSetup {
  position: [number, number, number]
  /**
   * Position de la lumière de rebond, sous le bâtiment. Elle vise l'origine
   * comme le soleil : sa direction de propagation est donc exactement opposée.
   */
  bounce: [number, number, number]
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
    // Très légèrement décalée en x/z plutôt que rigoureusement verticale : une
    // directionnelle exactement alignée sur l'axe y rend son vecteur `up`
    // dégénéré dans three, ce qui n'a pas d'incidence sans ombre mais rendrait
    // le jour où quelqu'un lui en donnerait une.
    bounce: [rayon * 0.1, bas - rayon * REBOND.profondeur, rayon * 0.15],
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
