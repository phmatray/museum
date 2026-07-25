/**
 * Le point d'accroche de l'éditeur, et la frontière avec la production.
 *
 * ── Pourquoi un fichier pour ça ──
 *
 * L'éditeur ne doit pas exister dans le bundle publié — pas « ne pas
 * s'afficher », NE PAS EXISTER (spec §10). Un `{import.meta.env.DEV && <Éditeur/>}`
 * écrit dans `App` ne suffirait pas : l'import statique en tête de fichier
 * embarquerait quand même tout le code, y compris `derive()` et les schémas
 * zod, dans le chunk de production.
 *
 * On passe donc par un `import()` DYNAMIQUE gardé par la constante : le
 * remplacement de `import.meta.env.DEV` par `false` au build rend la branche
 * morte, et le graphe de dépendances de l'éditeur n'est jamais atteint.
 *
 * C'est aussi ce fichier qui expose le musée régénéré à la scène, avec un
 * crochet qui rend `null` en production sans que `App` ait à savoir pourquoi.
 */
import { lazy, Suspense } from 'react'

import type { Museum } from '../domain/types'

/*
  Le garde entoure l'`import()`, PAS le rendu.

  Écrit à l'intérieur du composant — `if (!import.meta.env.DEV) return null` —
  il ne servait à rien : l'expression `import()` est évaluée au niveau du
  module, et le bundler émet donc son morceau quoi qu'il arrive. Mesuré :
  `PlanEditor-FNf-9EO6.js` était bel et bien livré, simplement jamais demandé.
  « Ne pas s'afficher » n'est pas « ne pas exister ».

  Ici la constante est remplacée par `false` au build, la branche devient morte,
  et le graphe de dépendances de l'éditeur n'est jamais atteint.
*/
const Plan = import.meta.env.DEV
  ? lazy(() => import('./PlanEditor').then((m) => ({ default: m.PlanEditor })))
  : null

export function EditorMount({ publie }: { publie: Museum }) {
  if (Plan === null) return null
  return (
    // `fallback={null}` : l'éditeur arrive en une frame, un écran d'attente s'y
    // verrait comme un clignotement.
    <Suspense fallback={null}>
      <Plan publie={publie} />
    </Suspense>
  )
}
