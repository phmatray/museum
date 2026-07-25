/**
 * Tests de l'éclairage peint (spec §9.2).
 *
 * Quatre familles d'assertions, dans cet ordre d'importance :
 *
 *  - LA RÉGRESSION QUI A MOTIVÉ LE LOT 3 : aucun thème ne peut redevenir assez
 *    sombre pour que la salle tombe au noir, et la salle d'honneur — seule salle
 *    `immersive` — ne peut pas être plus sombre qu'une salle `classic` ;
 *  - le piège des tableaux d'uniformes : three envoie TOUJOURS `MAX_HALOS`
 *    éléments, un tableau plus court laisserait des flaques fantômes ;
 *  - le piège du cache de programme : sans clé constante, un mur = un shader ;
 *  - la géométrie des flaques : bonne position le long du mur, repère unitaire,
 *    et aucun NaN sur un mur dégénéré.
 *
 * Aucun canvas : `MeshStandardMaterial` et `onBeforeCompile` se construisent et
 * s'exécutent en Node. `buildAmbientEnvironment` est le seul export non testé
 * ici — il exige un `WebGLRenderer`, donc un vrai contexte graphique.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { Museum, Placement, ThemeId, Wall } from '../../domain/types'
import {
  MAX_HALOS,
  THEME_PALETTE,
  TONE_MAPPING,
  createWallMaterial,
  lightWellWash,
  wallHalos,
} from '../lighting'

// ── Fabriques ────────────────────────────────────────────────────────────

function accrochage(over: Partial<Placement> = {}): Placement {
  return {
    key: 'owner/name',
    u: 5,
    centerHeight: 1.45,
    width: 1.4,
    height: 0.7,
    atlas: 0,
    layer: 0,
    pinned: false,
    ...over,
  }
}

/** Mur de 10 m le long de +x, normale intérieure vers −z. */
function mur(over: Partial<Wall> = {}): Wall {
  return {
    id: 'test',
    a: { x: 0, z: 0 },
    b: { x: 10, z: 0 },
    height: 4.3,
    kind: 'side',
    normal: { x: 0, z: -1 },
    openings: [],
    placements: [],
    ...over,
  }
}

/**
 * Luminance relative d'une couleur sRGB, dans l'espace LINÉAIRE.
 *
 * C'est la seule grandeur qui dise quelque chose sur « sombre » ou « clair » :
 * comparer des composantes sRGB à la main donnerait un classement faux dès que
 * deux teintes diffèrent.
 */
