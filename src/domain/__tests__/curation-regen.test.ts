/**
 * Le critère de fin du lot 5 : **régénérer sans perdre d'override**.
 *
 * C'est le test de santé de toute l'architecture, pas une vérification de
 * confort. Le musée est DÉRIVÉ de (catalogue, curation, configuration, atlas) ;
 * si une régénération perd du travail de curation, c'est que la séparation fuit
 * quelque part — qu'une décision de curation a été écrite dans le résultat au
 * lieu de l'entrée. L'éditeur rejoue exactement cette fonction dans le
 * navigateur, ce qui rend le défaut visible au clic plutôt qu'au prochain build.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ATLAS_VIDE, derive } from '../derive'
import { parseCatalogue, parseMuseumConfig } from '../../schema'
import type { Curation } from '../types'

const catalogue = parseCatalogue(
  JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/catalogue.json'), 'utf8')),
)
const config = parseMuseumConfig(
  JSON.parse(readFileSync(resolve(__dirname, '../../../museum.config.json'), 'utf8')),
)

const VIERGE: Curation = { schemaVersion: 1, repos: {}, rooms: {}, excluded: [] }

function construire(curation: Curation) {
  return derive({ catalogue, curation, config, atlas: ATLAS_VIDE })
}

/** Toutes les salles de tous les niveaux, à plat. */
function salles(m: ReturnType<typeof construire>) {
  return m.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, niveau: f.level })))
}

describe('régénérer sans perdre d’override', () => {
  const nu = construire(VIERGE)
  const cible = salles(nu).find((r) => r.keys.length > 0)!

  it('le musée nu se dérive et porte des salles', () => {
    expect(cible).toBeDefined()
    expect(salles(nu).length).toBeGreaterThan(1)
  })

  it('un renommage survit à la régénération', () => {
    const cure = construire({ ...VIERGE, rooms: { [cible.id]: { name: 'Salle des essais' } } })
    const apres = salles(cure).find((r) => r.id === cible.id)
    expect(apres?.name).toBe('Salle des essais')
  })

  it('un rethémage survit à la régénération', () => {
    const cure = construire({ ...VIERGE, rooms: { [cible.id]: { theme: 'immersive' } } })
    expect(salles(cure).find((r) => r.id === cible.id)?.theme).toBe('immersive')
  })

  it('DEUX régénérations d’affilée donnent le même bâtiment, octet pour octet', () => {
    // Sans ça, « Régénérer » deviendrait un bouton qu'on n'ose plus cliquer :
    // le bâtiment dériverait à chaque appel et la curation ne serait plus la
    // seule cause du résultat.
    const curation: Curation = {
      ...VIERGE,
      rooms: { [cible.id]: { name: 'Salle des essais', theme: 'modern' } },
    }
    expect(JSON.stringify(construire(curation))).toBe(JSON.stringify(construire(curation)))
  })

  it('retirer l’override rend la salle à ce que le générateur décide', () => {
    // C'est ce qui permet de revenir en arrière sans éditer le JSON à la main :
    // l'éditeur SUPPRIME la clé quand on vide un champ, il n'écrit pas "".
    const cure = construire({ ...VIERGE, rooms: { [cible.id]: { name: 'Salle des essais' } } })
    expect(salles(cure).find((r) => r.id === cible.id)?.name).toBe('Salle des essais')

    const rendu = construire(VIERGE)
    expect(salles(rendu).find((r) => r.id === cible.id)?.name).toBe(cible.name)
  })

  it('une curation vide ne change RIEN au bâtiment', () => {
    // Le pire défaut possible serait qu'ouvrir puis fermer l'éditeur sans rien
    // toucher modifie le musée.
    expect(JSON.stringify(construire(VIERGE))).toBe(JSON.stringify(nu))
  })

  it('n’accroche pas moins d’œuvres après curation', () => {
    // Un override de nom ne doit pas faire tomber une œuvre du mur : c'est le
    // symptôme d'une curation qui participerait au dimensionnement.
    const compter = (m: ReturnType<typeof construire>) =>
      salles(m).reduce((n, r) => n + r.walls.reduce((k, w) => k + w.placements.length, 0), 0)
    const cure = construire({ ...VIERGE, rooms: { [cible.id]: { name: 'Salle des essais' } } })
    expect(compter(cure)).toBe(compter(nu))
  })
})
