/**
 * LOT 3 — La couche des cartels (spec § 9.3, US-2.4).
 *
 * Cent œuvres, seize cartels. Ce composant est l'intermédiaire entre les deux :
 * à chaque évaluation il demande à `domain/cartels.ts` quelles œuvres sont assez
 * proches pour mériter une étiquette, réaffecte le pool en conséquence, et
 * désigne l'unique œuvre que le visiteur regarde d'assez près pour avoir droit
 * au panneau détaillé.
 *
 * Il ne DÉCIDE rien lui-même : les seuils, l'ordre, les départages d'égalité et
 * la règle d'affectation vivent dans `domain/`, où ils se testent sans canvas.
 * Ce qui appartient en propre à ce fichier, c'est ce qui n'existe que pour
 * l'écran : quand ré-évaluer, et comment ne pas re-rendre React pour rien.
 *
 * ── Les trois freins, du moins cher au plus cher ──
 *
 *  1. CADENCE. La sélection ne tourne pas à 60 Hz mais à 10 Hz. À 1,4 m/s — la
 *     vitesse de marche du contrôleur — cent millisecondes valent 14 cm : très
 *     en dessous de la marge d'hystérésis de 60 cm, donc invisible.
 *  2. IMMOBILITÉ. Un visiteur arrêté ne change rien à la sélection ; on compare
 *     position et direction à la dernière évaluation et on s'arrête là.
 *  3. IDENTITÉ. Même quand la sélection est recalculée, elle est presque
 *     toujours identique à la précédente. On ne pousse un état React que si le
 *     tableau d'affectation a VRAIMENT changé — sinon les seize `Text` se
 *     re-synchroniseraient pour rien, et c'est la re-vectorisation des glyphes
 *     qui coûte, pas le draw call.
 *
 * ── Budget, MESURÉ ──
 *
 * Plafond théorique : 16 cartels d'un bloc de texte chacun, plus 3 pour le
 * panneau (plaque, en-tête, corps), soit 19 draw calls si tout était visible en
 * même temps. Mesuré sur le musée réel, au point le plus dense du bâtiment
 * (`etage-1-south-1`, 13 œuvres à moins de 6 m), en balayant les 360° :
 *
 *   draw calls        1 à 8 selon l'orientation, 8 au pire
 *   programmes        2 (le SDF de troika, et le matériau de la plaque)
 *   triangles         ≤ 760
 *
 * L'écart au plafond vient du frustum : le visiteur ne voit jamais les quatre
 * murs à la fois, et les cartels hors champ ne sont pas dessinés. Les cases
 * inoccupées, elles, sont carrément invisibles et ne coûtent rien.
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

import { WALL_THICKNESS } from '../builders/wall'
import {
  CARTEL_POOL_SIZE,
  assignSlots,
  cartelText,
  collectCartels,
  panelText,
  selectFocused,
  selectNearestCartels,
} from '../domain/cartels'
import type { CartelSpec, PanelText } from '../domain/cartels'
import type { Museum, RepoKey } from '../domain/types'
import { Cartel, CartelPanel } from './Cartel'

// ── Réglages de la couche ────────────────────────────────────────────────

/** Relief du texte par rapport à la face visible du mur, en mètres. */
const CARTEL_RELIEF = 0.004

/** Période d'évaluation de la sélection, en secondes. */
const EVAL_PERIOD = 0.1

/** Déplacement en deçà duquel une ré-évaluation ne peut rien changer (m²). */
const MOVE_EPS_SQ = 0.02 * 0.02

/** Rotation en deçà de laquelle le cône de regard n'a pas bougé. */
const TURN_COS = Math.cos(0.01)

/** Panneau vide : évite d'avoir à démonter le composant entre deux œuvres. */
const PANEL_VIDE: PanelText = { heading: '', body: '' }

// Vecteurs de travail, alloués UNE fois au niveau du module : `useFrame` tourne
// 60 fois par seconde, et trois `new THREE.Vector3()` par image suffisent à
// nourrir le ramasse-miettes jusqu'au hoquet visible.
const oeil = new THREE.Vector3()
const regard = new THREE.Vector3()

export interface CartelLayerProps {
  museum: Museum
  /** Nombre de `Text` maintenus montés. Défaut : `CARTEL_POOL_SIZE`. */
  poolSize?: number
}

/**
 * Ce que le pool affiche à un instant donné.
 *
 * DEUX listes et non une, et c'est la seule subtilité de ce composant : `keys`
 * dit qui est ALLUMÉ, `posees` dit qui est POSÉ. Une œuvre qui sort du champ
 * quitte `keys` mais reste dans `posees` jusqu'à ce que sa case soit reprise par
 * une autre. Sans cette distinction, une case libérée verrait son cartel sauter
 * hors du bâtiment et son texte se vider à l'instant même où le fondu de sortie
 * commence : il n'y aurait plus rien à estomper, et le cartel disparaîtrait d'un
 * coup. Le même mécanisme vaut pour le panneau, où US-2.4 l'exige explicitement.
 */
interface Affectation {
  /** Une case par emplacement du pool ; `null` = case éteinte. */
  keys: (RepoKey | null)[]
  /** Ce que chaque case PORTE, y compris pendant son extinction. */
  posees: (RepoKey | null)[]
  /** Œuvre détaillée par le panneau de proximité, ou `null` s'il se referme. */
  focusKey: RepoKey | null
  /** Dernière œuvre détaillée, conservée le temps du fondu. */
  focusPosee: RepoKey | null
}

