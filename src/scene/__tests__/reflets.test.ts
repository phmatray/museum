import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import '../RefletsLayer'

describe('RefletsLayer', () => {
  it("retire l'environnement du diffus : la clarté ne dépend pas de la pièce où se tient le visiteur", () => {
    // Si three renomme la ligne, le remplacement ne fait plus rien : ce test le dit.
    expect(THREE.ShaderChunk.lights_fragment_maps).not.toContain('getIBLIrradiance')
    expect(THREE.ShaderChunk.lights_fragment_maps).toContain('getIBLRadiance')
  })
})
