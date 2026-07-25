/**
 * La LOCOMOTION du visiteur — la partie qui se calcule, séparée de celle qui
 * interroge Rapier.
 *
 * ── Pourquoi ce module existe ──
 *
 * Tout ce qui suit vivait dans le `useFrame` de `Player.tsx` : la gravité,
 * l'intégration, le suivi de caméra. Aucune de ces lignes n'était testable sans
 * navigateur, sans monde physique et sans boucle de rendu — donc aucune ne
 * l'était. C'est ce qui a laissé passer le défaut ci-dessous pendant toute la
 * durée du projet.
 *
 * ── LE DÉFAUT, mesuré ──
 *
 * L'ancien contrôleur lisait `rb.translation()` à CHAQUE image de rendu et
 * poussait `translation + déplacement` par `setNextKinematicTranslation`. Or la
 * translation d'un corps cinématique n'est mise à jour qu'au PAS DE PHYSIQUE
 * (1/60 s par défaut). Au-dessus de soixante images par seconde, deux consignes
 * ou plus sont donc écrites entre deux pas, et seule la dernière survit : le
 * déplacement des images intermédiaires est perdu.
 *
 * Conséquence, contre-intuitive et parfaitement réelle : **plus l'écran est
 * rapide, plus le visiteur marche lentement.** Relevé sur le musée, vitesse
 * réglée à 4 m/s :
 *
 *   117 im/s → 1,53 m/s     214 im/s → 0,99 m/s
 *
 * soit très exactement `vitesse × 60 / im par seconde`. Personne n'avait jamais
 * marché à la vitesse configurée.
 *
 * ── Le remède : le visiteur POSSÈDE sa position ──
 *
 * On ne relit plus la position du corps, on la tient. Rapier reste l'arbitre
 * des collisions — c'est lui qui dit de combien on a le droit d'avancer — mais
 * l'intégration est à nous, et elle se fait par PAS FIXES accumulés. Deux
 * cadences d'affichage différentes exécutent alors exactement la même suite de
 * pas, donc parcourent exactement la même distance.
 *
 * Aucune fonction de ce fichier ne touche à three, à React ou à Rapier : elles
 * prennent des nombres et rendent des nombres.
 */

// ── Le pas fixe ──────────────────────────────────────────────────────────

/**
 * Durée d'un pas d'intégration, en secondes.
 *
 * 1/120 et non 1/60 : le pas fixe borne la finesse de la détection de contact,
 * et à 4 m/s un pas de 1/60 avance de 6,7 cm entre deux vérifications. Le
 * contrôleur de Rapier balaie sa capsule (il ne téléporte pas), donc rien ne
 * traverse — mais un ressaut de marche est franchi en deux fois moins d'étapes,
 * et le lissage de marche en devient visiblement plus grossier.
 */
export const PAS_FIXE = 1 / 120

/**
 * Plafond du delta consommé en une image, en secondes.
 *
 * Un onglet remis au premier plan, un ramasse-miettes, une texture décodée : le
 * delta d'une image peut valoir plusieurs secondes. Sans plafond, on exécuterait
 * des centaines de pas d'un coup — le visiteur ferait un bond de plusieurs
 * mètres, et sur une image déjà lente le coût de rattrapage rendrait la suivante
 * plus lente encore. C'est la spirale classique, et 0,1 s la coupe : au-delà, le
 * temps est simplement PERDU, ce qui est le bon compromis pour une visite.
 */
export const DELTA_MAX = 0.1

/**
 * Combien de pas fixes exécuter, et ce qu'il reste à reporter.
 *
 * Le reste est CONSERVÉ d'une image à l'autre : le jeter arrondirait le temps
 * simulé vers le bas à chaque image, et le visiteur avancerait d'autant plus
 * lentement que l'affichage serait rapide — c'est-à-dire qu'on reproduirait, en
 * plus discret, le défaut qu'on est en train de corriger.
 */
export function cadencer(accumulateur: number, delta: number): {
  pas: number
  reste: number
} {
  const total = accumulateur + Math.min(Math.max(delta, 0), DELTA_MAX)
  const pas = Math.floor(total / PAS_FIXE)
  return { pas, reste: total - pas * PAS_FIXE }
}

// ── Vitesses ─────────────────────────────────────────────────────────────

/**
 * Vitesse de marche, en m/s.
 *
 * 1,80 et non 4,00. Quatre mètres par seconde sont 14,4 km/h : la vitesse d'un
 * coureur, pas celle d'un visiteur — et à cette allure une salle de sept mètres
 * se traverse en moins de deux secondes, ce qui interdit de regarder quoi que
 * ce soit. 1,80 m/s est un pas soutenu (6,5 km/h) : on avance franchement, et
 * une œuvre reste lisible en passant devant.
 *
 * Le défaut mesuré rendait de toute façon la valeur réglée fictive — à 120 im/s
 * on marchait déjà à 1,5 m/s sans que personne l'ait décidé.
 */
