/**
 * LOT 3 — Les œuvres accrochées (spec §9).
 *
 * Ce composant NE DÉCIDE RIEN : `domain/hanging.ts` a posé chaque œuvre sur son
 * mur, `builders/artwork.ts` en a fait des matrices d'instance. Il ne reste qu'à
 * les donner au GPU de la façon qui tient dans le budget.
 *
 * ── Pourquoi l'instancing n'est pas optionnel ──
 *
 * Le bâtiment vide coûte déjà 82 draw calls sur les 150 du §9. Cent œuvres
 * rendues chacune par un `mesh` en coûteraient cent de plus, et cent matériaux
 * avec. Le lot 0 a mesuré la sortie : UNE `DataArrayTexture`, un `InstancedMesh`,
 * un attribut d'instance `aLayer`, et le shader va chercher
 * `texture(map, vec3(uv, aLayer))`. 256 couches distinctes, un seul draw call,
 * 120 im/s.
 *
 * Un étage entier tient donc en DEUX draw calls :
 *
 *   1. les toiles — `InstancedMesh` + texture array, shader GLSL3
 *   2. les cadres — `InstancedMesh` d'une boîte unité, mise à l'échelle par
 *                   instance ; un maillage par cadre en coûterait cent
 *
 * UN JEU PAR ÉTAGE, et c'est le point du culling de §9.3 : les instances d'un
 * plateau partagent une bounding sphere, un plateau hors champ se saute d'un
 * bloc. Le groupe se masque en outre entièrement au-delà de deux niveaux
 * d'écart avec le joueur — on ne voit pas les toiles à travers deux planchers.
 *
 * ── Deux niveaux de détail (§9.1) ──
 *
 * Loin, la couche 256×128 de la texture array, toujours résidente. Sous dix
 * mètres, la vignette 1024×512 du dépôt, chargée À LA DEMANDE et rendue par un
 * maillage individuel ; l'instance correspondante passe alors à l'échelle nulle.
 * Charger les 115 vignettes coûterait 240 Mo de VRAM, soit plus que le budget
 * textures ENTIER du §9 — c'est très exactement ce que la texture array évite.
 *
 * La bascule n'a le droit ni de sauter ni de changer de couleur : les deux LOD
 * partagent la même matrice, la même peinture de spot et le même chemin
 * colorimétrique (voir `io/arrayTexture.ts`).
 *
 * ── Éclairage ──
 *
 * Aucune lumière n'est ajoutée ici, et il n'y en aura jamais une par œuvre : le
 * budget est de QUATRE lumières temps réel pour tout le bâtiment (§9.2). La
 * surbrillance du spot est PEINTE dans le fragment shader, ce qui coûte trois
 * instructions et zéro draw call.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import type { Hanging } from '../builders/artwork'
import { collectHangings } from '../builders/artwork'
import type { Floor, Museum, RepoKey } from '../domain/types'
import type { AtlasTextures } from '../io/arrayTexture'
import {
  MAX_NEAR_TEXTURES,
  NEAR_LOD_DISTANCE,
  atlasResource,
  claimNearTextures,
  nearTextures,
  subscribeNearTextures,
} from '../io/arrayTexture'

// ── Réglages de rendu ────────────────────────────────────────────────────

/** Écart de niveaux au-delà duquel le contenu d'un plateau ne sert plus (§9.3). */
const FLOOR_CULL_RANGE = 2

/**
 * Déplacement de la caméra qui déclenche une réévaluation du LOD, en mètres.
 *
 * Recalculer cent distances à chaque image n'aurait aucune conséquence mesurable,
 * mais reconstruire à chaque image l'état React qui en découle en aurait une. Un
 * demi-mètre reste très en dessous du seuil des dix mètres : aucune bascule ne
 * peut être manquée.
 */
const LOD_STEP = 0.5

