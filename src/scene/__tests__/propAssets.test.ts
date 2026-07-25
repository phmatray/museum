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
import { describe, expect, it } from 'vitest'

import { PROP_IDS } from '../../domain/props'
import type { PropId } from '../../domain/props'
import { DRACO_PATH, ESPECES_GLTF, KIT_PATH, NOEUDS_DU_KIT, PLANTS_DIR } from '../propAssets'

describe('propAssets — le catalogue', () => {
  it('fournit un modèle pour chaque identifiant de prop', () => {
    const fournis = new Set<PropId>([
      ...Object.values(NOEUDS_DU_KIT),
      ...ESPECES_GLTF.map((espece) => espece.id),
    ])
    expect([...PROP_IDS].filter((id) => !fournis.has(id))).toEqual([])
  })

  it("ne fournit rien qui n'ait de placement", () => {
    const connus = new Set<string>(PROP_IDS)
    expect(Object.values(NOEUDS_DU_KIT).filter((id) => !connus.has(id))).toEqual([])
    expect(ESPECES_GLTF.map((e) => e.id).filter((id) => !connus.has(id))).toEqual([])
  })

  it('ne monte aucune espèce deux fois sur le même identifiant', () => {
    const ids = [...Object.values(NOEUDS_DU_KIT), ...ESPECES_GLTF.map((e) => e.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('garde des chemins RELATIFS, pour survivre à GitHub Pages', () => {
    // Le site vit sous `/<dépôt>/` en production : un chemin qui commence par
    // une barre y donne un 404, et le mobilier disparaît sans une seule erreur
    // dans la console — `propAssetsResource` avale l'échec par conception.
    for (const chemin of [KIT_PATH, PLANTS_DIR, DRACO_PATH]) {
      expect(chemin.startsWith('/')).toBe(false)
      expect(chemin.startsWith('http')).toBe(false)
    }
    expect(PLANTS_DIR.endsWith('/')).toBe(true)
    expect(DRACO_PATH.endsWith('/')).toBe(true)
  })
})
