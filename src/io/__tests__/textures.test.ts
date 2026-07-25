/**
 * LOT 4 — Tests du chargement des cartes PBR (spec §9.4).
 *
 * Rien ici ne touche à WebGL : un `Texture` de three est un objet JavaScript
 * ordinaire tant qu'aucun renderer ne le téléverse, et le chargeur est injecté.
 * C'est précisément pour ça que le chargement est séparé du rendu.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. L'ESPACE COLORIMÉTRIQUE. La couleur en sRGB, la normale et la rugosité en
 *     données brutes. Se tromper délave la matière ET tord son relief, sans
 *     jamais lever la moindre erreur : c'est le défaut le plus cher à
 *     diagnostiquer de tout le rendu, parce qu'il ressemble à « la lumière n'est
 *     pas bonne ».
 *  2. LA MUTUALISATION. Une matière posée sur soixante-dix murs doit être
 *     téléchargée UNE fois. Une régression ici ne casse rien — elle multiplie
 *     par soixante-dix le temps de chargement et la VRAM.
 *  3. LES CHEMINS. `NormalGL` et non `NormalDX`, et un chemin relatif à
 *     `BASE_URL` : les deux erreurs ne se voient qu'à l'exécution, l'une comme
 *     un relief inversé, l'autre comme un 404 sur GitHub Pages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import type { ChargeurDeTextures } from '../textures'
import {
  ANISOTROPIE,
  MATERIALS_PATH,
  SOURCE_AMBIENTCG,
  chargerMatiere,
  cheminsDeMatiere,
  configurerJeu,
  matiereEnCache,
  viderCacheDeMatieres,
} from '../textures'

// ── Chargeur d'essai ─────────────────────────────────────────────────────

/**
 * Un chargeur qui rend une texture vide, immédiatement. Il note les URL
 * demandées : c'est la seule mesure qui prouve la mutualisation, puisque le
 * cache ne se voit pas de l'extérieur.
 */
function chargeurEspion(): ChargeurDeTextures & { urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    load(url, onLoad) {
      urls.push(url)
      const texture = new THREE.Texture()
      // Le vrai `TextureLoader` rappelle de façon asynchrone : imiter un retour
      // synchrone masquerait toute course entre deux appelants.
      queueMicrotask(() => onLoad?.(texture))
      return texture
    },
  }
}

afterEach(() => {
  viderCacheDeMatieres()
})

// ── Chemins ──────────────────────────────────────────────────────────────

describe('cheminsDeMatiere', () => {
  it('compose les trois cartes depuis l’identifiant ambientCG', () => {
    const chemins = cheminsDeMatiere('beton', '/musee/')
    expect(chemins.couleur).toBe(
      `/musee/${MATERIALS_PATH}Concrete034/Concrete034_1K-JPG_Color.jpg`,
    )
    expect(chemins.normale).toContain('Concrete034_1K-JPG_NormalGL.jpg')
    expect(chemins.rugosite).toContain('Concrete034_1K-JPG_Roughness.jpg')
  })

  it('demande la normale en convention OpenGL, jamais DirectX', () => {
    // `NormalDX` est le miroir vertical de `NormalGL` : le prendre inverse creux
    // et bosses, ce qui ne se voit qu'en lumière rasante.
    for (const id of Object.keys(SOURCE_AMBIENTCG) as (keyof typeof SOURCE_AMBIENTCG)[]) {
      const chemins = cheminsDeMatiere(id, '/')
      expect(chemins.normale).toMatch(/NormalGL\.jpg$/)
      expect(chemins.normale).not.toContain('NormalDX')
    }
  })

  it('reste relatif à la base du site', () => {
    // Sur GitHub Pages le site vit sous /<dépôt>/ : un chemin commençant par
    // `/assets` y donnerait un 404 silencieux.
    const chemins = cheminsDeMatiere('marbre', '/depot/')
    expect(chemins.couleur.startsWith('/depot/')).toBe(true)
  })
})

// ── Colorimétrie ─────────────────────────────────────────────────────────