/**
 * Le spot n'existe pas (spec §9.2) : on le PEINT.
 *
 * Deux cent cinquante-six projecteurs avec ombres ne tournent dans aucun
 * navigateur, et sans logiciel de DCC il n'y a pas de lightmap possible. Or la
 * signature visuelle d'un spot sur une toile se réduit à une surbrillance douce,
 * un peu au-dessus du centre — quelques instructions dans le fragment shader.
 *
 * Le foyer est décalé vers le haut (`0.62`) parce qu'une cimaise éclaire une
 * toile depuis le plafond, jamais de face.
 */
const PEINDRE_LE_SPOT = /* glsl */ `
  vec3 peindreLeSpot(vec3 base, vec2 coord) {
    vec2 ecart = coord - vec2(0.5, 0.62);
    float halo = exp(-3.0 * dot(ecart, ecart));
    return base * (0.80 + 0.38 * halo);
  }
`

/**
 * Sommet des toiles instanciées.
 *
 * `aLayer` est l'attribut d'instance qui remplace cent matériaux par un seul.
 * Il ressort `flat` : un index de couche INTERPOLÉ entre les sommets n'aurait
 * aucun sens, et sur un quad de deux triangles il ferait apparaître la moitié
 * d'une œuvre voisine le long de la diagonale.
 */
const TOILE_VERT = /* glsl */ `
  in float aLayer;
  out vec2 vUv;
  flat out int vLayer;
  void main() {
    vUv = uv;
    vLayer = int(aLayer);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`

const TOILE_FRAG = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray map;
  in vec2 vUv;
  flat in int vLayer;
  out vec4 outColor;
  ${PEINDRE_LE_SPOT}
  void main() {
    vec3 base = texture(map, vec3(vUv, float(vLayer))).rgb;
    outColor = vec4(peindreLeSpot(base, vUv), 1.0);
  }
`

/**
 * Le LOD proche. Même peinture de spot, même absence de conversion
 * colorimétrique ; seule la source change — une texture 2D ordinaire au lieu
 * d'une couche. C'est ce qui rend la bascule des dix mètres invisible.
 */
const VIGNETTE_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const VIGNETTE_FRAG = /* glsl */ `
  uniform sampler2D map;
  in vec2 vUv;
  out vec4 outColor;
  ${PEINDRE_LE_SPOT}
  void main() {
    vec3 base = texture(map, vUv).rgb;
    outColor = vec4(peindreLeSpot(base, vUv), 1.0);
  }
