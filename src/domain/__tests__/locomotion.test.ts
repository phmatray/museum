/**
 * Le contrat de la locomotion.
 *
 * Le fil conducteur : **la cadence d'affichage ne doit rien changer.** C'est la
 * propriété qui manquait, et son absence ne s'est jamais vue en jouant — elle
 * s'est vue en mesurant deux navigateurs à des cadences différentes.
 */
import { describe, expect, it } from 'vitest'

import {
  AMPLITUDE_LATERALE,
  DELTA_MAX,
  ECART_OEIL_MAX,
  LONGUEUR_PAS,
  PAS_FIXE,
  TAUX_ACCELERATION,
  VITESSE_CHUTE_MAX,
  VITESSE_MARCHE,
  VITESSE_OEIL_MAX,
  approcher,
  balancement,
  cadencer,
  chuter,
  directionMarche,
  enfoncementImpact,
  suivreOeil,
} from '../locomotion'

const AUCUNE = { forward: false, backward: false, left: false, right: false }

/** Simule `secondes` de jeu à une cadence donnée, et rend la distance parcourue. */
function simuler(secondes: number, imagesParSeconde: number): number {
  const delta = 1 / imagesParSeconde
  let reste = 0
  let v = 0
  let distance = 0
  for (let i = 0; i < Math.round(secondes * imagesParSeconde); i += 1) {
    const c = cadencer(reste, delta)
    reste = c.reste
    for (let k = 0; k < c.pas; k += 1) {
      v = approcher(v, VITESSE_MARCHE, TAUX_ACCELERATION, PAS_FIXE)
      distance += v * PAS_FIXE
    }
  }
  return distance
}

describe('cadencer — le pas fixe', () => {
  /**
   * LE test qui manquait.
   *
   * L'ancien contrôleur lisait `rb.translation()`, publiée seulement au pas de
   * physique : au-dessus de 60 im/s, la consigne d'une image écrasait celle de
   * la précédente. Relevé sur le musée à 4 m/s réglés — 117 im/s ⇒ 1,53 m/s,
   * 214 im/s ⇒ 0,99 m/s. Le visiteur marchait d'autant plus lentement que
   * l'écran était rapide, et personne n'avait jamais atteint la vitesse réglée.
   */
  it('parcourt la même distance à 30, 60, 144 et 240 images par seconde', () => {
    const reference = simuler(3, 60)
    // La tolérance est UN pas fixe de marche — 1,8 m/s × 1/120 s = 1,5 cm — et
    // pas un chiffre rond : au moment où l'on arrête la simulation, le reste
    // reporté peut valoir jusqu'à un pas non encore exécuté. C'est la seule
    // divergence que le pas fixe autorise, et elle ne s'accumule pas.
    const UN_PAS = VITESSE_MARCHE * PAS_FIXE
    for (const ips of [30, 72, 144, 240]) {
      expect(Math.abs(simuler(3, ips) - reference), `${ips} im/s`).toBeLessThanOrEqual(UN_PAS)
    }
    // Et le tout reste à portée de la distance théorique : 3 s à 1,8 m/s, moins
    // le retard de la mise en vitesse.
    expect(reference).toBeGreaterThan(3 * VITESSE_MARCHE - 0.2)
    expect(reference).toBeLessThan(3 * VITESSE_MARCHE)
  })

  it('reporte le temps non consommé au lieu de le jeter', () => {
    // À 200 im/s chaque image vaut 5 ms et le pas 8,33 ms : une image sur deux
    // n'exécute aucun pas. Sans report, on perdrait 40 % du temps simulé.
    let reste = 0
    let pasTotal = 0
    for (let i = 0; i < 200; i += 1) {
      const c = cadencer(reste, 1 / 200)
      reste = c.reste
      pasTotal += c.pas
    }
    expect(pasTotal).toBe(120)
  })

  it('plafonne un delta aberrant plutôt que de rattraper des heures', () => {
    // Un onglet réveillé après cinq minutes : sans plafond, 36 000 pas d'un coup.
    expect(cadencer(0, 300).pas).toBe(Math.floor(DELTA_MAX / PAS_FIXE))
  })

  it('ignore un delta négatif', () => {
    expect(cadencer(0, -1).pas).toBe(0)
  })
})

