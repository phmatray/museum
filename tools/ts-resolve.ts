/**
 * Rétablit, pour Node, la résolution sans extension que Vite pratique.
 *
 * `src/` est écrit pour Vite, qui résout `./clustering` sans extension ; le
 * résolveur ESM de Node, lui, exige l'extension. Plutôt que d'imposer un `.ts`
 * partout dans le domaine — ce qui alourdirait des modules dont Node n'est pas
 * le premier client — on rétablit ici la convention du bundler, et seulement
 * pour les chemins relatifs dont le `.ts` existe vraiment.
 *
 * ── Pourquoi un fichier à part ──
 *
 * Ce crochet vivait dans `tools/derive-museum.ts`, et il y était seul. Le
 * deuxième outil qui a eu besoin de lire le domaine depuis Node
 * (`measure-props.ts`) l'aurait recopié, ce qui aurait fait deux endroits où la
 * règle peut dériver — pour une règle dont la panne se manifeste par un
 * `ERR_MODULE_NOT_FOUND` sur un module qui existe.
 *
 * ── Le piège d'ordonnancement, qui n'est pas une subtilité ──
 *
 * En ESM, TOUT le graphe est résolu avant qu'une seule ligne ne s'exécute. Un
 * `import` statique du domaine serait donc résolu AVANT que ce crochet ne soit
 * posé, et échouerait quand même. Les modules du domaine doivent être chargés
 * par `await import(...)`, APRÈS l'appel :
 *
 *     import { activerResolutionTs } from './ts-resolve.ts'
 *     activerResolutionTs()
 *     const { placeProps } = await import('../src/domain/props.ts')
 *
 * Importer ce module pour son seul effet de bord ne marcherait pas non plus, et
 * pour la même raison : d'où une fonction qu'on appelle, et pas un effet de bord
 * qu'on croirait acquis.
 */
/// <reference types="node" />
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'

let pose = false

export function activerResolutionTs(): void {
  if (pose) return
  pose = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
        const candidat = new URL(`${specifier}.ts`, context.parentURL)
        if (candidat.protocol === 'file:' && existsSync(candidat)) {
          return nextResolve(`${specifier}.ts`, context)
        }
      }
      return nextResolve(specifier, context)
    },
  })
}
