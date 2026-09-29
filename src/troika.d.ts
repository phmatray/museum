// troika-three-text (dépendance de drei) n'a pas de types : seul ce qu'on appelle.
declare module 'troika-three-text' {
  import type { Mesh } from 'three'

  export function preloadFont(options: { font: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void
  /** Les `Text` ajoutés comme enfants, rendus en un seul appel de dessin (`scene/lotDeTextes.ts`). */
  export class BatchedText extends Mesh {
    dispose(): void
  }
}
