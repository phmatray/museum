# Basis Universal transcoder

Copied verbatim from `three/examples/jsm/libs/basis/` (three r186), like `public/draco/`.
`KTX2Loader` (`src/io/textures.ts`) fetches these two files to transcode the `.ktx2`
material maps produced by `tools/encode-ktx2.ts` into whatever compressed format the
GPU reads (BC7, ASTC, ETC2…).

* `basis_transcoder.js` — JavaScript wrapper.
* `basis_transcoder.wasm` — WebAssembly transcoder.

Update both together when three is upgraded.

## License

[Apache License 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE)
