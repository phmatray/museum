/**
 * LOT 4 — Chargement du mobilier et de la végétation (spec §9.4).
 *
 * `domain/props.ts` a décidé OÙ. Ce module dit AVEC QUOI : il ramène huit
 * modèles glTF et les réduit à ce que `PropsLayer` peut instancier, c'est-à-dire
 * des couples (géométrie, matériau) prêts à porter une matrice par exemplaire.
 *
 * Il vit dans un `.ts` et non dans le `.tsx` du calque pour une raison
 * mécanique : eslint interdit d'exporter autre chose qu'un composant depuis un
 * fichier `.tsx` (règle `react-refresh`), et le chargement doit être exporté
 * pour être mémorisé et testé.
 *
 * ── Une pièce = un draw call, donc on fusionne ──
 *
 * Le kit `museum-kit.glb` est modélisé proprement : le banc a une assise en
 * chêne et un piètement en acier, DEUX matériaux, donc deux primitives. Rendu
 * tel quel, chaque banc coûterait deux lots d'instances au lieu d'un — et
 * pareil pour le projecteur. On fusionne donc les primitives d'un même objet en
 * une seule géométrie en CUISANT la couleur de base de chaque matériau dans un
 * attribut `color` de sommet. Le résultat tient dans un unique
 * `MeshStandardMaterial` à `vertexColors`, et le bois reste du bois.
 *
 * Ce qui se perd dans l'opération, ce sont la rugosité et la métallicité par
 * matériau : on les moyenne, pondérées par le nombre de sommets. Sur un
 * piètement de banc vu à trois mètres, personne ne peut faire la différence ;
 * sur le nombre de draw calls, la différence est de un pour deux.
 *
 * Les plantes, elles, portent de VRAIES textures (couleur, normale, ARM) et un
 * masque d'alpha sur les feuilles. On garde leurs matériaux tels quels — les
 * fusionner reviendrait à jeter les images, c'est-à-dire tout ce qui les fait
 * exister.
 *
 * ── Le décodeur Draco ──
 *
 * Le kit est compressé en Draco. `DRACOLoader` ne sait pas où trouver son
 * décodeur : il le charge à l'exécution depuis un chemin qu'on lui donne. Les
 * deux fichiers sont donc copiés dans `public/draco/`, servis tels quels et
 * relatifs à `BASE_URL` — sur GitHub Pages le site vit sous `/<dépôt>/`, un
 * chemin absolu y donnerait un 404. Ils ne pèsent sur le chargement initial que
 * lorsqu'on les demande, c'est-à-dire après que le bâtiment est déjà à l'écran.
 */
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { PropId } from '../domain/props'

// ── Contrat public ───────────────────────────────────────────────────────

