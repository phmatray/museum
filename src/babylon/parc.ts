/**
 * Ce que les couches du jardin (vague 3) partagent, calculé ou créé une fois :
 *
 * - `PARC` : `parkPlacements(MUSEE)` (~50 ms), le même objet pour le relief,
 *   l'enceinte, les allées, la végétation, la faune, Bavette et le lierre
 *   (three le calcule une fois dans PlanBuilding.tsx).
 * - `pelouse(scene)` : la matière 'pelouse' de three (`parc:pelouse`) : Grass004
 *   couleur seule à 1/6 m, teinte #a0b377 sans gain, couleurs de sommet, Lambert
 *   sans spéculaire. Pelouse, campagne et fosse du belvédère.
 * - `dallage(scene)` : la pierre du parvis, aussi l'axe dallé des allées et les
 *   foulées du belvédère (enceinte). Une matière, donc un seul programme.
 * - `FOULE` : 4 × (x, z, rayon), écrits par les hérissons (faune), lus par le
 *   gazon pour coucher l'herbe ; rayon 0 = personne.
 * - `ambiance()` : saison et météo, lues une fois (?saison=, ?meteo=).
 * - `retourner` : les faces de three dans le sens de Babylon ; `mulberry32` : l'aléa de three à graine numérique.
 *
 * Les deux matières prennent les lueurs (projecteurs de façade sur le parvis la nuit).
 * ponytail : pas de `pietiner` (usure des joints) ni d'`intemperer` (météo) : vagues suivantes.
 */
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial'
import type { Scene } from '@babylonjs/core/scene'

import { CLAIR, meteoDemandee, type Meteo } from '../domain/meteo.ts'
import { saisonA, type Saison } from '../domain/saisons.ts'
import { MUSEE } from '../plan/musee.ts'
import { parkPlacements } from '../plan/park.ts'
import { brancherLueurs } from './lueurs.ts'
import { matierePBR } from './matieres.ts'
import { creerPierre } from './pierre.ts'

export const PARC = parkPlacements(MUSEE)

/** Une matière par scène, créée au premier appel. */
function uneParScene(creer: (s: Scene) => PBRMaterial): (s: Scene) => PBRMaterial {
  const deja = new WeakMap<Scene, PBRMaterial>()
  return (s) => {
    const m = deja.get(s) ?? creer(s)
    deja.set(s, m)
    return m
  }
}

export const pelouse = uneParScene((scene) => {
  const m = matierePBR('pelouse', 'herbe', scene, { teinte: '#a0b377', gain: 1, couleurSeule: true })
  // Lambert de three : ni reflet d'environnement ni spéculaire du soleil.
  m.environmentIntensity = 0
  m.metallicF0Factor = 0
  brancherLueurs([m])
  return m
})

export const dallage = uneParScene((scene) => {
  const m = creerPierre(scene, 'dallage')
  brancherLueurs([m])
  return m
})

export const FOULE: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]

let lue: { saison: Saison; meteo: Meteo } | null = null
/** ponytail : figées au chargement, comme le ciel de main.ts ; un état vivant avec la vague météo. */
export function ambiance(): { saison: Saison; meteo: Meteo } {
  lue ??= { saison: saisonA(new Date(), location.search), meteo: meteoDemandee(location.search) ?? CLAIR }
  return lue
}

/** Les faces de three (a, b, c) dans le sens de Babylon (a, c, b) : scène main droite. */
export function retourner(ix: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < ix.length; i += 3) out.push(ix[i], ix[i + 2], ix[i + 1])
  return out
}

/** mulberry32 à graine numérique, comme three (le `generateur` de plan/park.ts part d'un texte). */
export function mulberry32(graine: number): () => number {
  let etat = graine >>> 0
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0
    let t = etat
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
