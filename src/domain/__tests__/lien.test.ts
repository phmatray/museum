import { describe, expect, it } from 'vitest'

import { identifiant, lienVers, projetDemande, resoudre } from '../lien'

const cles = ['phmatray/FormCraft', 'phmatray/.github', 'Atypical-Consulting/.github', 'Atypical-Consulting/FlowForge']
const owners = ['phmatray', 'Atypical-Consulting']

describe('projetDemande', () => {
  it('lit ?projet=, ?p= et #', () => {
    expect(projetDemande('?projet=phmatray/FormCraft')).toBe('phmatray/FormCraft')
    expect(projetDemande('?heure=14:00&p=FormCraft')).toBe('FormCraft')
    expect(projetDemande('', '#FormCraft')).toBe('FormCraft')
    expect(projetDemande('?p=%20FormCraft/', '')).toBe('FormCraft')
  })
  it('la requête l’emporte sur le fragment ; rien demandé, null', () => {
    expect(projetDemande('?p=A', '#B')).toBe('A')
    expect(projetDemande('?heure=14:00', '')).toBeNull()
    expect(projetDemande('?p=', '#')).toBeNull()
    // Un fragment mal encodé ne lève pas.
    expect(projetDemande('', '#%E0%A4%A')).not.toBeNull()
  })
})

describe('resoudre', () => {
  it('ignore la casse et le propriétaire manquant', () => {
    expect(resoudre('formcraft', cles, owners)).toBe('phmatray/FormCraft')
    expect(resoudre('PHMATRAY/formcraft', cles, owners)).toBe('phmatray/FormCraft')
    expect(resoudre('someone/FlowForge', cles, owners)).toBe('Atypical-Consulting/FlowForge')
  })
  it('deux dépôts du même nom : celui du premier propriétaire, sauf si on précise', () => {
    expect(resoudre('.github', cles, owners)).toBe('phmatray/.github')
    expect(resoudre('atypical-consulting/.github', cles, owners)).toBe('Atypical-Consulting/.github')
  })
  it('absent : null', () => {
    expect(resoudre('Inconnu', cles, owners)).toBeNull()
  })
})

describe('lienVers', () => {
  it('le nom court quand il est unique, owner/repo sinon', () => {
    expect(identifiant('phmatray/FormCraft', cles)).toBe('FormCraft')
    expect(identifiant('phmatray/.github', cles)).toBe('phmatray/.github')
  })
  it('la page de partage en production, le musée sinon ; et le lien revient au même projet', () => {
    expect(lienVers('phmatray/FormCraft', cles, 'https://phmatray.github.io/museum/', true)).toBe('https://phmatray.github.io/museum/p/FormCraft/')
    const direct = lienVers('phmatray/FormCraft', cles, 'https://phmatray.github.io/museum', false)
    expect(direct).toBe('https://phmatray.github.io/museum/?p=FormCraft')
    const u = new URL(lienVers('Atypical-Consulting/.github', cles, 'http://localhost:5173/', true))
    expect(resoudre(projetDemande(u.search)!, cles, owners)).toBe('Atypical-Consulting/.github')
  })
})
