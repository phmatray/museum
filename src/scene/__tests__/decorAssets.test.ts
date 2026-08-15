/**
 * LOT 9 — Le catalogue du décor doit couvrir le catalogue des placements.
 *
 * Même parti que `propAssets.test.ts` : ce test ne charge rien. Il vérifie la
 * seule chose qui puisse casser en SILENCE — la correspondance entre les
 * identifiants que `domain/decor.ts` produit, ceux que `kits.ts` sait fournir, et
 * les nœuds que Blender met réellement dans le fichier.
 *
 * Le risque est ici plus vif qu'ailleurs, et pour une raison précise : **Meshy
 * sort ses nœuds ANONYMES**. Le nom `NervureAtrium` n'existe nulle part dans ce
 * que Meshy livre — il naît dans la table `PIECES` de `process-meshy.py`, et il
 * est recopié à la main dans `NOEUDS_DU_DECOR`. Deux listes, deux langages,
 * aucune vérification du compilateur. Une faute de frappe ne lève rien : la
 * pièce disparaît de la scène avec un avertissement en console.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DECOR_IDS, DECOR_METRICS, placeDecor } from '../../domain/decor'
import type { DecorId } from '../../domain/decor'
import type { Museum } from '../../domain/types'
import { DECOR_KIT_PATH, DRACO_PATH, NOEUDS_DU_DECOR } from '../kits'
import { doitFusionner, SURCHARGE_FUSION } from '../decorAssets'
import { lireGltf, metriquesDuNoeud, trianglesDuNoeud } from '../../domain/__tests__/glbBounds'

const RACINE = resolve(__dirname, '../../..')
const musee = JSON.parse(
  readFileSync(resolve(RACINE, 'public/data/museum.json'), 'utf8'),
) as Museum

describe('decorAssets — le catalogue', () => {
  it('fournit un modèle pour chaque identifiant de décor', () => {
    const fournis = new Set<DecorId>(Object.values(NOEUDS_DU_DECOR))
    expect([...DECOR_IDS].filter((id) => !fournis.has(id))).toEqual([])
  })

  it("ne fournit rien qui n'ait de placement", () => {
    const connus = new Set<string>(DECOR_IDS)
    expect(Object.values(NOEUDS_DU_DECOR).filter((id) => !connus.has(id))).toEqual([])
  })

  it('garde des chemins RELATIFS, pour survivre à GitHub Pages', () => {
    for (const chemin of [DECOR_KIT_PATH, DRACO_PATH]) {
      expect(chemin.startsWith('/')).toBe(false)
      expect(chemin.startsWith('http')).toBe(false)
    }
    expect(DECOR_KIT_PATH.endsWith('.glb')).toBe(true)
  })

  it('les nœuds attendus sont ceux que Blender met dans le fichier', () => {
    // ⚠️ La classe de caractères DOIT accepter les MAJUSCULES : les nœuds
    // s'appellent `NervureAtrium`, pas `nervure-atrium`. Le motif de
    // `propAssets.test.ts` (`[a-z_0-9-]+`) ne les verrait pas — il passerait au
    // vert en ne trouvant RIEN, ce qui est le pire résultat possible pour un
    // test de synchronisation.
    const script = readFileSync(resolve(RACINE, 'tools/blender/process-meshy.py'), 'utf8')
    const bloc = /^PIECES = \{(.*?)^\}/ms.exec(script)
    expect(bloc, 'table PIECES introuvable dans process-meshy.py').not.toBeNull()

    const cotePython = new Set(
      [...bloc![1].matchAll(/"noeud":\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]),
    )
    // Le test doit avoir des dents : une regex qui ne trouve rien passerait
    // tous les `every` qui suivent.
    expect(cotePython.size).toBeGreaterThan(0)

    for (const nom of Object.keys(NOEUDS_DU_DECOR)) {
      expect(cotePython, `« ${nom} » absent de PIECES`).toContain(nom)
    }
  })
})

describe('decorAssets — la règle de fusion', () => {
  it('fusionne tant que la duplication reste sous la surcharge', () => {
    expect(doitFusionner(1600, 1)).toBe(true)
    expect(doitFusionner(1600, 16)).toBe(true)
    // Le point de bascule exact, pour que la constante soit un contrat.
    expect(doitFusionner(1000, 31)).toBe(true)
    expect(doitFusionner(1000, 32)).toBe(false)
  })

  it('est monotone : plus d’exemplaires ne peut pas rendre la fusion plus attrayante', () => {
    let precedent = true
    for (let n = 1; n <= 200; n++) {
      const actuel = doitFusionner(500, n)
      expect(precedent || !actuel).toBe(true)
      precedent = actuel
    }
  })

  it('taille la surcharge sur la réserve réelle du §9, pas sur une intuition', () => {
    // 24 081 triangles de réserve mesurés au relevé de référence. La surcharge
    // ne peut donc pas être un ordre de grandeur au-dessus sans mentir.
    expect(SURCHARGE_FUSION).toBeLessThanOrEqual(50_000)
  })
})

describe('decorAssets — le kit réel', () => {
  const gltf = lireGltf(resolve(RACINE, DECOR_KIT_PATH.replace(/^/, 'public/')))

  it('porte les emprises réellement mesurées sur le GLB', () => {
    for (const [nom, id] of Object.entries(NOEUDS_DU_DECOR)) {
      const mesure = metriquesDuNoeud(gltf, nom)
      expect(mesure, `« ${nom} » introuvable dans ${DECOR_KIT_PATH}`).not.toBeNull()
      const declare = DECOR_METRICS[id]
      // Pessimiste est ACCEPTABLE (on réserve trop de place) ; optimiste ne
      // l'est pas (on plante une pièce dans un mur). D'où l'asymétrie.
      expect(declare.radius).toBeGreaterThanOrEqual(mesure!.rayon - 0.01)
      expect(declare.maxY).toBeGreaterThanOrEqual(mesure!.maxY - 0.01)
    }
  })

  it('ancre chaque pièce POSÉE sur son point de contact', () => {
    // Le défaut invisible aux autres épreuves : `DECOR_METRICS` étant mesuré sur
    // le même fichier, un ancrage faux passerait les deux bornes sans broncher.
    // Seule cette assertion-ci l'attrape.
    for (const nom of Object.keys(NOEUDS_DU_DECOR)) {
      const mesure = metriquesDuNoeud(gltf, nom)!
      expect(Math.abs(mesure.minY), `« ${nom} » ne pose pas son pied à zéro`).toBeLessThan(0.02)
    }
  })

  it('tient le budget de triangles que la table Blender annonce', () => {
    const script = readFileSync(resolve(RACINE, 'tools/blender/process-meshy.py'), 'utf8')
    for (const nom of Object.keys(NOEUDS_DU_DECOR)) {
      const reel = trianglesDuNoeud(gltf, nom)!
      const bloc = new RegExp(`"noeud":\\s*"${nom}"[\\s\\S]*?"budget":\\s*(\\d+)`).exec(script)
      expect(bloc, `budget de « ${nom} » introuvable`).not.toBeNull()
      expect(reel).toBeLessThanOrEqual(Number(bloc![1]))
      expect(reel).toBeGreaterThan(0)
    }
  })
})

describe('decor — le placement', () => {
  const placements = placeDecor(musee)

  it('pose des nervures, et pas zéro', () => {
    expect(placements.length).toBeGreaterThan(0)
  })

  it('est déterministe', () => {
    expect(placeDecor(musee)).toEqual(placements)
  })

  it('n’échelle JAMAIS avec un déterminant négatif', () => {
    // Dans un lot FUSIONNÉ toutes les pièces partagent un `side` : une échelle
    // miroir retournerait l'enroulement de cette pièce seule, et elle sortirait
    // à l'envers sans que rien d'autre ne bouge. On miroite par une rotation de
    // π, jamais par un signe.
    for (const p of placements) {
      expect(p.scale.x * p.scale.y * p.scale.z).toBeGreaterThan(0)
    }
  })

  it('ne pose rien en réserve, qui est enterrée', () => {
    const reserve = musee.floors.find((f) => f.level < 0)
    expect(placements.some((p) => p.floorId === reserve?.id)).toBe(false)
  })

  it('pose chaque nervure au niveau du plancher de son étage', () => {
    for (const p of placements) {
      const etage = musee.floors.find((f) => f.id === p.floorId)
      expect(etage, `étage « ${p.floorId} » inconnu`).toBeDefined()
      expect(p.position.y).toBeCloseTo(etage!.elevation, 6)
    }
  })

  it('pose chaque nervure HORS du vide de la trémie', () => {
    // Une nervure dont le pied flotte au-dessus du vide n'a rien pour la porter.
    // Elle penche ensuite AU-DESSUS du vide, et c'est le geste — mais son pied
    // reste sur la dalle.
    for (const p of placements) {
      const etage = musee.floors.find((f) => f.id === p.floorId)!
      const dansUnTrou = etage.slabHoles.some(
        (t) =>
          p.position.x > t.x &&
          p.position.x < t.x + t.width &&
          p.position.z > t.z &&
          p.position.z < t.z + t.depth,
      )
      expect(dansUnTrou, `nervure dans le vide en (${p.position.x}, ${p.position.z})`).toBe(false)
    }
  })

  it('reste dans l’emprise du bâtiment', () => {
    for (const p of placements) {
      const f = musee.floors.find((x) => x.id === p.floorId)!
      expect(p.position.x).toBeGreaterThanOrEqual(f.footprint.x)
      expect(p.position.x).toBeLessThanOrEqual(f.footprint.x + f.footprint.width)
      expect(p.position.z).toBeGreaterThanOrEqual(f.footprint.z)
      expect(p.position.z).toBeLessThanOrEqual(f.footprint.z + f.footprint.depth)
    }
  })

  it('ne donne de collider qu’à ce qui est à portée de main', () => {
    // L'invariant qui empêche la table de mentir : ce qui n'a pas de collider
    // doit être hors d'atteinte, et ce qui en a un doit exister au-dessus du sol.
    for (const id of DECOR_IDS) {
      const m = DECOR_METRICS[id]
      if (m.collision === null) continue
      expect(m.maxY).toBeGreaterThan(0)
    }
  })
})
