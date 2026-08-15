/**
 * Le budget de triangles du §9, vérifié SANS GPU et AVANT le commit.
 *
 * ── Pourquoi ce test existe alors que `capture.ts --check` mesure déjà ──
 *
 * `tools/capture.ts` est le juge final, et il le reste : il compte ce que la
 * carte dessine réellement, passes de post-traitement et d'ombres comprises.
 * Mais il lui faut un Chrome, un serveur Vite, un contexte WebGL et une scène
 * montée. Cela le rend excellent comme verdict et inutilisable comme garde-fou :
 * quand il rougit, le modèle est déjà dans l'arbre, déjà commité, déjà poussé.
 *
 * Le même compte se lit ici en quelques millisecondes, sur les GLB eux-mêmes,
 * en multipliant chaque sujet par le nombre d'exemplaires que les placeurs
 * RÉELS posent. Un modèle trop lourd échoue donc à `npm test`, avant d'exister
 * dans une capture.
 *
 * ── Ce que ce compte est, et ce qu'il n'est pas ──
 *
 * C'est un MAJORANT : il additionne toute la géométrie soumise, sans culling ni
 * frustum. Il est donc du bon côté de l'erreur — il ne peut pas rassurer à tort.
 * Il ne compte pas non plus le bâtiment procédural (~16 000 triangles), qui ne
 * vit dans aucun fichier : le plafond ci-dessous lui réserve sa part.
 *
 * Relevé du jour, reproductible par `node tools/measure-props.ts` :
 *
 *     parc       610 855   64,2 %      ← le premier poste, et de loin
 *     plantes    227 793   23,9 %
 *     mobilier   112 712   11,8 %      ← dont projecteur 94 000 à lui seul
 *     total      951 360
 *
 * Les deux chiffres qui commandent tout le reste sont dans ce tableau, et
 * aucun des deux n'était visible avant qu'on multiplie : le parc pèse plus que
 * tout le reste réuni, et le projecteur — 940 triangles, une pièce modeste —
 * coûte plus cher à lui seul que les quatre espèces de plantes d'intérieur.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { placeProps } from '../props'
import type { PropId } from '../props'
import { planterParc } from '../park'
import type { Museum } from '../types'
import { ESPECES_GLB, NOEUDS_DU_KIT } from '../../scene/propAssets'
import { ESPECES_PARK_GLB } from '../../scene/parkAssets'
import { lireGltf, trianglesDuNoeud } from './glbBounds'

const RACINE = resolve(__dirname, '../../..')

const musee = JSON.parse(
  readFileSync(resolve(RACINE, 'public/data/museum.json'), 'utf8'),
) as Museum

const kit = lireGltf(resolve(RACINE, 'public/assets/props/museum-kit.glb'))
const flore = lireGltf(resolve(RACINE, 'public/assets/plants/plants-lod.glb'))
const bois = lireGltf(resolve(RACINE, 'public/assets/plants/park-lod.glb'))

/**
 * Le plafond du §9, moins la part du bâtiment procédural.
 *
 * 1 000 000 au total, dont ~16 000 de murs, dalles, rampes et œuvres qui ne
 * sortent d'aucun fichier. Le reste — tout ce qui est instancié depuis un GLB —
 * doit tenir dans ce qui suit.
 */
const PLAFOND_ASSETS = 984_000

/**
 * Le sous-plafond du mobilier, hors végétation.
 *
 * Il n'existait pas, et c'est ce qui a laissé le projecteur atteindre 94 000
 * triangles sans que rien ne s'allume : le total global, lui, restait sous le
 * plafond parce que la végétation n'avait pas encore doublé. Un poste qui ne
 * peut pas dépasser tout seul est un poste qu'on peut faire grossir sans le
 * voir.
 */
const PLAFOND_MOBILIER = 130_000

interface Sujet {
  id: string
  triangles: number
  exemplaires: number
  aLEcran: number
}

function trianglesDuSujet(
  gltf: ReturnType<typeof lireGltf>,
  noeuds: readonly string[],
): number | null {
  let total = 0
  for (const nom of noeuds) {
    const t = trianglesDuNoeud(gltf, nom)
    if (t === null) return null
    total += t
  }
  return total
}

