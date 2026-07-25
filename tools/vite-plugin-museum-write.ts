/**
 * Plugin Vite : la seule écriture du projet (spec §10).
 *
 * Expose `POST /__museum/curation`, qui valide la charge utile par le schéma zod
 * puis écrit `curation.json`.
 *
 * ── `command === 'serve'` n'est pas une précaution, c'est le contrat ──
 *
 * Le musée déployé est un site STATIQUE : il n'a pas de serveur, donc pas de
 * point d'écriture, donc pas de « mode brouillon en production » possible. Ce
 * plugin ne s'installe qu'en développement, et c'est ce qui rend cette
 * impossibilité structurelle plutôt que disciplinaire. Le flux assumé est
 * forker → `npm run dev` → curer → commiter → l'Action publie.
 *
 * ── Le formatage est stable, exprès ──
 *
 * Clés triées, deux espaces, saut de ligne final. `curation.json` est un fichier
 * VERSIONNÉ : si l'ordre des clés suivait celui de l'objet JavaScript, deux
 * sessions d'édition produiraient des diffs illisibles où rien n'aurait bougé.
 */
/// <reference types="node" />
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Charge utile maximale. Une curation de dix mille dépôts pèse ~2 Mo. */
const TAILLE_MAX = 8 * 1024 * 1024

export interface MuseumWriteOptions {
  /** Chemin du fichier de curation, relatif à la racine du projet. */
  fichier?: string
}

export function museumDevWrite(options: MuseumWriteOptions = {}): Plugin {
  const fichier = options.fichier ?? 'curation.json'
  let racine = process.cwd()

  return {
    name: 'museum-dev-write',
    // Le plugin n'existe pas dans un build. Voir l'en-tête : c'est ce qui rend
    // le site déployé structurellement incapable d'être écrit.
    apply: 'serve',

    configResolved(config) {
      racine = config.root
    },

    configureServer(server) {
      const chemin = resolve(racine, fichier)

      /*
        Les ENTRÉES de la dérivation, en une réponse.

        L'éditeur rejoue `derive()` dans le navigateur — c'est ce qui fait du
        bouton « Régénérer » un vrai test de santé plutôt qu'une animation. Il
        lui faut donc les quatre entrées, or `museum.config.json` vit à la
        RACINE du dépôt et non dans `public/` : le navigateur ne peut pas le
        lire.

        On l'expose ici plutôt que de le copier dans `public/` : copié, il
        partirait dans le bundle de production, où personne n'en a l'usage et où
        il n'a rien à faire. Servi par un plugin `apply: 'serve'`, il n'existe
        qu'en développement, comme l'éditeur qui le consomme.
      */
      server.middlewares.use('/__museum/inputs', (req, res, next) => {
        if (req.method !== 'GET') {
          next()
          return
        }
        void (async () => {
          try {
            const [config, catalogue, curation, atlas] = await Promise.all([
              lireJson(resolve(racine, 'museum.config.json')),
              lireJson(resolve(racine, 'public/data/catalogue.json')),
              // Absents, ces deux-là valent leur forme vide : un musée non curé
              // et sans médias reste un musée dérivable.
              lireJson(chemin).catch(() => CURATION_VIDE),
              lireJson(resolve(racine, 'public/media/atlas.json')).catch(() => null),
            ])
            repondre(res, 200, JSON.stringify({ config, catalogue, curation, atlas }))
          } catch (erreur) {
            const message = erreur instanceof Error ? erreur.message : String(erreur)
            repondre(res, 500, JSON.stringify({ erreur: message }))
          }
        })()
      })

      server.middlewares.use('/__museum/curation', (req, res, next) => {
        if (req.method === 'GET') {
          void readFile(chemin, 'utf8')
            .then((texte) => repondre(res, 200, texte))
            // Absent n'est pas une erreur : un musée non curé est un musée
            // valide, et c'est même l'état de départ.
            .catch(() => repondre(res, 200, JSON.stringify(CURATION_VIDE)))
          return
        }

        if (req.method !== 'POST') {
          next()
          return
        }

        const morceaux: Buffer[] = []
        let taille = 0
        req.on('data', (c: Buffer) => {
          taille += c.length
          if (taille > TAILLE_MAX) {
            repondre(res, 413, JSON.stringify({ erreur: 'charge utile trop grande' }))
            req.destroy()
            return
          }
          morceaux.push(c)
        })

        req.on('end', () => {
          void (async () => {
            try {
              const brut: unknown = JSON.parse(Buffer.concat(morceaux).toString('utf8'))
              // La validation est faite par le MÊME schéma que celui de la
              // dérivation : un fichier écrit ici est, par construction, un
              // fichier que le pipeline saura relire.
              const { parseCuration } = await import('../src/schema/index.ts')
              const curation = parseCuration(brut)
              await writeFile(chemin, `${stableJson(curation)}\n`, 'utf8')
              repondre(res, 200, JSON.stringify({ ok: true, fichier }))
            } catch (erreur) {
              const message = erreur instanceof Error ? erreur.message : String(erreur)
              // 422 et non 500 : la charge utile est syntaxiquement reçue mais
              // refusée. Le message du schéma est renvoyé TEL QUEL — c'est lui
              // qui dit quel champ a lâché, et l'éditeur l'affiche.
              repondre(res, 422, JSON.stringify({ erreur: message }))
            }
          })()
        })
      })
    },
  }
}

const CURATION_VIDE = { schemaVersion: 1, repos: {}, rooms: {}, excluded: [] }

async function lireJson(chemin: string): Promise<unknown> {
  return JSON.parse(await readFile(chemin, 'utf8'))
}

function repondre(res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, code: number, corps: string): void {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(corps)
}

/**
 * JSON à clés triées, récursivement.
 *
 * `JSON.stringify` respecte l'ordre d'insertion des propriétés. Deux sessions
 * d'édition qui aboutissent au MÊME état produiraient donc deux fichiers
 * différents, et un diff git plein de lignes déplacées sans qu'aucune valeur
 * n'ait changé. Les tableaux, eux, gardent leur ordre : il porte du sens.
 */
export function stableJson(valeur: unknown): string {
  return JSON.stringify(trier(valeur), null, 2)
}

function trier(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(trier)
  if (v !== null && typeof v === 'object') {
    const sortie: Record<string, unknown> = {}
    for (const cle of Object.keys(v as Record<string, unknown>).sort()) {
      sortie[cle] = trier((v as Record<string, unknown>)[cle])
    }
    return sortie
  }
  return v
}