export function CartelLayer({ museum, poolSize = CARTEL_POOL_SIZE }: CartelLayerProps) {
  // Dérivé du bâtiment, pas du point de vue : calculé une fois, jamais recalculé
  // tant que le musée ne change pas. L'épaisseur réelle du mur vient de
  // `builders/wall.ts`, seule source de vérité — `domain/` ne peut pas
  // l'importer sans traîner `three` dans un dossier qui doit rester pur.
  const specs = useMemo(
    () => collectCartels(museum, WALL_THICKNESS + CARTEL_RELIEF),
    [museum],
  )
  const parCle = useMemo(() => {
    const index = new Map<RepoKey, CartelSpec>()
    for (const spec of specs) index.set(spec.key, spec)
    return index
  }, [specs])

  const [affectation, setAffectation] = useState<Affectation>(() => ({
    keys: new Array<RepoKey | null>(poolSize).fill(null),
    posees: new Array<RepoKey | null>(poolSize).fill(null),
    focusKey: null,
    focusPosee: null,
  }))

  // Miroir de l'état, tenu à jour EN MÊME TEMPS que lui et lu depuis
  // `useFrame`. L'état React seul n'y suffirait pas : la boucle de rendu voit la
  // valeur du dernier rendu commité, donc une évaluation en retard, ce qui
  // suffirait à réaffecter deux fois le même cartel.
  const courant = useRef(affectation)

  const horloge = useRef(0)
  const evalue = useRef(false)
  const dernierOeil = useRef(new THREE.Vector3())
  const dernierRegard = useRef(new THREE.Vector3())

  useFrame(({ camera }, delta) => {
    horloge.current += delta
    if (horloge.current < EVAL_PERIOD) return
    horloge.current = 0

    camera.getWorldPosition(oeil)
    camera.getWorldDirection(regard)

    // Immobile et regard fixe : la sélection ne peut pas avoir changé.
    if (
      evalue.current &&
      oeil.distanceToSquared(dernierOeil.current) < MOVE_EPS_SQ &&
      regard.dot(dernierRegard.current) > TURN_COS
    ) {
      return
    }
    evalue.current = true
    dernierOeil.current.copy(oeil)
    dernierRegard.current.copy(regard)

    const affichees = new Set<RepoKey>()
    for (const key of courant.current.keys) if (key !== null) affichees.add(key)

    const proches = selectNearestCartels(specs, oeil, {
      limit: poolSize,
      previous: affichees,
    })

    // Le panneau ne cherche que parmi les cartels retenus : il porte plus loin
    // (2,5 m) que la sélection ne coupe (6 m), l'œuvre regardée en fait donc
    // forcément partie, et on économise le parcours des cent œuvres.
    const focus = selectFocused(proches, oeil, regard, {
      previousKey: courant.current.focusKey,
    })

    const keys = assignSlots(
      courant.current.keys,
      proches.map((spec) => spec.key),
      poolSize,
    )
    const focusKey = focus?.key ?? null

    // Une case éteinte conserve son occupant précédent : c'est lui qui s'estompe.
    const posees = keys.map((key, i) => key ?? courant.current.posees[i] ?? null)
    const focusPosee = focusKey ?? courant.current.focusPosee

    if (
      identique(keys, courant.current.keys) &&
      identique(posees, courant.current.posees) &&
      focusKey === courant.current.focusKey &&
      focusPosee === courant.current.focusPosee
    ) {
      return
    }
    const suivant: Affectation = { keys, posees, focusKey, focusPosee }
    courant.current = suivant
    setAffectation(suivant)
  })

  // Le texte des seize cartels. Recalculé seulement quand l'affectation change,
  // c'est-à-dire quelques fois par salle traversée et non soixante fois par
  // seconde.
  const cases = useMemo(
    () =>
      Array.from({ length: poolSize }, (_, i) => {
        const posee = affectation.posees[i] ?? null
        const spec = posee === null ? null : (parCle.get(posee) ?? null)
        const artwork = posee === null ? undefined : museum.artworks[posee]
        return {
          key: posee,
          spec: artwork ? spec : null,
          text: artwork ? cartelText(artwork) : '',
          active: posee !== null && affectation.keys[i] === posee,
        }
      }),
    [affectation.posees, affectation.keys, poolSize, parCle, museum],
  )

  const panneau = useMemo(() => {
    const key = affectation.focusPosee
    const artwork = key === null ? undefined : museum.artworks[key]
    if (!key || !artwork) return { spec: null, content: PANEL_VIDE }
    return { spec: parCle.get(key) ?? null, content: panelText(artwork) }
  }, [affectation.focusPosee, parCle, museum])

  return (
    <>
      {cases.map((emplacement, i) => (
        <Cartel
          // La clé React est l'INDEX du pool, jamais celle de l'œuvre : c'est ce
          // qui garantit que React réutilise le même composant — donc le même
          // objet troika — quand la case change d'œuvre. Une clé par œuvre
          // démonterait et remonterait le `Text`, et le pool ne servirait à rien.
          key={i}
          spec={emplacement.spec}
          text={emplacement.text}
          active={emplacement.active}
          // L'œuvre détaillée n'a pas besoin de son cartel : le panneau occupe
          // exactement le même emplacement, et les deux se croisent en fondu.
          muted={emplacement.key !== null && emplacement.key === affectation.focusKey}
        />
      ))}
      <CartelPanel
        spec={panneau.spec}
        content={panneau.content}
        open={affectation.focusKey !== null}
      />
    </>
  )
}

/** Égalité case à case de deux affectations de pool. */
function identique(a: readonly (RepoKey | null)[], b: readonly (RepoKey | null)[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