describe('configurerJeu', () => {
  it('déclare la couleur en sRGB et les données en brut', () => {
    const jeu = configurerJeu({
      couleur: new THREE.Texture(),
      normale: new THREE.Texture(),
      rugosite: new THREE.Texture(),
    })

    expect(jeu.couleur.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(jeu.normale.colorSpace).toBe(THREE.NoColorSpace)
    expect(jeu.rugosite.colorSpace).toBe(THREE.NoColorSpace)
  })

  it('boucle les trois cartes et pose la même anisotropie', () => {
    const jeu = configurerJeu({
      couleur: new THREE.Texture(),
      normale: new THREE.Texture(),
      rugosite: new THREE.Texture(),
    })

    for (const carte of [jeu.couleur, jeu.normale, jeu.rugosite]) {
      // Sans `RepeatWrapping`, une répétition supérieure à 1 étire le dernier
      // texel sur toute la surface au lieu de répéter le motif.
      expect(carte.wrapS).toBe(THREE.RepeatWrapping)
      expect(carte.wrapT).toBe(THREE.RepeatWrapping)
      // L'anisotropie entre dans la clé de cache de three : trois valeurs
      // différentes donneraient trois textures GPU pour une seule image.
      expect(carte.anisotropy).toBe(ANISOTROPIE)
    }
  })
})

// ── Mutualisation ────────────────────────────────────────────────────────

describe('chargerMatiere', () => {
  it('charge les trois cartes et les paramètre', async () => {
    const chargeur = chargeurEspion()
    const jeu = await chargerMatiere('platre', chargeur)

    expect(chargeur.urls).toHaveLength(3)
    expect(jeu.couleur.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(jeu.rugosite.colorSpace).toBe(THREE.NoColorSpace)
  })

  it('ne charge une matière qu’une fois, quel que soit le nombre d’appelants', async () => {
    const chargeur = chargeurEspion()

    const premier = await chargerMatiere('beton', chargeur)
    const second = await chargerMatiere('beton', chargeur)

    // Trois requêtes au total, pas six : c'est toute la mutualisation.
    expect(chargeur.urls).toHaveLength(3)
    // Et surtout les MÊMES objets `Texture` : un second jeu, même issu du même
    // téléchargement, doublerait la VRAM.
    expect(second.couleur).toBe(premier.couleur)
    expect(second.normale).toBe(premier.normale)
    expect(second.rugosite).toBe(premier.rugosite)
  })

  it('partage la requête entre deux appelants concurrents', async () => {
    const chargeur = chargeurEspion()

    // Le cas réel : soixante-dix murs montés dans la même image, tous avant que
    // le premier octet ne soit arrivé.
    const [a, b] = await Promise.all([
      chargerMatiere('metal', chargeur),
      chargerMatiere('metal', chargeur),
    ])

    expect(chargeur.urls).toHaveLength(3)
    expect(a).toBe(b)
  })

  it('sépare les matières', async () => {
    const chargeur = chargeurEspion()
    const beton = await chargerMatiere('beton', chargeur)
    const marbre = await chargerMatiere('marbre', chargeur)

    expect(chargeur.urls).toHaveLength(6)
    expect(marbre.couleur).not.toBe(beton.couleur)
  })

  it('publie la matière en cache une fois chargée', async () => {
    const chargeur = chargeurEspion()
    expect(matiereEnCache('parquet')).toBeUndefined()

    const jeu = await chargerMatiere('parquet', chargeur)

    // C'est ce qui permet à un composant remonté de poser ses cartes dès la
    // première image, sans repasser par un aplat.
    expect(matiereEnCache('parquet')).toBe(jeu)
  })

  it('n’emprisonne pas une matière après un échec réseau', async () => {
    const casse: ChargeurDeTextures = {
      load(_url, _onLoad, _onProgress, onError) {
        const texture = new THREE.Texture()
        queueMicrotask(() => onError?.(new Error('404')))
        return texture
      },
    }
    const espion = vi.fn(casse.load)

    await expect(chargerMatiere('metal', { load: espion })).rejects.toThrow()

    // Un rejet mémorisé condamnerait la matière pour toute la session : une
    // coupure d'une seconde suffirait à laisser le garde-corps en aplat.
    const bon = chargeurEspion()
    const jeu = await chargerMatiere('metal', bon)
    expect(jeu.couleur.colorSpace).toBe(THREE.SRGBColorSpace)
  })
})
