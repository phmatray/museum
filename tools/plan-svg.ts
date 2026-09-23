/**
 * Dessine le plan d'architecte de chaque niveau dans `docs/plan/`.
 *
 *   node tools/plan-svg.ts
 *
 * Les SVG sont versionnés : c'est eux qu'on relit, sur GitHub, avant de toucher
 * à la 3D. Ils sont régénérés à chaque changement du plan.
 */
/// <reference types="node" />
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MUSEE } from '../src/plan/musee.ts'
import { renderLevel } from '../src/plan/svg.ts'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/plan')
await mkdir(OUT, { recursive: true })
for (const level of MUSEE.levels) {
  const file = resolve(OUT, `niveau-${level.id}.svg`)
  await writeFile(file, renderLevel(MUSEE, level.id) + '\n')
  console.log(`${level.name} → docs/plan/niveau-${level.id}.svg`)
}
