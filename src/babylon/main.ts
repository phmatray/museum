/**
 * La tranche Babylon (`?moteur=babylon`) : le même plan, un autre moteur, sans
 * React. Câblage seul : charge les données, monte les modules, lance la boucle.
 * Ordre : socle → soleil → visiteur → boîtes → toiles (l'ambiance du soleil règle la lightmap).
 */
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'

import config from '../../museum.config.json'
import { cielA, heureDemandee } from '../domain/soleil.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { monterBoites } from './boites.ts'
import { creerSocle } from './socle.ts'
import { monterSoleil } from './soleil.ts'
import { monterToiles } from './toiles.ts'
import { departDuVisiteur, monterVisiteur } from './visiteur.ts'

export async function demarrer(racine: HTMLElement): Promise<void> {
  const toile = document.createElement('canvas')
  // `display: block`, sinon la ligne de base d'un canvas en ligne ajoute une barre de défilement.
  toile.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none'
  racine.replaceChildren(toile)
  const { engine, scene } = await creerSocle(toile)

  const base = import.meta.env.BASE_URL
  const accrochage = await fetch(`${base}data/accrochage.json`).then((r) => r.json() as Promise<Accrochage>).catch(() => null)
  const recherche = new URLSearchParams(location.search)
  const ciel = cielA(heureDemandee(location.search, new Date()) ?? new Date(), config.location.latitude, config.location.longitude)

  // Soleil, ciel et ombres (soleil.ts).
  const { hemi, generateur } = monterSoleil(scene, ciel, recherche.get('ombres') !== '0')
  const camera = monterVisiteur(scene, toile, departDuVisiteur(MUSEE, accrochage, location.search, location.hash, config.owners))
  // Boîtes du plan et lightmap (boites.ts) : la force suit le jour, comme three.
  const porteurs = monterBoites(scene, MUSEE, { force: 0.75 + 0.25 * ciel.jour, hemi })
  // Toiles (toiles.ts), sans les attendre : la texture arrive quand elle arrive.
  if (accrochage) void monterToiles(scene, accrochage, base)

  for (const m of porteurs) generateur?.addShadowCaster(m)
  if (import.meta.env.DEV) {
    // Pour les mesures headless ; l'instrumentation remet le compteur d'appels à zéro à chaque image.
    const instr = new SceneInstrumentation(scene)
    ;(window as unknown as { __BABYLON__?: unknown }).__BABYLON__ = { engine, scene, camera, instr }
  }
  engine.runRenderLoop(() => scene.render())
  // La carte d'ombre (dessinée une fois) est redessinée quand tout est compilé.
  await scene.whenReadyAsync()
  generateur?.getShadowMap()?.resetRefreshCounter()
}