`

/**
 * Le quad des vignettes proches, partagé.
 *
 * Six maillages au plus, mais ils apparaissent et disparaissent à chaque pas du
 * joueur : allouer un tampon GPU à chaque fois ferait un va-et-vient permanent
 * d'allocations pour une géométrie strictement identique.
 */
const QUAD = new THREE.PlaneGeometry(1, 1)

const AUCUN: readonly Hanging[] = []

// ── Le composant ─────────────────────────────────────────────────────────

export interface ArtworkLayerProps {
  floor: Floor
  museum: Museum
}

export function ArtworkLayer({ floor, museum }: ArtworkLayerProps) {
  const atlas = useAtlas()
  const hangings = useMemo(() => collectHangings(floor), [floor])

  // Les élévations, triées, pour savoir à quel niveau se trouve le joueur sans
  // interroger la physique : ce composant n'a aucune raison de connaître Rapier.
  const paliers = useMemo(
    () =>
      museum.floors
        .map((autre) => ({ level: autre.level, elevation: autre.elevation }))
        .sort((a, b) => a.elevation - b.elevation),
    [museum],
  )

  const groupe = useRef<THREE.Group>(null)
  const [proches, setProches] = useState<readonly Hanging[]>(AUCUN)
  const vignettes = useNearTextures(floor.id, proches)

  // Une instance ne s'efface QU'UNE FOIS sa vignette réellement disponible :
  // l'effacer dès la demande laisserait un trou sur le mur pendant tout le
  // téléchargement, et un trou est bien plus visible qu'une image un peu floue.
  const masquees = useMemo(
    () => new Set(proches.filter((h) => vignettes.has(h.key)).map((h) => h.id)),
    [proches, vignettes],
  )

  const derniereEval = useRef(new THREE.Vector3(Infinity, Infinity, Infinity))

  useFrame(({ camera }) => {
    const noeud = groupe.current
    if (noeud === null) return

    const niveauJoueur = niveauCourant(paliers, camera.position.y)

    // §9.3 : au-delà de deux niveaux d'écart, un plateau ne montre plus que sa
    // dalle et son garde-corps. Ses œuvres ne sont de toute façon pas visibles.
    const visible = Math.abs(niveauJoueur - floor.level) <= FLOOR_CULL_RANGE
    noeud.visible = visible

    // Le LOD proche ne concerne QUE le plateau où se tient le joueur.
    //
    // La distance seule ne suffit pas : un niveau fait 4,7 m, si bien qu'une
    // œuvre de l'étage du dessus est à moins de dix mètres alors qu'une dalle
    // de quarante centimètres la sépare du regard. Mesuré au probe : sans cette
    // condition, treize vignettes haute définition étaient chargées à la fois —
    // 26 Mo de VRAM pour des toiles qu'on ne peut pas voir. Avec, on retombe
    // sur les quatre ou cinq du mur qu'on regarde.
    if (!visible || niveauJoueur !== floor.level) {
      if (proches.length > 0) setProches(AUCUN)
      // Le LOD proche est ABANDONNÉ ici, pas seulement suspendu : il faut donc
      // oublier le point de la dernière évaluation. Sans cet oubli, revenir sur
      // le plateau à moins de LOD_STEP de l'endroit qu'on avait quitté retombe
      // dans le garde-fou de distance ci-dessous, qui refuse de réévaluer — et
      // les œuvres restent en basse définition jusqu'au prochain demi-mètre
      // parcouru. Mesuré au probe : monter à l'étage puis redescendre au même
      // endroit laissait les six vignettes déchargées et ne les redemandait
      // jamais.
      derniereEval.current.set(Infinity, Infinity, Infinity)
      return
    }

    if (camera.position.distanceToSquared(derniereEval.current) < LOD_STEP * LOD_STEP) return
    derniereEval.current.copy(camera.position)

    const rayon = NEAR_LOD_DISTANCE * NEAR_LOD_DISTANCE
    const candidats = hangings
      .map((hanging) => ({ hanging, d2: hanging.centre.distanceToSquared(camera.position) }))
      .filter((candidat) => candidat.d2 <= rayon)
      // Départage par identifiant : à distance égale, l'ensemble retenu ne doit
      // pas dépendre de l'ordre de parcours.
      .sort((a, b) => a.d2 - b.d2 || (a.hanging.id < b.hanging.id ? -1 : 1))
      .slice(0, MAX_NEAR_TEXTURES)
      .map((candidat) => candidat.hanging)

    if (!memeSerie(candidats, proches)) setProches(candidats)
  })

  // Un lot par atlas : `Placement.atlas` peut désigner un second atlas dès que
  // le corpus dépasse une grille. Un seul aujourd'hui, donc un seul lot.
  const parAtlas = useMemo(() => {
    const groupes = new Map<number, Hanging[]>()
    for (const hanging of hangings) {
      const liste = groupes.get(hanging.atlas)
      if (liste === undefined) groupes.set(hanging.atlas, [hanging])
      else liste.push(hanging)
    }
    return [...groupes].sort((a, b) => a[0] - b[0])
  }, [hangings])

  return (
    <group ref={groupe} name={`artworks:${floor.id}`} position={[0, floor.elevation, 0]}>
      {hangings.length > 0 && <FrameInstances hangings={hangings} />}

      {atlas !== null &&
        parAtlas.map(([numero, liste]) =>
          // Un atlas manquant est une anomalie du pipeline média, pas une raison
          // de faire tomber la scène : les cadres restent, les toiles non.
          atlas.layers[numero] === undefined ? null : (
            <CanvasInstances
              key={numero}
              texture={atlas.layers[numero]}
              hangings={liste}
              masquees={masquees}
            />
          ),
        )}

      {proches.map((hanging) => {
        const texture = vignettes.get(hanging.key)
        return texture === undefined ? null : (
          <NearArtwork key={hanging.id} hanging={hanging} texture={texture} />
        )
      })}
    </group>
  )
}

// ── Les toiles ───────────────────────────────────────────────────────────

interface CanvasInstancesProps {
  texture: THREE.DataArrayTexture
  hangings: readonly Hanging[]
  /** Identifiants dont le LOD proche a pris le relais. */
  masquees: ReadonlySet<string>
}

function CanvasInstances({ texture, hangings, masquees }: CanvasInstancesProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  // La géométrie porte l'attribut d'instance : c'est ce quad-là, avec ces
  // couches-là, qui forme le lot. Un quad partagé entre deux lots ne pourrait
  // pas porter deux `aLayer` différents.
  const geometry = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1)
    const layers = Float32Array.from(hangings, (hanging) => hanging.layer)
    quad.setAttribute('aLayer', new THREE.InstancedBufferAttribute(layers, 1))
    return quad
  }, [hangings])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { map: { value: texture } },
        vertexShader: TOILE_VERT,
        fragmentShader: TOILE_FRAG,
      }),
    [texture],
  )

  // R3F ne libère que ce qu'il a lui-même créé en JSX : ces deux-là sont à nous,
  // et un tampon GPU par lot fuirait à chaque changement de musée.
  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useEffect(() => {
    const noeud = mesh.current
    if (noeud === null) return

    const nul = new THREE.Vector3(0, 0, 0)
    const tampon = new THREE.Matrix4()
    for (let i = 0; i < hangings.length; i++) {
      if (masquees.has(hangings[i].id)) {
        // Échelle nulle plutôt que suppression : l'index d'instance reste
        // aligné sur `aLayer`, et `Matrix4.scale` laisse la translation intacte
        // — la sphère englobante du lot ne bouge donc pas.
        noeud.setMatrixAt(i, tampon.copy(hangings[i].canvas).scale(nul))
      } else {
        noeud.setMatrixAt(i, hangings[i].canvas)
      }
    }
    noeud.instanceMatrix.needsUpdate = true
    // Sans sphère englobante, three teste le frustum sur la géométrie du quad
    // UNITÉ : le lot entier disparaîtrait dès que l'origine sort du champ.
    noeud.computeBoundingSphere()
  }, [hangings, masquees])

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, hangings.length]}
      // Le shader est non éclairé : ni ombre portée ni ombre reçue à calculer.
      castShadow={false}
      receiveShadow={false}
    />
  )
}

// ── Les cadres ───────────────────────────────────────────────────────────

function FrameInstances({ hangings }: { hangings: readonly Hanging[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: '#241f1b', roughness: 0.55, metalness: 0.05 }),
    [],
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useEffect(() => {
    const noeud = mesh.current
    if (noeud === null) return
    for (let i = 0; i < hangings.length; i++) noeud.setMatrixAt(i, hangings[i].frame)
    noeud.instanceMatrix.needsUpdate = true
    noeud.computeBoundingSphere()
  }, [hangings])

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, hangings.length]}
      // Une seule shadow map dans tout le budget (§9), celle de la verrière : un
      // cadre de six centimètres n'a rien à y apporter.
      castShadow={false}
      receiveShadow
    />
  )
}

// ── Le LOD proche ────────────────────────────────────────────────────────

function NearArtwork({ hanging, texture }: { hanging: Hanging; texture: THREE.Texture }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { map: { value: texture } },
        vertexShader: VIGNETTE_VERT,
        fragmentShader: VIGNETTE_FRAG,
      }),
    [texture],
  )

  useEffect(() => () => material.dispose(), [material])

  // Décomposition plutôt que matrice brute : R3F recompose la matrice d'un objet
  // depuis sa position, son quaternion et son échelle à chaque image, et une
  // matrice posée directement serait écrasée au premier rendu.
  const pose = useMemo(() => {
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const echelle = new THREE.Vector3()
    hanging.canvas.decompose(position, quaternion, echelle)
    return { position, quaternion, echelle }
  }, [hanging])

  return (
    <mesh
      geometry={QUAD}
      material={material}
      position={pose.position}
      quaternion={pose.quaternion}
      scale={pose.echelle}
    />
  )
}

// ── Vignettes à la demande ───────────────────────────────────────────────

/**
 * Déclare les vignettes dont ce niveau a besoin, et rend celles qui sont
 * arrivées.
 *
 * Les vignettes sont un état EXTERNE à React — elles viennent du réseau, elles
 * survivent aux composants, et plusieurs niveaux en réclament les mêmes. Elles
 * vivent donc dans le magasin observable de `io/arrayTexture.ts`, lu par
 * `useSyncExternalStore`. Un cache dans un état local aurait dû être purgé dans
 * un effet, c'est-à-dire déclencher des rendus en cascade à chaque pas du joueur.
 *
 * `owner` est l'identifiant du niveau : c'est lui qui permet au magasin de ne
 * libérer que ce dont plus AUCUN niveau n'a besoin. Deux plateaux voisins
 * peuvent avoir des œuvres à moins de dix mètres en même temps ; sans cette
 * réclamation nommée, ils se videraient mutuellement le cache à chaque image et
 * l'œuvre clignoterait indéfiniment entre ses deux LOD.
 */
function useNearTextures(
  owner: string,
  proches: readonly Hanging[],
): ReadonlyMap<RepoKey, THREE.Texture> {
  useEffect(() => {
    claimNearTextures(
      owner,
      proches.map((hanging) => hanging.key),
    )
  }, [owner, proches])

  // Déclaration séparée : purger à chaque changement de `proches` ferait
  // libérer puis recharger les vignettes qui restent proches d'un pas à l'autre.
  // Ce niveau ne rend sa réclamation qu'en disparaissant.
  useEffect(() => {
    return () => {
      claimNearTextures(owner, [])
    }
  }, [owner])

  return useSyncExternalStore(subscribeNearTextures, nearTextures, nearTextures)
}

// ── Chargement de l'atlas ────────────────────────────────────────────────

/**
 * L'atlas, sans suspendre.
 *
 * `use()` serait plus court, mais il resuspendrait l'arbre ENTIER sous le
 * `<Suspense>` du canvas — physique et joueur compris — après que le musée est
 * déjà affiché. Le bâtiment doit apparaître d'abord et les œuvres s'y accrocher
 * ensuite ; un état local dit exactement cela, et ne fait clignoter personne.
 */
function useAtlas(): AtlasTextures | null {
  const [atlas, setAtlas] = useState<AtlasTextures | null>(null)

  useEffect(() => {
    let vivant = true
    void atlasResource().then(
      (charge) => {
        if (vivant) setAtlas(charge)
      },
      (erreur: unknown) => {
        // Le bâtiment reste visitable sans ses toiles : on le signale, on ne
        // remonte pas l'erreur jusqu'à faire tomber la scène.
        console.error('atlas des œuvres indisponible', erreur)
      },
    )
    return () => {
      vivant = false
    }
  }, [])

  return atlas
}

// ── Outils ───────────────────────────────────────────────────────────────

/**
 * Le niveau où se trouve un point d'altitude `y` : le plus haut plancher situé
 * en dessous de lui. La tolérance absorbe le cas du joueur exactement posé sur
 * sa dalle, où l'altitude des pieds ÉGALE l'élévation du niveau.
 */
function niveauCourant(
  paliers: readonly { level: number; elevation: number }[],
  y: number,
): number {
  let courant = paliers[0]?.level ?? 0
  for (const palier of paliers) {
    if (palier.elevation <= y + 1e-3) courant = palier.level
    else break
  }
  return courant
}

function memeSerie(a: readonly Hanging[], b: readonly Hanging[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}
