/**
 * Les modèles Blender (GLB) : chargement, fusion par matière et lumière cuite.
 *
 * Tous sont modélisés dans le repère du plan. En scène main droite (socle.ts),
 * le chargeur glTF ne retourne rien sur `__root__` : les sommets arrivent tels
 * quels, en coordonnées du plan.
 *
 * Décodeurs, servis par le site (`configurerDecodeurs`), en URL ABSOLUES (les
 * workers en blob ne résolvent pas les relatives) : Draco depuis `public/draco/`
 * (le même module emscripten que three, variante glTF, sans repli JS) ; KTX2
 * (`KHR_texture_basisu`, cartes `.ktx2` de matieres.ts) par le
 * KhronosTextureContainer2 de Babylon, son décodeur et ses transcodeurs dans
 * `public/ktx2/` (`public/basis/` est celui de three, incompatible). Par défaut
 * Babylon les cherche sur un chemin versionné du CDN qui répond 404 en 9.31 :
 * le chargement d'un GLB texturé ne finissait jamais.
 */
import type { AssetContainer } from '@babylonjs/core/assetContainer'
import { Constants } from '@babylonjs/core/Engines/constants'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader'
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { DracoDecoder } from '@babylonjs/core/Meshes/Compression/dracoDecoder'
import { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/loaders/glTF/2.0/glTFLoader'
import { registerBuiltInGLTFExtensions } from '@babylonjs/loaders/glTF/2.0/Extensions/dynamic'

import LUMIERE from '../plan/lumiere.json' with { type: 'json' }
import { refleterCuit } from './boites.ts'

let configure = false
/** Une fois, avant le premier GLB ou la première carte KTX2. */
export function configurerDecodeurs(): void {
  if (configure) return
  configure = true
  // Les extensions (Draco, basisu, emissive_strength…) chargées à la demande, seulement si un GLB les demande.
  registerBuiltInGLTFExtensions()
  const abs = (f: string) => new URL(`${import.meta.env.BASE_URL}${f}`, location.href).href
  DracoDecoder.DefaultConfiguration = { wasmUrl: abs('draco/draco_wasm_wrapper.js'), wasmBinaryUrl: abs('draco/draco_decoder.wasm') }
  KhronosTextureContainer2.URLConfig = {
    jsDecoderModule: abs('ktx2/babylon.ktx2Decoder.js'),
    wasmUASTCToASTC: abs('ktx2/uastc_astc.wasm'),
    wasmUASTCToBC7: abs('ktx2/uastc_bc7.wasm'),
    wasmUASTCToRGBA_UNORM: abs('ktx2/uastc_rgba8_unorm_v2.wasm'),
    wasmUASTCToRGBA_SRGB: abs('ktx2/uastc_rgba8_srgb_v2.wasm'),
    wasmUASTCToR8_UNORM: abs('ktx2/uastc_r8_unorm.wasm'),
    wasmUASTCToRG8_UNORM: abs('ktx2/uastc_rg8_unorm.wasm'),
    jsMSCTranscoder: abs('ktx2/msc_basis_transcoder.js'),
    wasmMSCTranscoder: abs('ktx2/msc_basis_transcoder.wasm'),
    wasmZSTDDecoder: abs('ktx2/zstddec.wasm'),
  }
}

/**
 * Charge `assets/…glb` (chemin relatif à la base du site) dans un conteneur, PAS
 * encore ajouté à la scène : `c.addAllToScene()` pour le poser tel quel, ou y
 * lire la géométrie (thin instances) puis `c.dispose()`. Les matières PBR du
 * chargeur passent en diffus Lambert, comme `matiere()` (MeshStandardMaterial).
 */
export async function chargerGlb(scene: Scene, chemin: string): Promise<AssetContainer> {
  configurerDecodeurs()
  const c = await LoadAssetContainerAsync(`${import.meta.env.BASE_URL}${chemin}`, scene)
  for (const m of c.materials) if (m instanceof PBRMaterial) m.brdf.baseDiffuseModel = Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT
  return c
}

/** `chargerGlb`, ou null si le fichier manque (signalé en console) : un GLB absent n'arrête pas sa couche. */
export function glbOuRien(scene: Scene, chemin: string): Promise<AssetContainer | null> {
  return chargerGlb(scene, chemin).catch((e: unknown) => (console.error(`${chemin} indisponible`, e), null))
}

const partages = new WeakMap<Scene, Map<string, Promise<AssetContainer | null>>>()
/**
 * Un GLB lu par PLUSIEURS couches (jardin.glb : le décor `Jardin_*` à jardin.ts,
 * les sources `src_*` à vegetation.ts) : téléchargé et décodé une fois, déjà
 * posé dans la scène (`addAllToScene`). Chaque couche prend ses maillages par
 * préfixe de nom et ne jette QUE les siens ; matières et textures partagées
 * restent (`dispose(false, false)`), ne jamais `c.dispose()`.
 */
export function glbPartage(scene: Scene, chemin: string): Promise<AssetContainer | null> {
  const parChemin = partages.get(scene) ?? new Map<string, Promise<AssetContainer | null>>()
  partages.set(scene, parChemin)
  let p = parChemin.get(chemin)
  if (!p) parChemin.set(chemin, (p = glbOuRien(scene, chemin).then((c) => (c?.addAllToScene(), c))))
  return p
}

/**
 * `fusionnerParMatiere` de three : un maillage par matière (et par jeu
 * d'attributs, MergeMeshes refusant de mêler un maillage avec uv2 et un sans),
 * matrices monde cuites. À appeler APRÈS `addAllToScene` (le maillage fusionné
 * naît dans la scène) et après `eclairerModele` (qui ajoute l'uv2). `garder` :
 * ce qui reste à part (aiguilles d'horloge…). Rend tous les maillages restants.
 */
export function fusionnerParMatiere(maillages: AbstractMesh[], garder: (m: Mesh) => boolean = () => false): Mesh[] {
  const groupes = new Map<string, Mesh[]>()
  const restants: Mesh[] = []
  for (const m of maillages) {
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
    if (!m.material || garder(m)) {
      restants.push(m)
      continue
    }
    const cle = `${m.material.uniqueId}|${m.getVerticesDataKinds().sort().join()}`
    groupes.set(cle, [...(groupes.get(cle) ?? []), m])
  }
  for (const g of groupes.values()) restants.push(g.length > 1 ? Mesh.MergeMeshes(g, true, true)! : g[0])
  return restants
}

/** Une région de l'atlas en texels [x0, y0, x1, y1], comptés depuis le BAS (lumiere.json). */
type Region = number[]
const ATLAS = LUMIERE as { largeur: number; hauteur: number; modeles: Record<string, Region> }

/**
 * Les UV de lumière d'un modèle (couche « Lumiere », [0, 1]²) ramenées dans sa
 * région de l'atlas : glTF compte v depuis le HAUT, l'atlas depuis le bas.
 * Même formule que `eclairerModele` de scene/lumiere.ts.
 */
export function uvDeModele(uv: ArrayLike<number>, r: Region, L = ATLAS.largeur, H = ATLAS.hauteur): Float32Array {
  const a = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    a[i] = (r[0] + uv[i] * (r[2] - r[0])) / L
    a[i + 1] = (r[1] + (1 - uv[i + 1]) * (r[3] - r[1])) / H
  }
  return a
}

