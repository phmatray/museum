/**
 * La séance du cinéma : la dernière vidéo de la chaîne (`public/data/cinema.json`),
 * jouée sur la toile 3D comme si elle y était projetée.
 *
 * YouTube ne se lit pas en texture (CORS, et ses conditions l'interdisent) : le
 * lecteur intégré (un iframe) est un `HtmlMesh` (@babylonjs/addons), posé SOUS le
 * canevas et placé par le CSS 3D du `HtmlMeshRenderer` sur le plan de la toile.
 * Le canevas le laisse voir par un trou : le masque du HtmlMesh, un plan juste
 * devant la toile, écrit la profondeur et un alpha nul ; tout ce qui passe devant
 * (fauteuils, têtes, balustrade) le recouvre. L'alpha traverse la chaîne HDR (AO,
 * miroir, bloom, tons gardent l'alpha de la scène) et l'étalonnage (postTraitement.ts)
 * en fait le trou du canevas (prémultiplié, comme le composite de la page).
 * La visite continue pendant la séance (`partie.seance`) : on marche, on s'assied.
 *
 * Le masque du HtmlMesh d'origine coupe l'écriture de couleur : il laisse alors la
 * couleur d'effacement (opaque) dans la cible HDR. Le nôtre écrit (0, 0, 0, 0), en
 * alpha-test pour que le prepass garde sa profondeur et ses normales (AO, rayons).
 *
 * `lancer` vient d'un geste (touche, bouton) : il en faut un pour le son. `finir` :
 * Entrée de nouveau ou le bouton de la salle, la sortie de la salle (cinema.ts) ou la pause.
 * Le lecteur ne prend pas le pointeur (la marche le garde) ; pas de VR (HtmlMesh n'y existe pas) : la séance s'y arrête.
 */
import { HtmlMesh } from '@babylonjs/addons/htmlMesh/htmlMesh'
import { HtmlMeshRenderer } from '@babylonjs/addons/htmlMesh/htmlMeshRenderer'
import { Material } from '@babylonjs/core/Materials/material'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { lecteur, type Seance } from '../domain/cinema.ts'
import { partie } from './etat.ts'
import { el } from './ui/dom.ts'
import { greffer } from './greffe.ts'
import './ui/seance.css'

/** La toile : ses coins en monde, haut-gauche, haut-droit, bas-droit, bas-gauche (vus de la salle). */
export type Coins = readonly [Vector3, Vector3, Vector3, Vector3]

/** Le masque, devant la toile (vers la salle, +z) : sans ce décalage, toile et masque se disputent le même plan. */
const DEVANT = 0.01

export interface Seances {
  lancer(): void
  finir(): void
}

/** Le trou du canevas : profondeur écrite, couleur et alpha nuls. */
function masque(scene: Scene): StandardMaterial {
  const m = new StandardMaterial('seance:masque', scene)
  m.disableLighting = true
  m.backFaceCulling = false
  m.transparencyMode = Material.MATERIAL_ALPHATEST
  greffer(m, { nom: 'TrouSeance', code: (wgsl) => ({ fragment: { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: wgsl ? 'color = vec4f(0.0);' : 'color = vec4(0.0);' } }) })
  return m
}

export function monterSeance(
  scene: Scene,
  coins: Coins,
  programme: Seance | null,
  effets: { debut(): void; fin(): void } = { debut() {}, fin() {} },
): Seances {
  const largeur = Vector3.Distance(coins[0], coins[1])
  const hauteur = Vector3.Distance(coins[0], coins[3])
  const centre = coins[0].add(coins[2]).scaleInPlace(0.5)
  const titre = programme ? `${programme.titre} — ${programme.chaine}` : 'Séance'
  let mat: StandardMaterial | null = null
  let rendu: HtmlMeshRenderer | null = null
  let toile: HtmlMesh | null = null

  const finir = () => {
    if (!partie.getState().seance) return
    // Le maillage emporte l'iframe (la lecture s'arrête) ; le moteur CSS, ses conteneurs et son observateur.
    toile?.dispose()
    rendu?.dispose()
    toile = rendu = null
    effets.fin()
    partie.setState({ seance: false })
  }
  const lancer = () => {
    if (!programme || partie.getState().seance || partie.getState().enVR) return
    partie.setState({ seance: true })
    // ponytail: le moteur CSS n'existe que pendant la séance (il retrie le groupe 0 et suit la caméra à chaque image).
    rendu = new HtmlMeshRenderer(scene)
    toile = new HtmlMesh(scene, 'seance-toile', { captureOnPointerEnter: false })
    toile.isPickable = false
    toile.material?.dispose()
    toile.material = mat ??= masque(scene)
    toile.position.set(centre.x, centre.y, centre.z + DEVANT)
    // Le plan regarde −z : retourné, il fait face à la salle (comme la toile, cinema.ts).
    toile.rotation.y = Math.PI
    const film = el('iframe', {
      class: 'seance-film', src: lecteur(programme.video), title: titre,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
    })
    toile.setContent(film, largeur, hauteur)
    effets.debut()
  }
  // La pause (Échap, le billet) ou la VR, qui reprend la caméra : la séance s'arrête.
  partie.subscribe((s, a) => { if ((s.paused && !a.paused) || (s.enVR && !a.enVR)) finir() })
  return { lancer, finir }
}
