/**
 * LOT 4 — Le post-traitement (spec §9.4).
 *
 * ── Ce que cette passe corrige, et pourquoi elle est la correction majeure ──
 *
 * Le bâtiment du lot 3 s'aplatissait en une masse uniforme : deux murs
 * perpendiculaires sortaient à la même valeur, et l'arête qui les sépare
 * n'existait tout simplement pas à l'image. Aucun matériau, aucune lumière
 * supplémentaire ne répare ça — c'est l'OCCLUSION AMBIANTE qui manque, et elle
 * ne se calcule qu'en connaissant la géométrie voisine de chaque pixel.
 *
 * Le §9.4 impose l'écran plutôt que le baking : les matières CC0 retenues ne
 * livrent pas de carte d'AO. D'où N8AO, qui reconstruit les normales depuis la
 * profondeur.
 *
 * ── L'ordre de la chaîne, qui n'est pas arbitraire ──
 *
 *   RenderPass      la scène, en HDR linéaire, ombres comprises
 *   N8AO            creuse les angles — AVANT tout, sur la profondeur brute
 *   Bloom           déborde les hautes lumières — encore en linéaire, sinon le
 *                   rendu des tons aurait déjà écrasé ce qui doit déborder
 *   ToneMapping     la courbe du lot 3, rejouée ici (voir plus bas)
 *   Rayons          le soleil à travers les arbres, en écran (`etalonnage.ts`)
 *   Étalonnage      la couleur de l'heure : aube dorée, midi neutre, soir ambré, nuit bleue
 *   Vignette        après la courbe : c'est un assombrissement d'image finie
 *   SMAA            en dernier, sur l'image telle qu'elle sera affichée
 *
 * ── Le piège du rendu des tons ──
 *
 * `EffectComposer` force `gl.toneMapping = NoToneMapping` à son montage, et de
 * toute façon `WebGLPrograms` de three ignore le rendu des tons dès qu'on rend
 * dans une cible hors écran. Le réglage du lot 3 serait donc perdu en silence :
 * l'intérieur, calibré pour Khronos PBR Neutral, sortirait brûlé. On le rejoue
 * à la fin de la chaîne à partir des MÊMES constantes (`lighting.ts`) — ce
 * n'est pas un doublon, c'est un déplacement. Voir `toneMappingMode`.
 *
 * ── Le piège de l'anticrénelage ──
 *
 * `multisampling` doit être à 0. Le MSAA du composeur est incompatible avec une
 * passe qui lit la profondeur : N8AO recevrait une texture de profondeur
 * résolue et son occlusion serait fausse sur toutes les silhouettes. C'est SMAA
 * qui prend le relais, en post-traitement, comme le veut le §9.4.
 */
import { EffectComposer, N8AO, Bloom, ToneMapping, Vignette, SMAA } from '@react-three/postprocessing'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { TONE_EXPOSURE, TONE_MAPPING } from './lighting'
import { AO, BLOOM, VIGNETTE, toneMappingMode } from './postProcessingSettings'
import { EtalonnageEffect, creerRayons } from './etalonnage'
import { qualiteDemandee } from './qualite'
import { recherche } from '../stores/reglagesStore'

/** Ce que `alleger` touche de `N8AOPostPass` (n8ao ne publie pas ses types). */
interface PasseN8AO {
  renderToScreen: boolean
  outputTargetInternal: THREE.WebGLRenderTarget
  copyQuad: { render(gl: THREE.WebGLRenderer): void }
  transparencyRenderTargetDWFalse?: THREE.WebGLRenderTarget
  transparencyRenderTargetDWTrue?: THREE.WebGLRenderTarget
  configureTransparencyTarget(): void
  render(gl: THREE.WebGLRenderer, entree: THREE.WebGLRenderTarget, sortie: THREE.WebGLRenderTarget, ...reste: unknown[]): void
  allegee?: true
}

/**
 * N8AO au même résultat, pour moins cher. Rien n'est retiré : même occlusion,
 * même prise en compte des objets transparents (verrière, vitrines, eau).
 *
 * 1. Sa passe finale compose dans un tampon plein écran À ELLE, puis le recopie
 *    dans la sortie du composeur. La copie est exacte (demi-flottant vers
 *    demi-flottant, pixel pour pixel) : on compose directement dans la sortie.
 *    Un tampon plein écran de moins (8 Mo à DPR 1, 33 Mo à DPR 2) et une passe
 *    de moins par image.
 * 2. Les deux tampons de transparence ne sont lus que par leur ALPHA
 *    (`texture2D(transparencyDW…, vUv).a`) : 8 bits suffisent à une opacité de
 *    matériau, pas besoin de demi-flottants. Deux fois moins de mémoire.
 */
