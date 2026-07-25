/**
 * LOT 3 — Un cartel, et le panneau de proximité (spec § 9.3, US-2.4).
 *
 * Deux composants qui NE DÉCIDENT RIEN : `domain/cartels.ts` a déjà choisi
 * quelles œuvres méritent une étiquette, de quel côté du cadre elle se pose et
 * ce qu'on y écrit. Ici on ne fait qu'accrocher du texte SDF au bon endroit et
 * le faire apparaître en douceur.
 *
 * ── Ils restent MONTÉS en permanence ──
 *
 * `Cartel` est un élément de pool : `CartelLayer` en garde `CARTEL_POOL_SIZE`
 * montés du début à la fin et se contente de leur changer d'œuvre. Créer un
 * `Text` de troika alloue une géométrie, un matériau dérivé et une entrée
 * d'atlas SDF ; monter et démonter cent de ces objets au fil de la marche
 * coûterait bien plus cher que les draw calls qu'on cherche à économiser. Un
 * cartel sans œuvre n'est donc pas démonté : il est rendu INVISIBLE, ce qui
 * retire son draw call sans détruire sa mémoire.
 *
 * ── Pourquoi le fondu passe par une ref et pas par un état React ──
 *
 * L'opacité change à chaque image. La faire transiter par `useState`
 * déclencherait un rendu React par image et par cartel — soit ~960 rendus par
 * seconde pour un pool de 16. On écrit donc directement dans l'objet troika
 * depuis `useFrame`. C'est licite sans `sync()` : `fillOpacity` est un uniforme
 * relu par `onBeforeRender` à chaque image, contrairement au TEXTE qui, lui,
 * force une re-vectorisation des glyphes — c'est précisément ce que le pool
 * cherche à rendre rare.
 *
 * ── Aucun contour ──
 *
 * `outlineWidth` de troika est séduisant pour la lisibilité, mais il rend un
 * SECOND maillage : le pool passerait de 16 à 32 draw calls et sortirait du
 * budget de § 9. Le contraste est obtenu par la couleur d'encre, choisie selon
 * le thème de la salle — c'est gratuit.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'

import type { CartelSpec, PanelText } from '../domain/cartels'
import { CARTEL_WIDTH } from '../domain/cartels'
import type { ThemeId } from '../domain/types'

// ── Réglages typographiques ──────────────────────────────────────────────

/** Hauteur de corps du cartel, en mètres. À 6 m, ~3 px : le seuil du lisible. */
const CARTEL_FONT_SIZE = 0.026
const CARTEL_LINE_HEIGHT = 1.35

/** Le panneau, lui, ne se lit qu'à 2,5 m : il peut se permettre plus fin. */
const PANEL_HEADING_SIZE = 0.034
const PANEL_BODY_SIZE = 0.022
const PANEL_WIDTH = CARTEL_WIDTH

/**
 * Encre du texte, par thème de salle.
 *
 * Les murs sont clairs partout sauf en réserve (`vault`), assez sombre pour
 * qu'une encre foncée y disparaisse. Ce tableau est local et non importé de
 * `lighting.ts` : un cartel doit rester lisible même si la palette des murs
 * change, ce sont deux décisions distinctes.
 */
const THEME_INK: Record<ThemeId, string> = {
  classic: '#2a2620',
  modern: '#22242a',
  immersive: '#23262e',
  vault: '#f3ecdd',
}

/** Vitesse du fondu, en unités d'opacité par seconde. */
const FADE_SPEED = 4.5

/** En deçà, on coupe le rendu : un cartel à 1 % d'opacité coûte plein tarif. */
const OPACITY_EPS = 0.01

/** Loin sous le bâtiment : où se garent les cases de pool inoccupées. */
const PARKING: [number, number, number] = [0, -1000, 0]

/**
 * Amortissement indépendant de la fréquence d'images.
 *
 * Un `lerp(x, cible, 0.1)` par image donnerait un fondu deux fois plus rapide à
 * 120 im/s qu'à 60. L'exponentielle rend la durée du fondu identique quelle que
 * soit la machine — et le `delta` est plafonné, faute de quoi un retour d'onglet
 * après une seconde de pause ferait apparaître le cartel d'un coup.
 */
function approach(courant: number, cible: number, delta: number): number {
  const k = 1 - Math.exp(-FADE_SPEED * Math.min(delta, 0.1))
  return courant + (cible - courant) * k
}

/** Le sous-ensemble de l'objet troika que l'on pilote à la main. */
interface TroikaText extends THREE.Object3D {
  fillOpacity: number
}

// ── Cartel ───────────────────────────────────────────────────────────────

