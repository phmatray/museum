import { describe, expect, it } from 'vitest'

import { CLAIR } from '../meteo'
import { nomDeMeteo, requeteDeReprise } from '../signalement'

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
