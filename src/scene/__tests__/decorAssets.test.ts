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
import type { DecorId, DecorPlacement } from '../../domain/decor'
import { PROP_METRICS, pendAuPlafond, placeProps } from '../../domain/props'
import type { Museum } from '../../domain/types'
import { DECOR_KIT_PATH, DECOR_PARC_PATH, DRACO_PATH, NOEUDS_DU_DECOR, NOEUDS_DU_PARC } from '../kits'
import { doitFusionner, SURCHARGE_FUSION } from '../decorAssets'
import { lireGltf, metriquesDuNoeud, trianglesDuNoeud } from '../../domain/__tests__/glbBounds'

const RACINE = resolve(__dirname, '../../..')
const musee = JSON.parse(
  readFileSync(resolve(RACINE, 'public/data/museum.json'), 'utf8'),
) as Museum

describe('decorAssets — le catalogue', () => {
  it('fournit un modèle pour chaque identifiant de décor', () => {
    // Les DEUX kits : le parc vit dans son propre fichier pour que sa boîte
    // englobante ne s'étende pas du hall au fond de la parcelle. Ne contrôler
    // que l'intérieur laisserait cinq pièces sans modèle, et une pièce sans
    // modèle ne lève rien — elle disparaît avec un avertissement en console.
    const fournis = new Set<DecorId>([
      ...Object.values(NOEUDS_DU_DECOR),
      ...Object.values(NOEUDS_DU_PARC),
    ])
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

  it('ancre chaque pièce sur son point de CONTACT, quel qu’il soit', () => {
    // Le défaut invisible aux autres épreuves : `DECOR_METRICS` étant mesuré sur
    // le même fichier, un ancrage faux passerait les deux bornes sans broncher.
    // Seule cette assertion-ci l'attrape.
    //
    // ⚠️ Deux pièces PENDENT — la sculpture et la suspension d'atrium — et leur
    // point de contact est leur SOMMET, pas leur pied. Exiger `minY ≈ 0` pour
    // tout le monde accusait donc `SculptureAtrium` d'un ancrage faux alors
    // qu'elle est correctement ancrée, à l'autre bout.
    for (const nom of Object.keys(NOEUDS_DU_DECOR)) {
      const m = metriquesDuNoeud(gltf, nom)!
      const contact = (m.minY + m.maxY) / 2 < 0 ? m.maxY : m.minY
      // La tolérance suit la TAILLE de la pièce, et ce n'est pas une indulgence :
      // l'effondrement d'arêtes déplace des sommets proportionnellement à la
      // longueur des arêtes qu'il fusionne. Sur la banque d'accueil, 3 m de
      // long, le résidu vaut 22 mm — soit 0,7 % de la pièce, l'ordre de grandeur
      // exact de tous les autres. Un seuil absolu accuserait donc les grandes
      // pièces d'un défaut qui n'est proportionnellement pas plus grand.
      //
      // ⚠️ Et c'est la PLUS GRANDE dimension qui compte, pas la hauteur : la
      // banque d'accueil fait 3 m de long pour 1,10 m de haut, et le résidu
      // vient de ses arêtes longues. Mesurée sur la hauteur seule, la tolérance
      // valait 11 mm pour un résidu de 22 — l'épreuve accusait la pièce d'un
      // défaut que sa propre métrique ne savait pas dimensionner.
      const taille = Math.max(2 * m.rayon, m.maxY - m.minY)
      const tolerance = Math.max(0.02, taille * 0.01)
      expect(Math.abs(contact), `« ${nom} » n’affleure pas son ancrage`).toBeLessThan(tolerance)
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

/** Le prédicat du domaine, appliqué à une pièce de décor. Une règle, une implémentation. */
function pend(p: DecorPlacement): boolean {
  return pendAuPlafond(DECOR_METRICS[p.id])
}

describe('decorAssets — le kit du PARC', () => {
  // Le second fichier a exactement les mêmes façons de casser en silence que le
  // premier : un nœud mal nommé, une pièce hors budget. Ne contrôler que
  // l'intérieur laisserait cinq pièces sans garde-fou — dont la sculpture du
  // parvis, qui est la première chose qu'on voit du musée.
  const gltfParc = lireGltf(resolve(RACINE, 'public', DECOR_PARC_PATH))
  const script = readFileSync(resolve(RACINE, 'tools/blender/process-meshy.py'), 'utf8')

  it('porte les nœuds que Blender y met, et leurs emprises', () => {
    for (const [nom, id] of Object.entries(NOEUDS_DU_PARC)) {
      const mesure = metriquesDuNoeud(gltfParc, nom)
      expect(mesure, `« ${nom} » introuvable dans ${DECOR_PARC_PATH}`).not.toBeNull()
      expect(DECOR_METRICS[id].radius).toBeGreaterThanOrEqual(mesure!.rayon - 0.01)
      expect(DECOR_METRICS[id].maxY).toBeGreaterThanOrEqual(mesure!.maxY - 0.01)
    }
  })

  it('tient le budget de triangles de la table Blender', () => {
    for (const nom of Object.keys(NOEUDS_DU_PARC)) {
      const reel = trianglesDuNoeud(gltfParc, nom)!
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

  it('pose chaque pièce d’un étage DANS la tranche de cet étage', () => {
    // L'ancienne version exigeait `y == elevation` au micromètre, ce qui n'était
    // vrai que du temps où le décor n'était fait que de nervures posées au sol.
    // Une console s'accroche SOUS la dalle du niveau, une suspension pend depuis
    // le plancher du niveau au-dessus : les trois sont justes, et une égalité
    // stricte n'en accepte qu'une.
    //
    // L'invariant réel est un ENCADREMENT : rien ne doit sortir de la tranche
    // qui va de la sous-face de son plancher au plafond de son niveau.
    for (const p of placements) {
      if (p.floorId === null) continue
      const etage = musee.floors.find((f) => f.id === p.floorId)
      expect(etage, `étage « ${p.floorId} » inconnu`).toBeDefined()
      expect(p.position.y).toBeGreaterThanOrEqual(etage!.elevation - 1.0)
      expect(p.position.y).toBeLessThanOrEqual(etage!.elevation + etage!.ceilingHeight + 0.01)
    }
  })

  it('n’attache un floorId qu’à ce qui appartient VRAIMENT à un plateau', () => {
    // Les pièces du parvis portent `floorId: null`, et ce n'est pas un oubli :
    // le culling écarte un plateau hors champ avec tout ce qui lui est attaché.
    // Un portique rattaché au rez-de-chaussée disparaîtrait donc en même temps
    // que lui — c'est-à-dire précisément quand on le regarde depuis dehors.
    const dehors = placements.filter((p) => p.floorId === null)
    expect(dehors.length, 'plus rien n’est posé hors des plateaux').toBeGreaterThan(0)
    for (const p of dehors) {
      expect(musee.floors.some((f) => f.id === p.floorId)).toBe(false)
    }
  })

  it('pose chaque pièce POSÉE hors du vide de la trémie', () => {
    // Une pièce dont le pied flotte au-dessus du vide n'a rien pour la porter.
    // Une nervure penche ensuite AU-DESSUS du vide, et c'est le geste — mais son
    // pied reste sur la dalle.
    //
    // ⚠️ Les pièces SUSPENDUES sont exclues, et c'est le contraire d'une
    // indulgence : la sculpture d'atrium est posée au-dessus du vide EXPRÈS,
    // dans le cœur de l'hélice, parce que c'est le seul volume du bâtiment qui
    // soit à la fois central, haut de quatorze mètres et traversé par rien.
    for (const p of placements.filter((x) => !pend(x))) {
      if (p.floorId === null) continue
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

  it('reste dans l’emprise du bâtiment — sauf ce qui est dehors', () => {
    for (const p of placements) {
      if (p.floorId === null) continue
      const f = musee.floors.find((x) => x.id === p.floorId)!
      expect(p.position.x).toBeGreaterThanOrEqual(f.footprint.x)
      expect(p.position.x).toBeLessThanOrEqual(f.footprint.x + f.footprint.width)
      expect(p.position.z).toBeGreaterThanOrEqual(f.footprint.z)
      expect(p.position.z).toBeLessThanOrEqual(f.footprint.z + f.footprint.depth)
    }
  })

  it('ne fait se traverser AUCUNE nervure voisine', () => {
    // Le pas des nervures est borné par les ANGLES du pourtour, pas par les
    // côtés droits : la corde qui coupe un coin est plus courte que l'arc, et
    // deux nervures de part et d'autre d'un angle se retrouvaient à 0,32 m l'une
    // DANS l'autre. Invisible en 3D — deux nervures superposées lisent comme une
    // nervure épaisse — et évident sur le plan coté.
    // Le rayon se lit PAR EXEMPLAIRE : la même nervure sert de couronne à
    // pleine taille au dernier niveau et de garde-corps au tiers de l'échelle
    // en dessous. Une version antérieure de cette épreuve prenait le rayon
    // nominal pour tout le monde et déclarait fautif un garde-corps de 0,35 m
    // de rayon espacé de 1,50 m — elle mesurait une pièce qui n'existe pas.
    const rayon = (p: DecorPlacement): number =>
      DECOR_METRICS[p.id].radius * Math.max(p.scale.x, p.scale.z)

    // Deux pièces ne peuvent se traverser que si elles partagent une TRANCHE DE
    // HAUTEUR. Une console accrochée sous une dalle et une nervure posée sur
    // cette même dalle ont la même trace au sol par construction — c'est
    // exactement le dessin voulu — et les compter comme un recouvrement ferait
    // hurler l'épreuve sur ce qui va bien.
    const chevauche = (a: DecorPlacement, b: DecorPlacement): boolean => {
      const ha = [a.position.y + DECOR_METRICS[a.id].minY * a.scale.y,
                  a.position.y + DECOR_METRICS[a.id].maxY * a.scale.y]
      const hb = [b.position.y + DECOR_METRICS[b.id].minY * b.scale.y,
                  b.position.y + DECOR_METRICS[b.id].maxY * b.scale.y]
      return ha[0] < hb[1] - 0.01 && hb[0] < ha[1] - 0.01
    }

    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i]
        const b = placements[j]
        if (a.floorId !== b.floorId) continue
        if (!chevauche(a, b)) continue
        const mini = rayon(a) + rayon(b)
        const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)
        expect(
          d,
          `${a.id} et ${b.id} se traversent de ${(mini - d).toFixed(2)} m`,
        ).toBeGreaterThanOrEqual(mini - 0.01)
      }
    }
  })

  it('fait CÉDER le mobilier devant l’architecture', () => {
    // L'invariant que `tools/plan.ts` a rendu visible : les deux modules placent
    // contre des géométries différentes et ne se connaissaient pas. L'anneau de
    // jardinières du pourtour d'atrium traversait les nervures sur deux niveaux,
    // jusqu'à 0,75 m. Rien ne pouvait l'empêcher avant que `placeProps` ne
    // reçoive le décor.
    const props = placeProps(musee, placements)
    for (const p of props) {
      const m = PROP_METRICS[p.id]
      // Un projecteur suspendu à 3,90 m au-dessus d'une nervure n'est pas une
      // collision : on ne compare que ce qui partage une tranche de hauteur.
      // ⚠️ Le test était `m.maxY <= 0`, et il a lâché sur les 2 mm de résidu
      // d'ancrage du projecteur Meshy — voir `pendAuPlafond`.
      if (pendAuPlafond(m)) continue
      // Et symétriquement côté décor : une console accrochée sous une dalle ne
      // peut pas heurter un socle posé au sol du niveau d'en dessous.
      for (const d of placements) {
        if (d.floorId !== p.floorId) continue
        if (pend(d)) continue
        // Même correction que ci-dessus : l'emprise d'une nervure dépend de son
        // échelle, et `obstaclesDuNiveau` la lit bien ainsi. Une épreuve plus
        // stricte que le code qu'elle garde ne prouve rien — elle échoue sur des
        // cas que le musée n'a jamais posés.
        const mini = m.radius * p.scale + DECOR_METRICS[d.id].radius * Math.max(d.scale.x, d.scale.z)
        const dist = Math.hypot(p.position.x - d.position.x, p.position.z - d.position.z)
        expect(
          dist,
          `${p.id} traverse ${d.id} de ${(mini - dist).toFixed(2)} m`,
        ).toBeGreaterThanOrEqual(mini - 0.01)
      }
    }
  })

  it('laisse encore le musée se meubler malgré le décor', () => {
    // Le garde-fou du garde-fou : faire céder le mobilier est juste, le faire
    // disparaître ne l'est pas. Une nervure trop grosse ou trop nombreuse
    // viderait le bâtiment sans qu'aucune des épreuves ci-dessus ne bronche.
    const avec = placeProps(musee, placements).length
    const sans = placeProps(musee).length
    expect(avec).toBeGreaterThan(sans * 0.75)
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
