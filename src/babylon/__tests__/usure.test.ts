import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it, vi } from 'vitest'

import { MUSEE } from '../../plan/musee'
import { monterFacade } from '../facade'
import { dallage } from '../parc'
import { codeFacade, codePietiner } from '../usure'

describe('usure', () => {
  it('écrit la façade et le sol foulé dans les deux langues, sans ternaire en WGSL', () => {
    for (const wgsl of [false, true])
      for (const code of [codeFacade(wgsl, false), codeFacade(wgsl, true), codePietiner(wgsl, false), codePietiner(wgsl, true)]) {
        const corps = code.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA
        expect(corps).toContain('surfaceAlbedo')
        if (wgsl) expect(corps).not.toMatch(/\?|\bvec[234]\(|texture2D/)
      }
    expect(codeFacade(false, false).vertex).toBeUndefined()
    expect(codeFacade(true, true).vertex?.CUSTOM_VERTEX_DEFINITIONS).toContain('attribute boite: vec3f;')
  })

  it('greffe la façade (pierre et piliers épaufrés) et le dallage, avant les intempéries', async () => {
    // Ni police ni catalogue sous jsdom : l'enseigne et les bannières renoncent, les boîtes restent.
    vi.stubGlobal('FontFace', class { load = () => Promise.reject(new Error('jsdom')) })
    vi.stubGlobal('fetch', () => Promise.reject(new Error('jsdom')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new Scene(new NullEngine())
    const ms = await monterFacade(scene, MUSEE, '/')
    const nom = (n: string) => ms.find((m) => m.name === n)!
    expect(nom('facade-brique').material?.pluginManager?.getPlugin('UsureFacade')).toBeTruthy()
    for (const n of ['facade-pierre', 'facade-piliers']) {
      expect(nom(n).material?.pluginManager?.getPlugin('UsureFacadePierre')).toBeTruthy()
      expect(nom(n).isVerticesDataPresent('boite')).toBe(true)
    }
    const d = dallage(scene)
    expect(d.pluginManager?.getPlugin('UsureDalles')?.priority).toBeLessThan(d.pluginManager!.getPlugin('IntemperiesFlaques')!.priority)
  })
})
