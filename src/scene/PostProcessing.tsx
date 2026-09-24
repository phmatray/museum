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

import { TONE_MAPPING } from './lighting'
import { AO, BLOOM, VIGNETTE, toneMappingMode } from './postProcessingSettings'

/**
 * La chaîne de post-traitement du musée, montée dans le `Canvas` après le
 * bâtiment du plan (#31). Elle ne lit aucune donnée du plan : seulement la
 * scène déjà rendue et sa profondeur.
 */
export function PostProcessing() {
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
        aoRadius={AO.aoRadius}
        distanceFalloff={AO.distanceFalloff}
        intensity={AO.intensity}
        aoSamples={AO.aoSamples}
        denoiseSamples={AO.denoiseSamples}
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

      <Vignette offset={VIGNETTE.offset} darkness={VIGNETTE.darkness} />

      <SMAA />
    </EffectComposer>
  )
}
