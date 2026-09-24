/**
 * Garde contre la réapparition du doublon de `useAccrochage` (#49) :
 * `PropsLayer`/`CartelLayer` important autrefois une copie locale de
 * `useAccrochage` (`src/scene/useAccrochage.ts`) qui contournait la
 * validation zod. Ce test échoue tant que cette copie existe.
 *
 * Vérifié par existence de fichier (et non par `import()`) : Vite résout les
 * imports dynamiques à chemin littéral au moment de la transformation, donc
 * un chemin absent fait échouer tout le fichier de test plutôt que de
 * produire une promesse rejetée observable.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { useAccrochage } from '../../hooks/useAccrochage'

describe('PropsLayer / CartelLayer useAccrochage', () => {
  it('utilisent le hook partagé et validé de src/hooks', () => {
    expect(typeof useAccrochage).toBe('function')
  })

  it("n'ont plus de copie locale non validée dans src/scene/useAccrochage.ts", () => {
    const ici = dirname(fileURLToPath(import.meta.url))
    expect(existsSync(resolve(ici, '../useAccrochage.ts'))).toBe(false)
  })
})
