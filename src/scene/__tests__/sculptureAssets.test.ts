/**
 * Le GLB COMMITÉ tient ses cotes et son budget.
 *
 * Même parti que `propAssets.test.ts` pour `PROP_METRICS` : le budget de
 * triangles et l'échelle réelle sont écrits en commentaire dans le script
 * Blender, et rien ne les maintiendrait vrais. Une pièce reconstruite avec un
 * autre réglage passerait tous les tests de placement — qui ne lisent que le
 * JSON — tout en doublant le budget de la scène ou en sortant à la mauvaise
 * taille. Le commentaire devient donc une épreuve.
 *
 * Aucun décodage : les positions sont compressées en Draco, mais la
 * spécification glTF EXIGE que l'accesseur POSITION porte ses `min` et `max`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { bornesDuNoeud, lireGltf } from '../../domain/__tests__/glbBounds'
import { parseMuseumConfig } from '../../schema'
import { SCULPTURE_BUDGET_TRIANGLES } from '../sculptureAssets'

const CHEMIN = `${process.cwd()}/public/assets/sculptures/bavette.glb`
const gltf = lireGltf(CHEMIN)

/**
 * Le socle et la hauteur de `bavette`, LUS dans `museum.config.json` — pas
 * recopiés. Une version antérieure de ce fichier déclarait `SOCLE = { width:
 * 1.1, depth: 1.1 }` et `HAUTEUR = 0.9` en dur, avec un commentaire affirmant
 * qu'ils venaient de la config. C'était faux, et ça ne protégeait rien :
 * mesuré, muter `museum.config.json` pour donner à `bavette` un socle de
 * 0,40 × 0,40 m et une hauteur de 3 m laissait la suite entière au vert. La
 * garde que ce fichier prétend fournir — « la pièce tient sur son socle » —
 * n'existe que si les cotes viennent réellement du fichier qu'un fork édite.
 */
const config = parseMuseumConfig(
  JSON.parse(readFileSync(`${process.cwd()}/museum.config.json`, 'utf8')),
)
// `MuseumConfig.sculptures` est OPTIONNEL dans le type (les fixtures et les
// forks n'ont aucune raison de porter un tableau vide), même si le schéma zod
// lui donne `.default([])` à l'exécution : le `??` est donc requis par `tsc`,
// pas par une vraie incertitude sur la valeur qui sort de `parseMuseumConfig`.
const BAVETTE = (config.sculptures ?? []).find((s) => s.id === 'bavette')
if (BAVETTE === undefined) {
  throw new Error(
    'museum.config.json : aucune sculpture « bavette » déclarée — ce fichier de test n’a plus rien à mesurer',
  )
}
const SOCLE = BAVETTE.plinth
const HAUTEUR = BAVETTE.height

describe('bavette.glb', () => {
  it('ne dépasse pas le budget de triangles', () => {
    let total = 0
    for (const mesh of gltf.meshes ?? []) {
      for (const prim of mesh.primitives) {
        // Draco stocke le compte dans l'extension ; à défaut, l'accesseur
        // d'index ou de position le porte.
        const p = prim as unknown as { indices?: number; attributes: Record<string, number> }
        const acc =
          p.indices !== undefined
            ? gltf.accessors?.[p.indices]
            : gltf.accessors?.[p.attributes.POSITION]
        total += Math.floor(((acc as { count?: number })?.count ?? 0) / 3)
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(SCULPTURE_BUDGET_TRIANGLES)
  })

  it('fait exactement la hauteur déclarée par la configuration', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect(b.max[1] - b.min[1]).toBeCloseTo(HAUTEUR, 2)
  })

  it('a son origine AU SOL — c’est le point d’ancrage que domain/ calcule', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect(b.min[1]).toBeCloseTo(0, 2)
  })

  it('est centrée en plan sur son origine', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 2)
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(0, 2)
  })

  it('TIENT SUR SON SOCLE — c’est ce qui justifie que l’emprise soit celle du socle', () => {
    const b = bornesDuNoeud(gltf, nomDuNoeud())!
    expect(b.max[0] - b.min[0]).toBeLessThanOrEqual(SOCLE.width)
    expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(SOCLE.depth)
  })

  it('pèse moins que le budget de chargement qu’on lui accorde', () => {
    expect(readFileSync(CHEMIN).byteLength).toBeLessThan(600 * 1024)
  })
})

/** Le nœud racine du fichier, quel que soit le nom que Blender lui a donné. */
function nomDuNoeud(): string {
  const nom = (gltf.nodes ?? []).find((n) => n.name !== undefined)?.name
  if (nom === undefined) throw new Error('bavette.glb : aucun nœud nommé')
  return nom
}
