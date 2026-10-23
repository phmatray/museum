import { describe, expect, it } from 'vitest'

import { CLAIR } from '../meteo'
import { echantillonner, nomDeMeteo, promptDuConstat, requeteDeReprise, vuesDuConstat } from '../signalement'

describe('requeteDeReprise', () => {
  it('écarte la pose et l’heure, garde les autres forçages', () => {
    expect(requeteDeReprise('?p=FormCraft&heure=22:00&saison=hiver&qualite=basse&ombres=0', CLAIR, true)).toBe('saison=hiver&ombres=0&meteo=clair')
  })
  it('fige le temps vivant, sauf s’il était forcé', () => {
    expect(requeteDeReprise('', { ...CLAIR, pluie: 0.4 }, true)).toBe('meteo=pluie')
    expect(requeteDeReprise('?meteo=brouillard', { ...CLAIR, pluie: 0.4 }, true)).toBe('meteo=brouillard')
  })
  it('force WebGL2 quand le visiteur y était', () => {
    expect(requeteDeReprise('', CLAIR, false)).toBe('meteo=clair&gpu=0')
  })
})

describe('nomDeMeteo', () => {
  it('l’orage d’abord, puis la neige, la pluie, le brouillard', () => {
    expect(nomDeMeteo({ ...CLAIR, orage: true, pluie: 1 })).toBe('orage')
    expect(nomDeMeteo({ ...CLAIR, neige: 0.2, pluie: 0.2 })).toBe('neige')
    expect(nomDeMeteo({ ...CLAIR, brouillard: 0.8 })).toBe('brouillard')
    expect(nomDeMeteo(CLAIR)).toBe('clair')
  })
})

describe('echantillonner', () => {
  const pose = (x: number, t: number) => ({ x, z: 0, y: 0, yaw: 0, pitch: 0, t })
  it('immobile : une seule pose, pas de trajet', () => {
    expect(echantillonner([pose(1, -2), pose(1, -1), pose(1, 0)])).toEqual([pose(1, -2)])
  })
  it('en marche : n poses réparties, la plus ancienne et la dernière comprises', () => {
    const trajet = Array.from({ length: 24 }, (_, i) => pose(i, (i - 23) / 4))
    expect(echantillonner(trajet, 5).map((p) => p.x)).toEqual([0, 6, 12, 17, 23])
  })
  it('un arrêt au milieu compte pour une pose', () => {
    expect(echantillonner([pose(0, -3), pose(1, -2), pose(1, -1.5), pose(1, -1), pose(2, 0)]).map((p) => p.x)).toEqual([0, 1, 2])
  })
})

describe('vuesDuConstat', () => {
  const pose = (x: number, t: number) => ({ x, z: 0, y: 0, yaw: 0, pitch: 0, t })
  const lieu = { surface: 'volee:volee-sous-sol', x: 9, z: 0, y: -1, yaw: 0, pitch: 0 }
  it('immobile : la pose seule, sur sa surface', () => {
    expect(vuesDuConstat(lieu, [pose(9, -1), pose(9, 0)])).toEqual([{ nom: 'lieu', ...lieu }])
  })
  it('en marche : la pose, puis le trajet dans l’ordre, sans le temps', () => {
    const vues = vuesDuConstat(lieu, [pose(0, -3), pose(1, -2), pose(2, -1)])
    expect(vues.map((v) => v.nom)).toEqual(['lieu', 'trajet-1', 'trajet-2', 'trajet-3'])
    expect(vues[2]).toEqual({ nom: 'trajet-2', x: 1, z: 0, y: 0, yaw: 0, pitch: 0 })
  })
})

describe('promptDuConstat', () => {
  it('commence par la commande du skill, et dit où trouver le constat', () => {
    const p = promptDuConstat('261023153316', 'les spots', '/m/.signalement/261023153316', '/m/.claude/worktrees/recette')
    expect(p.split('\n')[0]).toBe('/signalement 261023153316')
    expect(p).toContain('« les spots »')
    expect(p).toContain('/m/.signalement/261023153316/signalement.json')
    expect(p).toContain('/m/.claude/worktrees/recette/.claude/skills/signalement/SKILL.md')
  })
})
