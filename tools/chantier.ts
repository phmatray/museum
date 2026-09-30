/**
 * Le journal de chantier (`docs/journal/index.html`) → `public/data/chantier.json`,
 * que la salle du chantier du jardin accroche (`src/scene/ChantierLayer.tsx`).
 *
 *     node tools/chantier.ts
 *
 * Lancé par `npm run build` : le journal publié et sa salle ne divergent jamais.
 * Le JSON est versionné, comme `accrochage.json` : les tests le lisent tel quel.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { lireJournal } from '../src/domain/journal.ts'

const racine = fileURLToPath(new URL('..', import.meta.url))
const journal = lireJournal(readFileSync(`${racine}docs/journal/index.html`, 'utf8'))
if (journal.etapes.length === 0) throw new Error('le journal ne compte aucune étape : son HTML a-t-il changé de forme ?')
writeFileSync(`${racine}public/data/chantier.json`, `${JSON.stringify(journal, null, 1)}\n`)
const sansImage = journal.etapes.filter((e) => e.image === null).length
console.log(`chantier : ${journal.etapes.length} étapes (${sansImage} sans image), ${Object.keys(journal.categories).length} catégories → public/data/chantier.json`)
