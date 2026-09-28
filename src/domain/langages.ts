/**
 * Les couleurs de langage de GitHub (linguist), pour les langages de la
 * collection. Un langage absent prend le gris de GitHub.
 */
const COULEURS: Record<string, string> = {
  'C#': '#178600',
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  HTML: '#e34c26',
  CSS: '#663399',
  SCSS: '#c6538c',
  Shell: '#89e051',
  PowerShell: '#012456',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  'C++': '#f34b7d',
  C: '#555555',
  Razor: '#512be4',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Dockerfile: '#384d54',
  'F#': '#b845fc',
  Dart: '#00b4ab',
  Ruby: '#701516',
  PHP: '#4f5d95',
}

export const couleurDeLangage = (langage: string): string => COULEURS[langage] ?? '#8b949e'

/** Les parts de chaque langage, de la plus grande à la plus petite, en fractions de 1. */
export function partsDeLangages(octets: Record<string, number>): { langage: string; part: number }[] {
  const total = Object.values(octets).reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return Object.entries(octets)
    .map(([langage, n]) => ({ langage, part: n / total }))
    .sort((a, b) => b.part - a.part || a.langage.localeCompare(b.langage))
}
