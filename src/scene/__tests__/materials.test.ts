/**
 * LOT 4 — Tests de la bibliothèque de matières (spec §9.4).
 *
 * Aucun canvas : un `MeshStandardMaterial` et un `Texture` de three sont des
 * objets JavaScript tant qu'aucun renderer ne les téléverse, et
 * `onBeforeCompile` n'est qu'une fonction qui réécrit deux chaînes de caractères.
 * Elle est donc appelée ici avec un shader factice, ce qui est le seul moyen de
 * vérifier une injection GLSL sans GPU.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. L'ÉCHELLE EN COORDONNÉES MONDE. Un mur de 38 m et un mur de 7 m doivent
 *     montrer le même béton. C'est l'exigence dont la violation se voit le plus
 *     vite à l'écran — avant même qu'on ait identifié la matière, on voit que
 *     l'un est étiré.
 *  2. LA MUTUALISATION PAR CLONAGE. Deux échelles exigent deux `Texture`, mais
 *     elles doivent partager la même `Source` : sinon chaque échelle recharge
 *     l'image et la VRAM part en morceaux.
 *  3. LE REBOND DES SOUS-FACES. Sans lui, les faces tournées vers le bas
 *     tombent au noir — une masse noire occupait le bas de la vue d'entrée au
 *     lot 3.
 *  4. LE NOMBRE DE PROGRAMMES. Une clé de cache constante, sans quoi une dalle
 *     par étage devient un programme par étage.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import type { JeuDeCartes } from '../../io/textures'
import { configurerJeu } from '../../io/textures'
import {
  MOTIF_METRES,
  REGLAGE_MATIERE,
  appliquerCartes,
  creerMatiere,
  libererJeu,
  matiereDeDalle,
  matiereDeMur,
  repeterJeu,
  repetitionMetrique,
  repetitionMonde,
} from '../materials'

// ── Outils ───────────────────────────────────────────────────────────────

function jeuJouet(): JeuDeCartes {
  return configurerJeu({
    couleur: new THREE.Texture(),
    normale: new THREE.Texture(),
    rugosite: new THREE.Texture(),
  })
}

/**
 * Un shader factice qui contient les quatre points d'ancrage utilisés par
 * `peindreRebond`. Si three renomme un chunk, `replace` devient une opération
 * nulle et l'effet disparaît EN SILENCE : ce faux shader est ce qui attrape le
 * cas.
 */
function shaderJouet() {
  return {
    uniforms: {} as Record<string, unknown>,
    vertexShader: [
      '#include <common>',
      'void main() {',
      '#include <beginnormal_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '#include <emissivemap_fragment>',
      '}',
    ].join('\n'),
  }
}

function compiler(material: THREE.MeshStandardMaterial) {
  const shader = shaderJouet()
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  )
  return shader
}

// ── Échelle ──────────────────────────────────────────────────────────────

describe('repetitionMonde', () => {
  it('donne la MÊME densité à un mur de 38 m et à un mur de 7 m', () => {
    // Le cœur de l'exigence : la répétition suit les mètres, pas les UV. Un
    // rapport constant entre répétition et longueur, c'est exactement « un motif
    // tous les deux mètres ».
    const grand = repetitionMonde(38, 4)
    const petit = repetitionMonde(7, 4)

    expect(grand[0] / 38).toBeCloseTo(petit[0] / 7, 12)
    expect(grand[1]).toBeCloseTo(petit[1], 12)
    expect(grand[0]).toBeCloseTo(38 / MOTIF_METRES, 12)
  })

  it('donne la même densité que la géométrie ait des UV normalisées ou métriques', () => {
    // Les murs (ExtrudeGeometry) ont des UV en mètres, le garde-corps
    // (BoxGeometry) des UV en carré unité. Les deux doivent montrer le même
    // grain, sans quoi le garde-corps trahit le procédural à lui seul.
    const normalise = repetitionMonde(38, 4)
    const metrique = repetitionMonde(38, 4, { uvMetriques: true })

    // motifs par mètre = répétition × étendue UV par mètre
    expect(normalise[0] / 38).toBeCloseTo(metrique[0], 12)
    expect(normalise[1] / 4).toBeCloseTo(metrique[1], 12)
  })

  it('la répétition métrique ne dépend pas des dimensions', () => {
    expect(repetitionMonde(38, 4, { uvMetriques: true })).toEqual(
      repetitionMonde(7, 12, { uvMetriques: true }),
    )
    expect(repetitionMetrique()).toEqual([1 / MOTIF_METRES, 1 / MOTIF_METRES])
  })

  it('honore un motif plus fin', () => {
    const [rx] = repetitionMonde(10, 3, { motif: 0.5 })
    expect(rx).toBeCloseTo(20, 12)
  })

  it('refuse un motif non positif', () => {
    // Un motif nul donnerait une répétition infinie, donc une matrice UV en NaN
    // et un maillage entier invisible.
    expect(() => repetitionMonde(10, 3, { motif: 0 })).toThrow(RangeError)
  })

  it('ne produit jamais de NaN sur une surface dégénérée', () => {
    const [rx, ry] = repetitionMonde(0, 0, { uvMetriques: true })
    expect(Number.isFinite(rx)).toBe(true)
    expect(Number.isFinite(ry)).toBe(true)
  })
})

