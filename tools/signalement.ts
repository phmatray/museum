/**
 * Le signalement des bugs visuels, en dév seulement : `src/babylon/ui/signalement.ts` poste la capture, la note
 * et la pose du visiteur sur `/__signalement` ; ce greffon de Vite ouvre un worktree `bug/<id>` sur le HEAD
 * servi, y range le constat (`.signalement/`, ignoré par git) et lance `claude -p` avec la consigne
 * ci-dessous : reproduire la vue en headless (`tools/comparer-captures.ts --lieu`), corriger, recapturer,
 * comparer, committer sans pousser. Une notification macOS annonce la fin ; `claude --resume <session>`
 * dans le worktree reprend la conversation.
 */
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

const executer = promisify(execFile)
const git = async (cwd: string, ...args: string[]) => (await executer('git', args, { cwd })).stdout.trim()

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
})
type Constat = z.infer<typeof Constat>

const CHROME_MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** La consigne de l'agent : tout ce qu'il lui faut pour reproduire, corriger et prouver, sans revenir vers nous. */
export function consigne(id: string, c: Constat, port: number): string {
  const r = (n: number) => +n.toFixed(3)
  const { x, z: zz, y, yaw, pitch, surface } = c.lieu
  const capture = `node tools/comparer-captures.ts http://localhost:${port}/ --lieu=${r(x)},${r(zz)},${r(y)},${r(yaw)},${r(pitch)} --heure=${c.heure} --q='${c.q}'`
  return `Tu corriges un bug visuel du musée, signalé depuis le musée lui-même (bouton 🐞 de \`npm run dev\`).
Tu es dans un worktree isolé, sur la branche \`bug/${id}\`, partie du commit que le visiteur regardait.
Travaille seul jusqu'au bout : personne ne répondra à tes questions avant la fin.

## Le constat

Note du visiteur : « ${c.note} »

- Sa capture : \`.signalement/utilisateur.png\` (regarde-la d'abord ; rendu ${c.moteur}, ${c.taille.join('×')} px).
- Sa pose : surface \`${surface}\`, x=${r(x)}, z=${r(zz)}, y=${r(y)}, yaw=${r(yaw)}, pitch=${r(pitch)} ; heure ${c.heure} ; requête \`${c.q}\`.
- Adresse d'origine et relevé météo exact : \`.signalement/signalement.json\`.

## La marche à suivre

1. Lis CLAUDE.md. \`node_modules\` et les assets non versionnés sont déjà copiés ; s'il en manque : \`npm ci\`, \`node tools/fetch-assets.ts\`.
2. Lance le serveur de dév de ce worktree en tâche de fond, sur le port réservé : \`npx vite --port ${port} --strictPort\`
   (jamais 5173 : c'est celui du visiteur, qui tourne sur le code d'origine).
3. **Avant**, sans toucher au code :
   \`${capture} --dossier=.signalement/avant\`
   Compare \`.signalement/avant/lieu.png\` à la capture du visiteur : même vue, au cadrage (1280×720) et au GPU près.
   Si le bug n'y est pas, cherche ce qui manque (heure, météo, saison, moteur) jusqu'à le reproduire ; si tu n'y arrives pas,
   arrête-toi là et explique-le dans le rapport (étape 6).
   Capture aussi deux ou trois vues voisines de \`VUES\` (\`tools/comparer-captures.ts\`), dans une commande à part sans \`--lieu\` ni \`--q\` :
   \`node tools/comparer-captures.ts http://localhost:${port}/ --vues=<vue>,<vue> --dossier=.signalement/avant\`
4. Trouve la cause racine, pas le symptôme, et corrige-la à la source en suivant CLAUDE.md (plan → fonctions dérivées,
   z-fighting = deux surfaces sur le même plan, greffes GLSL **et** WGSL…). Puis \`npm run lint\` et les tests concernés
   (\`NODE_OPTIONS=--no-webstorage npx vitest run <fichiers>\`).
   Si la correction exige Blender, un nouveau bake de la lumière ou une décision de design, ne la fais pas : décris-la dans le rapport.
5. **Après** : les mêmes commandes avec \`--dossier=.signalement/apres --avant=.signalement/avant\`. Elles affichent l'écart
   moyen par vue et écrivent \`.signalement/apres/<vue>.avant-apres.png\` (avant à gauche, après à droite).
   Regarde ces images toi-même : le bug a disparu de \`lieu\`, et les vues voisines n'ont pas bougé sauf changement voulu
   (deux captures du même code diffèrent déjà d'environ 0,5 : visiteurs, faune et nuages bougent). Sinon, reprends à l'étape 4 (trois essais au plus).
6. Écris \`.signalement/rapport.md\` : verdict (corrigé / partiel / non reproduit), cause, correctif (fichiers), écarts mesurés,
   images (chemins relatifs à \`.signalement/\`), ce qui reste douteux.
7. Commit sur \`bug/${id}\`, message en français dans le style du dépôt (\`fix(<zone>): …\`), sans \`.signalement/\`.
   Ne pousse pas et n'ouvre pas de PR : le propriétaire regarde l'avant/après d'abord. Arrête le serveur de dév.
`
}

