import { describe, expect, it } from 'vitest'

import { DEFAUTS, ecrireReglages, heureTexte, lireReglages, mouvementReduitPour, rechercheAvec } from '../reglages'
import { meteoDemandee } from '../meteo'
import { saisonA } from '../saisons'
import { heureDemandee } from '../soleil'
import { qualiteDemandee } from '../../scene/qualite'

describe('reglages', () => {
  it('rend les défauts pour rien, du JSON abîmé ou autre chose qu’un objet', () => {
    expect(lireReglages(null)).toEqual(DEFAUTS)
    expect(lireReglages('{pas du json')).toEqual(DEFAUTS)
    expect(lireReglages('[1,2]')).toEqual(DEFAUTS)
    expect(lireReglages('null')).toEqual(DEFAUTS)
  })

  it('fait l’aller-retour', () => {
    const r = { ...DEFAUTS, volume: 0.3, qualite: 'basse', ombres: false, champ: 82, heure: 22 * 60 + 30, meteo: 'neige', saison: 'hiver', mouvement: 'reduit' } as const
    expect(lireReglages(ecrireReglages(r))).toEqual(r)
  })

  it('migre champ par champ : garde ce qui vaut, borne les nombres, oublie l’inconnu', () => {
    const r = lireReglages(JSON.stringify({ v: 0, volume: 7, champ: 20, sensibilite: 'vite', qualite: 'ultra', plan: false, meteo: 'grêle', ancien: 1 }))
    expect(r).toEqual({ ...DEFAUTS, volume: 1, champ: 60, plan: false })
    expect(r).not.toHaveProperty('ancien')
  })

  it('traduit les réglages en paramètres que lisent les forçages existants', () => {
    const r = { ...DEFAUTS, heure: 21 * 60 + 5, meteo: 'pluie', saison: 'automne', qualite: 'basse', ombres: false } as const
    const q = rechercheAvec('', r)
    expect(heureDemandee(q, new Date(2026, 5, 1, 9))?.getHours()).toBe(21)
    expect(meteoDemandee(q)?.pluie).toBeGreaterThan(0)
    expect(saisonA(new Date(2026, 5, 1), q)).toEqual(saisonA(new Date(2026, 9, 24)))
    expect(qualiteDemandee(q)).toBe('basse')
    expect(new URLSearchParams(q).get('ombres')).toBe('0')
  })

  it('laisse l’adresse l’emporter, et n’ajoute rien aux défauts', () => {
    const q = rechercheAvec('?heure=08:00&p=museum', { ...DEFAUTS, heure: 23 * 60 })
    expect(new URLSearchParams(q).get('heure')).toBe('08:00')
    expect(new URLSearchParams(q).get('p')).toBe('museum')
    expect(rechercheAvec('', DEFAUTS)).toBe('')
  })

  it('écrit l’heure sur deux chiffres, et réduit le mouvement selon le choix', () => {
    expect(heureTexte(65)).toBe('01:05')
    expect(mouvementReduitPour('systeme', true)).toBe(true)
    expect(mouvementReduitPour('normal', true)).toBe(false)
    expect(mouvementReduitPour('reduit', false)).toBe(true)
  })
})
