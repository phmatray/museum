import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import config from '../../../museum.config.json'
import { CARNET_VIDE } from '../../domain/succes'
import { MUSEE } from '../../plan/musee'
import { marquerPret } from '../chargement'
import { partie } from '../etat'
import { monterPhoto } from '../photo'
import { carnet } from '../succes'
import { departDuVisiteur, monterVisiteur } from '../visiteur'

const appuyer = (code: string) => dispatchEvent(new KeyboardEvent('keydown', { code }))
const lacher = (code: string) => dispatchEvent(new KeyboardEvent('keyup', { code }))

describe('le mode photo', () => {
  const engine = new NullEngine()
  const scene = new Scene(engine)
  const toile = document.createElement('canvas')
  const camera = monterVisiteur(scene, toile, departDuVisiteur(MUSEE, null, '', '', config.owners))
  const racine = document.createElement('div')
  const bouton = monterPhoto(scene, camera, toile, racine)
  const barre = racine.querySelector<HTMLElement>('.photo-barre')!
  marquerPret()

  it('reste fermé tant que l’appareil de la cabine n’est pas pris', () => {
    carnet.setState({ carnet: CARNET_VIDE })
    partie.setState({ paused: false })
    expect(bouton.hidden).toBe(true)
    appuyer('KeyP')
    expect(partie.getState().photo).toBe(false)
    carnet.setState({ carnet: { ...CARNET_VIDE, gestes: ['appareil'] } })
    expect(bouton.hidden).toBe(false)
  })

  it('P prend la caméra : elle vole, le visiteur l’attend, et P la lui rend où il était', () => {
    const avant = { ...camera.walker() }
    appuyer('KeyP')
    expect(partie.getState().photo).toBe(true)
    expect(barre.hidden).toBe(false)
    const y0 = camera.position.y
    appuyer('Space')
    // NullEngine ne mesure pas le temps : 50 ms par image.
    ;(engine as unknown as { _deltaTime: number })._deltaTime = 50
    for (let i = 0; i < 10; i++) scene.render()
    lacher('Space')
    expect(camera.position.y).toBeGreaterThan(y0)
    expect(camera.walker()).toEqual(avant)
    appuyer('KeyP')
    expect(partie.getState().photo).toBe(false)
    expect(barre.hidden).toBe(true)
    expect(camera.position.y).toBeCloseTo(y0)
  })

  it('figer arrête le temps du moteur et les animations ; la pause referme le mode', () => {
    appuyer('KeyP')
    appuyer('KeyF')
    expect(engine.getDeltaTime()).toBe(0)
    expect(scene.animationsEnabled).toBe(false)
    partie.setState({ paused: true })
    expect(partie.getState().photo).toBe(false)
    expect(scene.animationsEnabled).toBe(true)
  })

  it('une pellicule ajoute sa passe en bout de chaîne ; la naturelle n’en a pas', () => {
    partie.setState({ paused: false })
    appuyer('KeyP')
    expect(camera._postProcesses.some((p) => p?.name === 'pellicule')).toBe(false)
    appuyer('Digit3')
    expect(racine.querySelector('.photo-pellicule')!.textContent).toBe('Noir et blanc')
    expect(camera._postProcesses.at(-1)?.name).toBe('pellicule')
    appuyer('Digit1')
    expect(camera._postProcesses.some((p) => p?.name === 'pellicule')).toBe(false)
    appuyer('KeyP')
  })
})
