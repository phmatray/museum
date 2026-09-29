/**
 * Les textures embarquées des GLB, recompressées pour le GPU (KTX2 / Basis
 * Universal, extension `KHR_texture_basisu`) — le pendant de `encode-ktx2.ts`
 * pour les modèles.
 *
 * ── Pourquoi ──
 *
 * Un JPG, un PNG ou un WebP embarqué se décode sur le fil principal, puis monte
 * en RGBA plein dans la mémoire vidéo : 5,6 Mo par carte de 1024². Les quarante
 * cartes des plantes, du jardin, des sculptures et de l’escalier bloquaient
 * le chargement et pesaient près de 90 Mo au GPU. En KTX2, le transcodeur
 * (un worker) sort directement le format compressé que lit le GPU (BC7, ASTC,
 * ETC2…) : quatre à huit fois moins, et rien à décoder sur le fil principal.
 *
 * ── Comment ──
 *
 * La géométrie ne change pas (Draco, relu puis réécrit à l'identique). Chaque
 * texture est encodée selon ce qu'elle porte :
 *
 * - une NORMALE en UASTC (préréglage « carte de normales », RDO + Zstandard) :
 *   l'ETC1S y laisse des blocs en lumière rasante ;
 * - une COULEUR à alpha utile (feuillages découpés, verres) en UASTC sRGB : la
 *   découpe doit tomber au même texel ;
 * - les autres couleurs en ETC1S sRGB, rugosité/métal/occlusion en ETC1S
 *   linéaire, qualité maximale.
 *
 * Aucun retournement vertical : une texture glTF n'est pas retournée
 * (`flipY = false`), une KTX2 non plus. Une texture déjà en KTX2 est laissée :
 * le script se relance sans rien abîmer.
 *
 * À relancer après chaque export Blender d'un de ces modèles (les
 * `tools/blender/build-*.py` écrivent des WebP ou des JPG) :
 *
 *     node tools/compresser-glb.ts                              # tous ceux de la liste
 *     node tools/compresser-glb.ts public/assets/jardin/jardin.glb
 *
 * Côté site, `brancherKTX2` (`src/io/textures.ts`) donne le transcodeur à
 * chaque `GLTFLoader` qui lit ces fichiers.
 */
import { resolve } from 'node:path'

import { NodeIO, type Texture } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import draco3d from 'draco3d'
import { encodeToKTX2 } from 'ktx2-encoder'
import sharp from 'sharp'

/**
 * Les modèles dont les textures passent en KTX2. `bavette-anime.glb` a son propre chantier.
 * Pas `accessoires.glb` : ses cartes Meshy de 1024² sont pleines de grain fin (la pierre
 * poreuse de la fontaine) que l'ETC1S lisse à l'œil, et l'UASTC quintuple le fichier
 * (3,9 -> 19 Mo). Pas `park-lod.glb` : le site ne le charge plus.
 */
export const MODELES = [
  'architecture/escalier.glb',
  'jardin/jardin.glb',
  'plants/plants-lod.glb',
  'sculptures/arborescence.glb',
  'sculptures/chandelles.glb',
  'sculptures/formulaire.glb',
]

const ASSETS = resolve(import.meta.dirname, '..', 'public', 'assets')

/** L'encodeur WebAssembly écrit son journal sur la sortie standard, quoi qu'on lui dise. */
async function sansBavard<T>(f: () => Promise<T>): Promise<T> {
  const [log, ecrire] = [console.log, process.stdout.write]
  console.log = () => {}
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    return await f()
  } finally {
    console.log = log
    process.stdout.write = ecrire
  }
}

const decoder = async (octets: Uint8Array) => {
  const { data, info } = await sharp(octets).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) }
}

/** Ce que porte une texture : normale, couleur (à alpha utile ou non), ou donnée linéaire. */
function sorte(t: Texture): 'normale' | 'couleur-alpha' | 'couleur' | 'donnee' {
  const liens = t.listParents().flatMap((p) => t.getGraph().listParentEdges(t).filter((e) => e.getParent() === p).map((e) => [p, e.getName()] as const))
  const noms = liens.map(([, n]) => n)
  if (noms.some((n) => /normal/i.test(n))) return 'normale'
  const couleurs = liens.filter(([, n]) => /baseColor|emissive|sheenColor|specularColor|diffuse/i.test(n))
  if (couleurs.length === 0) return 'donnee'
  const alpha = couleurs.some(([p]) => 'getAlphaMode' in p && (p as { getAlphaMode(): string }).getAlphaMode() !== 'OPAQUE')
  return alpha ? 'couleur-alpha' : 'couleur'
}

export async function compresser(fichier: string): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })
  const doc = await io.read(fichier)
  const avant = (await io.writeBinary(doc)).byteLength
  let faites = 0
  for (const t of doc.getRoot().listTextures()) {
    const image = t.getImage()
    if (t.getMimeType() === 'image/ktx2' || !image) continue
    const s = sorte(t)
    const uastc = s !== 'couleur' && s !== 'donnee'
    const srgb = s === 'couleur' || s === 'couleur-alpha'
    const ktx2 = await sansBavard(() =>
      encodeToKTX2(image, {
        imageDecoder: decoder,
        isUASTC: uastc,
        isNormalMap: s === 'normale',
        needSupercompression: uastc,
        enableRDO: uastc,
        rdoQualityLevel: 1,
        isPerceptual: srgb,
        isSetKTX2SRGBTransferFunc: srgb,
        qualityLevel: 255,
        compressionLevel: 2,
        generateMipmap: true,
        isYFlip: false,
      }),
    )
    t.setImage(ktx2).setMimeType('image/ktx2')
    faites++
  }
  if (faites === 0) {
    console.log(`  à jour  ${fichier}`)
    return
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true)
  // Les WebP partis, leur extension n'a plus lieu d'être déclarée.
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp') e.dispose()
  await io.write(fichier, doc)
  const apres = (await io.writeBinary(doc)).byteLength
  console.log(`  ok      ${fichier} : ${faites} textures, ${(avant / 1024).toFixed(0)} -> ${(apres / 1024).toFixed(0)} Kio`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fichiers = process.argv.slice(2)
  for (const f of fichiers.length > 0 ? fichiers.map((f) => resolve(f)) : MODELES.map((m) => resolve(ASSETS, m))) await compresser(f)
}