// ── Clonage ──────────────────────────────────────────────────────────────

describe('repeterJeu', () => {
  it('pose la répétition sur les TROIS cartes', () => {
    // Depuis r152 chaque carte a sa propre matrice UV : n'en régler qu'une fait
    // glisser le relief par rapport à la couleur.
    const jeu = repeterJeu(jeuJouet(), [19, 2])

    for (const carte of [jeu.couleur, jeu.normale, jeu.rugosite]) {
      expect(carte.repeat.x).toBe(19)
      expect(carte.repeat.y).toBe(2)
    }
  })

  it('partage la source du maître : une image, plusieurs échelles', () => {
    const maitre = jeuJouet()
    const mur = repeterJeu(maitre, [19, 2])
    const cloison = repeterJeu(maitre, [3.5, 2])

    // La `Source` est ce que three téléverse : deux clones qui la partagent
    // n'occupent qu'une texture GPU, quelle que soit leur répétition.
    expect(mur.couleur.source).toBe(maitre.couleur.source)
    expect(cloison.couleur.source).toBe(maitre.couleur.source)
    expect(cloison.couleur).not.toBe(mur.couleur)
    // Et les paramètres d'échantillonnage, qui entrent dans la clé de cache de
    // three, doivent rester identiques — sinon la mutualisation tombe.
    expect(mur.couleur.colorSpace).toBe(maitre.couleur.colorSpace)
    expect(mur.normale.anisotropy).toBe(maitre.normale.anisotropy)
    expect(mur.couleur.wrapS).toBe(THREE.RepeatWrapping)
  })

  it('libère les clones sans toucher au maître', () => {
    const maitre = jeuJouet()
    const clone = repeterJeu(maitre, [1, 1])
    libererJeu(clone)
    // Le maître reste en cache pour les surfaces suivantes : le disposer ici
    // forcerait un nouveau décodage JPEG au prochain mur.
    expect(maitre.couleur.source).toBeDefined()
  })
})

// ── Matériau ─────────────────────────────────────────────────────────────

describe('creerMatiere', () => {
  it('pose les trois cartes et applique le gain d’albédo', () => {
    const jeu = repeterJeu(jeuJouet(), [1, 1])
    const material = creerMatiere('beton', jeu)

    expect(material.map).toBe(jeu.couleur)
    expect(material.normalMap).toBe(jeu.normale)
    expect(material.roughnessMap).toBe(jeu.rugosite)
    // La carte d'ambientCG tourne autour de 0,48 en linéaire : sans gain, le
    // bâtiment perd un tiers de sa clarté en passant à la texture.
    expect(material.color.r).toBeCloseTo(REGLAGE_MATIERE.beton.gain, 6)
    // `needsUpdate` est en écriture seule dans three ; ce qu'il incrémente, et
    // ce que le renderer relit pour recompiler, c'est `version`. Sans cela le
    // programme reste celui d'un matériau sans carte et la texture n'apparaît
    // jamais.
    expect(material.version).toBeGreaterThan(0)
  })

  it('reste regardable tant que les JPEG ne sont pas arrivés', () => {
    // `null` est l'état normal de la première seconde : un aplat vaut mieux
    // qu'une surface absente, et le matériau se recompilera tout seul.
    const material = creerMatiere('marbre', null)
    expect(material.map).toBeNull()
    expect(material.roughness).toBeLessThanOrEqual(1)
  })

  it('sort le garde-corps du noir', () => {
    // Défaut formellement identifié au lot 3 : `#6d7176` à `metalness` 0,6 rend
    // presque noir sur un tiers de la vue d'entrée. Un métal n'a pas de diffus ;
    // la correction est de descendre la métallicité ET de remonter l'albédo.
    const metal = REGLAGE_MATIERE.metal
    expect(metal.metalness).toBeLessThanOrEqual(0.3)
    expect(metal.gain).toBeGreaterThan(1.5)

    const material = creerMatiere('metal', repeterJeu(jeuJouet(), [1, 1]))
    expect(material.metalness).toBeLessThanOrEqual(0.3)
    expect(material.color.r).toBeGreaterThan(1)
  })

  it('accepte une teinte, qui se multiplie au gain de la carte', () => {
    const gris = new THREE.Color('#808080')

    // Sans carte, la teinte est le niveau final : le gain n'a rien à compenser
    // et l'appliquer rendrait l'aplat plus clair que la matière texturée.
    const nu = creerMatiere('parquet', null, { teinte: '#808080' })
    expect(nu.color.r).toBeCloseTo(gris.r, 6)

    const texture = creerMatiere('parquet', repeterJeu(jeuJouet(), [1, 1]), {
      teinte: '#808080',
    })
    expect(texture.color.r).toBeCloseTo(gris.r * REGLAGE_MATIERE.parquet.gain, 6)
  })
})