export interface CartelProps {
  /**
   * Œuvre POSÉE sur cette case du pool. Elle ne redevient `null` que si la case
   * n'a jamais rien porté : une œuvre qui vient d'être désaffectée y reste le
   * temps de son fondu de sortie, sinon il n'y aurait plus rien à estomper.
   */
  spec: CartelSpec | null
  /** Texte déjà rédigé par `domain/cartels.ts`. */
  text: string
  /** Faux dès que l'œuvre est sortie du champ : le cartel s'efface. */
  active: boolean
  /**
   * Vrai quand le panneau de proximité a pris le relais sur CETTE œuvre : le
   * cartel s'efface pendant que le panneau apparaît, les deux se croisant sur le
   * même emplacement du mur.
   */
  muted?: boolean
}

export function Cartel({ spec, text, active, muted = false }: CartelProps) {
  const groupe = useRef<THREE.Group>(null)
  const texte = useRef<TroikaText>(null)
  const opacite = useRef(0)
  // Une case réaffectée à une autre œuvre repart de zéro : sans ça, le nouveau
  // texte apparaîtrait brutalement à l'opacité de l'ancien.
  const clePrecedente = useRef<string | null>(null)

  // Caché AVANT la première image. On ne passe pas `visible={false}` en prop :
  // R3F la réappliquerait à chaque rendu React et couperait net un fondu en
  // cours. Poser la valeur une seule fois laisse `useFrame` seul maître du
  // drapeau.
  useLayoutEffect(() => {
    if (groupe.current) groupe.current.visible = false
  }, [])

  useFrame((_, delta) => {
    const groupeCourant = groupe.current
    const texteCourant = texte.current
    if (!groupeCourant || !texteCourant) return

    const cle = spec?.key ?? null
    if (cle !== clePrecedente.current) {
      clePrecedente.current = cle
      opacite.current = 0
    }

    const cible = spec !== null && active && !muted ? 1 : 0
    opacite.current = approach(opacite.current, cible, delta)

    const visible = opacite.current > OPACITY_EPS
    groupeCourant.visible = visible
    if (visible) texteCourant.fillOpacity = opacite.current
  })

  // Un cartel de pool n'est jamais démonté ; tant qu'il n'a jamais rien affiché
  // il se gare hors du bâtiment.
  const position: [number, number, number] = spec
    ? [spec.anchor.x, spec.anchor.y, spec.anchor.z]
    : PARKING

  return (
    <group ref={groupe} position={position} rotation={[0, spec?.yaw ?? 0, 0]}>
      <Text
        ref={texte}
        color={THEME_INK[spec?.theme ?? 'classic']}
        fontSize={CARTEL_FONT_SIZE}
        lineHeight={CARTEL_LINE_HEIGHT}
        maxWidth={CARTEL_WIDTH}
        anchorX="center"
        // Ancré en HAUT : l'arête haute du bloc coïncide avec l'arête basse du
        // cadre, ce qui aligne le cartel sur l'œuvre quel que soit le nombre de
        // lignes qu'il finit par occuper.
        anchorY="top"
        textAlign="left"
        // Le texte est plaqué sur le mur ; sans ce millimètre de relief il
        // z-fighterait avec la face du mur dès que la caméra s'en éloigne.
        position={[0, -0.012, 0.002]}
      >
        {text}
      </Text>
    </group>
  )
}

// ── Panneau de proximité (US-2.4) ────────────────────────────────────────

export interface CartelPanelProps {
  /** Dernière œuvre regardée. Conservée pendant tout le fondu de sortie. */
  spec: CartelSpec | null
  content: PanelText
  /** Faux dès que le visiteur détourne le regard : le panneau s'estompe. */
  open: boolean
}

/**
 * Le panneau riche : description et topics, sous 2,5 m et dans l'axe du regard.
 *
 * Il occupe EXACTEMENT l'emprise du cartel — même point d'ancrage, même largeur
 * — et ne fait que descendre plus bas. C'est ce qui lui donne gratuitement les
 * deux exigences d'US-2.4 : il n'obstrue pas l'œuvre (il est sous son arête
 * basse et décalé sur le côté) et il ne peut pas déborder sur le cadre voisin,
 * puisque `domain/cartels.ts` a déjà prouvé que cette emprise-là est libre.
 *
 * Un seul panneau existe dans toute la scène — c'est `CartelLayer` qui garantit
 * l'unicité —, il peut donc se permettre trois draw calls : la plaque de fond,
 * l'en-tête et le corps.
 */