/**
 * La lumière cuite d'un modèle (`MODELES` de bake-lumiere.ts : 'escalier',
 * 'salle-honneur') : la DERNIÈRE couche UV (uv2 si elle existe, sinon uv) est
 * remappée dans la région `modele/<nom du maillage>`, sinon `modele`, et l'atlas
 * de boites.ts (coordinatesIndex 1) devient la lightmap de sa matière. Un
 * maillage sans UV (soleil, joints) garde l'ambiance pleine. Une seule fois par
 * maillage (l'uv2 réécrite n'est plus dans [0, 1]). `atlas` null (absent) :
 * l'uv2 est posée quand même, pour que la fusion par matière reste possible.
 * ponytail : la région d'un modèle prend la teinte hémisphérique « côté » de
 * chargerAtlas, même pour un dessus ; marquer `sens` par îlot UV si la nuit le montre.
 */
export function eclairerModele(maillages: AbstractMesh[], modele: string, atlas: BaseTexture | null): void {
  for (const m of maillages) {
    if (!(m instanceof Mesh)) continue
    const r = ATLAS.modeles[`${modele}/${m.name}`] ?? ATLAS.modeles[modele]
    const uv = m.getVerticesData(VertexBuffer.UV2Kind) ?? m.getVerticesData(VertexBuffer.UVKind)
    if (!r || !uv) continue
    m.setVerticesData(VertexBuffer.UV2Kind, uvDeModele(uv, r))
    if (atlas && m.material instanceof PBRMaterial) {
      refleterCuit(m.material)
      m.material.lightmapTexture = atlas
    }
  }
}
