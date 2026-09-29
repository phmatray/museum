// troika-three-text (dépendance de drei) n'a pas de types : seul ce qu'on appelle.
declare module 'troika-three-text' {
  export function preloadFont(options: { font: string; characters?: string | string[]; sdfGlyphSize?: number }, callback: () => void): void
}