export const VITESSE_MARCHE = 1.8

/** Vitesse en hâte (Maj). Pour traverser un plateau déjà vu, pas pour visiter. */
export const VITESSE_HATE = 3.8

/**
 * Taux d'approche de la vitesse cible, en 1/s.
 *
 * Le mouvement n'est plus instantané. Un visiteur qui atteint sa vitesse de
 * croisière en une image et s'arrête net à la suivante n'a aucune masse : c'est
 * le premier signe qui trahit un contrôleur de démonstration. 18 s⁻¹ donne 90 %
 * de la vitesse en 0,13 s — assez pour qu'on sente le départ, assez peu pour que
 * la commande reste franche.
 *
 * L'approche est EXPONENTIELLE et non linéaire : `1 − exp(−taux·h)` donne le
 * même résultat quel que soit le découpage du temps, alors qu'un `lerp(v, c, k)`
 * à coefficient constant converge d'autant plus vite que les pas sont nombreux.
 */
export const TAUX_ACCELERATION = 18

/**
 * Vitesse de chute maximale, en m/s.
 *
 * Sans plafond, une chute par un bord de dalle atteint 30 m/s avant que le filet
 * anti-vide ne s'arme, et le pas suivant demande à Rapier un déplacement de
 * 25 cm vers le bas : le balayage de capsule le résout, mais l'atterrissage
 * devient un arrêt sec de plusieurs mètres par seconde. 20 m/s est déjà bien
 * au-delà de toute chute d'un étage à l'autre (4,70 m ⇒ 9,6 m/s).
 */
export const VITESSE_CHUTE_MAX = 20

export const GRAVITE = -9.81

/** Approche exponentielle, indépendante du découpage du temps. */
export function approcher(actuel: number, cible: number, taux: number, h: number): number {
  return cible + (actuel - cible) * Math.exp(-taux * h)
}

/** Vitesse verticale après `h` secondes de chute libre, bornée. */
export function chuter(vy: number, h: number): number {
  return Math.max(vy + GRAVITE * h, -VITESSE_CHUTE_MAX)
}

// ── Direction ────────────────────────────────────────────────────────────

export interface Touches {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
}

export interface Vec2XZ {
  x: number
  z: number
}

/**
 * Direction de marche dans le repère MONDE, normalisée, à partir des touches et
 * du cap de la caméra.
 *
 * L'avant de la caméra est −Z tourné du lacet θ ; la droite est +X tourné du
 * même lacet. La diagonale est normalisée, sans quoi marcher en biais irait
 * 41 % plus vite qu'en ligne droite — le défaut le plus ancien du genre.
 */
export function directionMarche(touches: Touches, yaw: number): Vec2XZ {
  const avant = (touches.forward ? 1 : 0) - (touches.backward ? 1 : 0)
  const cote = (touches.right ? 1 : 0) - (touches.left ? 1 : 0)
  if (avant === 0 && cote === 0) return { x: 0, z: 0 }

  const norme = Math.hypot(avant, cote)
  const a = avant / norme
  const c = cote / norme
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // Avant local (0, −1) et droite locale (1, 0), tournés de θ autour de Y.
  return {
    x: -a * sin + c * cos,
    z: -a * cos - c * sin,
  }
}

// ── Lissage de marche ────────────────────────────────────────────────────

/**
 * Vitesse verticale maximale de l'ŒIL au sol, en m/s.
 *
 * ── Deux mécanismes ont été essayés ; celui-ci est le second ──
 *
 * Le premier était un ressort : encaisser la montée dans un décalage, puis le
 * résorber exponentiellement. Il a deux défauts, et le harnais de marche les a
 * trouvés tous les deux.
 *
 * D'abord il ne lissait que les MONTÉES. Un pic mesuré sur trois était une
 * descente — 35 mm en 8 ms, soit 4,3 m/s —, produite par
 * `enableSnapToGround` quand on quitte le nez d'une marche. Une chute d'œil est
 * exactement aussi désagréable qu'un bond.
 *
 * Ensuite, et c'est le point de fond : un filtre du premier ordre ne retire pas
 * une rampe, il n'en retire que le transitoire. En régime permanent le décalage
 * se stabilise et l'œil se remet à monter d'exactement ce que monte le corps —
 * le lissage devient un retard constant qui ne lisse plus rien. Mesuré :
 * l'escalier passait encore 33 mm en une image.
 *
 * Le second mécanisme énonce directement la propriété qu'on veut : l'œil ne
 * monte ni ne descend plus vite que 1,40 m/s tant qu'on a les pieds au sol.
 * L'ascension de l'escalier n'en demande que 0,55 à la vitesse de marche —
 * l'œil suit donc exactement la rampe — et 1,16 en hâte, ce qui reste sous la
 * limite. Seuls les à-coups de franchissement sont écrêtés.
 *
 * En chute libre l'écart plafonne (voir `ECART_OEIL_MAX`) et l'œil retrouve la
 * vitesse du corps : tomber doit se sentir.
 */