describe('approcher — la masse du visiteur', () => {
  it('atteint 90 % de la cible en 0,13 s, quel que soit le découpage', () => {
    const enUnPas = approcher(0, 10, TAUX_ACCELERATION, 0.128)
    let enPetitsPas = 0
    for (let i = 0; i < 128; i += 1) {
      enPetitsPas = approcher(enPetitsPas, 10, TAUX_ACCELERATION, 0.001)
    }
    expect(enUnPas).toBeCloseTo(9, 0)
    expect(enPetitsPas).toBeCloseTo(enUnPas, 6)
  })

  it('ne dépasse jamais la cible', () => {
    let v = 0
    for (let i = 0; i < 1000; i += 1) v = approcher(v, 5, TAUX_ACCELERATION, PAS_FIXE)
    expect(v).toBeLessThanOrEqual(5)
    expect(v).toBeCloseTo(5, 6)
  })
})

describe('chuter', () => {
  it('plafonne la vitesse de chute', () => {
    let vy = 0
    for (let i = 0; i < 10_000; i += 1) vy = chuter(vy, PAS_FIXE)
    expect(vy).toBe(-VITESSE_CHUTE_MAX)
  })

  it('tombe de 4,70 m en arrivant sous 10 m/s — la hauteur d’un étage', () => {
    let vy = 0
    let y = 0
    while (y > -4.7) {
      vy = chuter(vy, PAS_FIXE)
      y += vy * PAS_FIXE
    }
    expect(Math.abs(vy)).toBeLessThan(10)
  })
})

describe('directionMarche', () => {
  it('rend le vecteur nul sans touche', () => {
    expect(directionMarche(AUCUNE, 0)).toEqual({ x: 0, z: 0 })
  })

  it('avance vers −Z quand la caméra regarde le nord', () => {
    const d = directionMarche({ ...AUCUNE, forward: true }, 0)
    expect(d.x).toBeCloseTo(0, 6)
    expect(d.z).toBeCloseTo(-1, 6)
  })

  it('avance vers −X quand la caméra a tourné de 90°', () => {
    const d = directionMarche({ ...AUCUNE, forward: true }, Math.PI / 2)
    expect(d.x).toBeCloseTo(-1, 6)
    expect(d.z).toBeCloseTo(0, 6)
  })

  it('va vers +X quand on appuie à droite', () => {
    const d = directionMarche({ ...AUCUNE, right: true }, 0)
    expect(d.x).toBeCloseTo(1, 6)
    expect(d.z).toBeCloseTo(0, 6)
  })

  it('normalise la diagonale — sinon on court plus vite en biais', () => {
    const d = directionMarche({ ...AUCUNE, forward: true, right: true }, 0)
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1, 6)
  })

  it('s’annule quand deux touches opposées sont tenues', () => {
    expect(directionMarche({ ...AUCUNE, forward: true, backward: true }, 0)).toEqual({
      x: 0,
      z: 0,
    })
  })
})

