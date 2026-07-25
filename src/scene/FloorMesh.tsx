/**
 * LOT 2/3 — Un niveau.
 *
 * UN GROUPE PAR ÉTAGE, et c'était le point : le culling du lot 3 (spec §9.3)
 * ne fait que basculer la visibilité de ce groupe. Tout ce qui appartient au
 * niveau y est, rien de ce qui appartient à un autre niveau n'y entre.
 *
 * ── Deux groupes, et pas un (lot 3) ──
 *
 * Le plateau est désormais coupé en deux nœuds emboîtés, parce que le §9.3
 * distingue deux masquages qui n'ont pas la même portée :
 *
 *   `floor:<id>`    le plateau ENTIER — masqué quand sa boîte, ombre portée
 *                   comprise, ne rencontre plus le frustum ;
 *   `content:<id>`  les murs, les œuvres et les cartels — masqués dès que le
 *                   joueur est à plus de deux niveaux, même si le plateau reste
 *                   à l'écran. C'est le cas courant depuis l'atrium : on voit
 *                   les dalles des quatre niveaux, jamais le contenu des salles
 *                   du troisième.
 *
 * La dalle, le garde-corps et la toiture restent donc HORS du groupe de
 * contenu : ce sont eux qui donnent au bâtiment sa silhouette vue d'en bas, et
 * les masquer se verrait pour trois draw calls gagnés.
 *
 * Le niveau porte quatre choses :
 *
 *  - **la dalle**, emprise moins trémies, dont la face supérieure est à
 *    `floor.elevation` : c'est le sol sur lequel on marche, et son collider est
 *    ce qui empêche de traverser le bâtiment ;
 *  - **le garde-corps** du périmètre des trémies, seul obstacle entre le joueur
 *    et le vide de l'atrium — il a donc un collider, pas seulement une
 *    silhouette ;
 *  - **les salles**, qui n'apportent que leurs murs (voir `RoomMesh` : le sol et
 *    le plafond d'une salle sont les dalles, pas des plans supplémentaires) ;
 *  - **la toiture**, au dernier niveau seulement — celui qui n'a pas de dalle
 *    au-dessus de lui. Elle est percée de la même trémie que la dalle, ce qui
 *    fait de l'atrium le puits de lumière zénithal du spec §9.2.
 *
 * Les colliders de la dalle et du garde-corps vivent dans le MÊME `RigidBody`
 * que leurs maillages, posé à l'élévation du niveau : impossible de déplacer
 * l'un sans l'autre.
 */
import { useEffect, useMemo, useRef } from 'react'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import * as THREE from 'three'

import { RAILING_HEIGHT, buildRailing, buildSlab } from '../builders/slab'
import { buildGlazing, creerVitrage } from '../builders/glazing'
import { buildWall } from '../builders/wall'
import { floorBox, shadowSweptBox } from '../domain/culling'
import { landingsForFloor } from '../domain/landings'
import type { Floor, Museum, Vec2 } from '../domain/types'
import { ArtworkLayer } from './ArtworkLayer'
import { RoomMesh } from './RoomMesh'
import { createWallMaterial } from './lighting'
import { useRegisterFloor } from './floorCulling'
import {
  REGLAGE_MATIERE,
  appliquerCartes,
  matiereDeDalle,
  repetitionDeMatiere,
  repetitionMonde,
  useCartes,
  useMatiere,
} from './materials'

export interface FloorMeshProps {
  floor: Floor
  /** Le musée entier : les œuvres du niveau y puisent leur atlas et leurs voisins. */
  museum: Museum
  /** Épaisseur de dalle, depuis `museum.config.building`. */
  slabThickness: number
  /**
   * Vrai quand aucune dalle ne couvre ce niveau. Ce n'est pas une décision de
   * ce composant : `MuseumScene` la lit dans la liste des niveaux.
   */
  isTopFloor: boolean
  /**
   * Dérive horizontale de l'ombre par mètre de chute, et altitude du sol du
   * bâtiment. Calculées par `MuseumScene`, qui pose le soleil : c'est la même
   * décision, elle ne doit pas être prise deux fois.
   */
  shadowDrift: Vec2
  baseElevation: number
}

/** Épaisseur de la toiture. Plus fine qu'une dalle : elle ne porte personne. */
const ROOF_THICKNESS = 0.3