function portLibre(): Promise<number> {
  return new Promise((ok, ko) => {
    const s = net.createServer().on('error', ko).listen(0, () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => ok(port))
    })
  })
}

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

/** Le worktree prêt à servir : les dépendances et les assets non versionnés clonés (APFS : instantané, sans place), liés ailleurs. */
async function ouvrirWorktree(racine: string, id: string): Promise<string> {
  const commun = path.resolve(racine, await git(racine, 'rev-parse', '--git-common-dir'))
  const worktree = path.join(path.dirname(commun), '.claude', 'worktrees', `bug-${id}`)
  await git(racine, 'worktree', 'add', '-b', `bug/${id}`, worktree, 'HEAD')
  const ignores = (await git(racine, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', 'public')).split('\n')
  for (const p of ['node_modules', ...ignores].map((p) => p.replace(/\/$/, '')).filter(Boolean)) {
    const de = path.join(racine, p)
    const vers = path.join(worktree, p)
    if (!fs.existsSync(de) || fs.existsSync(vers)) continue
    fs.mkdirSync(path.dirname(vers), { recursive: true })
    if (process.platform === 'darwin') await executer('cp', ['-cR', de, vers])
    else fs.symlinkSync(de, vers)
  }
  return worktree
}

async function signaler(racine: string, c: Constat) {
  const id = new Date().toISOString().replace(/\D/g, '').slice(2, 14)
  const worktree = await ouvrirWorktree(racine, id)
  const dossier = path.join(worktree, '.signalement')
  fs.mkdirSync(dossier, { recursive: true })
  const { image, ...reste } = c
  fs.writeFileSync(path.join(dossier, 'utilisateur.png'), Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'))
  fs.writeFileSync(path.join(dossier, 'signalement.json'), JSON.stringify({ id, ...reste }, null, 2))
  const texte = consigne(id, c, await portLibre())
  fs.writeFileSync(path.join(dossier, 'consigne.md'), texte)

  const session = randomUUID()
  const journal = path.join(dossier, 'claude.log')
  const sortie = fs.openSync(journal, 'a')
  const env = { ...process.env }
  if (!env.CHROME_PATH && fs.existsSync(CHROME_MAC)) env.CHROME_PATH = CHROME_MAC
  // Sans demande de permission : personne ne regarde. Le worktree isole le code, et pousser reste interdit.
  const agent = spawn('claude', ['-p', texte, '--session-id', session, '--permission-mode', 'bypassPermissions', '--disallowedTools', 'Bash(git push:*)'], {
    cwd: worktree, env, detached: true, stdio: ['ignore', sortie, sortie],
  })
  await new Promise<void>((ok, ko) => agent.once('spawn', ok).once('error', ko))
  fs.closeSync(sortie)
  agent.on('exit', (code) => {
    const message = code === 0 ? `bug-${id} : fini, voir .signalement/rapport.md` : `bug-${id} : arrêté (code ${code})`
    console.log(`[signalement] ${message} — ${worktree}`)
    if (process.platform === 'darwin') execFile('osascript', ['-e', `display notification "${message}" with title "Musée — signalement"`], () => {})
  })
  agent.unref()
  console.log(`[signalement] bug-${id} → ${worktree} (session ${session})`)
  return { id, worktree, journal, session }
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
        // L'agent tourne sans garde-fou de permissions : jamais à la demande d'une autre machine (`vite --host`).
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
