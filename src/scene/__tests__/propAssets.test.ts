/**
 * LOT 4 — Le catalogue des modèles doit couvrir le catalogue des placements.
 *
 * Ce test ne charge rien : décoder du Draco et du JPEG demanderait un WebGL que
 * jsdom n'a pas. Il vérifie la seule chose qui puisse casser en silence — la
 * CORRESPONDANCE entre les identifiants que `domain/props.ts` produit et ceux
 * que `propAssets.ts` sait fournir. Une faute de frappe dans l'une des deux
 * tables ne provoque aucune erreur : le prop disparaît simplement de la scène,
 * ce qui ne se voit qu'en cherchant un banc qu'on ne trouve pas.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { PROP_IDS } from '../../domain/props'
import type { PropId } from '../../domain/props'
import { DRACO_PATH, ESPECES_GLB, KIT_PATH, NOEUDS_DU_KIT, PLANTS_LOD } from '../propAssets'

describe('propAssets — le catalogue', () => {
  it('fournit un modèle pour chaque identifiant de prop', () => {
    const fournis = new Set<PropId>([
      ...Object.values(NOEUDS_DU_KIT),
      ...ESPECES_GLB.map((espece) => espece.id),
    ])
    expect([...PROP_IDS].filter((id) => !fournis.has(id))).toEqual([])
  })

  it("ne fournit rien qui n'ait de placement", () => {
    const connus = new Set<string>(PROP_IDS)
    expect(Object.values(NOEUDS_DU_KIT).filter((id) => !connus.has(id))).toEqual([])
    expect(ESPECES_GLB.map((e) => e.id).filter((id) => !connus.has(id))).toEqual([])
  })

  it('ne monte aucune espèce deux fois sur le même identifiant', () => {
    const ids = [...Object.values(NOEUDS_DU_KIT), ...ESPECES_GLB.map((e) => e.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('garde des chemins RELATIFS, pour survivre à GitHub Pages', () => {
    // Le site vit sous `/<dépôt>/` en production : un chemin qui commence par
    // une barre y donne un 404, et le mobilier disparaît sans une seule erreur
    // dans la console — `propAssetsResource` avale l'échec par conception.
    for (const chemin of [KIT_PATH, PLANTS_LOD, DRACO_PATH]) {
      expect(chemin.startsWith('/')).toBe(false)
      expect(chemin.startsWith('http')).toBe(false)
    }
    // `DRACO_PATH` est un DOSSIER — `setDecoderPath` y concatène les noms des
    // deux fichiers du décodeur. Les deux autres sont des fichiers.
    expect(DRACO_PATH.endsWith('/')).toBe(true)
    expect(KIT_PATH.endsWith('.glb')).toBe(true)
    expect(PLANTS_LOD.endsWith('.glb')).toBe(true)
  })

  it('les nœuds attendus sont ceux que Blender met dans le fichier', () => {
    // `ESPECES_GLB` lit `plants-lod.glb`, que `decimate-plants.py` écrit à
    // partir de sa propre liste `GARDES`. Deux listes séparées par un changement
    // de langage : sans ce test, en retirer un sujet côté Blender ferait
    // disparaître une espèce du musée avec un simple avertissement en console.
    const script = readFileSync(
      resolve(__dirname, '../../../tools/blender/decimate-plants.py'),
      'utf8',
    )
    const bloc = /GARDES = \{(.*?)\n\}/s.exec(script)
    expect(bloc, 'bloc GARDES introuvable dans decimate-plants.py').not.toBeNull()
    // Le tiret compte : les identifiants d'espèce s'écrivent « plante-01 ».
    const cotePython = new Set([...bloc![1].matchAll(/"([a-z_0-9-]+)"/g)].map((m) => m[1]))
    for (const { id, noeuds } of ESPECES_GLB) {
      expect(cotePython, `espèce ${id} absente du script Blender`).toContain(id)
      for (const n of noeuds) {
        expect(cotePython, `nœud ${n} absent du script Blender`).toContain(n)
      }
    }
  })
})
