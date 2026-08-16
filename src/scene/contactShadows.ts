/**
 * Les ombres de CONTACT, peintes — un seul draw call pour tout le mobilier.
 *
 * ── Le défaut, et pourquoi il saute aux yeux ──
 *
 * Un socle, une jardinière ou un banc posés sans rien sous eux ne LISENT pas
 * comme posés : ils flottent. C'est le défaut qui trahit une scène 3D avant
 * toute question de matière ou de résolution, parce que l'œil lit l'appui d'un
 * objet à l'ombre qu'il jette, pas à ses arêtes.
 *
 * ── Pourquoi pas une vraie ombre ──
 *
 * Parce que la mesure existe déjà et qu'elle est sans appel. La seconde shadow
 * map du §9 a été écrite, branchée sur la salle courante, puis mesurée :
 * **+77 draw calls et RIEN à l'image** (voir l'en-tête de `RoomLights.tsx`).
 * Rien, parce que tout ce qu'une salle contient est `castShadow={false}` — et
 * l'activer coûterait une passe d'ombres par salle traversée, sur un compteur
 * déjà à 260 pour un plafond de 150.
 *
 * ── Pourquoi une ombre peinte est la bonne réponse ici ──
 *
 * C'est exactement la doctrine du §9.2, appliquée à un autre objet : « les spots
 * n'existent pas », leur signature visuelle est PEINTE parce que 256 projecteurs
 * avec ombres ne tournent dans aucun navigateur. Une ombre de contact se réduit
 * de la même façon à une tache douce sous l'objet — et à cette échelle, une
 * tache douce EST ce qu'on verrait.
 *
 * Ce qu'on y perd est réel et doit être dit : la tache ne s'allonge pas avec
 * l'angle de la lumière, et elle ne monte pas sur ce qui la borde. Sur un objet
 * de moins d'un mètre vu debout, aucun des deux ne se remarque ; sur une
 * sculpture de neuf mètres, il faudra autre chose.
 *
 * ── Un seul lot ──
 *
 * Toutes les taches sont fusionnées en une géométrie unique, en coordonnées
 * MONDE, avec un seul matériau : **un draw call pour les deux cent quarante
 * pièces posées du bâtiment**. C'est le même parti que `decorAssets.ts`, et pour
 * la même raison.
 */
import * as THREE from 'three'

import type { PropId, PropPlacement } from '../domain/props'
import { PROP_METRICS } from '../domain/props'

/**
 * Débord de la tache autour de l'emprise de l'objet.
 *
 * 1,7 : la tache doit déborder assez pour qu'une part visible reste À CÔTÉ de
 * l'objet — sous lui, elle ne sert à rien. À 1,45, l'objet couvrait 69 % du
 * disque et ne laissait voir que sa frange déjà éteinte.
 *
 * Beaucoup plus large, elle cesserait de lire comme un appui pour devenir une
 * flaque sale : le défaut classique du « blob shadow » de jeu vidéo.
 */
const DEBORD = 1.7

/**
 * Décollement du sol, en mètres.
 *
 * 8 mm suffisent à sortir du z-fighting avec la dalle sans que la tache ne
 * décolle visiblement à distance rasante. `depthWrite: false` fait le reste.
 */
const DECOLLEMENT = 0.008

/**
 * Opacité au centre de la tache.
 *
 * 0,46, réglé sur le terrazzo — le sol le plus clair du musée, donc le cas le
 * plus exigeant. En dessous, l'objet flotte encore ; au-dessus, la tache se lit
 * comme une flaque peinte et non comme un appui.
 */
const OPACITE = 0.46

/** Un prop qui pend au plafond ne pose rien : il n'a pas d'ombre de contact. */
function poseAuSol(id: PropId): boolean {
  return PROP_METRICS[id].maxY > 0
}

/**
 * La texture de la tache : un disque dont l'alpha décroît vers le bord.
 *
 * Générée en mémoire plutôt que chargée : c'est un dégradé radial de 64 pixels,
 * il ne mérite ni un fichier, ni une requête, ni une entrée dans CREDITS.md.
 *
 * La décroissance est en `1 - r³`, et le choix se voit à l'écran. Une courbe
 * en `(1 - r²)²`, essayée d'abord, concentre le noir au CENTRE du disque —
 * c'est-à-dire précisément sous l'objet, là où il est caché. Il ne restait
 * visible que l'anneau extérieur, déjà tombé à 26 % : l'ombre existait dans le
 * tampon et ne se voyait pas à l'image.
 *
 * `1 - r³` reste plein jusqu'aux deux tiers du rayon, donc jusqu'au BORD de
 * l'objet, puis chute vite sans laisser d'arête franche — un bord net est ce qui
 * fait lire une ombre peinte comme un autocollant.
 */
