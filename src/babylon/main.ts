/**
 * Le musée en Babylon.js (entrée : src/main.ts) : le plan lu tel quel, sans
 * framework. Câblage seul : charge les données, monte les modules, lance la boucle.
 * Ordre : socle → soleil et ciel → visiteur → post-traitement → reflets → boîtes et parement → tri des salles →
 * couches du bâtiment (vague 1), de l'intérieur (vague 2), du jardin (vague 3), des rayons et de la météo (vague 4), chacune non bloquante : un GLB absent n'arrête
 * pas la visite. Tout arrivé, les sondes de reflets sont prises et les matières
 * figées (sauf celles qui vivent). L’interface (ui/, vague 5) se monte autour : chargement et billet avant le socle.
 */
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'

import config from '../../museum.config.json'
import { vrDisponible } from '../io/xr.ts'
import { qualiteDemandee } from '../domain/qualite.ts'
import type { Accrochage } from '../plan/hang.ts'
import { MUSEE } from '../plan/musee.ts'
import { choisirVitrines } from '../plan/vitrines.ts'

import { monterAccessoires } from './accessoires.ts'
import { monterAllees } from './allees.ts'
import { monterAteliers } from './ateliers.ts'
import { monterBatllo } from './batllo.ts'
import { BAVETTE, monterBavette } from './bavette.ts'
import { monterBelvedere } from './belvedere.ts'
import { monterBoites } from './boites.ts'
import { monterCiel } from './ciel.ts'
import { monterCartels } from './cartels.ts'
import { chargement, marquerPret, suivre } from './chargement.ts'
import { journalDuChantier, monterChantier } from './chantier.ts'
import { monterCimaises } from './cimaises.ts'
import { monterCloche } from './cloche.ts'
import { monterConstellation } from './constellation.ts'
import { monterContact } from './contact.ts'
import { monterDeparts } from './departs.ts'
import { monterEclairage } from './eclairage.ts'
import { monterEnceinte } from './enceinte.ts'
import { monterEscalier } from './escalier.ts'
import { catalogue, demarrerCycle, partie, recherche, reglages, vivant, VIVANTES } from './etat.ts'
import { monterFacade } from './facade.ts'
import { monterFaune } from './faune.ts'
import { monterFeuilles } from './feuilles.ts'
import { animerIntemperies } from './intemperies.ts'
import { monterJardin } from './jardin.ts'
import { monterLierre } from './lierre.ts'
import { reglerLueurs } from './lueurs.ts'
import { cartesChargees } from './matieres.ts'
import { enregistrerBrume, monterMeteo } from './meteo.ts'
import { monterMobilier } from './mobilier.ts'
import { monterMosaique } from './mosaique.ts'
import { monterNef } from './nef.ts'
import { monterParement } from './parement.ts'
import { monterPortes } from './portes.ts'
import { monterPostTraitement } from './postTraitement.ts'
import { monterProps } from './props.ts'
import { monterQualite } from './qualite.ts'
import { monterRayons } from './rayons.ts'
import { monterReflets } from './reflets.ts'
import { monterRelief } from './relief.ts'
import { monterRuisseau } from './ruisseau.ts'
import { monterSalleHonneur } from './salleHonneur.ts'
import { monterSculptures } from './sculptures.ts'
import { basculerSon, monterBoutonSon, monterSon, son } from './son.ts'
import { creerSocle } from './socle.ts'
import { fondrePorteurs, monterSoleil } from './soleil.ts'
import { monterToiles } from './toiles.ts'
import { monterVegetation } from './vegetation.ts'
import { monterVisibilite, retrier, toutMontrer } from './visibilite.ts'
import { departDuVisiteur, monterVisiteur } from './visiteur.ts'
import { monterVitrines } from './vitrines.ts'
import type { PorteVR } from './vr.ts'
import { monterAccueil } from './ui/accueil.ts'
import { monterCarteEtape } from './ui/carteEtape.ts'
import { monterEcranChargement } from './ui/ecranChargement.ts'
import { monterMinimap } from './ui/minimap.ts'
import { monterMobile } from './ui/mobile.ts'
import { monterOeuvre } from './ui/oeuvre.ts'
import { monterSucces } from './succes.ts'
import { monterCarnet } from './ui/carnet.ts'
import { monterReglages } from './ui/reglages.ts'
import { monterVisite } from './ui/visite.ts'
import { observer } from './ui/dom.ts'

