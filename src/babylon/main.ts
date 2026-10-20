/**
 * La tranche Babylon (`?moteur=babylon`) : le même plan, un autre moteur, sans
 * React. Câblage seul : charge les données, monte les modules, lance la boucle.
 * Ordre : socle → soleil → reflets → visiteur → boîtes et parement → toiles →
 * couches du bâtiment (vague 1), chacune non bloquante : un GLB absent n'arrête
 * pas la visite. Tout arrivé, les sondes de reflets sont prises et les matières
 * figées (sauf celles qui vivent).
 */
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'

import config from '../../museum.config.json'
import { cielA, heureDemandee } from '../domain/soleil.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'

import { monterBatllo } from './batllo.ts'
import { monterBelvedere } from './belvedere.ts'
import { monterBoites } from './boites.ts'
import { monterCimaises } from './cimaises.ts'
import { monterEclairage } from './eclairage.ts'
import { monterEscalier } from './escalier.ts'
import { monterFacade } from './facade.ts'
import { reglerLueurs } from './lueurs.ts'
import { cartesChargees } from './matieres.ts'
import { monterNef } from './nef.ts'
import { monterParement } from './parement.ts'
import { monterPortes } from './portes.ts'
import { monterReflets } from './reflets.ts'
import { monterSalleHonneur } from './salleHonneur.ts'
import { creerSocle } from './socle.ts'
import { monterSoleil } from './soleil.ts'
import { monterToiles } from './toiles.ts'
import { departDuVisiteur, monterVisiteur } from './visiteur.ts'

/** Les matières qui changent après le chargement : jamais figées (la lentille fond, l'atlas des toiles peut se replier). */
const VIVANTES = new Set(['lentille-allumee', 'toiles'])

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
  // Les lueurs des lieux (lueurs.ts) : un état partagé, chaque couche y branche ses matières.
  reglerLueurs(ciel.jour, hemi)
  // Les reflets (reflets.ts) : l'environnement posé avant la première compilation.
  const reflets = monterReflets(scene, MUSEE, ciel.jour)
  const camera = monterVisiteur(scene, toile, departDuVisiteur(MUSEE, accrochage, location.search, location.hash, config.owners))
  // Boîtes du plan et lightmap (boites.ts) : la force suit le jour, comme three.
  const { porteurs, atlas, marches, lanterneaux } = monterBoites(scene, MUSEE, { force: 0.75 + 0.25 * ciel.jour, hemi })
  // Parement (parement.ts) et cimaises (cimaises.ts) : synchrones, dans la première carte d'ombre.
  porteurs.push(...monterParement(scene, MUSEE, atlas), ...monterCimaises(scene, MUSEE))
  for (const m of porteurs) generateur?.addShadowCaster(m)
  const signaler = (quoi: string) => (e: unknown) => console.error(`${quoi} indisponible`, e)
  // Toiles (toiles.ts), sans les attendre : la texture arrive quand elle arrive.
  const toiles = accrochage ? monterToiles(scene, accrochage, base).catch(signaler('toiles')) : null

  // Les couches du bâtiment, sans les attendre. Les porteurs arrivés après la
  // première carte d'ombre la font redessiner.
  const ombrer = (ms: Mesh[]) => {
    for (const m of ms) generateur?.addShadowCaster(m)
    generateur?.getShadowMap()?.resetRefreshCounter()
  }
  const couches = [
    toiles,
    monterFacade(scene, MUSEE, ciel.jour, base).then(ombrer, signaler('façade')),
    monterPortes(scene, accrochage, ciel.jour).then(ombrer, signaler('portes')),
    monterNef(scene, ciel.jour, generateur).catch(signaler('nef')),
    monterEscalier(scene, atlas, generateur, marches).catch(signaler('escalier')),
    // La lampe de la salle d'honneur et la SpotLight de l'éveil sont créées tout de suite : elles entrent dans la première compilation.
    monterSalleHonneur(scene, ciel.jour, atlas, generateur).catch(signaler('salle d’honneur')),
    monterBatllo(scene, generateur).catch(signaler('baie Batlló')),
    monterBelvedere(scene, ciel.jour, generateur).catch(signaler('belvédère')),
    // Le marcheur se relit sur la caméra (yeux à 1,62 m).
    monterEclairage(scene, accrochage, ciel.jour, lanterneaux, () => ({ x: camera.position.x, y: camera.position.y - 1.62, z: camera.position.z, yaw: camera.rotation.y }))
      .catch(signaler('éclairage')),
    atlas.catch(() => {}),
  ]
  if (import.meta.env.DEV) {
    // Pour les mesures headless ; l'instrumentation remet le compteur d'appels à zéro à chaque image.
    const instr = new SceneInstrumentation(scene)
    ;(window as unknown as { __BABYLON__?: unknown }).__BABYLON__ = { engine, scene, camera, instr }
  }
  engine.runRenderLoop(() => scene.render())
  // Tout arrivé et compilé : la carte d'ombre redessinée, les sondes prises, les matières figées
  // (sinon chacune repasse toute sa préparation à chaque image). Une couche d'une vague
  // suivante qui change une matière après coup la dégèle (`unfreeze`) ou s'ajoute à VIVANTES.
  await Promise.all(couches)
  await cartesChargees()
  await scene.whenReadyAsync()
  generateur?.getShadowMap()?.resetRefreshCounter()
  reflets.rafraichir()
  for (const m of scene.materials) if (!VIVANTES.has(m.name)) m.freeze()
}
