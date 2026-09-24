/**
 * Le post-traitement ne se teste pas au pixel — le §12 le dit : `scene/` se
 * valide par capture d'écran. Ce que ces tests gardent, ce sont les INVARIANTS
 * qu'une capture ne montre pas, et qu'une régression casserait en silence.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ToneMappingMode } from 'postprocessing'

import { TONE_MAPPING } from '../lighting'
import {
  AO,
  BLOOM,
  VIGNETTE,
  toneMappingMode,
} from '../postProcessingSettings'

describe('toneMappingMode', () => {
  /**
   * LE test de ce lot. `EffectComposer` rend dans une cible hors écran, où
   * three IGNORE `gl.toneMapping` : la courbe du lot 3 doit être rejouée dans
   * la chaîne. Si `lighting.ts` change de courbe et que la traduction ne suit
   * pas, l'image entière change de calibration sans qu'aucune capture
   * n'explique pourquoi.
   */
  it('rejoue exactement la courbe choisie par le lot 3', () => {
    expect(toneMappingMode(TONE_MAPPING)).toBe(ToneMappingMode.NEUTRAL)
  })

  it('traduit les courbes que three et postprocessing partagent', () => {
    expect(toneMappingMode(THREE.LinearToneMapping)).toBe(ToneMappingMode.LINEAR)
    expect(toneMappingMode(THREE.ReinhardToneMapping)).toBe(
      ToneMappingMode.REINHARD,
    )
    expect(toneMappingMode(THREE.CineonToneMapping)).toBe(ToneMappingMode.CINEON)
    expect(toneMappingMode(THREE.ACESFilmicToneMapping)).toBe(
      ToneMappingMode.ACES_FILMIC,
    )
    expect(toneMappingMode(THREE.AgXToneMapping)).toBe(ToneMappingMode.AGX)
    expect(toneMappingMode(THREE.NeutralToneMapping)).toBe(
      ToneMappingMode.NEUTRAL,
    )
  })

  it('retombe sur Neutral plutôt que de lever sur une courbe inconnue', () => {
    // `CustomToneMapping` n'a pas d'équivalent : il n'existe que par un shader
    // fourni par l'application. Une exception ici noircirait tout l'écran.
    expect(toneMappingMode(THREE.CustomToneMapping)).toBe(
      ToneMappingMode.NEUTRAL,
    )
  })
})

describe('occlusion ambiante', () => {
  /**
   * Le rayon est en MÈTRES, dans un bâtiment dont le plafond est à 4,3 m. Un
   * rayon du même ordre que la pièce transformerait l'occlusion de contact en
   * assombrissement global — le défaut que le lot corrige, à l'envers.
   */
  it('garde un rayon à l’échelle du contact, pas de la pièce', () => {
    expect(AO.aoRadius).toBeGreaterThan(0.5)
    expect(AO.aoRadius).toBeLessThan(3)
  })

  it('reste en unités du monde, pour que le creusement ne glisse pas avec la caméra', () => {
    expect(AO.screenSpaceRadius).toBe(false)
  })

  /**
   * La demi-résolution est ce qui rend la passe gratuite à l'image. La perdre
   * ne casserait rien de visible — juste le budget d'images par seconde du §9,
   * qui ne se voit qu'en le mesurant.
   */
  it('calcule en demi-résolution', () => {
    expect(AO.halfRes).toBe(true)
  })
})

describe('bloom', () => {
  /**
   * Mesuré à l'écran : le pic des toiles (visuels OG blancs) est sous 0,95 en
   * linéaire. Descendre le seuil sous 1 les fait toutes luire — c'est le seul
   * réglage de ce lot qui puisse rendre le musée laid d'un coup.
   */
  it('ne se déclenche qu’au-dessus de l’unité, jamais sur une toile blanche', () => {
    expect(BLOOM.luminanceThreshold).toBeGreaterThanOrEqual(1)
  })

  it('reste discret', () => {
    expect(BLOOM.intensity).toBeLessThanOrEqual(0.4)
  })
})

describe('vignette', () => {
  it('reste sous le seuil où elle se lit comme un effet', () => {
    expect(VIGNETTE.darkness).toBeLessThanOrEqual(0.4)
  })
})