export function textureDeTache(taille = 64): THREE.DataTexture {
  const data = new Uint8Array(taille * taille * 4)
  const c = (taille - 1) / 2
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const r = Math.hypot(x - c, y - c) / c
      const a = r >= 1 ? 0 : 1 - r ** 3
      const i = (y * taille + x) * 4
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = Math.round(a * 255)
    }
  }
  const texture = new THREE.DataTexture(data, taille, taille, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  // Sans ça, le bord du disque se répète et cerne la tache d'un liseré.
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/**
 * Une géométrie unique portant une tache par prop posé, en coordonnées MONDE.
 *
 * Rend `null` quand il n'y a rien à ombrer — le calque ne monte alors aucun
 * maillage plutôt qu'un maillage vide.
 */
export function geometrieDesTaches(placements: readonly PropPlacement[]): THREE.BufferGeometry | null {
  const poses = placements.filter((p) => poseAuSol(p.id))
  if (poses.length === 0) return null

  const positions = new Float32Array(poses.length * 4 * 3)
  const uvs = new Float32Array(poses.length * 4 * 2)
  const indices = new Uint32Array(poses.length * 6)

  poses.forEach((p, n) => {
    const r = PROP_METRICS[p.id].radius * p.scale * DEBORD
    const y = p.position.y + DECOLLEMENT
    // Le quad n'est PAS tourné avec le prop : une tache radiale est invariante
    // par rotation, et la faire tourner ne ferait que consommer un sinus.
    const coins: [number, number][] = [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ]
    coins.forEach(([dx, dz], k) => {
      const i = (n * 4 + k) * 3
      positions[i] = p.position.x + dx
      positions[i + 1] = y
      positions[i + 2] = p.position.z + dz
      const j = (n * 4 + k) * 2
      uvs[j] = k === 0 || k === 3 ? 0 : 1
      uvs[j + 1] = k < 2 ? 0 : 1
    })
    // ⚠️ L'ENROULEMENT, et pourquoi il est dans ce sens.
    //
    // Écrit d'abord dans l'ordre naturel (0,1,2 / 0,2,3), le produit vectoriel
    // des deux arêtes tombe sur −Y : la face avant regardait le SOUS-SOL, et
    // l'élimination des faces arrière supprimait les deux cent quarante taches.
    // Elles étaient dans la scène, elles coûtaient leur draw call, et l'image
    // était rigoureusement inchangée.
    //
    // Le défaut n'était pas visible à l'œil — une ombre absente ressemble à une
    // ombre qu'on n'a pas encore faite. C'est la MESURE qui l'a dit : à opacité
    // 1,0, `pctSous25` et la luminance moyenne de la vue `coin` étaient
    // identiques au dixième près à ce qu'elles valaient à 0,38. Deux cent
    // quarante disques noirs qui ne déplacent pas un seul compteur ne sont pas
    // dessinés.
    const base = n * 4
    const t = n * 6
    indices[t] = base
    indices[t + 1] = base + 2
    indices[t + 2] = base + 1
    indices[t + 3] = base
    indices[t + 4] = base + 3
    indices[t + 5] = base + 2
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  // La normale est la même pour toutes les taches — elles regardent le ciel —
  // mais le matériau ne s'éclaire pas : on l'omet plutôt que d'écrire un
  // attribut que rien ne lit.
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Le matériau des taches.
 *
 * `MeshBasicMaterial` et non `Standard` : une ombre ne s'éclaire pas. Elle ne
 * doit surtout pas s'éclaircir quand un plafonnier passe au-dessus, ce qui est
 * exactement ce qu'un matériau PBR ferait.
 *
 * `depthWrite: false` pour qu'une tache n'occulte pas ce qui la suit dans la
 * passe transparente, et `polygonOffset` pour ne pas lutter avec la dalle sur
 * les GPU dont la profondeur est moins précise que la nôtre.
 */
export function materiauDesTaches(texture: THREE.Texture): THREE.Material {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: OPACITE,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    color: 0x000000,
  })
}