describe('suivreOeil — la limite de vitesse de l’œil', () => {
  /**
   * Le premier mécanisme était un ressort exponentiel. Il ne lissait que les
   * MONTÉES — un pic mesuré sur trois était une descente de 35 mm en 8 ms,
   * produite par `enableSnapToGround` au nez d'une marche — et, filtre du
   * premier ordre, il ne retirait pas la rampe mais seulement son transitoire :
   * l'escalier passait encore 33 mm en une image. Celui-ci énonce la propriété
   * directement.
   */
  it('écrête un franchissement de marche, à la montée comme à la descente', () => {
    const monte = suivreOeil(0, 0.15, PAS_FIXE)
    const descend = suivreOeil(0, -0.15, PAS_FIXE)
    expect(monte).toBeCloseTo(VITESSE_OEIL_MAX * PAS_FIXE, 9)
    expect(descend).toBeCloseTo(-VITESSE_OEIL_MAX * PAS_FIXE, 9)
  })

  it('suit sans écrêter l’ascension de l’escalier à la vitesse de marche', () => {
    // 1,8 m/s sur une pente à 31 % : 0,56 m/s, bien sous la limite. L'œil colle
    // au corps, et le lissage ne coûte donc RIEN sur le cas nominal.
    const parPas = VITESSE_MARCHE * 0.31 * PAS_FIXE
    let oeil = 0
    let corps = 0
    for (let i = 0; i < 240; i += 1) {
      corps += parPas
      oeil = suivreOeil(oeil, corps, PAS_FIXE)
    }
    expect(corps - oeil).toBeLessThan(1e-9)
  })

  it('ne prend jamais plus de 35 cm de retard, même en chute libre', () => {
    let oeil = 0
    let corps = 0
    for (let i = 0; i < 600; i += 1) {
      corps -= VITESSE_CHUTE_MAX * PAS_FIXE
      oeil = suivreOeil(oeil, corps, PAS_FIXE)
    }
    expect(oeil - corps).toBeCloseTo(ECART_OEIL_MAX, 9)
  })

  it('rattrape exactement, sans osciller', () => {
    let oeil = 0
    for (let i = 0; i < 200; i += 1) oeil = suivreOeil(oeil, 0.1, PAS_FIXE)
    expect(oeil).toBe(0.1)
  })
})

describe('enfoncementImpact', () => {
  it('ignore une descente de marche', () => {
    expect(enfoncementImpact(-1.7)).toBe(0)
  })

  it('encaisse une chute d’étage, sans passer sous le plancher', () => {
    expect(enfoncementImpact(-9.6)).toBeGreaterThan(0.05)
    expect(enfoncementImpact(-40)).toBeLessThanOrEqual(0.12)
  })
})

describe('balancement', () => {
  it('est nul à l’arrêt — sinon on berce un visiteur immobile', () => {
    expect(balancement(12.3, 0)).toEqual({ y: 0, lateral: 0 })
  })

  it('est nul quand l’amplitude est coupée (prefers-reduced-motion)', () => {
    expect(balancement(12.3, VITESSE_MARCHE, 0)).toEqual({ y: 0, lateral: 0 })
  })

  it('est périodique sur la DISTANCE, pas sur le temps', () => {
    const a = balancement(3, VITESSE_MARCHE)
    const b = balancement(3 + 2 * LONGUEUR_PAS, VITESSE_MARCHE)
    expect(b.y).toBeCloseTo(a.y, 6)
    expect(b.lateral).toBeCloseTo(a.lateral, 6)
  })

  it('bat deux fois plus vite en vertical qu’en latéral', () => {
    // Une foulée complète = deux appuis : le corps monte deux fois, se déporte
    // une fois. L'inverse donne une démarche de canard.
    const demiCycle = balancement(LONGUEUR_PAS, VITESSE_MARCHE)
    expect(demiCycle.y).toBeCloseTo(0, 6)
    expect(Math.abs(demiCycle.lateral)).toBeCloseTo(0, 6)
    // Au quart de foulée, le latéral est à son maximum et le vertical repasse
    // par zéro : c'est la signature du rapport 2 pour 1.
    const quart = balancement(LONGUEUR_PAS / 2, VITESSE_MARCHE)
    expect(Math.abs(quart.lateral)).toBeCloseTo(AMPLITUDE_LATERALE, 6)
    expect(Math.abs(quart.y)).toBeLessThan(1e-6)
  })

  it('reste sous deux centimètres, même en hâte', () => {
    let max = 0
    for (let d = 0; d < 10; d += 0.01) {
      max = Math.max(max, Math.abs(balancement(d, 3.8).y))
    }
    expect(max).toBeLessThan(0.02)
  })
})