export const VITESSE_OEIL_MAX = 1.4

/**
 * Écart maximal entre l'œil et sa cible, en mètres.
 *
 * C'est ce qui empêche la limite de vitesse de transformer une chute d'étage en
 * lévitation : au-delà de 35 cm de retard, l'œil est ramené de force. Pendant
 * une chute à 9 m/s il reste donc simplement 35 cm au-dessus, et descend à la
 * vitesse du corps.
 */
export const ECART_OEIL_MAX = 0.35

/**
 * Fait suivre à l'œil la hauteur du corps, sans jamais dépasser
 * `VITESSE_OEIL_MAX`, et sans jamais s'en écarter de plus de `ECART_OEIL_MAX`.
 *
 * Rend la nouvelle hauteur d'œil, en mètres, dans le même repère que `cible`.
 */
export function suivreOeil(oeil: number, cible: number, h: number): number {
  const pasMax = VITESSE_OEIL_MAX * h
  const ecart = cible - oeil
  const suivi = oeil + Math.max(-pasMax, Math.min(pasMax, ecart))
  return Math.max(cible - ECART_OEIL_MAX, Math.min(cible + ECART_OEIL_MAX, suivi))
}

/**
 * Enfoncement à l'atterrissage, en mètres, pour une vitesse d'impact donnée.
 *
 * Une chute qui se termine par un arrêt net, sans que rien ne bouge à l'écran,
 * ne se lit pas comme un atterrissage : elle se lit comme un bug d'altitude. On
 * abaisse l'œil d'un coup, et `suivreOeil` le remonte à sa vitesse limite — la
 * reprise dure donc 0,09 s pour 12 cm, ce qui est la durée d'une flexion de
 * jambes.
 *
 * Plafonné à 12 cm : au-delà, une chute d'étage ferait plonger la caméra sous le
 * plancher.
 */
export function enfoncementImpact(vitesseImpact: number): number {
  if (vitesseImpact >= SEUIL_ATTERRISSAGE) return 0
  return Math.min(0.12, -vitesseImpact * 0.012)
}

/**
 * En deçà de cette vitesse verticale, on n'a pas « atterri ». Descendre une
 * marche de 15 cm produit 1,7 m/s : ce n'est pas un impact, et l'encaisser
 * ferait plonger la caméra à chaque marche d'un escalier descendu.
 */
export const SEUIL_ATTERRISSAGE = -2

// ── Balancement ──────────────────────────────────────────────────────────

/** Longueur d'un pas, en mètres. Un adulte de 1,75 m marche par pas de 0,75 m. */
export const LONGUEUR_PAS = 0.75

/** Amplitude verticale du balancement à la vitesse de marche, en mètres. */
export const AMPLITUDE_VERTICALE = 0.014

/** Amplitude latérale. Moitié moins, et à la moitié de la fréquence. */
export const AMPLITUDE_LATERALE = 0.011

export interface Balancement {
  /** Décalage vertical de l'œil, en mètres. */
  y: number
  /** Décalage latéral, dans le repère de la caméra, en mètres. */
  lateral: number
}

/**
 * Le balancement de marche, indexé sur la DISTANCE et non sur le temps.
 *
 * Indexé sur le temps, il continuerait de bercer un visiteur à l'arrêt contre un
 * mur, et se désynchroniserait de l'allure dès qu'on passe en hâte. Indexé sur
 * la distance parcourue, il s'arrête quand on s'arrête, et sa cadence suit
 * exactement la vitesse — ce qui est la définition d'une foulée.
 *
 * Le vertical bat à DEUX fois la fréquence du latéral : le corps monte à chaque
 * appui, gauche puis droit, mais ne se déporte qu'une fois par cycle complet.
 * L'inverse donne une démarche de canard, et c'est immédiatement perceptible.
 *
 * L'amplitude suit la vitesse : à l'arrêt elle est nulle, et le retour au calme
 * se fait donc tout seul, sans état supplémentaire à amortir.
 */
export function balancement(
  distance: number,
  vitesse: number,
  amplitude = 1,
): Balancement {
  const echelle = Math.min(vitesse / VITESSE_MARCHE, 1.4) * amplitude
  if (echelle <= 0) return { y: 0, lateral: 0 }
  const phase = (distance / LONGUEUR_PAS) * Math.PI
  return {
    y: Math.sin(phase * 2) * AMPLITUDE_VERTICALE * echelle,
    lateral: Math.sin(phase) * AMPLITUDE_LATERALE * echelle,
  }
}
