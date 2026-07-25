/**
 * LOT 3 — La visite guidée.
 *
 * Ce composant ne décide RIEN de l'itinéraire : il consomme `buildTour(museum)`,
 * qui est pur et testé sans canvas. Ici il ne reste que du mouvement — une
 * spline, une horloge, une orientation — c'est-à-dire précisément ce qu'aucun
 * test unitaire ne peut juger et ce qu'un œil juge en trois secondes.
 *
 * ── Une spline, pas des segments ──
 *
 * Relier les arrêts par des droites donne un mouvement de robot : arrêt net,
 * repartir dans une autre direction, recommencer. Une `CatmullRomCurve3` passe
 * exactement par chaque arrêt (`getPoint(i / (n − 1))` rend le i-ème point de
 * contrôle) tout en arrondissant les angles, ce qui est exactement le contrat
 * qu'il nous faut : les arrêts restent des arrêts, le chemin entre eux respire.
 * Le type `centripetal` est choisi pour la même raison qu'en animation : il ne
 * produit ni boucle ni dépassement quand deux arrêts sont très proches — un
 * `uniform` fait sortir la caméra du bâtiment sur un virage serré.
 *
 * ── La vitesse est en mètres par seconde, pas en `t` par seconde ──
 *
 * Avancer `t` linéairement traverserait un couloir de 2 m et un palier de 20 m
 * dans le même temps. On mesure donc la longueur d'arc de chaque segment une
 * fois pour toutes, et on en déduit sa durée.
 *
 * ── L'orientation est amortie, pas interpolée ──
 *
 * On interpole la CIBLE (linéairement d'un `lookAt` à l'autre) et on amortit la
 * rotation vers elle avec un facteur `1 − exp(−k·dt)`, indépendant de la
 * fréquence d'images : à 30 comme à 144 im/s, la caméra tourne à la même
 * vitesse apparente. Un `lookAt` sec à chaque image donnerait des à-coups à
 * chaque changement d'arrêt.
 */
