# Décodeur KTX2 de Babylon.js

Pour le musée (`src/babylon/glb.ts`, `KhronosTextureContainer2.URLConfig`) :
le module `babylon.ktx2Decoder.js` (paquet npm `babylonjs-ktx2decoder@9.31.0`) et ses
transcodeurs Basis Universal (UASTC → ASTC/BC7/RGBA/R8/RG8, ETC1S par `msc_basis_transcoder`,
supercompression zstd), copiés de `https://cdn.babylonjs.com/ktx2Transcoders/1/` et
`https://cdn.babylonjs.com/zstddec.wasm`. Licence Apache-2.0.

Servis par le site plutôt que par le CDN : Babylon 9.31 les cherche sous un chemin versionné
(`cdn.babylonjs.com/v9.31.0/…`) qui répond 404, et le chargement d'un GLB texturé ne finit
jamais.