export async function demarrer(racine: HTMLElement): Promise<void> {
  const toile = document.createElement('canvas')
  // `display: block`, sinon la ligne de base d'un canvas en ligne ajoute une barre de défilement.
  toile.style.cssText = 'display:block;width:100vw;height:100vh;touch-action:none'
  // À la place de l'écran statique d'index.html (fixe, il couvrirait la scène) ; l'interface (ui/) se monte ensuite à côté.
  racine.replaceChildren(toile)
  const base = import.meta.env.BASE_URL
  // L'écran de chargement et le billet d'accueil (ui/) : avant le socle, la visite en pause jusqu'au prêt.
  monterEcranChargement(racine)
  let accrochageCharge: Accrochage | null = null
  // La porte de la VR (vr.ts) arrive après le socle ; le billet l'attend pour proposer « En VR » (null : pas de VR ici).
  let ouvrirVR: (p: Pick<PorteVR, 'mode' | 'entrer'> | null) => void = () => {}
  const porteVR = new Promise<Pick<PorteVR, 'mode' | 'entrer'> | null>((ok) => (ouvrirVR = ok))
  monterAccueil(racine, toile, { accrochage: () => accrochageCharge, base, vr: porteVR })
  // La brume et l'éclair (meteo.ts) : greffés sur toute PBRMaterial créée ensuite.
  enregistrerBrume()
  const { engine, scene } = await creerSocle(toile)
  // La qualité adaptative (qualite.ts) : la densité posée tout de suite, le moniteur au point prêt.
  const qualite = monterQualite(engine, scene, () => qualiteDemandee(recherche()))

  // Le catalogue aussi (la même promesse que les couches) : les vitrines comptent pour le rendez-vous de `?p=`.
  const [accrochage, cat] = await suivre(Promise.all([
    fetch(`${base}data/accrochage.json`).then((r) => r.json() as Promise<Accrochage>).catch(() => null),
    catalogue(base),
  ]))
  accrochageCharge = accrochage
  // L'état vivant (etat.ts) : le ciel toutes les 30 s, la météo tous les quarts d'heure ; METEO lissée à chaque image (intemperies.ts).
  demarrerCycle()
  animerIntemperies(scene)
  const forcages = new URLSearchParams(recherche())
  // Le ciel du chargement, pour les montages ; chaque couche suit ensuite l'état vivant.
  const { ciel } = vivant.getState()

  // Soleil, ombres (soleil.ts) et dôme du ciel (ciel.ts), qui suivent l'heure.
  const { soleil, hemi, generateur } = monterSoleil(scene, ciel, forcages.get('ombres') !== '0')
  const ciel3d = monterCiel(scene)
  // Les lueurs des lieux (lueurs.ts) : un état partagé, chaque couche y branche ses matières (soleil.ts les suit ensuite).
  reglerLueurs(ciel.jour, hemi)
  const enVitrine = cat ? choisirVitrines(cat.artworks, cat.owners).map((a) => a.key) : null
  const depart = departDuVisiteur(MUSEE, accrochage, location.search, location.hash, config.owners, enVitrine)
  partie.setState({ rendezVous: depart.rendezVous })
  const camera = monterVisiteur(scene, toile, depart)
  // L'interface autour de la scène (ui/, son.ts) : le bouton son entre dans le groupe des réglages.
  monterSon(scene, camera)
  const interSon = { bouton: monterBoutonSon(), actif: () => son.getState().actif, basculer: basculerSon, abonner: (f: () => void) => son.subscribe(f) }
  // Le carnet de tampons (succes.ts, ui/carnet.ts) : les faits notés dès le compostage, le carnet à côté de la roue.
  monterSucces(accrochage, enVitrine?.length ?? 0)
  monterReglages(racine, { toile, son: interSon, carnet: monterCarnet(racine, toile) })
  monterMinimap(racine, accrochage, () => (BAVETTE.monte ? BAVETTE : null))
  monterOeuvre(racine, base)
  monterVisite(racine, accrochage)
  monterCarteEtape(racine, journalDuChantier(base))
  monterMobile(racine)
  // Le post-traitement HDR (postTraitement.ts) : avant toute matière, l'image processing quitte les matières pour la passe d'écran.
  monterPostTraitement(scene, camera, qualiteDemandee(recherche()) === 'basse')
  // La VR (vr.ts), en tâche de fond : sur un téléphone, vrDisponible charge le polyfill Cardboard (la visite n'attend pas).
  // Montée seulement si elle est possible ici, avec la marche (vrEntrees.ts, visiteur.ts) et le rendu par œil (vrRendu.ts).
  // Sur WebGPU (un téléphone : le socle n'a pris WebGL2 que pour un casque ou `?vr=`), le bouton recharge en `?vr=1`,
  // où le socle prend WebGL2 ; le visiteur le presse alors une seconde fois (la session exige un geste).
  vrDisponible().then(async (mode) => {
    if (!mode) return ouvrirVR(null)
    if (engine.isWebGPU) {
      return ouvrirVR({ mode, entrer: async () => {
        const u = new URL(location.href)
        u.searchParams.set('vr', '1')
        location.replace(u)
      } })
    }
    const vr = (await import('./vr.ts')).monterVR(scene, camera, mode)
    camera.brancherVR(vr)
    ;(await import('./vrEntrees.ts')).monterEntreesVR(scene, vr)
    ;(await import('./vrRendu.ts')).monterRenduVR(scene, vr)
    ouvrirVR(vr)
  }).catch((e: unknown) => console.error('VR indisponible', e))
  // En VR, l'interface DOM se retire sans être démontée (App.tsx) : `[data-vr]` sur la racine (CSS de ui/).
  observer(partie, (s) => s.enVR, (v) => racine.toggleAttribute('data-vr', v))
  // Les reflets (reflets.ts) : une sonde par salle, l'environnement posé avant la première compilation.
  const reflets = monterReflets(scene, MUSEE, () => camera.walker(), ciel3d)
  // Le marcheur relu sur la caméra (yeux à 1,62 m), pour les couches qui regardent ce qu'il regarde.
  const visiteur = () => ({ x: camera.position.x, y: camera.position.y - 1.62, z: camera.position.z, yaw: camera.rotation.y })
  // Boîtes du plan et lightmap (boites.ts) : la force du jour du chargement, comme three.
  // ponytail : l'atlas n'est pas recuit quand l'heure passe (écart ≤ 25 %) ; refaire tableDeLumiere sur auCiel si ça se voit.
  const { porteurs, atlas, marches, lanterneaux } = monterBoites(scene, MUSEE, { force: 0.75 + 0.25 * ciel.jour, hemi })
  // Parement (parement.ts), cimaises (cimaises.ts) et accessoires (accessoires.ts) : synchrones, dans la première carte d'ombre.
  // Les meubles posés au sol, pour leurs ombres de contact (contact.ts).
  const meubles: Mesh[] = monterCimaises(scene, MUSEE)
  porteurs.push(...monterParement(scene, MUSEE, atlas), ...meubles, ...monterAccessoires(scene))
  for (const m of porteurs) generateur.addShadowCaster(m)
  // Le tri entre salles (visibilite.ts) : tôt, il prend chaque maillage qui arrive.
  const { lieuDe } = monterVisibilite(scene, camera, MUSEE)
  const signaler = (quoi: string) => (e: unknown) => console.error(`${quoi} indisponible`, e)

  // Les couches du bâtiment, sans les attendre. Les porteurs arrivés après la
  // première carte d'ombre la font redessiner.
  const ombrer = (ms: Mesh[]) => {
    for (const m of ms) generateur.addShadowCaster(m)
    generateur.getShadowMap()?.resetRefreshCounter()
  }
  const meuble = (ms: Mesh[]) => (meubles.push(...ms), ombrer(ms))
  // Les couches calculées sur le fil (100 à 400 ms chacune : relief, allées, feuilles, lierre, enceinte) :
  // une par tâche, chacune après une image dessinée, pour que la visite s'affiche et ne fige pas d'un bloc.
  let file: Promise<unknown> = Promise.resolve()
  const apresUneImage = <T>(f: () => T | Promise<T>): Promise<T> => {
    const p = file.then(() => new Promise<T>((ok, ko) => scene.onAfterRenderObservable.addOnce(() => setTimeout(() => Promise.resolve().then(f).then(ok, ko)))))
    file = p.catch(() => {})
    return p
  }
  const couches = [
    accrochage ? monterToiles(scene, accrochage, base).then(ombrer, signaler('toiles')) : null,
    monterFacade(scene, MUSEE, base).then(ombrer, signaler('façade')),
    monterPortes(scene, accrochage).then(ombrer, signaler('portes')),
    monterNef(scene, generateur).catch(signaler('nef')),
    monterEscalier(scene, atlas, generateur, marches).catch(signaler('escalier')),
    // La lampe de la salle d'honneur et la SpotLight de l'éveil sont créées tout de suite : elles entrent dans la première compilation.
    monterSalleHonneur(scene, atlas, generateur).catch(signaler('salle d’honneur')),
    monterBatllo(scene, generateur).catch(signaler('baie Batlló')),
    monterBelvedere(scene, generateur).catch(signaler('belvédère')),
    monterEclairage(scene, accrochage, lanterneaux, visiteur).catch(signaler('éclairage')),
    // Vague 2 : l'intérieur.
    monterMobilier(scene).then(meuble, signaler('mobilier')),
    monterProps(scene, accrochage).then(meuble, signaler('props')),
    monterVitrines(scene, base, visiteur).then(meuble, signaler('vitrines')),
    monterSculptures(scene, base).then(meuble, signaler('sculptures')),
    accrochage ? monterCartels(scene, accrochage, base).then(ombrer, signaler('cartels')) : null,
    monterMosaique(scene, base).then(ombrer, signaler('mosaïque')),
    monterDeparts(scene, accrochage, base).then(ombrer, signaler('départs')),
    monterCloche(scene, base).then(ombrer, signaler('cloche')),
    monterAteliers(scene, base).then(ombrer, signaler('ateliers')),
    monterConstellation(scene, accrochage, base).catch(signaler('constellation')),
    monterChantier(scene, base, camera).then(ombrer, signaler('chantier')),
    // Vague 3 : le jardin. La faune et Bavette s'animent sans cesse : jamais dans la carte d'ombre (bavette.ts).
    apresUneImage(() => monterRelief(scene, camera)).then(ombrer, signaler('relief')),
    apresUneImage(() => monterEnceinte(scene)).then(ombrer, signaler('enceinte')),
    apresUneImage(() => monterAllees(scene)).then(ombrer, signaler('allées')),
    monterVegetation(scene).then(ombrer, signaler('végétation')),
    apresUneImage(() => monterFeuilles(scene)).catch(signaler('feuilles mortes')),
    monterJardin(scene).then(ombrer, signaler('jardin')),
    monterRuisseau(scene).then(ombrer, signaler('ruisseau')),
    monterFaune(scene, camera).catch(signaler('faune')),
    monterBavette(scene, camera).catch(signaler('bavette')),
    apresUneImage(() => monterLierre(scene)).then(ombrer, signaler('lierre')),
    // Vague 4 : les rayons de la nef et la météo (jamais dans la carte d'ombre).
    Promise.resolve().then(() => monterRayons(scene)).catch(signaler('rayons')),
    Promise.resolve().then(() => monterMeteo(scene, camera)).catch(signaler('météo')),
    atlas.catch(() => {}),
  ].map((p) => (p ? suivre<unknown>(p) : p))
  if (import.meta.env.DEV) {
    // Pour les mesures headless ; l'instrumentation remet le compteur d'appels à zéro à chaque image.
    const instr = new SceneInstrumentation(scene)
    ;(window as unknown as { __BABYLON__?: unknown }).__BABYLON__ = { engine, scene, camera, instr, reprendre: () => partie.setState({ paused: false }) }
  }
  engine.runRenderLoop(() => scene.render())
  // Tout arrivé et compilé : la carte d'ombre redessinée, les sondes prises, les matières figées
  // (sinon chacune repasse toute sa préparation à chaque image). Une couche d'une vague
  // suivante qui change une matière après coup la dégèle (`unfreeze`) ou s'ajoute à VIVANTES (etat.ts).
  await Promise.all(couches)
  monterContact(scene, meubles)
  await suivre(cartesChargees())
  // Un lot vide pour l'instant (sujets au loin, `cacherAuLoin`) se compilerait sans ses instances : la variante
  // à instances (caméra et carte d'ombre) attendrait sa première apparition, en pleine marche (~200 ms à 43 m de la façade).
  for (const m of scene.meshes as Mesh[]) {
    if (m.thinInstanceCount !== 0 || !m._thinInstanceDataStorage?.matrixData) continue
    m.thinInstanceCount = 1
    m.isReady(true)
    m.thinInstanceCount = 0
  }
  await scene.whenReadyAsync()
  chargement.setState({ etape: 'finition' })
  // Les porteurs immobiles fondus par case (soleil.ts), sur les lots complets : la carte d'ombre en un appel par case.
  // Ombres éteintes : seulement si le réglage les allume en cours de visite.
  const fondre = () => (toutMontrer(), fondrePorteurs(scene, generateur, lieuDe), retrier())
  if (soleil.shadowEnabled) fondre()
  else {
    const fin = reglages.subscribe(() => soleil.shadowEnabled && (fin(), fondre()))
  }
  reflets.rafraichir()
  for (const m of scene.materials) if (!VIVANTES.has(m.name)) m.freeze()
  // Prêt une fois les sondes prises et 3 images dessinées : plus de rafale de compilation sous les pas.
  await reflets.prises()
  await new Promise<void>((ok) => {
    let n = 0
    const o = scene.onAfterRenderObservable.add(() => { if (++n === 3) { scene.onAfterRenderObservable.remove(o); ok() } })
  })
  marquerPret()
  // La qualité adaptative, seulement une fois prêt (les compilations du chargement fausseraient la mesure).
  qualite.demarrer()
}
