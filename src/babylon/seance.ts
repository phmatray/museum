/**
 * La séance du cinéma : la dernière vidéo de la chaîne (`public/data/cinema.json`),
 * jouée sur la toile 3D comme si elle y était projetée.
 *
 * YouTube ne se lit pas en texture (CORS, et ses conditions l'interdisent) : le
 * lecteur intégré (un iframe) est posé AU-DESSUS du canevas, déformé à chaque
 * image par une homographie (`domain/projection.ts`, en `matrix3d` CSS) pour
 * épouser exactement les quatre coins projetés de la toile. La caméra ne bouge
 * pas pendant la séance (la visite est en pause, `partie.seance` : pas de billet),
 * le regard peut encore tourner : la projection suit.
 *
 * `lancer` vient d'un geste (clic sur la toile, touche) : il en faut un pour le son.
 * « Quitter la séance » (ou Échap, quand le lecteur n'a pas le clavier) rend la main.
 */
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { Scene } from '@babylonjs/core/scene'

import { lecteur, type Seance } from '../domain/cinema.ts'
import { matrice3d, type Point } from '../domain/projection.ts'
import { partie } from './etat.ts'
import { el } from './ui/dom.ts'
import './ui/seance.css'

/** La toile : ses coins en monde, haut-gauche, haut-droit, bas-droit, bas-gauche (vus de la salle). */
export type Coins = readonly [Vector3, Vector3, Vector3, Vector3]

/** La taille de travail du lecteur (px) : grande pour un texte net, ramenée par la matrice. */
const LARGEUR = 1600

export interface Seances {
  lancer(): void
  finir(geste: boolean): void
}

export function monterSeance(
  scene: Scene,
  camera: FreeCamera,
  toile: HTMLCanvasElement,
  racine: HTMLElement,
  coins: Coins,
  programme: Seance | null,
  effets: { debut(): void; fin(): void } = { debut() {}, fin() {} },
): Seances {
  const rapport = Vector3.Distance(coins[0], coins[3]) / Vector3.Distance(coins[0], coins[1])
  const hauteur = Math.round(LARGEUR * rapport)
  const film = el('iframe', {
    class: 'seance-film', width: LARGEUR, height: hauteur, title: programme ? `${programme.titre} — ${programme.chaine}` : 'Séance',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
  })
  film.style.width = `${LARGEUR}px`
  film.style.height = `${hauteur}px`
  const quitter = el('button', { type: 'button', class: 'seance-quitter' }, 'Quitter la séance')
  const salle = el('div', { class: 'seance', hidden: true, role: 'dialog', 'aria-label': programme ? `Séance : ${programme.titre}` : 'Séance' }, film, quitter)
  racine.append(salle)

  let reprendre = false
  const ecran: Point[] = [[0, 0], [0, 0], [0, 0], [0, 0]]
  const p = new Vector3()

  const poser = () => {
    const l = toile.clientWidth
    const h = toile.clientHeight
    const vue = camera.viewport.toGlobal(l, h)
    const transformee = scene.getTransformMatrix()
    for (let i = 0; i < 4; i++) {
      Vector3.ProjectToRef(coins[i], Matrix.IdentityReadOnly, transformee, vue, p)
      // Derrière l'œil (z hors de [0, 1]) : rien de juste à montrer.
      if (p.z < 0 || p.z > 1) {
        film.style.visibility = 'hidden'
        return
      }
      ecran[i] = [p.x, p.y]
    }
    const m = matrice3d(LARGEUR, hauteur, ecran as [Point, Point, Point, Point])
    film.style.visibility = m ? 'visible' : 'hidden'
    if (m) film.style.transform = m
  }
  const suivre = scene.onAfterCameraRenderObservable

  let observateur: ReturnType<typeof suivre.add> | null = null
  const finir = (geste: boolean) => {
    if (!partie.getState().seance) return
    film.src = 'about:blank'
    salle.hidden = true
    if (observateur) suivre.remove(observateur)
    observateur = null
    effets.fin()
    if (geste && reprendre) {
      // Le clic qui referme est un geste : le navigateur rend la souris.
      Promise.resolve(toile.requestPointerLock?.()).catch(() => {})
      partie.setState({ seance: false, paused: false })
    } else partie.setState({ seance: false })
    reprendre = false
  }
  const lancer = () => {
    if (!programme || partie.getState().seance || partie.getState().enVR) return
    reprendre = !!document.pointerLockElement
    partie.setState({ seance: true, paused: true })
    if (reprendre) document.exitPointerLock()
    film.src = lecteur(programme.video)
    salle.hidden = false
    poser()
    observateur = suivre.add(poser)
    effets.debut()
  }
  quitter.addEventListener('click', () => finir(true))
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && partie.getState().seance) {
      e.stopPropagation()
      finir(false)
    }
  }, true)
  // La VR reprend la caméra : la séance s'arrête.
  partie.subscribe((s, a) => { if (s.enVR && !a.enVR) finir(false) })
  return { lancer, finir }
}
