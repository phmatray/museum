/**
 * LOT 3 — De l'atlas WebP à la `DataArrayTexture` (spec §9.1).
 *
 * Une texture par œuvre donnerait cent matériaux et cent draw calls. Le spike du
 * lot 0 (`spike/array-texture.ts`, mesuré dans Chrome) a montré la sortie : UN
 * atlas téléchargé, découpé au chargement en autant de couches que d'œuvres, et
 * un `InstancedMesh` dont le shader échantillonne `texture(map, vec3(uv, aLayer))`.
 * 256 couches, 1 draw call, 120 im/s.
 *
 * Ce fichier ne contient que la moitié « données » de ce chemin. Il n'importe ni
 * react ni `@react-three/fiber` : la découpe est de l'arithmétique sur un tampon
 * d'octets, elle se teste sans canvas et c'est exactement ce que font les tests.
 *
 * ── LE PIÈGE, corrigé ici et nulle part ailleurs ──
 *
 * `DataArrayTexture` n'applique PAS `UNPACK_FLIP_Y_WEBGL`, contrairement à une
 * texture classique : ce drapeau est ignoré pour les cibles `TEXTURE_2D_ARRAY`.
 * Or `getImageData` rend les lignes de haut en bas et WebGL attend (0,0) en bas à
 * gauche. Sans retournement explicite à la construction, TOUTES LES TOILES SONT
 * ACCROCHÉES À L'ENVERS — le spike l'a effectivement produit avant correction.
 *
 * Le retournement est fait ICI, à la copie, et surtout pas dans le shader : le
 * reste du code (accrochage, cadres, LOD proche, éditeur) doit pouvoir ignorer
 * qu'une texture array existe. Un `1.0 - uv.y` dans le fragment shader ferait
 * diverger le LOD proche, qui lui passe par une texture 2D ordinaire flippée par
 * le chargeur.
 *
 * ── Colorimétrie ──
 *
 * Les couches sont déclarées en `NoColorSpace` et le shader écrit ses octets
 * tels quels dans un framebuffer de sortie sRGB : les octets du WebP sont déjà
 * encodés en sRGB, les faire passer par une conversion linéaire puis inverse ne
 * ferait qu'ajouter du bruit d'arrondi. Le LOD proche suit le même chemin, sans
 * quoi la bascule à 10 m se verrait comme un saut de contraste.
 */
import * as THREE from 'three'

import type { AtlasIndex, RepoKey } from '../domain/types'

// ── Emplacements ─────────────────────────────────────────────────────────

/**
 * Chemins RELATIFS à la base du site. Sur GitHub Pages le site vit sous
 * `/<dépôt>/` : un chemin absolu `/media/atlas.json` y donnerait un 404 que
 * seule la console révélerait.
 */
export const ATLAS_INDEX_PATH = 'media/atlas.json'
export const NEAR_MEDIA_PATH = 'media/near/'

/**
 * Distance sous laquelle une œuvre passe en haute définition (spec §9.1).
 * Vit ici parce que c'est la constante qui décide QUAND charger un fichier.
 */
export const NEAR_LOD_DISTANCE = 10

/**
 * Plafond du nombre de vignettes haute définition simultanées.
 *
 * Ce n'est pas une optimisation prudente : chaque vignette est un 1024×512 non
 * compressé en VRAM (2 Mo avec ses mips), et l'atlas en occupe déjà 15. Six
 * suffit largement — face à un mur, on ne peut pas avoir plus de trois ou quatre
 * œuvres à moins de dix mètres ET dans le champ.
 */
export const MAX_NEAR_TEXTURES = 6

// ── Découpe, pure ────────────────────────────────────────────────────────