export function CartelPanel({ spec, content, open }: CartelPanelProps) {
  const groupe = useRef<THREE.Group>(null)
  const entete = useRef<TroikaText>(null)
  const corps = useRef<TroikaText>(null)
  const plaque = useRef<THREE.Mesh>(null)
  const opacite = useRef(0)
  const clePrecedente = useRef<string | null>(null)

  // Même raison que dans `Cartel` : caché une fois pour toutes, puis piloté par
  // le seul `useFrame`.
  useLayoutEffect(() => {
    if (groupe.current) groupe.current.visible = false
  }, [])

  // La hauteur de la plaque suit la longueur du texte : un panneau court
  // flotterait sinon au milieu d'un grand rectangle vide.
  const mesures = useMemo(() => panelMetrics(content), [content])

  useFrame((_, delta) => {
    const groupeCourant = groupe.current
    if (!groupeCourant) return

    const cle = spec?.key ?? null
    if (cle !== clePrecedente.current) {
      clePrecedente.current = cle
      opacite.current = 0
    }

    opacite.current = approach(opacite.current, spec !== null && open ? 1 : 0, delta)
    const visible = opacite.current > OPACITY_EPS
    groupeCourant.visible = visible
    if (!visible) return

    if (entete.current) entete.current.fillOpacity = opacite.current
    if (corps.current) corps.current.fillOpacity = opacite.current
    const materiau = plaque.current?.material as THREE.Material | undefined
    // La plaque plafonne à 0,82 : opaque, elle ferait un rectangle blanc
    // découpé dans le mur, plus voyant que le texte qu'elle porte.
    if (materiau) materiau.opacity = opacite.current * 0.82
  })

  const position: [number, number, number] = spec
    ? [spec.anchor.x, spec.anchor.y, spec.anchor.z]
    : PARKING
  const ink = THEME_INK[spec?.theme ?? 'classic']

  return (
    <group ref={groupe} position={position} rotation={[0, spec?.yaw ?? 0, 0]}>
      <mesh ref={plaque} position={[0, -mesures.total / 2, 0.003]}>
        <planeGeometry args={[PANEL_WIDTH + 0.05, mesures.total]} />
        <meshBasicMaterial
          color={spec?.theme === 'vault' ? '#1c1a16' : '#fbf8f1'}
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <Text
        ref={entete}
        color={ink}
        fontSize={PANEL_HEADING_SIZE}
        lineHeight={1.25}
        maxWidth={PANEL_WIDTH}
        anchorX="center"
        anchorY="top"
        textAlign="left"
        position={[0, -0.02, 0.005]}
      >
        {content.heading}
      </Text>

      <Text
        ref={corps}
        color={ink}
        fontSize={PANEL_BODY_SIZE}
        lineHeight={1.4}
        maxWidth={PANEL_WIDTH}
        anchorX="center"
        anchorY="top"
        textAlign="left"
        position={[0, -0.02 - mesures.heading, 0.005]}
      >
        {content.body}
      </Text>
    </group>
  )
}

// ── Métrologie approximative du panneau ──────────────────────────────────

/**
 * Estimation du nombre de lignes que troika rendra pour une largeur donnée.
 *
 * Approximation ASSUMÉE : la hauteur exacte n'existe qu'une fois le texte
 * vectorisé, c'est-à-dire une image plus tard. L'attendre ferait tressauter la
 * plaque de fond à chaque ouverture du panneau. Le facteur 0,52 est le rapport
 * largeur/hauteur moyen d'un caractère de la police par défaut ; il surestime
 * légèrement, ce qui est le bon sens de l'erreur — une plaque un peu trop grande
 * passe inaperçue, une plaque trop petite tronque visiblement le texte.
 */
function lineCount(texte: string, fontSize: number, width: number): number {
  const parLigne = Math.max(1, Math.floor(width / (fontSize * 0.52)))
  let total = 0
  for (const ligne of texte.split('\n')) {
    total += ligne.length === 0 ? 1 : Math.ceil(ligne.length / parLigne)
  }
  return total
}

interface PanelMetrics {
  /** Hauteur de l'en-tête, marge comprise : le corps commence là. */
  heading: number
  /** Hauteur totale de la plaque. */
  total: number
}

function panelMetrics(content: PanelText): PanelMetrics {
  const heading =
    lineCount(content.heading, PANEL_HEADING_SIZE, PANEL_WIDTH) * PANEL_HEADING_SIZE * 1.25 + 0.024
  const corps = lineCount(content.body, PANEL_BODY_SIZE, PANEL_WIDTH) * PANEL_BODY_SIZE * 1.4
  return { heading, total: heading + corps + 0.055 }
}