describe('peindreRebond', () => {
  it('éclaire les faces tournées vers le bas, dans le repère du MONDE', () => {
    const material = creerMatiere('beton', null)
    const shader = compiler(material)

    // La normale doit partir en monde : « vers le bas » est une direction du
    // monde, la lire en repère de vue ferait tourner le rebond avec le regard.
    expect(shader.vertexShader).toContain('mat3(modelMatrix) * objectNormal')
    expect(shader.fragmentShader).toContain('-normalize(vRebondNrm).y')
    // Modulé par l'albédo, comme les flaques du §9.2 : un rebond non modulé est
    // un autocollant lumineux.
    expect(shader.fragmentShader).toContain('diffuseColor.rgb * uRebondCouleur')
    expect(shader.uniforms.uRebond).toBeDefined()
  })

  it('expose son amplitude, réglable à l’écran', () => {
    const material = creerMatiere('beton', null, { rebond: 0.42 })
    const uniforms = material.userData.rebond as { uRebond: { value: number } }
    expect(uniforms.uRebond.value).toBe(0.42)
  })

  it('ne compile qu’UN programme pour toutes les matières', () => {
    // Sans clé constante, three prend la source de `onBeforeCompile` : une
    // fermeture par matériau, donc un programme par dalle et par mur.
    const a = creerMatiere('beton', null)
    const b = creerMatiere('marbre', null, { rebond: 0.1 })
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey())
    expect(a.customProgramCacheKey()).not.toBe('')
  })
})

describe('appliquerCartes', () => {
  it('multiplie la couleur existante au lieu de l’écraser', () => {
    // Le matériau d'un mur vient de `lighting.ts`, dont la palette de thème
    // porte le niveau d'albédo : l'écraser effacerait les quatre thèmes.
    const material = new THREE.MeshStandardMaterial({ color: '#ded4c2' })
    const attendu = new THREE.Color('#ded4c2').r * REGLAGE_MATIERE.platre.gain

    appliquerCartes(material, repeterJeu(jeuJouet(), [1, 1]), 'platre')

    expect(material.color.r).toBeCloseTo(attendu, 6)
  })

  it('ne touche à rien quand la matière n’est pas encore là', () => {
    const material = new THREE.MeshStandardMaterial({ color: '#ded4c2' })
    const avant = material.color.getHex()

    appliquerCartes(material, null, 'platre')

    expect(material.map).toBeNull()
    expect(material.color.getHex()).toBe(avant)
  })
})

// ── Affectation ──────────────────────────────────────────────────────────

describe('affectation des matières', () => {
  it('donne le béton CLAIR au mur d’enceinte, quel que soit le thème', () => {
    // L'enveloppe a sa propre matière depuis la pose du brise-soleil : même
    // carte que `beton`, gain plus haut, pour que le peigne de lames ait un fond
    // clair à rayer. Ce que cette épreuve garde n'a pas changé — c'est que le
    // THÈME d'une salle ne déborde jamais sur la façade, sans quoi le bâtiment
    // changerait de couleur de l'extérieur selon le contenu des salles.
    expect(matiereDeMur('outer', 'classic')).toBe('beton-blanc')
    expect(matiereDeMur('outer', 'modern')).toBe('beton-blanc')
    expect(matiereDeMur('outer', 'immersive')).toBe('beton-blanc')
    expect(matiereDeMur('outer', 'vault')).toBe('beton-blanc')
  })

  it('donne le plâtre du thème aux cloisons', () => {
    expect(matiereDeMur('inner', 'classic')).toBe('platre')
    expect(matiereDeMur('inner', 'modern')).toBe('platre-peint')
    expect(matiereDeMur('side', 'immersive')).toBe('platre-peint')
    // La réserve est un sous-sol technique : le béton brut y est une
    // information, pas une économie.
    expect(matiereDeMur('inner', 'vault')).toBe('beton')
  })

  it('donne le marbre au rez-de-chaussée et au puits de lumière', () => {
    expect(matiereDeDalle(0)).toBe('marbre')
    expect(matiereDeDalle(1)).toBe('parquet')
    expect(matiereDeDalle(-1)).toBe('beton')
  })
})
