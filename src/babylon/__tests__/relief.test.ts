import { NullEngine } from '@babylonjs/core/Engines/nullEngine'
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Frustum } from '@babylonjs/core/Maths/math.frustum'
import { FromHalfFloat } from '@babylonjs/core/Misc/halfFloat'
import { Scene } from '@babylonjs/core/scene'
import { describe, expect, it } from 'vitest'

import { hauteurDuParc } from '../../plan/relief'
import { gabaritCube } from '../boites'
import { PARC } from '../parc'
import { brins, carteDuSol, codeDuGazon, GAZONS, geometrieParvis, geometriePelouse, parcellesDeGazon, uneEnVue } from '../relief'

/** La normale géométrique (sens de Babylon : (b − a) × (c − a) inversé, comme ComputeNormals) du triangle t. */
function normale(p: ArrayLike<number>, i: ArrayLike<number>, t: number): [number, number, number] {
  const v = (k: number) => [p[3 * i[3 * t + k]], p[3 * i[3 * t + k] + 1], p[3 * i[3 * t + k] + 2]]
  const [a, b, c] = [v(0), v(1), v(2)]
  const [u, w] = [[b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]]
  return [-(u[1] * w[2] - u[2] * w[1]), -(u[2] * w[0] - u[0] * w[2]), -(u[0] * w[1] - u[1] * w[0])]
}