export function FloorMesh({
  floor,
  museum,
  slabThickness,
  isTopFloor,
  shadowDrift,
  baseElevation,
}: FloorMeshProps) {
  const slab = useMemo(
    () => buildSlab(floor.footprint, floor.slabHoles, slabThickness),
    [floor.footprint, floor.slabHoles, slabThickness],
  )

  // Pas de trémie, pas de garde-corps : au niveau le plus bas la dalle est
  // pleine, et poser un garde-corps de zéro segment coûterait un draw call pour
  // un maillage vide.
  // Le garde-corps S'OUVRE là où l'escalier arrive. Sans ça il ceinture la
  // trémie sur tout son périmètre — et comme l'escalier est DANS la trémie, il
  // devient inaccessible : c'est exactement ce qui se passait, et aucun test de
  // géométrie ne pouvait l'attraper, chaque pièce étant juste séparément.
  const paliers = useMemo(
    () =>
      landingsForFloor(museum, floor.elevation).map((p) => ({
        centre: p.position,
        rayon: p.rayon,
      })),
    [museum, floor.elevation],
  )
  const railing = useMemo(
    () =>
      slab.railingSegments.length > 0
        ? buildRailing(slab.railingSegments, RAILING_HEIGHT, paliers)
        : null,
    [slab, paliers],
  )

  // La toiture reprend exactement la découpe de la dalle : l'atrium reste
  // ouvert sur le ciel, ce qui donne la verrière zénithale sans modéliser de
  // verrière.
  const roof = useMemo(
    () =>
      isTopFloor
        ? buildSlab(floor.footprint, floor.slabHoles, ROOF_THICKNESS).geometry
        : null,
    [isTopFloor, floor.footprint, floor.slabHoles],
  )

  // ── Matières (§9.4) ────────────────────────────────────────────────────
  //
  // La dalle et la toiture sortent d'`ExtrudeGeometry`, dont three fabrique les
  // UV en MÈTRES : leur répétition ne dépend pas de leurs dimensions, et une
  // dalle de 38 m montre exactement le même marbre qu'une de 7 m.
  //
  // Le `rebond` est ce qui sauve la vue d'entrée. Une dalle a une face tournée
  // vers le bas — le plafond du niveau d'en dessous — que les deux lumières du
  // bâtiment, toutes deux zénithales, n'atteignent jamais : elle tombait au noir
  // et occupait le bas du champ dès l'entrée. On y peint le rebond du sol, qui
  // dans la réalité l'éclaire et qu'aucun rendu direct ne calcule.
  //
  // DEUX matériaux, dans l'ordre des groupes posés par `buildSlab` : on marche
  // sur le premier, le second est la tranche et le plafond du niveau d'en
  // dessous. Une seule matière pour les deux donnait un plafond en lames de
  // parquet dans toute la vue d'accueil, et un bandeau de bois faisant le tour
  // de la façade à chaque niveau.
  // Le béton est mutualisé au niveau du module : la dalle, la fermeture du
  // pourtour et les murs d'enceinte des salles partagent une seule texture GPU.
  const cartesBeton = useCartes('beton', repetitionDeMatiere('beton'))
  const matiereDalle = matiereDeDalle(floor.level)
  // La répétition omise : `useMatiere` prend alors l'échelle propre de la
  // matière — une banche de béton de 2,6 m, une tuile de parquet de 3 m.
  const dessusMaterial = useMatiere(matiereDalle, undefined, { rebond: 0 })
  // La coque, elle, garde le `rebond` : c'est elle qui porte la sous-face, la
  // seule surface du bâtiment que les lumières zénithales n'atteignent jamais.
  // Sans ce rebond peint elle tombe au noir et occupe le bas du champ dès
  // l'entrée. Un plafond de musée est du béton clair, pas du parquet.
  const coqueMaterial = useMatiere('beton', undefined, {
    rebond: 0.34,
    teinte: '#cfcac2',
  })
  const slabMaterials = useMemo(
    () => [dessusMaterial, coqueMaterial],
    [dessusMaterial, coqueMaterial],
  )
  // La toiture est le seul béton du bâtiment en PLEIN SOLEIL. Au niveau
  // d'albédo des murs intérieurs — qui, eux, ne reçoivent que de l'indirect et
  // ont besoin d'être relevés — elle partait en blanc pur : mesuré à l'écran,
  // la dalle de couverture était une tache sans matière, texture comprise. On
  // l'assombrit donc, ce qui est aussi ce qu'est une toiture réelle : du béton
  // lessivé par la pluie, jamais du béton neuf.
  const roofMaterial = useMatiere('beton', undefined, {
    rebond: 0.34,
    teinte: '#b0aba2',
  })
  // La toiture porte les deux mêmes groupes que la dalle, et son dessous est le
  // plafond du dernier étage : lui laisser le béton lessivé de l'extérieur y
  // ferait un plafond gris sale. Il reçoit donc la coque claire, comme les
  // autres plafonds du bâtiment.
  const roofMaterials = useMemo(
    () => [roofMaterial, coqueMaterial],
    [roofMaterial, coqueMaterial],
  )

  // Le garde-corps, lui, est fait de `BoxGeometry` : ses UV sont un carré unité
  // par face, la répétition doit donc être proportionnelle aux dimensions. Les
  // panneaux n'ayant pas tous la même longueur, on cale l'échelle sur la moyenne
  // — l'écart résiduel sur un métal brossé est invisible, contrairement à
  // l'étirement d'un facteur cinq qu'on aurait en ignorant le problème.
  const repetitionRailing = useMemo(() => {
    const segments = slab.railingSegments
    const longueur =
      segments.length > 0
        ? segments.reduce(
            (somme, s) => somme + Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z),
            0,
          ) / segments.length
        : 1
    return repetitionMonde(longueur, RAILING_HEIGHT, {
      motif: REGLAGE_MATIERE.metal.motif,
    })
  }, [slab])
  const railingMaterial = useMatiere('metal', repetitionRailing)

  // ── Fermeture du pourtour ──────────────────────────────────────────────
  //
  // `domain/layout.ts` a calculé ce que les salles laissent ouvert sur le
  // pourtour ; il ne reste qu'à le construire. Ces murs sont hors du groupe de
  // CONTENU, avec la dalle et la toiture : ce sont eux qui donnent au bâtiment
  // sa silhouette et sa façade, et les masquer quand on masque les œuvres
  // rouvrirait le bâtiment à chaque fois qu'on s'en éloigne.
  const enclosure = useMemo(
    () => floor.enclosure.map((wall) => buildWall(wall)),
    [floor.enclosure],
  )
  // UN matériau pour toute la fermeture d'un niveau : ces murs n'ont ni œuvre ni
  // flaque de lumière, donc aucun uniforme qui leur soit propre — contrairement
  // aux murs de salle, où c'est l'accrochage qui impose un matériau par mur.
  //
  // Le thème passé n'a pas d'effet visible : `createWallMaterial` force la
  // teinte et la rugosité de l'enceinte dès que `kind` vaut 'outer', et les
  // autres uniformes du thème ne servent qu'aux flaques, qu'un mur sans
  // accrochage n'a pas.
  const enclosureMaterial = useMemo(() => {
    const gabarit = floor.enclosure[0]
    if (!gabarit) return null
    return appliquerCartes(
      createWallMaterial({ theme: 'modern', wall: gabarit, elevation: floor.elevation }),
      cartesBeton,
      'beton',
    )
  }, [floor.enclosure, floor.elevation, cartesBeton])

  // ── Vitrage ────────────────────────────────────────────────────────────
  //
  // Toutes les vitres du plateau en UN maillage : percer un mur ne fait pas une
  // fenêtre, ça fait un trou, et sans reflet l'œil lit un décor découpé au
  // cutter. Les jours vivent à la fois dans les murs de fermeture du niveau et
  // dans les murs d'enceinte des passages : on ramasse les deux.
  const vitrage = useMemo(
    () =>
      buildGlazing([
        ...floor.enclosure,
        ...floor.rooms.flatMap((r) => r.walls),
      ]),
    [floor.enclosure, floor.rooms],
  )
  const vitrageMaterial = useMemo(() => creerVitrage(), [])

  // ── Culling (§9.3) ─────────────────────────────────────────────────────
  //
  // La boîte est calculée UNE fois, au montage : un plateau ne bouge pas. Elle
  // inclut le volume balayé par son ombre jusqu'au sol du bâtiment, sans quoi
  // un étage sorti du cadre emporterait avec lui l'ombre qu'il projette dans
  // l'atrium — trois mètres plus bas, en plein champ.
  const groupe = useRef<THREE.Group>(null)
  const contenu = useRef<THREE.Group>(null)
  const boite = useMemo(() => {
    const brute = floorBox(floor, {
      slabThickness,
      roofThickness: isTopFloor ? ROOF_THICKNESS : 0,
    })
    const balayee = shadowSweptBox(brute, baseElevation, shadowDrift)
    return new THREE.Box3(
      new THREE.Vector3(balayee.minX, balayee.minY, balayee.minZ),
      new THREE.Vector3(balayee.maxX, balayee.maxY, balayee.maxZ),
    )
  }, [floor, slabThickness, isTopFloor, baseElevation, shadowDrift])

  useRegisterFloor({ level: floor.level, box: boite, group: groupe, content: contenu })

  // Rien de ce qui est construit ici n'est libéré par R3F : il ne dispose que ce
  // qu'il a créé lui-même en JSX.
  // Les matériaux, eux, sont libérés par `useMatiere` : ils survivent à un
  // changement d'échelle de leur texture, pas à un démontage.
  useEffect(() => {
    return () => {
      slab.geometry.dispose()
      railing?.geometry.dispose()
      roof?.dispose()
      for (const wall of enclosure) wall.geometry.dispose()
      enclosureMaterial?.dispose()
      vitrage.geometry.dispose()
      vitrageMaterial.dispose()
    }
  }, [slab, railing, roof, enclosure, enclosureMaterial, vitrage, vitrageMaterial])

  return (
    <group ref={groupe} name={`floor:${floor.id}`}>
      <RigidBody
        type="fixed"
        colliders={false}
        position={[0, floor.elevation, 0]}
        name={`slab:${floor.id}`}
      >
        <mesh geometry={slab.geometry} material={slabMaterials} receiveShadow castShadow />
        <TrimeshCollider args={[slab.collider.vertices, slab.collider.indices]} />

        {railing && (
          <>
            <mesh geometry={railing.geometry} material={railingMaterial} castShadow receiveShadow />
            <TrimeshCollider args={[railing.collider.vertices, railing.collider.indices]} />
          </>
        )}
      </RigidBody>

      {enclosureMaterial && enclosure.length > 0 && (
        <RigidBody
          type="fixed"
          colliders={false}
          position={[0, floor.elevation, 0]}
          name={`enclos:${floor.id}`}
        >
          {enclosure.map((built, i) => (
            <mesh
              key={floor.enclosure[i].id}
              name={floor.enclosure[i].id}
              geometry={built.geometry}
              material={enclosureMaterial}
              castShadow
              receiveShadow
            />
          ))}
          {/*
            Avec collider, et ce n'est pas optionnel : sans lui la façade
            redevient franchissable et le joueur sort du bâtiment par le côté
            qu'on vient précisément de fermer.
          */}
          {enclosure.map((built, i) =>
            built.collider.indices.length === 0 ? null : (
              <TrimeshCollider
                key={floor.enclosure[i].id}
                args={[built.collider.vertices, built.collider.indices]}
              />
            ),
          )}
        </RigidBody>
      )}

      {vitrage.count > 0 && (
        // Pas de collider : une vitre est une vue, et le mur qui la porte est
        // déjà solide sous l'allège et au-dessus du linteau. Un collider ici ne
        // servirait qu'à empêcher de s'approcher de la fenêtre.
        <mesh
          name={`vitrage:${floor.id}`}
          geometry={vitrage.geometry}
          material={vitrageMaterial}
          position={[0, floor.elevation, 0]}
        />
      )}

      {roof && (
        // Pas de collider : la toiture est à 4,3 m au-dessus du plancher, hors
        // d'atteinte d'un personnage qui ne saute pas. Un trimesh de plus ne
        // servirait qu'à ralentir les requêtes de Rapier.
        <mesh
          geometry={roof}
          material={roofMaterials}
          // `buildSlab` fait pendre l'épaisseur SOUS son origine : on remonte
          // donc d'une épaisseur pour que le dessous de la toiture affleure
          // exactement le plafond du niveau.
          position={[0, floor.elevation + floor.ceilingHeight + ROOF_THICKNESS, 0]}
          castShadow
          receiveShadow
        />
      )}

      {/*
        Le contenu du plateau, dans son propre nœud pour être masqué d'un bloc.

        Il est posé à l'ORIGINE, sans décalage d'élévation : `RoomMesh` et
        `ArtworkLayer` placent eux-mêmes leur repère à `floor.elevation`.
        L'imbriquer dans un nœud déjà décalé — le `RigidBody` de la dalle, par
        exemple — accrocherait toutes les œuvres un étage trop haut.
      */}
      <group ref={contenu} name={`content:${floor.id}`}>
        {floor.rooms.map((room) => (
          <RoomMesh key={room.id} room={room} elevation={floor.elevation} />
        ))}

        {/*
          Les cent œuvres du bâtiment tiennent en deux draw calls par étage
          (spec §9.1) : un `InstancedMesh` pour les toiles, un pour les cadres.
          Un jeu PAR ÉTAGE, ce qui est exactement ce que ce groupe permet de
          sauter d'un bloc.
        */}
        <ArtworkLayer floor={floor} museum={museum} />
      </group>
    </group>
  )
}