import { use, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { buildTour, type TourStop } from '../domain/tour'
import { museumResource } from '../io/loadMuseum'
import { useGameStore } from '../stores/gameStore'

export type { TourStop } from '../domain/tour'

export interface GuidedTourProps {
  /**
   * Itinéraire imposé. Absent — le cas normal — il est DÉRIVÉ du musée chargé.
   * Un tableau vide vaut absence : une liste sans étape ne décrit pas une
   * visite, elle décrit l'oubli d'en fournir une.
   */
  stops?: TourStop[]
  onComplete: () => void
}

/** Vitesse de déplacement de la caméra, en mètres par seconde. Une marche calme. */
const SPEED = 2.4

/**
 * Vitesse de convergence du regard, en s⁻¹.
 *
 * 3,5 amène la caméra sur sa cible en un demi-tiers de seconde environ : assez
 * vif pour ne pas donner l'impression d'un retard, assez mou pour que le
 * changement d'arrêt ne soit pas un à-coup.
 */
const ORIENT_RATE = 3.5

/** Subdivisions par segment pour mesurer sa longueur d'arc. */
const ARC_SAMPLES = 16

const _cible = new THREE.Vector3()
const _regard = new THREE.Object3D()

interface Parcours {
  courbe: THREE.CatmullRomCurve3
  /** Longueur d'arc de chaque segment `i → i+1`, en mètres. */
  longueurs: number[]
  /** Les points visés, dans l'ordre des arrêts. */
  regards: THREE.Vector3[]
}

export function GuidedTour({ stops, onComplete }: GuidedTourProps) {
  const museum = use(museumResource())
  const { camera } = useThree()
  const tourActive = useGameStore((s) => s.tourActive)

  // L'itinéraire ne dépend que du musée : il se calcule une fois, pas à chaque
  // image ni à chaque bascule de la visite.
  const itineraire = useMemo(
    () => (stops !== undefined && stops.length > 0 ? stops : buildTour(museum)),
    [stops, museum],
  )
  const parcours = useMemo(() => tracer(itineraire), [itineraire])

  const etape = useRef(0)
  const avance = useRef(0)
  const attente = useRef(0)
  const enPause = useRef(true)
  const active = useRef(false)
  const termine = useRef(false)

  useFrame((_, delta) => {
    if (!tourActive) {
      active.current = false
      // On réarme aussi le drapeau de fin : sans cela, une visite sans étape
      // rendrait la main une seule fois dans la vie de la page, et le second
      // clic sur « visite guidée » figerait le joueur pour de bon.
      termine.current = false
      return
    }

    // Rien à montrer : on rend la main IMMÉDIATEMENT. Sortir en silence
    // laisserait `tourActive` à vrai, c'est-à-dire un joueur figé — le `Player`
    // se coupe pendant une visite — dans une visite qui ne commence jamais.
    if (itineraire.length === 0 || parcours === null) {
      if (!termine.current) {
        termine.current = true
        onComplete()
      }
      return
    }

    // Réinitialisation SYNCHRONE au démarrage : un `useEffect` s'exécute après
    // le premier `useFrame`, qui verrait donc l'état de la visite précédente.
    if (!active.current) {
      active.current = true
      termine.current = false
      etape.current = 0
      avance.current = 0
      attente.current = 0
      enPause.current = true
      poser(camera, parcours.courbe.getPoint(0), parcours.regards[0], 1)
      return
    }

    const dernier = itineraire.length - 1

    if (enPause.current) {
      attente.current += delta
      // On continue d'amortir le regard pendant la pause : c'est là que la
      // caméra achève de se tourner vers le mur qu'elle vient d'atteindre.
      viser(camera, parcours.regards[etape.current], delta)
      if (attente.current < itineraire[etape.current].pauseDuration) return

      attente.current = 0
      if (etape.current >= dernier) {
        active.current = false
        termine.current = true
        onComplete()
        return
      }
      enPause.current = false
      avance.current = 0
      return
    }

    const i = etape.current
    const longueur = Math.max(parcours.longueurs[i], 1e-3)
    avance.current += (delta * SPEED) / longueur
    const arrive = avance.current >= 1
    const local = arrive ? 1 : avance.current

    const t = (i + local) / dernier
    camera.position.copy(parcours.courbe.getPoint(t))

    // La cible glisse d'un point visé à l'autre en douceur (lissage cubique) :
    // sans lui, le regard se met à tourner dès le premier centimètre parcouru
    // et quitte l'œuvre qu'on est censé être en train de regarder.
    _cible.lerpVectors(parcours.regards[i], parcours.regards[i + 1], adoucir(local))
    viser(camera, _cible, delta)

    if (arrive) {
      etape.current = i + 1
      avance.current = 0
      enPause.current = true
      attente.current = 0
    }
  })

  return null
}

// ── Géométrie du parcours ────────────────────────────────────────────────

/**
 * Prépare la spline et ses longueurs d'arc.
 *
 * `null` sous deux arrêts : une courbe a besoin de deux points, et une visite à
 * un seul arrêt se traite comme un cadrage fixe (voir plus bas).
 */
function tracer(stops: TourStop[]): Parcours | null {
  if (stops.length === 0) return null

  const points = stops.map((s) => new THREE.Vector3(s.position.x, s.position.y, s.position.z))
  const regards = stops.map((s) => new THREE.Vector3(s.lookAt.x, s.lookAt.y, s.lookAt.z))

  // Un seul arrêt : la « courbe » est ce point, répété. La caméra s'y pose et y
  // reste le temps de la pause, ce qui est exactement la visite d'un musée
  // d'une salle.
  if (points.length === 1) {
    return {
      courbe: new THREE.CatmullRomCurve3([points[0], points[0].clone()], false, 'centripetal'),
      longueurs: [0],
      regards: [regards[0], regards[0]],
    }
  }

  const courbe = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const longueurs: number[] = []
  const n = points.length - 1
  const _a = new THREE.Vector3()
  const _b = new THREE.Vector3()

  for (let i = 0; i < n; i++) {
    let total = 0
    courbe.getPoint(i / n, _a)
    for (let k = 1; k <= ARC_SAMPLES; k++) {
      courbe.getPoint((i + k / ARC_SAMPLES) / n, _b)
      total += _a.distanceTo(_b)
      _a.copy(_b)
    }
    longueurs.push(total)
  }

  return { courbe, longueurs, regards }
}

/** Lissage cubique classique : départ et arrivée sans à-coup. */
function adoucir(t: number): number {
  return t * t * (3 - 2 * t)
}

/**
 * Oriente la caméra vers `cible`, en amortissant.
 *
 * `1 − exp(−k·dt)` et non `k·dt` : le premier est invariant par changement de
 * fréquence d'images (deux demi-pas valent un pas entier), le second ne l'est
 * pas et fait tourner la caméra plus vite sur une machine rapide.
 */
function viser(camera: THREE.Camera, cible: THREE.Vector3, delta: number): void {
  poser(camera, null, cible, 1 - Math.exp(-ORIENT_RATE * delta))
}

/**
 * Pose la caméra : position (si fournie) et orientation, avec un poids de 1 pour
 * un placement sec.
 *
 * On passe par un objet intermédiaire plutôt que par `camera.lookAt` : ce
 * dernier écrase l'orientation, alors qu'ici on veut interpoler DEPUIS
 * l'orientation courante — sinon la caméra pivote instantanément au démarrage,
 * depuis là où le joueur regardait, ce qui donne un à-coup violent.
 */
function poser(
  camera: THREE.Camera,
  position: THREE.Vector3 | null,
  cible: THREE.Vector3,
  poids: number,
): void {
  if (position !== null) camera.position.copy(position)
  _regard.position.copy(camera.position)
  _regard.up.copy(camera.up)
  _regard.lookAt(cible)
  if (poids >= 1) camera.quaternion.copy(_regard.quaternion)
  else camera.quaternion.slerp(_regard.quaternion, poids)
}