function alleger(passe: PasseN8AO | null) {
  if (!passe || passe.allegee) return
  passe.allegee = true

  const octets = () => {
    for (const cible of [passe.transparencyRenderTargetDWFalse, passe.transparencyRenderTargetDWTrue]) if (cible) cible.texture.type = THREE.UnsignedByteType
  }
  octets()
  const configurer = passe.configureTransparencyTarget.bind(passe)
  passe.configureTransparencyTarget = () => {
    configurer()
    octets()
  }

  // Le tampon propre reste en place hors du rendu : `setSize` et `dispose` ne
  // doivent jamais toucher aux tampons du composeur.
  const propre = passe.outputTargetInternal
  const copier = passe.copyQuad.render
  const rien = () => {}
  const rendre = passe.render.bind(passe)
  passe.render = (gl, entree, sortie, ...reste) => {
    const direct = !passe.renderToScreen && !!sortie
    passe.outputTargetInternal = direct ? sortie : propre
    passe.copyQuad.render = direct ? rien : copier
    try {
      rendre(gl, entree, sortie, ...reste)
    } finally {
      passe.outputTargetInternal = propre
      passe.copyQuad.render = copier
    }
  }
}

/**
 * La chaîne de post-traitement du musée, montée dans le `Canvas` après le
 * bâtiment du plan (#31). Elle ne lit aucune donnée du plan : seulement la
 * scène déjà rendue et sa profondeur.
 */
export function PostProcessing() {
  // L'exposition que `ToneMappingEffect` lit dans l'uniforme du renderer :
  // personne d'autre ne la pose depuis le retrait de l'ancienne scène (#29).
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  // `?qualite=basse` : les mêmes effets, moins chers (occlusion et rayons moins échantillonnés, rayons au quart).
  const basse = qualiteDemandee(recherche()) === 'basse'
  const rayons = useMemo(() => creerRayons(camera, basse), [camera, basse])
  const etalonnage = useMemo(() => new EtalonnageEffect(), [])
  useEffect(() => () => rayons.dispose(), [rayons])
  useEffect(() => () => etalonnage.dispose(), [etalonnage])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    gl.toneMappingExposure = TONE_EXPOSURE
  }, [gl])

  return (
    <EffectComposer
      // Voir l'en-tête : le MSAA fausserait la profondeur lue par N8AO.
      multisampling={0}
      // N8AO reconstruit ses normales depuis la profondeur ; une `NormalPass`
      // coûterait un rendu complet de la scène en plus pour rien.
      enableNormalPass={false}
    >
      {/*
        `N8AO` n'est pas un `Effect` mais une `Pass` : le composeur l'insère
        telle quelle, et comme elle déclare `needsDepthTexture`, elle
        réutilise la profondeur du `RenderPass` au lieu de redessiner la
        scène.
      */}
      <N8AO
        ref={alleger}
        aoRadius={AO.aoRadius}
        distanceFalloff={AO.distanceFalloff}
        intensity={AO.intensity}
        aoSamples={basse ? AO.aoSamples / 2 : AO.aoSamples}
        denoiseSamples={basse ? AO.denoiseSamples / 2 : AO.denoiseSamples}
        denoiseRadius={AO.denoiseRadius}
        halfRes={AO.halfRes}
        screenSpaceRadius={AO.screenSpaceRadius}
        // Sans ce recalage sur la profondeur, la demi-résolution laisserait
        // un escalier d'occlusion sur toutes les silhouettes.
        depthAwareUpsampling
        color={AO.color}
      />

      <Bloom
        luminanceThreshold={BLOOM.luminanceThreshold}
        luminanceSmoothing={BLOOM.luminanceSmoothing}
        intensity={BLOOM.intensity}
        radius={BLOOM.radius}
        mipmapBlur={BLOOM.mipmapBlur}
      />

      <ToneMapping mode={toneMappingMode(TONE_MAPPING)} />

      {/* Les rayons à travers les arbres, puis l'étalonnage de l'heure (\`etalonnage.ts\`) : sur l'image finie, avant la vignette. */}
      <primitive object={rayons} dispose={null} />
      <primitive object={etalonnage} dispose={null} />

      <Vignette offset={VIGNETTE.offset} darkness={VIGNETTE.darkness} />

      <SMAA />
    </EffectComposer>
  )
}
