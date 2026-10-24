/**
 * Le signalement des bugs visuels, en dév seulement : `src/babylon/ui/signalement.ts` poste la capture, la note
 * et la pose du visiteur sur `/__signalement` ; ce greffon de Vite range le constat dans le checkout principal,
 * `.signalement/<id>/` (ignoré par git : utilisateur.png, signalement.json, consigne.md), quel que soit le worktree
 * servi : les constats ne s'éparpillent plus dans des worktrees qu'on supprime. Il rend un prompt court, que le
 * visiteur copie dans la session Claude de son choix : `/signalement <id>` (le skill `.claude/skills/signalement`
 * porte la procédure). Rien n'est lancé d'ici : un agent lancé en tâche de fond puis « repris » ailleurs faisait
 * deux agents dans le même worktree.
 */
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

import { promptDuConstat } from '../src/domain/signalement.ts'

const executer = promisify(execFile)
const git = async (cwd: string, ...args: string[]) => (await executer('git', args, { cwd })).stdout.trim()

/** Le checkout principal, même depuis un worktree : les constats et les worktrees y vivent tous. */
export function racinePrincipale(cwd: string): string {
  return path.dirname(path.resolve(cwd, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim()))
}

const Constat = z.object({
  note: z.string().trim().min(1).max(4000),
  image: z.string().startsWith('data:image/png;base64,'),
  adresse: z.string().max(2000),
  lieu: z.object({ level: z.number(), surface: z.string().max(200), x: z.number(), z: z.number(), y: z.number(), yaw: z.number(), pitch: z.number() }),
  heure: z.string().regex(/^\d{2}:\d{2}$/),
  q: z.string().max(500).regex(/^[\w%=&.+*-]*$/),
  meteo: z.unknown(),
  moteur: z.string().max(20),
  taille: z.tuple([z.number(), z.number()]),
  trajet: z.array(z.object({ x: z.number(), z: z.number(), y: z.number(), yaw: z.number(), pitch: z.number(), t: z.number() })).max(100).default([]),
})
type Constat = z.infer<typeof Constat>

const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function lireCorps(req: IncomingMessage, max = 40 * 1024 * 1024): Promise<string> {
  return new Promise((ok, ko) => {
    let taille = 0
    const morceaux: Buffer[] = []
    req.on('data', (m: Buffer) => {
      taille += m.length
      if (taille <= max) return void morceaux.push(m)
      ko(new Error('corps trop lourd'))
      req.destroy()
    })
    req.on('end', () => ok(Buffer.concat(morceaux).toString('utf8')))
    req.on('error', ko)
  })
}

async function signaler(racine: string, c: Constat) {
  const id = new Date().toISOString().replace(/\D/g, '').slice(2, 14)
  const dossier = path.join(racinePrincipale(racine), '.signalement', id)
  fs.mkdirSync(dossier, { recursive: true })
  const { image, ...reste } = c
  fs.writeFileSync(path.join(dossier, 'utilisateur.png'), Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'))
  // Tout ce que la procédure lit : le constat, la racine servie et son commit (le worktree `bug/<id>` en part),
  // et `sale` si ce checkout avait des modifications non commitées, absentes de ce commit.
  const sha = await git(racine, 'rev-parse', 'HEAD')
  const sale = (await git(racine, 'status', '--porcelain', '--untracked-files=no')) !== ''
  fs.writeFileSync(path.join(dossier, 'signalement.json'), JSON.stringify({ id, racine, sha, sale, ...reste }, null, 2))
  const prompt = promptDuConstat(id, c.note, dossier, racine)
  fs.writeFileSync(path.join(dossier, 'consigne.md'), prompt)
  console.log(`[signalement] ${id} → ${dossier}`)
  return { id, dossier, prompt }
}

export function signalementEnDev() {
  return {
    name: 'signalement-en-dev',
    apply: 'serve' as const,
    configureServer(server: { config: { root: string }; middlewares: { use: (chemin: string, f: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
      server.middlewares.use('/__signalement', (req, res) => {
        const repondre = (code: number, corps: object) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(corps))
        }
        // Le constat s'écrit sur le disque et la consigne mène un agent : jamais à la demande d'une autre machine (`vite --host`).
        if (req.method !== 'POST' || !LOCALES.has(req.socket.remoteAddress ?? '')) return repondre(403, { erreur: 'POST depuis cette machine seulement' })
        lireCorps(req)
          .then((corps) => signaler(server.config.root, Constat.parse(JSON.parse(corps))))
          .then((r) => repondre(200, r))
          .catch((e: unknown) => {
            console.error('[signalement]', e)
            repondre(500, { erreur: e instanceof Error ? e.message : String(e) })
          })
      })
    },
  }
}
