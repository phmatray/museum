/**
 * Garde-fou : aucun `<instancedMesh>` ne reçoit son matériau par `args` (#35).
 *
 * R3F RECONSTRUIT l'objet quand un élément d'`args` change d'identité. Un
 * `InstancedMesh` neuf naît avec des matrices d'instance identité, et l'effet
 * qui les pose ne repasse que si ses propres dépendances changent. Un matériau
 * qui arrive plus tard (`useMatiere` en rend un nouveau quand les cartes PBR
 * sont chargées) ramenait ainsi tous les murs et toutes les dalles du bâtiment
 * à un cube unité à l'origine : le musée publié s'affichait noir.
 *
 * Passé en prop, le matériau est affecté sur l'objet existant, qui garde ses
 * matrices. Le test est statique, faute de harnais R3F (#21) : il lit la source.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..')

function sources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) return sources(chemin)
    return e.name.endsWith('.tsx') ? [chemin] : []
  })
}

describe('instancedMesh', () => {
  it('ne reçoit jamais son matériau par args', () => {
    const fautifs: string[] = []
    for (const fichier of sources(SRC)) {
      const texte = readFileSync(fichier, 'utf8')
      // Le deuxième élément d'`args` de chaque `<instancedMesh`, jusqu'au `>`.
      for (const m of texte.matchAll(/<instancedMesh\b[^>]*?args=\{\[\s*[^,\]]+,\s*([^,\]]+)/g)) {
        if (m[1].trim() !== 'undefined') fautifs.push(`${fichier}: ${m[1].trim()}`)
      }
    }
    expect(fautifs).toEqual([])
  })
})