/** Un lot instanciable : une géométrie, un matériau, un draw call. */
export interface PropPiece {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** Tout ce qu'il faut pour dessiner le mobilier. Vide si le chargement a échoué. */
export type PropAssets = ReadonlyMap<PropId, readonly PropPiece[]>

/**
 * Le catalogue — chemins et noms de nœuds — vit dans `kits.ts`, qui n'importe ni
 * `three` ni Vite. Il est réexporté ici pour que rien de ce qui consommait déjà
 * ce module n'ait à changer d'import.
 *
 * La séparation n'est pas cosmétique : `tools/measure-props.ts` a besoin de ces
 * tables et de rien d'autre, et les lire depuis ce fichier-ci l'obligeait à
 * charger le moteur de rendu — ce que `tsc -b` refuse à bon droit côté Node.
 *
 * `PLANTS_LOD` mérite son mot d'explication, qui n'a pas sa place dans une table
 * de données : on ne lit plus les glTF de Poly Haven directement parce que ce
 * sont des modèles de RENDU HORS LIGNE. Leurs quatre sujets pesaient 46 100
 * triangles et 8,4 Mo de cartes 1K, or le musée en instancie 13 à 18 par espèce —
 * 780 000 triangles à l'écran, pour des sujets d'1,20 m vus entre 2 et 8 m. Et ce
 * sont des PLANCHES : le fichier de l'anthurium contient six sujets, celui du
 * calathéa cinq, dont un seul était instancié — les autres étaient téléchargés
 * puis jetés.
 */
export {
  DRACO_PATH,
  ESPECES_GLB,
  KIT_PATH,
  NOEUDS_DU_KIT,
  PLANTS_LOD,
} from './kits'
export type { EspeceGlb } from './kits'

import { ESPECES_GLB, KIT_PATH, NOEUDS_DU_KIT, PLANTS_LOD, DRACO_PATH } from './kits'

// ── Chargement ───────────────────────────────────────────────────────────

let promesse: Promise<PropAssets> | null = null

/**
 * Charge le mobilier, une fois pour toute la session.
 *
 * Mémorisé comme `atlasResource()` : quatre plateaux demandent les mêmes
 * modèles, et sans mémorisation ils déclencheraient quatre téléchargements du
 * même fichier au montage.
 */
export function propAssetsResource(base: string = import.meta.env.BASE_URL): Promise<PropAssets> {
  promesse ??= chargerTout(base).catch((erreur: unknown) => {
    // Le musée reste visitable sans ses bancs : on le signale, on ne fait pas
    // tomber la scène. Même parti que l'atlas des œuvres du lot 3.
    console.error('mobilier indisponible', erreur)
    return new Map<PropId, readonly PropPiece[]>()
  })
  return promesse
}

async function chargerTout(base: string): Promise<PropAssets> {
  const gltf = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${base}${DRACO_PATH}`)
  gltf.setDRACOLoader(draco)

  const pieces = new Map<PropId, readonly PropPiece[]>()

  const kit = await gltf.loadAsync(`${base}${KIT_PATH}`)
  for (const [nom, id] of Object.entries(NOEUDS_DU_KIT)) {
    const noeud = kit.scene.getObjectByName(nom)
    if (noeud === undefined) {
      console.warn(`museum-kit.glb : nœud « ${nom} » introuvable`)
      continue
    }
    const piece = fusionnerEnUnLot(noeud)
    if (piece !== null) pieces.set(id, [piece])
  }

  // UN seul fichier pour les quatre espèces, contre quatre glTF et leurs
  // vingt-quatre cartes séparées auparavant.
  const flore = await gltf.loadAsync(`${base}${PLANTS_LOD}`)
  for (const { id, noeuds } of ESPECES_GLB) {
    // Un sujet réparti sur plusieurs nœuds est regroupé sous un porteur commun :
    // `lotsTextures` prend une racine et parcourt ce qui pend dessous.
    const porteur = new THREE.Group()
    for (const nom of noeuds) {
      const noeud = flore.scene.getObjectByName(nom)
      if (noeud === undefined) {
        console.warn(`plants-lod.glb : nœud « ${nom} » introuvable`)
        continue
      }
      // Le nœud garde sa transformation MONDE : le détacher de sa hiérarchie
      // sans la cuire replacerait la pièce à l'origine, et un pot se retrouverait
      // séparé de son feuillage.
      noeud.updateWorldMatrix(true, false)
      porteur.add(noeud)
    }
    const lots = lotsTextures(porteur)
    if (lots.length > 0) pieces.set(id, lots)
  }

  // Le décodeur garde un worker vivant tant qu'on ne le libère pas, et plus
  // rien ne sera décodé après ce point.
  draco.dispose()

  return pieces
}

// ── Réduction des modèles ────────────────────────────────────────────────

/**
 * Fusionne un objet du kit en une géométrie unique à couleurs de sommet.
 *
 * Les transformations de nœud sont CUITES dans les positions : le glTF place le
 * banc à 0,42 m au-dessus de son origine, et le projecteur en dessous de la
 * sienne. En cuisant, l'origine de chaque instance devient le point d'ancrage
 * que `domain/props.ts` calcule — le sol pour ce qui se pose, le plan de
 * plafond pour ce qui pend. Sans ça, chaque prop serait à poser avec un décalage
 * que seul un coup d'œil à Blender permettrait de deviner.
 */
function fusionnerEnUnLot(noeud: THREE.Object3D): PropPiece | null {
  const racine = repereDAncrage(noeud)

  const morceaux: THREE.BufferGeometry[] = []
  let rugosite = 0
  let metal = 0
  let sommets = 0

  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const source = objet.geometry as THREE.BufferGeometry
    const geometrie = source.clone()
    // Du repère du maillage vers celui du nœud demandé.
    geometrie.applyMatrix4(new THREE.Matrix4().multiplyMatrices(racine, objet.matrixWorld))

    const materiau = premierMateriau(objet)
    const couleur = new THREE.Color(1, 1, 1)
    if (materiau instanceof THREE.MeshStandardMaterial) {
      couleur.copy(materiau.color)
      const n = geometrie.attributes.position.count
      rugosite += materiau.roughness * n
      metal += materiau.metalness * n
      sommets += n
    }
    peindreLesSommets(geometrie, couleur)
    morceaux.push(geometrie)
  })

  if (morceaux.length === 0) return null

  // `mergeGeometries` exige des jeux d'attributs identiques ; les six primitives
  // du kit portent toutes POSITION, NORMAL et TEXCOORD_0, plus la couleur qu'on
  // vient d'ajouter.
  const geometry = morceaux.length === 1 ? morceaux[0] : mergeGeometries(morceaux, false)
  if (geometry === null) return null
  for (const morceau of morceaux) {
    if (morceau !== geometry) morceau.dispose()
  }

  return {
    geometry,
    material: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: sommets > 0 ? rugosite / sommets : 0.7,
      metalness: sommets > 0 ? metal / sommets : 0,
    }),
  }
}

/**
 * Un lot par matériau, textures comprises.
 *
 * Les plantes gardent leurs images : la couleur d'un feuillage n'est pas une
 * teinte, c'est une carte, et le masque d'alpha est ce qui découpe les feuilles
 * dans leurs quads. On se contente donc de rapatrier les géométries dans le
 * repère du sujet et de forcer ce dont l'instanciation a besoin.
 */
function lotsTextures(noeud: THREE.Object3D): PropPiece[] {
  const racine = repereDAncrage(noeud)

  const parMateriau = new Map<THREE.Material, THREE.BufferGeometry[]>()

  noeud.traverse((objet) => {
    if (!(objet instanceof THREE.Mesh)) return
    const materiau = premierMateriau(objet)
    if (materiau === null) return
    const geometrie = (objet.geometry as THREE.BufferGeometry).clone()
    geometrie.applyMatrix4(new THREE.Matrix4().multiplyMatrices(racine, objet.matrixWorld))
    const liste = parMateriau.get(materiau)
    if (liste === undefined) parMateriau.set(materiau, [geometrie])
    else liste.push(geometrie)
  })

  const lots: PropPiece[] = []
  for (const [materiau, geometries] of parMateriau) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false)
    if (geometry === null) continue
    for (const g of geometries) {
      if (g !== geometry) g.dispose()
    }
    lots.push({ geometry, material: preparerMateriauVegetal(materiau) })
  }
  return lots
}

/**
 * Règle un matériau de feuillage pour l'instanciation.
 *
 * Deux corrections, toutes deux visibles à l'écran :
 *
 *  - `side: DoubleSide`. Une feuille est un quad : vue de dessous, sans cette
 *    ligne, elle disparaît. La moitié du feuillage s'évanouit selon l'angle.
 *  - `alphaTest`. Le glTF déclare `alphaMode: MASK`, que le chargeur traduit
 *    déjà ; on le réaffirme parce qu'un feuillage en transparence TRIÉE ferait
 *    dépendre le rendu de l'ordre des instances, c'est-à-dire scintiller à
 *    chaque pas du joueur. Le découpage binaire ne trie rien.
 */
function preparerMateriauVegetal(source: THREE.Material): THREE.Material {
  const materiau = source.clone()
  materiau.side = THREE.DoubleSide
  if (materiau.transparent || materiau.alphaTest > 0) {
    materiau.transparent = false
    materiau.alphaTest = Math.max(materiau.alphaTest, 0.4)
  }
  materiau.depthWrite = true
  return materiau
}

/**
 * Le repère d'ancrage d'un prop : recentré à l'horizontale, INTACT en hauteur.
 *
 * Cette dissymétrie est la seule chose du module qui ne se devine pas, et les
 * deux moitiés ont chacune coûté une passe de relecture à l'écran.
 *
 * **En hauteur, on garde tout.** Un nœud glTF porte sa translation, et c'est
 * elle qui POSE l'objet : le banc est modélisé centré sur son assise puis
 * remonté de 0,42 m pour que ses pieds touchent le sol, le projecteur est
 * descendu de 0,10 m pour pendre sous son plan d'accroche. L'annuler enfonçait
 * les bancs dans le marbre jusqu'à l'assise et escamotait les projecteurs dans
 * la dalle.
 *
 * **À l'horizontale, on recentre.** Poly Haven ne livre pas un sujet par
 * fichier mais une PLANCHE : six anthuriums, cinq calatheas, rangés sur une
 * grille d'un mètre de pas. La translation d'un spécimen n'a donc aucun sens
 * une fois qu'on l'a extrait de sa planche — gardée, elle décalait chaque
 * plante d'un mètre à côté de sa jardinière, qui restait vide.
 */
function repereDAncrage(noeud: THREE.Object3D): THREE.Matrix4 {
  noeud.updateWorldMatrix(true, true)
  const centre = new THREE.Vector3().setFromMatrixPosition(noeud.matrixWorld)
  return new THREE.Matrix4().makeTranslation(-centre.x, 0, -centre.z)
}

/** Cuit une couleur uniforme dans un attribut de sommet. */
function peindreLesSommets(geometrie: THREE.BufferGeometry, couleur: THREE.Color): void {
  const n = geometrie.attributes.position.count
  const donnees = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    donnees[i * 3] = couleur.r
    donnees[i * 3 + 1] = couleur.g
    donnees[i * 3 + 2] = couleur.b
  }
  geometrie.setAttribute('color', new THREE.BufferAttribute(donnees, 3))
}

function premierMateriau(mesh: THREE.Mesh): THREE.Material | null {
  const materiau = mesh.material as THREE.Material | THREE.Material[]
  if (Array.isArray(materiau)) return materiau[0] ?? null
  return materiau
}