function luminance(hex: string): number {
  // PIÈGE : `new THREE.Color('#…')` convertit DÉJÀ de sRGB vers l'espace de
  // travail linéaire (`ColorManagement` est actif par défaut depuis r152).
  // Appeler `convertSRGBToLinear()` en plus applique la courbe deux fois et
  // divise la luminance par sept — de quoi faire échouer le seuil sur des
  // couleurs parfaitement claires.
  const c = new THREE.Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

// ── La régression : plus jamais de salle noire ───────────────────────────

describe('palette des thèmes', () => {
  const THEMES: ThemeId[] = ['classic', 'modern', 'immersive', 'vault']

  it('couvre exactement les thèmes du contrat de domaine', () => {
    expect(Object.keys(THEME_PALETTE).sort()).toEqual([...THEMES].sort())
  })

  it("ne laisse aucun thème sous le seuil d'une salle noire", () => {
    // Sous deux lumières seulement, un mur en dessous de ~15 % de luminance
    // linéaire ne se distingue plus du noir dès qu'il sort du puits de lumière.
    // C'est exactement ce que faisait l'ancien `immersive` (#575e69, 0,10).
    for (const theme of THEMES) {
      expect(luminance(THEME_PALETTE[theme].wall)).toBeGreaterThan(0.15)
    }
  })

  it("fait de la salle d'honneur l'espace le plus lumineux, pas le plus sombre", () => {
    // La seule salle `immersive` du bâtiment est la salle d'honneur du
    // rez-de-chaussée, sous la verrière de l'atrium — c'est l'ENTRÉE. Le thème
    // ne peut donc pas être plus sombre que celui des galeries courantes.
    expect(luminance(THEME_PALETTE.immersive.wall)).toBeGreaterThanOrEqual(
      luminance(THEME_PALETTE.classic.wall),
    )
    expect(THEME_PALETTE.immersive.washHigh).toBeGreaterThan(
      THEME_PALETTE.classic.washHigh,
    )
  })

  it('garde la réserve plus sombre que les salles ouvertes au public', () => {
    // `vault` est au niveau −1, sous terre : sombre y est une information.
    expect(luminance(THEME_PALETTE.vault.wall)).toBeLessThan(
      luminance(THEME_PALETTE.classic.wall),
    )
  })

  it("n'utilise pas le rendu des tons qui écrasait les basses lumières", () => {
    expect(TONE_MAPPING).not.toBe(THREE.ACESFilmicToneMapping)
  })
})

// ── Puits de lumière ─────────────────────────────────────────────────────

describe('lightWellWash', () => {
  it('décroît quand on descend dans le bâtiment', () => {
    expect(lightWellWash(9.4)).toBeGreaterThan(lightWellWash(4.7))
    expect(lightWellWash(4.7)).toBeGreaterThan(lightWellWash(0))
    expect(lightWellWash(0)).toBeGreaterThan(lightWellWash(-4.7))
  })

  it('reste positif et borné hors des étages réels', () => {
    for (const y of [-1000, -4.7, 0, 13.7, 1000]) {
      const v = lightWellWash(y)
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(0.4)
    }
  })
})

// ── Géométrie des flaques ────────────────────────────────────────────────

describe('wallHalos', () => {
  it('place la flaque à la bonne abscisse le long du mur', () => {
    const halos = wallHalos(mur({ placements: [accrochage({ u: 3 })] }))
    expect(halos.count).toBe(1)
    expect(halos.centres[0].x).toBeCloseTo(3, 6)
    expect(halos.centres[0].z).toBeCloseTo(0, 6)
  })

  it('lève le centre de la flaque AU-DESSUS de l’axe de l’œuvre', () => {
    // Un spot muséal est au plafond et vise vers le bas : le cœur de la tache
    // ne tombe jamais pile sur l'axe du cadre.
    const halos = wallHalos(mur({ placements: [accrochage()] }))
    expect(halos.centres[0].y).toBeGreaterThan(1.45)
  })

  it('suit la direction du mur, pas les axes du monde', () => {
    // Mur le long de −z : une œuvre à u = 4 doit tomber à z = −4, pas à x = 4.
    const halos = wallHalos(
      mur({
        a: { x: 2, z: 0 },
        b: { x: 2, z: -10 },
        normal: { x: -1, z: 0 },
        placements: [accrochage({ u: 4 })],
      }),
    )
    expect(halos.centres[0].x).toBeCloseTo(2, 6)
    expect(halos.centres[0].z).toBeCloseTo(-4, 6)
    expect(halos.tangente.length()).toBeCloseTo(1, 6)
    expect(halos.normale.length()).toBeCloseTo(1, 6)
  })

  it('donne des ellipses plus larges que le cadre', () => {
    const p = accrochage({ width: 2, height: 1 })
    const halos = wallHalos(mur({ placements: [p] }))
    expect(halos.rayons[0].x).toBeGreaterThan(p.width / 2)
    expect(halos.rayons[0].y).toBeGreaterThan(p.height / 2)
  })

  it('plafonne à MAX_HALOS sans jeter', () => {
    const trop = Array.from({ length: MAX_HALOS + 5 }, (_, i) =>
      accrochage({ u: i * 0.5 }),
    )
    const halos = wallHalos(mur({ placements: trop }))
    expect(halos.count).toBe(MAX_HALOS)
  })

  it('rend un repère fini sur un mur dégénéré', () => {
    // Un mur de longueur nulle donnerait une tangente NaN, qui contaminerait
    // tout le fragment shader — donc un mur entièrement noir ou blanc.
    const halos = wallHalos(
      mur({ a: { x: 1, z: 1 }, b: { x: 1, z: 1 }, normal: { x: 0, z: 0 } }),
    )
    for (const v of [halos.tangente, halos.normale]) {
      expect(Number.isFinite(v.x)).toBe(true)
      expect(Number.isFinite(v.y)).toBe(true)
      expect(Number.isFinite(v.z)).toBe(true)
      expect(v.length()).toBeCloseTo(1, 6)
    }
  })
})

// ── Matériau ─────────────────────────────────────────────────────────────

interface PoolUniforms {
  uHaloCount: { value: number }
  uHaloPos: { value: THREE.Vector3[] }
  uHaloRadius: { value: THREE.Vector2[] }
  uWashBack: { value: number }
}

function uniformes(material: THREE.Material): PoolUniforms {
  return material.userData.pools as PoolUniforms
}

/**
 * Fait compiler le matériau contre un shader factice contenant les mêmes
 * points d'injection que `meshphysical`. C'est le seul moyen de vérifier
 * l'injection sans contexte WebGL.
 */
function compile(material: THREE.MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: [
      '#include <common>',
      'void main() {',
      '  #include <beginnormal_vertex>',
      '  #include <begin_vertex>',
      '}',
    ].join('\n'),
    fragmentShader: [
      '#include <common>',
      'void main() {',
      '  #include <emissivemap_fragment>',
      '}',
    ].join('\n'),
  }
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  )
  return shader
}