function releve(): { mobilier: Sujet[]; plantes: Sujet[]; parc: Sujet[] } {
  const poses = new Map<PropId, number>()
  for (const p of placeProps(musee)) poses.set(p.id, (poses.get(p.id) ?? 0) + 1)

  const mobilier: Sujet[] = []
  for (const [noeud, id] of Object.entries(NOEUDS_DU_KIT)) {
    const t = trianglesDuNoeud(kit, noeud) ?? 0
    const n = poses.get(id) ?? 0
    mobilier.push({ id, triangles: t, exemplaires: n, aLEcran: t * n })
  }

  const plantes: Sujet[] = []
  for (const { id, noeuds } of ESPECES_GLB) {
    const t = trianglesDuSujet(flore, noeuds) ?? 0
    const n = poses.get(id) ?? 0
    plantes.push({ id, triangles: t, exemplaires: n, aLEcran: t * n })
  }

  const semis = new Map<string, number>()
  for (const p of planterParc(musee.floors[0].footprint).plantations) {
    semis.set(p.espece, (semis.get(p.espece) ?? 0) + 1)
  }
  const parc: Sujet[] = []
  for (const { id, noeuds } of ESPECES_PARK_GLB) {
    const t = trianglesDuSujet(bois, noeuds) ?? 0
    const n = semis.get(id) ?? 0
    parc.push({ id, triangles: t, exemplaires: n, aLEcran: t * n })
  }

  return { mobilier, plantes, parc }
}

function somme(sujets: readonly Sujet[]): number {
  return sujets.reduce((t, s) => t + s.aLEcran, 0)
}

/**
 * La ventilation, imprimée à l'échec.
 *
 * Un dépassement doit dire QUELLE pièce le cause. Sans cette ligne, le test
 * annonce « 1 042 000 > 984 000 » et laisse chercher — or le coupable est
 * presque toujours un sujet modeste multiplié par cent, ce qui est exactement
 * ce qu'on ne voit pas en lisant une table de budgets par pièce.
 */
function ventilation(sujets: readonly Sujet[]): string {
  return [...sujets]
    .sort((a, b) => b.aLEcran - a.aLEcran)
    .map((s) => `    ${s.id.padEnd(14)} ${String(s.triangles).padStart(6)} × ${String(s.exemplaires).padStart(3)} = ${String(s.aLEcran).padStart(7)}`)
    .join('\n')
}

describe('budget géométrique — les assets, multipliés par leurs placements', () => {
  const { mobilier, plantes, parc } = releve()
  const tous = [...mobilier, ...plantes, ...parc]

  it('tient sous le plafond du §9, part du bâtiment réservée', () => {
    const total = somme(tous)
    expect(
      total,
      `\n  dépassement de ${total - PLAFOND_ASSETS} triangles\n${ventilation(tous)}\n`,
    ).toBeLessThanOrEqual(PLAFOND_ASSETS)
  })

  it('garde le mobilier sous son propre sous-plafond', () => {
    // Le contrôle qui manquait. Sans lui, un prop peut grossir de cent fois son
    // coût réel tant que la végétation laisse de la place.
    const total = somme(mobilier)
    expect(total, `\n${ventilation(mobilier)}\n`).toBeLessThanOrEqual(PLAFOND_MOBILIER)
  })

  it('mesure bien quelque chose — aucun sujet à zéro triangle', () => {
    // Le test doit avoir des dents : un nœud mal nommé rendrait 0, et un budget
    // de zéro passe tous les plafonds. C'est le mode de défaillance silencieux
    // de tout compteur, et il se ferme ici.
    expect(tous.filter((s) => s.triangles === 0).map((s) => s.id)).toEqual([])
  })

  it('pose bien des exemplaires — aucun sujet jamais placé', () => {
    expect(tous.filter((s) => s.exemplaires === 0).map((s) => s.id)).toEqual([])
  })

  it("nomme le parc comme premier poste, ce qui n'est pas une intuition", () => {
    // Cette assertion documente une mesure plutôt qu'elle ne contraint le code.
    // Elle existe parce que le commentaire d'en-tête de `parkAssets.ts` a
    // affirmé le contraire pendant des mois — 6 000 triangles par arbre au lieu
    // de 22 000 — et qu'un dimensionnement de budget s'est appuyé dessus. Une
    // hiérarchie fausse dans un commentaire ne se voit jamais ; dans un test, si.
    expect(somme(parc)).toBeGreaterThan(somme(plantes) + somme(mobilier))
  })
})