describe('le relief', () => {
  const sol = geometriePelouse(PARC, gabaritCube(new Scene(new NullEngine())))

  it('pose la pelouse sur hauteurDuParc, ses faces et normales vers le haut, couleurs RGBA linéaires', () => {
    const p = sol.positions!
    // Le premier nœud de la grille : le coin nord-ouest du terrain.
    expect([p[0], p[2]]).toEqual([-40, -40])
    expect(p[1]).toBeCloseTo(hauteurDuParc(-40, -40), 6)
    expect(sol.colors!.length / 4).toBe(p.length / 3)
    expect(sol.uvs!.length / 2).toBe(p.length / 3)
    // Le premier triangle (pelouse) regarde le ciel, dans le sens de Babylon.
    expect(normale(p, sol.indices!, 0)[1]).toBeGreaterThan(0)
    // Un nœud au milieu du parc (hors jupe) : sa normale lissée regarde le ciel.
    expect(sol.normals![3 * ((70 + 40) * 129 + 10) + 1]).toBeGreaterThan(0.5)
  })

  it('brume de la campagne au-delà de 1, et pas une maille de campagne dans le terrain', () => {
    expect(Math.max(...sol.colors!)).toBeGreaterThan(1.4)
    const p = sol.positions!
    const i = sol.indices!
    let dedans = 0
    for (let t = 0; t < i.length / 3; t++) {
      const [x, z] = [0, 1, 2].reduce(([sx, sz], k) => [sx + p[3 * i[3 * t + k]] / 3, sz + p[3 * i[3 * t + k] + 2] / 3], [0, 0])
      if (x < -40 || x > 88 || z < -40 || z > 80) continue
      dedans++
    }
    // La pelouse et la fosse, rien d'autre : < 2 triangles par m² du terrain.
    expect(dedans).toBeLessThan(2 * 128 * 120 + 12)
  })

  it('le parvis : 4 bandes à 4 cm, dessus vers le haut, côtés vers le dehors, angles arrondis', () => {
    const g = geometrieParvis(PARC)
    const p = g.positions!
    const ys = new Set<number>()
    for (let k = 1; k < p.length; k += 3) ys.add(p[k])
    expect([...ys].sort()).toEqual([0, 0.04])
    expect(normale(p, g.indices!, 0)[1]).toBeGreaterThan(0)
    // Aucun sommet dans le coin vif (-5, -5) : il est arrondi de 4 m.
    for (let k = 0; k < p.length; k += 3) expect(Math.hypot(p[k] + 5, p[k + 2] + 5)).toBeGreaterThan(1)
    // Les côtés regardent hors de leur bande (bandes convexes : depuis leur centre ; ceux d'un bord partagé, ambigus, comptent contre).
    const ix = g.indices!
    let cotes = 0
    for (let t = 0; t < ix.length / 3; t++) {
      const n = normale(p, ix, t)
      if (Math.abs(n[1]) > 1e-9) continue
      const [x, z] = [0, 1, 2].reduce(([sx, sz], k) => [sx + p[3 * ix[3 * t + k]] / 3, sz + p[3 * ix[3 * t + k] + 2] / 3], [0, 0])
      const r = PARC.dalles.find((b) => x >= b.x - 1e-6 && x <= b.x + b.width + 1e-6 && z >= b.z - 1e-6 && z <= b.z + b.depth + 1e-6)!
      cotes += Math.sign(n[0] * (x - r.x - r.width / 2) + n[2] * (z - r.z - r.depth / 2))
    }
    expect(cotes).toBeGreaterThan(180)
  })

  it('la carte du sol : 256 × 240, la cote en rouge, pas d’herbe sur le parvis, de l’herbe au loin', () => {
    const c = carteDuSol(PARC)
    expect([c.largeur, c.hauteur]).toEqual([256, 240])
    const texel = (x: number, z: number) => (Math.floor((z + 40) / 0.5) * 256 + Math.floor((x + 40) / 0.5)) * 4
    expect(FromHalfFloat(c.donnees[texel(20, 20) + 1])).toBe(0)
    expect(FromHalfFloat(c.donnees[texel(-30, -30)])).toBeCloseTo(hauteurDuParc(-29.75, -29.75), 2)
    const verts = Array.from({ length: c.largeur * c.hauteur }, (_, k) => c.donnees[4 * k + 1]).filter((g) => g !== 0).length
    expect(verts).toBeGreaterThan(c.largeur * c.hauteur * 0.3)

    const parcelles = parcellesDeGazon(c)
    expect(parcelles.length).toBeGreaterThan(100)
    expect(parcelles.every((b) => b[4] > b[1])).toBe(true)
    // Aucune parcelle au milieu du parvis.
    expect(parcelles.some((b) => b[0] < 20 && b[3] > 20 && b[2] < 20 && b[5] > 20)).toBe(false)
  })

  it('uneEnVue : la parcelle devant la caméra, pas celle derrière ni hors du rayon', () => {
    const plans = Frustum.GetPlanes(Matrix.LookAtRH(new Vector3(0, 1.6, 0), new Vector3(0, 1.6, -10), Vector3.Up())
      .multiply(Matrix.PerspectiveFovRH(0.8, 1, 0.1, 1000)))
    const devant: [number, number, number, number, number, number] = [-2, 0, -8, 2, 0.5, -4]
    const derriere: [number, number, number, number, number, number] = [-2, 0, 4, 2, 0.5, 8]
    expect(uneEnVue([devant], plans, 0, 0, 10)).toBe(true)
    expect(uneEnVue([derriere], plans, 0, 0, 10)).toBe(false)
    expect(uneEnVue([devant], plans, 0, 0, 3)).toBe(false)
  })

  it('les brins : 7 sommets, 5 triangles, un semis déterministe dans le carré', () => {
    const a = brins(GAZONS[0], 7)
    expect(a.positions.length / 3).toBe(7)
    expect(a.indices.length / 3).toBe(5)
    expect(a.aBrin.length).toBe(4 * GAZONS[0].nombre)
    expect(a.aBrin.every((v) => v >= 0 && v < GAZONS[0].cote)).toBe(true)
    // La densité de three : 110 000 brins sur 20 m.
    expect(GAZONS[0].nombre / GAZONS[0].cote ** 2).toBeCloseTo(110000 / 400, 0)
    expect(brins(GAZONS[0], 7).aBrin.slice(0, 8)).toEqual(a.aBrin.slice(0, 8))
    expect(brins(GAZONS[0], 8).aBrin[0]).not.toBe(a.aBrin[0])
  })

  it('teinte le gazon de la saison et du temps (gazon.ts), dans les deux langues', () => {
    for (const wgsl of [false, true]) {
      const c = codeDuGazon(GAZONS[0], [0, 0, 1, 1], wgsl)
      const u = wgsl ? 'uniforms.' : ''
      expect(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA).toContain('* (1.0 - 0.15 * gs.y) * (1.0 - 0.3 * gs.z)')
      expect(c.vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain(`(1.0 - 0.85 * ${u}gazonSaison.w)`)
      expect(c.vertex.CUSTOM_VERTEX_UPDATE_POSITION).toContain(`clamp(0.6 + 0.2 * ${u}gazonCam.w, 0.5, 3.0)`)
      expect(/\bvec[234]\(/.test(c.fragment.CUSTOM_FRAGMENT_UPDATE_ALPHA)).toBe(!wgsl)
    }
  })
})
