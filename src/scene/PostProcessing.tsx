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
 * Le §9.4 impose l'écran plutôt que le baking : le bâtiment est génératif, ses
 * UV changent à chaque dérivation, et les matières CC0 retenues ne livrent pas
 * de carte d'AO. D'où N8AO, qui reconstruit les normales depuis la profondeur.
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
import { useEffect, useState } from 'react'

import { TONE_MAPPING } from './lighting'
import { AO, BLOOM, VIGNETTE, toneMappingMode } from './postProcessingSettings'

/**
 * La chaîne de post-traitement du musée. À placer dans le `Canvas`, en dehors
 * de `<Physics>` : le composeur n'a aucun corps rigide à déclarer, et le groupe
 * R3F qu'il monte n'a rien à faire dans le monde de Rapier.
 */
export function PostProcessing() {
  // Interrupteur de MESURE, pas de préférence : il ne sert qu'au « avant /
  // après » du §9.4, depuis la même caméra et dans la même session. En
  // production il reste bloqué à `true`, faute de handle pour le basculer.
  const [actif, setActif] = useState(true)

  return (
    <>
      <PostProcessingDebugHandle setEnabled={setActif} />
      <EffectComposer
        enabled={actif}
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
          scène. C'est ce qui permet de tenir le budget du §9.
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
    </>
  )
}

/**
 * Ajoute `setPostFx(bool)` à `window.__MUSEUM__`, en développement seulement.
 *
 * Même convention que `setCulling` du lot 2, et pour la même raison : le coût
 * d'une passe ne se mesure qu'en la coupant sans bouger la caméra. Le handle
 * appartient à `MuseumScene` ; on ne fait que l'augmenter, et on retire
 * proprement la clé au démontage pour ne pas laisser une fermeture morte
 * derrière un rechargement à chaud.
 *
 * `import.meta.env.DEV` le retire intégralement du bundle de production.
 */
function PostProcessingDebugHandle({
  setEnabled,
}: {
  setEnabled: (actif: boolean) => void
}) {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __MUSEUM__?: Record<string, unknown> }
    if (!w.__MUSEUM__) return
    w.__MUSEUM__.setPostFx = setEnabled
    return () => {
      delete w.__MUSEUM__?.setPostFx
    }
  }, [setEnabled])
  return null
}
