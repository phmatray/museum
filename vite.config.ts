// `defineConfig` vient de vitest et non de vite : c'est la seule signature qui
// connaisse la clé `test`, que vite seul rejette au typage.
import { configDefaults, defineConfig } from 'vitest/config'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

/**
 * Le journal de chantier (`docs/journal`) sous `/journal/` en dév, comme le
 * build le copie dans `dist/journal/` : la baraque du chantier y lit ses images
 * (`babylon/chantier.ts`) et la carte d'étape y renvoie. Servi en place, sans dupliquer
 * ses 12 Mo d'images dans `public/`.
 */
function journalEnDev() {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
  return {
    name: 'journal-en-dev',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (chemin: string, f: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      const racine = path.resolve('docs/journal')
      server.middlewares.use('/journal', (req, res, next) => {
        const demande = decodeURIComponent((req.url ?? '/').split('?')[0])
        const fichier = path.join(racine, demande.endsWith('/') ? `${demande}index.html` : demande)
        if (!fichier.startsWith(racine) || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) return next()
        res.setHeader('Content-Type', types[path.extname(fichier).toLowerCase()] ?? 'application/octet-stream')
        fs.createReadStream(fichier).pipe(res)
      })
    },
  }
}

export default defineConfig({
  // Sur GitHub Pages le site vit sous /<nom-du-depot>/, pas à la racine du
  // domaine. La CI passe BASE_PATH ; en local on reste à la racine.
  base: process.env.BASE_PATH ?? '/',
  plugins: [journalEnDev()],
  // Le worker du navmesh (babylon/navmesh.worker.ts) charge Recast par import() : un module ES.
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // Des morceaux par bibliothèque, qui changent rarement : le cache du
        // navigateur les garde d'une publication à l'autre, seul `index` bouge.
        // Les shaders de Babylon (GLSL ou WGSL, selon le moteur) restent hors du
        // groupe : Babylon les charge par import() paresseux, un fichier chacun.
        // webxr-polyfill aussi : io/xr.ts ne le charge (import()) que pour une
        // Cardboard sans WebXR natif ; dans `vendor`, chaque visiteur le préchargerait.
        // Sans `includeDependenciesRecursively: false` : ce réglage lève la garantie d'ordre
        // d'exécution, et un shader importé tel quel (le miroir, le velours) lisait alors
        // `ShaderStore` avant son initialisation : le musée publié plantait au chargement.
        codeSplitting: {
          groups: [
            { name: 'babylon', test: /node_modules[\\/]@babylonjs[\\/](?!core[\\/]Shaders|addons[\\/]atmosphere[\\/]Shaders)/, priority: 20 },
            { name: 'vendor', test: /node_modules[\\/](zustand|zod|qrcode-generator)[\\/]/, priority: 10 },
          ],
        },
      },
    },
    // Le cœur de Babylon pèse ~2,97 Mo minifié (725 ko gzip), importé d'un bloc par
    // babylon/main.ts : c'est le plancher du musée. Le seuil par défaut (500 ko)
    // avertirait à chaque build.
    chunkSizeWarningLimit: 3000,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Les worktrees d'agents (.claude/worktrees/) contiennent une copie du dépôt :
    // sans cette exclusion, chaque suite lancée depuis la racine les rejouait.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Plusieurs suites balaient tout le terrain ou simulent des heures de marche :
    // seules, 2 à 4 s ; en parallèle, sous charge, elles dépassaient les 5 s par
    // défaut une fois sur deux. 30 s les laisse finir sans masquer une boucle folle.
    testTimeout: 30_000,
  },
})