describe('createWallMaterial', () => {
  it('remplit les tableaux d’uniformes jusqu’à MAX_HALOS', () => {
    // three envoie toujours MAX_HALOS éléments : un tableau plus court
    // laisserait les derniers slots sur les valeurs de la frame précédente,
    // c'est-à-dire des flaques venues d'un autre mur.
    const material = createWallMaterial({
      theme: 'classic',
      wall: mur({ placements: [accrochage()] }),
      elevation: 0,
    })
    const u = uniformes(material)
    expect(u.uHaloCount.value).toBe(1)
    expect(u.uHaloPos.value).toHaveLength(MAX_HALOS)
    expect(u.uHaloRadius.value).toHaveLength(MAX_HALOS)
    // Les rayons de bourrage ne doivent pas être nuls : une division par zéro
    // dans le shader donnerait un NaN sur tout le mur, même si le compteur
    // interdit d'y entrer.
    for (const r of u.uHaloRadius.value) {
      expect(r.x).toBeGreaterThan(0)
      expect(r.y).toBeGreaterThan(0)
    }
    material.dispose()
  })

  it('ne peint le dos que des murs qui donnent sur l’atrium', () => {
    const dedans = createWallMaterial({
      theme: 'classic',
      wall: mur({ kind: 'inner' }),
      elevation: 4.7,
    })
    const facade = createWallMaterial({
      theme: 'classic',
      wall: mur({ kind: 'outer' }),
      elevation: 4.7,
    })
    expect(uniformes(dedans).uWashBack.value).toBeGreaterThan(0)
    // La façade est déjà en plein soleil : la repeindre ne ferait que la brûler.
    expect(uniformes(facade).uWashBack.value).toBe(0)
    dedans.dispose()
    facade.dispose()
  })

  it('partage un seul programme entre tous les murs', () => {
    // Sans clé constante, three prend la source d'`onBeforeCompile` comme clé :
    // une fermeture par mur, donc ~70 shaders compilés au démarrage.
    const a = createWallMaterial({ theme: 'classic', wall: mur(), elevation: 0 })
    const b = createWallMaterial({
      theme: 'vault',
      wall: mur({ id: 'autre', placements: [accrochage()] }),
      elevation: -4.7,
    })
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey())
    a.dispose()
    b.dispose()
  })

  it('injecte les flaques dans les deux étages du shader', () => {
    const material = createWallMaterial({
      theme: 'classic',
      wall: mur({ placements: [accrochage()] }),
      elevation: 0,
    })
    const shader = compile(material)

    // Les varyings doivent être déclarés des deux côtés, sinon le lien échoue.
    expect(shader.vertexShader).toContain('varying vec3 vFlaquePos')
    expect(shader.vertexShader).toContain('vFlaquePos = position')
    expect(shader.vertexShader).toContain('vFlaqueNrm = objectNormal')
    expect(shader.fragmentShader).toContain('varying vec3  vFlaquePos')
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance')
    // La contribution DOIT être modulée par l'albédo : sans ce facteur, la
    // flaque devient un autocollant lumineux identique sur tous les thèmes.
    expect(shader.fragmentShader).toContain('diffuseColor.rgb * uHaloColor')
    // Les uniformes du module doivent avoir rejoint ceux du shader, sinon les
    // tableaux restent à zéro et aucune flaque n'apparaît.
    expect(shader.uniforms.uHaloCount).toBe(uniformes(material).uHaloCount)
    material.dispose()
  })

  it('est déterministe', () => {
    const wall = mur({ placements: [accrochage(), accrochage({ u: 7 })] })
    const a = uniformes(
      createWallMaterial({ theme: 'modern', wall, elevation: 4.7 }),
    )
    const b = uniformes(
      createWallMaterial({ theme: 'modern', wall, elevation: 4.7 }),
    )
    expect(a.uHaloPos.value.map((v) => v.toArray())).toEqual(
      b.uHaloPos.value.map((v) => v.toArray()),
    )
  })
})

// ── Le musée réel ────────────────────────────────────────────────────────

describe('musée réel', () => {
  const museum: Museum = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../public/data/museum.json'),
      'utf-8',
    ),
  )

  it('tient dans MAX_HALOS sur tous les murs accrochés', () => {
    const max = Math.max(
      ...museum.floors.flatMap((f) =>
        f.rooms.flatMap((r) => r.walls.map((w) => w.placements.length)),
      ),
    )
    expect(max).toBeLessThanOrEqual(MAX_HALOS)
  })

  it('fabrique un matériau fini pour chaque mur du bâtiment', () => {
    let murs = 0
    for (const floor of museum.floors) {
      for (const room of floor.rooms) {
        for (const wall of room.walls) {
          const material = createWallMaterial({
            theme: room.theme,
            wall,
            elevation: floor.elevation,
          })
          const u = uniformes(material)
          expect(u.uHaloCount.value).toBe(wall.placements.length)
          for (const p of u.uHaloPos.value) {
            expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
          }
          material.dispose()
          murs++
        }
      }
    }
    expect(murs).toBeGreaterThan(0)
  })
})