/** Un bloc RGBA à plat, tel que `getImageData` le rend. */
export interface AtlasPixels {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/**
 * Nombre de couches réellement utilisées par un atlas donné.
 *
 * On n'alloue PAS `cols × rows` couches systématiquement : l'atlas du corpus
 * réel a 256 emplacements pour 115 dépôts, et allouer les 141 emplacements vides
 * coûterait 18 Mo de VRAM pour du noir. La couche maximale référencée par
 * `entries` suffit — les couches sont attribuées en séquence par le pipeline
 * média, donc il n'y a pas de trou avant elle.
 */
export function atlasLayerCount(index: AtlasIndex, atlas: number): number {
  let max = -1
  for (const entree of Object.values(index.entries)) {
    if (entree.atlas === atlas && entree.layer > max) max = entree.layer
  }
  return max + 1
}

/**
 * Découpe un atlas en un tampon de couches, prêt pour `DataArrayTexture`.
 *
 * La couche `L` est la tuile de la colonne `L % cols`, ligne `⌊L / cols⌋` — la
 * même convention que celle qu'écrit le pipeline média dans `atlas.json`, et
 * c'est ce que le test d'ordre vérifie sur les vraies entrées.
 *
 * Refuse un atlas dont les dimensions ne correspondent pas à l'index plutôt que
 * de lire à côté : un atlas régénéré avec une autre taille de tuile produirait
 * sinon cent œuvres décalées d'un demi-cadre, sans le moindre message.
 */
export function sliceAtlas(
  source: AtlasPixels,
  index: AtlasIndex,
  layerCount: number,
): Uint8Array {
  const { tileWidth, tileHeight, cols, rows } = index
  const attendu = { width: cols * tileWidth, height: rows * tileHeight }
  if (source.width !== attendu.width || source.height !== attendu.height) {
    throw new RangeError(
      `sliceAtlas: atlas ${source.width}×${source.height}, ` +
        `index ${attendu.width}×${attendu.height} (${cols}×${rows} tuiles de ${tileWidth}×${tileHeight}) — ` +
        `l'atlas et son index ne viennent pas du même build`,
    )
  }
  if (layerCount < 0 || layerCount > cols * rows) {
    throw new RangeError(
      `sliceAtlas: ${layerCount} couches demandées, ${cols * rows} emplacements disponibles`,
    )
  }
  if (source.data.length < attendu.width * attendu.height * 4) {
    throw new RangeError(
      `sliceAtlas: tampon de ${source.data.length} octets pour ${attendu.width * attendu.height * 4} attendus (RGBA)`,
    )
  }

  const rowBytes = tileWidth * 4
  const layerBytes = rowBytes * tileHeight
  const out = new Uint8Array(layerBytes * layerCount)

  for (let layer = 0; layer < layerCount; layer++) {
    const x0 = (layer % cols) * tileWidth
    const y0 = Math.floor(layer / cols) * tileHeight
    for (let row = 0; row < tileHeight; row++) {
      const src = ((y0 + row) * source.width + x0) * 4
      // ── LE retournement. Voir l'en-tête du fichier. ──
      const dst = layer * layerBytes + (tileHeight - 1 - row) * rowBytes
      out.set(source.data.subarray(src, src + rowBytes), dst)
    }
  }

  return out
}

/**
 * Enveloppe un tampon découpé dans une `DataArrayTexture` prête au rendu.
 *
 * Filtrage linéaire sans mipmaps : une tuile fait 256×128, elle est vue de loin
 * mais jamais minifiée au-delà d'un facteur deux ou trois, et générer les mips
 * d'une texture array coûte une passe de plus au chargement pour un gain
 * invisible. Le LOD proche prend le relais avant que ça compte.
 */
export function makeArrayTexture(
  data: Uint8Array,
  index: AtlasIndex,
  layerCount: number,
): THREE.DataArrayTexture {
  const texture = new THREE.DataArrayTexture(
    data,
    index.tileWidth,
    index.tileHeight,
    Math.max(1, layerCount),
  )
  texture.format = THREE.RGBAFormat
  texture.type = THREE.UnsignedByteType
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  // Octets sRGB écrits tels quels : voir « Colorimétrie » en en-tête.
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * Retrouve le NUMÉRO d'un atlas depuis son URL.
 *
 * `AtlasIndex.entries` référence les atlas par un entier, pas par une chaîne ;
 * il faut donc raccorder l'URL demandée à la liste `atlases`. La comparaison
 * porte sur la fin du chemin : l'appelant passe une URL absolue préfixée par
 * `BASE_URL`, l'index contient un chemin relatif au site.
 *
 * Un atlas inconnu retombe sur 0 plutôt que de lever : un index à un seul atlas
 * — le cas courant — ne doit pas dépendre de la façon dont l'URL a été fabriquée.
 */
export function resolveAtlasNumber(atlasUrl: string, index: AtlasIndex): number {
  const trouve = index.atlases.findIndex((chemin) => atlasUrl.endsWith(chemin))
  return trouve < 0 ? 0 : trouve
}

// ── Chargement ───────────────────────────────────────────────────────────

/**
 * Télécharge un atlas et le découpe en `DataArrayTexture`.
 *
 * `createImageBitmap` est appelé avec `premultiplyAlpha: 'none'` et
 * `colorSpaceConversion: 'none'` : sans ça, le navigateur est LIBRE de
 * prémultiplier l'alpha et de convertir vers l'espace du moniteur, et les octets
 * qu'on lit ensuite ne sont plus ceux du fichier. Les tuiles étant opaques, la
 * prémultiplication passerait inaperçue au test et donnerait des bords sales sur
 * les seules images qui ont de la transparence.
 */
export async function loadArrayTexture(
  atlasUrl: string,
  index: AtlasIndex,
  atlas: number = resolveAtlasNumber(atlasUrl, index),
): Promise<THREE.DataArrayTexture> {
  const reponse = await fetch(atlasUrl)
  if (!reponse.ok) {
    throw new Error(
      `${atlasUrl} — le serveur a répondu ${reponse.status} ${reponse.statusText} ; l'atlas a-t-il été généré (npm run media) ?`,
    )
  }

  const bitmap = await createImageBitmap(await reponse.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  try {
    const pixels = readPixels(bitmap)
    const layerCount = atlasLayerCount(index, atlas)
    return makeArrayTexture(sliceAtlas(pixels, index, layerCount), index, layerCount)
  } finally {
    bitmap.close()
  }
}

/**
 * Décode un bitmap en RGBA.
 *
 * `OffscreenCanvas` quand il existe — il évite d'attacher un élément au
 * document — sinon un `<canvas>` détaché, qui marche partout. `willReadFrequently`
 * est faux à dessein : on ne lit qu'UNE fois, et le drapeau ferait basculer le
 * contexte sur un backend logiciel plus lent pour ce seul appel.
 */
function readPixels(bitmap: ImageBitmap): AtlasPixels {
  const { width, height } = bitmap
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })

  const contexte = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (contexte === null) {
    throw new Error("aucun contexte 2d disponible : l'atlas ne peut pas être découpé")
  }

  contexte.drawImage(bitmap, 0, 0)
  const image = contexte.getImageData(0, 0, width, height)
  return { data: image.data, width, height }
}

/** Va chercher `atlas.json` et vérifie qu'il décrit bien une grille utilisable. */
export async function loadAtlasIndex(url?: string): Promise<AtlasIndex> {
  const cible = url ?? `${import.meta.env.BASE_URL}${ATLAS_INDEX_PATH}`
  const reponse = await fetch(cible)
  if (!reponse.ok) {
    throw new Error(
      `${cible} — le serveur a répondu ${reponse.status} ${reponse.statusText} ; les médias ont-ils été générés (npm run media) ?`,
    )
  }
  return assertAtlasIndex(await reponse.json(), cible)
}

/**
 * Contrôle minimal de l'index.
 *
 * Volontairement pauvre par rapport à `src/schema/` : ce fichier est généré et
 * consommé par le seul module qui le lit. Ce qu'on veut attraper, c'est une
 * grille à zéro colonne ou une taille de tuile absente, qui donneraient une
 * division par zéro et une texture vide plutôt qu'une erreur.
 */
function assertAtlasIndex(brut: unknown, source: string): AtlasIndex {
  const index = brut as Partial<AtlasIndex>
  const positif = (valeur: unknown) => typeof valeur === 'number' && Number.isInteger(valeur) && valeur > 0
  if (
    !positif(index.tileWidth) ||
    !positif(index.tileHeight) ||
    !positif(index.cols) ||
    !positif(index.rows) ||
    !Array.isArray(index.atlases) ||
    typeof index.entries !== 'object' ||
    index.entries === null
  ) {
    throw new Error(
      `${source} — index d'atlas illisible : tileWidth/tileHeight/cols/rows entiers positifs, atlases et entries attendus`,
    )
  }
  return index as AtlasIndex
}

// ── Ressource mémorisée ──────────────────────────────────────────────────

export interface AtlasTextures {
  index: AtlasIndex
  /** Une texture array par atlas, indexée par `Placement.atlas`. */
  layers: THREE.DataArrayTexture[]
}

/**
 * L'atlas, chargé UNE fois pour tout le musée.
 *
 * Quatre niveaux rendent chacun leurs œuvres, mais ils partagent la même texture
 * array : la découper quatre fois multiplierait par quatre la VRAM et le temps
 * de chargement pour un résultat identique au pixel près. En cas d'échec la
 * promesse est oubliée, pour qu'un remontage puisse réessayer.
 */
let enCours: Promise<AtlasTextures> | null = null

export function atlasResource(): Promise<AtlasTextures> {
  if (enCours === null) {
    enCours = chargerAtlas().catch((erreur: unknown) => {
      enCours = null
      throw erreur
    })
  }
  return enCours
}

async function chargerAtlas(): Promise<AtlasTextures> {
  const index = await loadAtlasIndex()
  const base = import.meta.env.BASE_URL
  const layers = await Promise.all(
    index.atlases.map((chemin, numero) => loadArrayTexture(`${base}${chemin}`, index, numero)),
  )
  return { index, layers }
}

/** Oublie l'atlas mémorisé et libère ses couches. Tests et rechargement à chaud. */
export function resetAtlasResource(): void {
  const precedent = enCours
  enCours = null
  void precedent?.then(
    ({ layers }) => layers.forEach((texture) => texture.dispose()),
    () => {},
  )
}

// ── LOD proche ───────────────────────────────────────────────────────────

/**
 * URL de la vignette haute définition d'un dépôt.
 *
 * Le pipeline média nomme les fichiers `owner__name.webp` : la barre oblique de
 * la `RepoKey` ne peut pas rester, elle créerait un sous-dossier par propriétaire
 * et casserait la copie à plat vers `public/`.
 */
export function nearTextureUrl(key: RepoKey, base: string = import.meta.env.BASE_URL): string {
  return `${base}${NEAR_MEDIA_PATH}${key.replace('/', '__')}.webp`
}

/**
 * ── Le magasin des vignettes ─────────────────────────────────────────────
 *
 * Le LOD proche est un ÉTAT EXTERNE à React : les vignettes arrivent du réseau,
 * plusieurs niveaux en réclament simultanément, et leur durée de vie ne suit pas
 * celle d'un composant. On l'expose donc en magasin observable
 * (`subscribeNearTextures` / `nearTextures`), consommé par `useSyncExternalStore`
 * — ce qui évite au composant de gérer un cache dans un état local qu'il devrait
 * purger dans un effet, c'est-à-dire de provoquer des rendus en cascade.
 *
 * Deux structures, et la distinction compte :
 *
 *  - `demandes` mémorise la PROMESSE de chaque vignette. Deux œuvres voisines
 *    franchissent le seuil des 10 m dans la même image ; sans ça le même fichier
 *    partirait deux fois sur le réseau.
 *  - `pretes` est l'instantané IMMUABLE des vignettes réellement disponibles. Il
 *    est remplacé et jamais muté : son identité change exactement quand son
 *    contenu change, ce dont dépend `useSyncExternalStore` pour ne pas
 *    redessiner en boucle.
 */
const demandes = new Map<RepoKey, Promise<THREE.Texture>>()
const chargeur = new THREE.TextureLoader()

let pretes: ReadonlyMap<RepoKey, THREE.Texture> = new Map()
const auditeurs = new Set<() => void>()

function publier(suivant: ReadonlyMap<RepoKey, THREE.Texture>): void {
  pretes = suivant
  for (const auditeur of [...auditeurs]) auditeur()
}

/** Abonnement au magasin, pour `useSyncExternalStore`. */
export function subscribeNearTextures(auditeur: () => void): () => void {
  auditeurs.add(auditeur)
  return () => {
    auditeurs.delete(auditeur)
  }
}

/** Instantané des vignettes disponibles. Stable tant que rien ne change. */
export function nearTextures(): ReadonlyMap<RepoKey, THREE.Texture> {
  return pretes
}

/**
 * Charge la vignette d'un dépôt, À LA DEMANDE.
 *
 * Jamais en lot : 115 vignettes de 1024×512 font 240 Mo de VRAM, soit davantage
 * que le budget textures ENTIER du §9. C'est tout l'intérêt de la texture array —
 * la haute définition ne sert qu'aux quelques œuvres qu'on a sous le nez.
 *
 * `flipY` reste à sa valeur par défaut (vrai) : une texture 2D ordinaire EST
 * retournée par WebGL, contrairement à une texture array. Les deux LOD montrent
 * donc la même image dans le même sens, chacun par son chemin.
 */
export function loadNearTexture(key: RepoKey): Promise<THREE.Texture> {
  const dejaLa = demandes.get(key)
  if (dejaLa !== undefined) return dejaLa

  const promesse = chargeur.loadAsync(nearTextureUrl(key)).then((texture) => {
    texture.colorSpace = THREE.NoColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    // Une toile est vue de biais dès qu'on longe un mur : sans anisotropie elle
    // devient floue exactement quand on s'en approche, c'est-à-dire au moment où
    // ce LOD sert à quelque chose. three plafonne la valeur aux capacités du GPU.
    texture.anisotropy = 8
    return texture
  })

  demandes.set(key, promesse)
  void promesse.then(
    (texture) => {
      // Le joueur a pu s'éloigner pendant le téléchargement : republier une
      // vignette que plus personne ne réclame la garderait en VRAM pour rien.
      if (demandes.get(key) !== promesse) {
        texture.dispose()
        return
      }
      publier(new Map(pretes).set(key, texture))
    },
    // Une vignette absente n'est pas une raison de casser la scène : l'instance
    // de la texture array reste affichée, et c'est très bien.
    () => {
      demandes.delete(key)
    },
  )

  return promesse
}

/**
 * Qui a besoin de quelle vignette, par propriétaire.
 *
 * Un décompte par réclamant plutôt qu'une simple purge, parce que les niveaux
 * décident CHACUN de leur LOD proche : deux plateaux voisins peuvent avoir des
 * œuvres à moins de dix mètres en même temps, et si chacun purgeait « tout ce
 * qui n'est pas à moi », ils se libéreraient mutuellement leurs textures à
 * chaque image — une œuvre proche clignoterait indéfiniment entre ses deux LOD.
 */
const reclamations = new Map<string, ReadonlySet<RepoKey>>()

/**
 * Déclare l'ensemble EXACT des vignettes dont `owner` a besoin : lance celles
 * qui manquent, libère celles que plus personne ne réclame.
 *
 * C'est le seul point d'entrée du LOD proche. Sans la libération, le cache ne
 * ferait que croître et une visite complète du musée finirait par tenir les 115
 * vignettes en mémoire — ce que le chargement à la demande était précisément
 * censé éviter.
 */
export function claimNearTextures(owner: string, keys: Iterable<RepoKey>): void {
  const demande = new Set(keys)
  if (demande.size === 0) reclamations.delete(owner)
  else reclamations.set(owner, demande)

  const reclamees = new Set<RepoKey>()
  for (const ensemble of reclamations.values()) {
    for (const key of ensemble) reclamees.add(key)
  }

  let suivant: Map<RepoKey, THREE.Texture> | null = null
  for (const [key, promesse] of [...demandes]) {
    if (reclamees.has(key)) continue
    demandes.delete(key)
    void promesse.then(
      (texture) => texture.dispose(),
      () => {},
    )
    if (pretes.has(key)) {
      suivant ??= new Map(pretes)
      suivant.delete(key)
    }
  }
  if (suivant !== null) publier(suivant)

  for (const key of reclamees) void loadNearTexture(key)
}

/** Libère toutes les vignettes et oublie les réclamations. Réservé aux tests. */
export function resetNearTextures(): void {
  reclamations.clear()
  for (const [, promesse] of [...demandes]) {
    void promesse.then(
      (texture) => texture.dispose(),
      () => {},
    )
  }
  demandes.clear()
  publier(new Map())
}
