/**
 * Le signalement des bugs visuels, en dév seulement : `src/babylon/ui/signalement.ts` poste la capture, la note
 * et la pose du visiteur sur `/__signalement` ; ce greffon de Vite range le constat dans
 * `<racine servie>/.signalement/<id>/` (ignoré par git : utilisateur.png, signalement.json, consigne.md) et
 * rend la consigne, que le visiteur copie dans la session Claude de son choix. Rien n'est lancé d'ici : un
 * agent lancé en tâche de fond puis « repris » ailleurs faisait deux agents dans le même worktree.
 * La consigne : un worktree `bug/<id>` parti du commit servi, la vue rejouée en headless
 * (`tools/comparer-captures.ts --lieu`), la correction, l'avant/après, un rapport, un commit sans push.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

/** Où et sur quoi travailler : le dossier du constat, la racine servie, son commit, et ce qui n'y était pas commité. */
interface Lieux { dossier: string; racine: string; worktrees: string; sha: string; sale: boolean }

/** La consigne de l'agent : tout ce qu'il lui faut pour reproduire, corriger et prouver, sans revenir vers nous. */
export function consigne(id: string, c: Constat, l: Lieux): string {
  const r = (n: number) => +n.toFixed(3)
  const { x, z: zz, y, yaw, pitch, surface } = c.lieu
  const d = l.dossier
  const capture = `node tools/comparer-captures.ts http://localhost:<port>/ --lieu=${r(x)},${r(zz)},${r(y)},${r(yaw)},${r(pitch)} --heure=${c.heure} --q='${c.q}' --taille=${c.taille.join('x')}`
  const chrome = process.platform === 'darwin' ? `\n   Sur ce Mac, si \`CHROME_PATH\` n'est pas posé : \`export CHROME_PATH="${CHROME_MAC}"\`.` : ''
  return `Tu corriges un bug visuel du musée, signalé depuis le musée lui-même (bouton 🐞 de \`npm run dev\`).
Travaille seul jusqu'au bout : personne ne répondra à tes questions avant la fin.

## Le constat

Note du visiteur : « ${c.note} »

- Sa capture : \`${d}/utilisateur.png\` (regarde-la d'abord ; rendu ${c.moteur}, ${c.taille.join('×')} px).
- Sa pose : surface \`${surface}\`, x=${r(x)}, z=${r(zz)}, y=${r(y)}, yaw=${r(yaw)}, pitch=${r(pitch)} ; heure ${c.heure} ; requête \`${c.q}\`.
- Adresse d'origine et relevé météo exact : \`${d}/signalement.json\`.
- Le code servi : \`${l.racine}\`, au commit \`${l.sha}\`.${l.sale ? '\n- Attention : ce checkout avait des modifications non commitées, absentes de ce commit. Si le bug en dépend, dis-le dans le rapport.' : ''}

Les captures et le rapport vont dans \`${d}/\`, jamais dans le worktree.

## La marche à suivre

1. Travaille dans un worktree \`bug/${id}\` parti de \`${l.sha}\` : EnterWorktree, ou
   \`git -C ${l.racine} worktree add -b bug/${id} ${l.worktrees}/bug-${id} ${l.sha}\`.
   Recopie-y \`node_modules\` et les assets non versionnés depuis \`${l.racine}\` (sur macOS \`cp -cR\`, instantané) :
   \`node_modules\` et chaque chemin de \`git -C ${l.racine} ls-files --others --ignored --exclude-standard --directory public\`.
   S'il en manque encore : \`npm ci\`, \`node tools/fetch-assets.ts\`. Puis lis CLAUDE.md.
2. Lance le serveur de dév du worktree en tâche de fond sur un port libre, jamais 5173 (celui du visiteur, sur le code
   d'origine) : \`npx vite --port <port> --strictPort\`.${chrome}
3. **Avant**, sans toucher au code :
   \`${capture} --dossier=${d}/avant\`
   Compare \`${d}/avant/lieu.png\` à la capture du visiteur : même vue et même cadrage, au GPU près.
   Si le bug n'y est pas, cherche ce qui manque (heure, météo, saison, moteur) jusqu'à le reproduire ; si tu n'y arrives pas,
   arrête-toi là et explique-le dans le rapport (étape 6).
   Capture aussi deux ou trois vues voisines de \`VUES\` (\`tools/comparer-captures.ts\`), dans une commande à part sans \`--lieu\` ni \`--q\` :
   \`node tools/comparer-captures.ts http://localhost:<port>/ --vues=<vue>,<vue> --dossier=${d}/avant\`
4. Trouve la cause racine, pas le symptôme, et corrige-la à la source en suivant CLAUDE.md (plan → fonctions dérivées,
   z-fighting = deux surfaces sur le même plan, greffes GLSL **et** WGSL…). Puis \`npm run lint\` et les tests concernés
   (\`NODE_OPTIONS=--no-webstorage npx vitest run <fichiers>\` sous Node 26).
   Si la correction exige Blender, un nouveau bake de la lumière ou une décision de design, ne la fais pas : décris-la dans le rapport.
5. **Après** : les mêmes commandes avec \`--dossier=${d}/apres --avant=${d}/avant\`. Elles affichent l'écart
   moyen par vue et écrivent \`${d}/apres/<vue>.avant-apres.png\` (avant à gauche, après à droite).
   Regarde ces images toi-même : le bug a disparu de \`lieu\`, et les vues voisines n'ont pas bougé sauf changement voulu
   (deux captures du même code diffèrent déjà d'environ 0,5 : visiteurs, faune et nuages bougent). Sinon, reprends à l'étape 4 (trois essais au plus).
6. Écris \`${d}/rapport.md\` : verdict (corrigé / partiel / non reproduit), cause, correctif (fichiers), écarts mesurés,
   images (chemins relatifs à ce dossier), ce qui reste douteux.
7. Commit sur \`bug/${id}\`, message en français dans le style du dépôt (\`fix(<zone>): …\`).
   Ne pousse pas et n'ouvre pas de PR : le propriétaire regarde l'avant/après d'abord. Arrête le serveur de dév.
`
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

async function signaler(racine: string, c: Constat) {
  const id = new Date().toISOString().replace(/\D/g, '').slice(2, 14)
  const dossier = path.join(racine, '.signalement', id)
  fs.mkdirSync(dossier, { recursive: true })
  const { image, ...reste } = c
  fs.writeFileSync(path.join(dossier, 'utilisateur.png'), Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'))
  fs.writeFileSync(path.join(dossier, 'signalement.json'), JSON.stringify({ id, ...reste }, null, 2))
  // Les worktrees vont sous le checkout principal, même quand le serveur tourne dans un worktree.
  const commun = path.resolve(racine, await git(racine, 'rev-parse', '--git-common-dir'))
  const lieux = {
    dossier,
    racine,
    worktrees: path.join(path.dirname(commun), '.claude', 'worktrees'),
    sha: await git(racine, 'rev-parse', 'HEAD'),
    sale: (await git(racine, 'status', '--porcelain', '--untracked-files=no')) !== '',
  }
  const prompt = consigne(id, c, lieux)
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
